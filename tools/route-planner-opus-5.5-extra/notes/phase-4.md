# Phase 4: days, meals, fuel, time zones, sunset and zones

Date: 2026-11-07. Result: done. `POST /api/plan` now plans whole days: it picks where each driving day ends, plans lunch, dinner and fuel along with the breaks, shows every time in local time with a row where the clock changes, gives sunset per day, and applies all five zone types. The page shows it all: day headers with chips, meal / fuel / merged / overnight / clock-change rows, a picker for meals and overnights, day chips and the selected day on the map, meal blocks and windows in the day strip, a zone-type editor that says what each zone did, and "avoid this road" for a closed road. `make test`: 200 passed (150 before, 50 new).

## The algorithm in plain words

The phase 3 pipeline stays: places → choices → segments → a cheapest path per segment → clock. Two passes were added and the path carries more state.

1. **Choices** (`choices.prepare`) also look at the zones, with each candidate's own `lat`/`lon`:
   - a place in a **no-stops** zone leaves the choices (kept in `zoned` so the picker can name the zone);
   - a place in a **no-meals** zone stays, but has no meal cost;
   - a place in a **no-overnight** zone is not a place to stay;
   - a place in a **prefer** zone costs 8 less as a break or meal (less than a break's fixed 10, so a prefer zone never adds stops) and 15 less as a night.
   - Each choice also gets a **meal place**: the member of its 2-mile group with the cheapest meal cost (detour, +6 when fewer than 3 places to eat match the food filter). A rest area wins a break, the town next to it wins lunch.
2. **Days** (`days.py`, new). The trip is cut at the start, the user's overnights and the end; those never move. Inside each stretch a cheapest path runs over the places to stay (at least 2 lodgings, merged within 2 mi, keeping the one with most lodging). Each edge is one day and costs:
   - 100 per day (fewest days first);
   - (hours of driving)² (even days: 6 + 6 beats 8 + 4);
   - 3 per minute of driving past 8 h, of arriving after 19:00, and (when "stop driving at sunset" is on) of arriving after sunset;
   - the place: +5 under 4 lodgings, its detour, −15 in a prefer zone.

   The arrival time is an estimate: start of the day + driving + timed stops + about one break per interval + the lunch or dinner the day drives through. A pinned night ("stay here instead") must be on the path. The chosen places become overnight places (nights 1) and everything after works as for the user's overnights.
3. **Stops** (`stops.py`, new; it replaces `graph.plan_segment` in the schedule). Same walk as phase 3, but each way of reaching a place is a *label* that remembers the clock (UTC minutes), lunch done, dinner done, the mile of the last fill-up, where the break clock last restarted, and the last stop. At a place a label can go on as:
   - a **break** (15 min, restarts the break clock);
   - **lunch** or **dinner**, only arriving inside the window in local time there, at a place with matching food outside no-meals zones (the meal's minutes, restarts the break clock);
   - a **fuel-only** stop (10 min, does not restart the break clock, never within 20 min of another stop);
   - and any break or meal at a place with fuel may also fill the tank: that is a **merged** fuel stop ("merged: fuel was due by mile 300").

   Costs: the phase 3 gap and stop costs for breaks; 10 + meal cost per meal; 2 to fill up at a stop; 25 for a fuel-only stop; 120 when a meal window passes without the meal (so a meal is planned whenever anything fits, and the plan warns when nothing does); 5 per mile past the fuel due point. Hard rules (break clock within 110 %, fuel by mile 300, detour limit) relax in steps as in phase 3: detours, then late fuel, then long gaps; the last step always finds a path.

   To stay small, at each place and each (lunch, dinner) a label is dropped when another is no costlier, filled up no earlier, restarted the break clock no earlier, and leaves no later but at most 20 min earlier; at most 8 are kept. With meals and fuel off this finds exactly phase 3's path (a test checks 40 random graphs).
4. **Between segments** (`schedule.after_hard_stop`): a timed stop keeps the tank and counts as a meal when at least the meal's minutes of it fall inside the window ("lunch during this stop"); an overnight fills the tank, has dinner "near the hotel" when reached by 19:30, and starts the next day at the day start with no meals done.
5. **Clock** (`clock.py`, new). Times run in UTC minutes; each row is shown in the zone of the route at its mile (timezonefinder + zoneinfo/tzdata). Where the route crosses a zone line (found every 5 mi, then halved to 0.1 mi) a `clock` row says "into Mountain time (MDT): clocks go back 1 h · it was 15:00 CDT". Meal windows are local to the place of the meal. Sunset (astral) is computed for each day's arrival place.
6. **Explaining zones** (`schedule.zone_effects`). The plan is made a second time without the stop zones. A stop whose counterpart (same kind, same day, same order) sits in a zone that rules that kind out says "moved from Montrose: no-meals zone"; one that lands in a prefer zone instead says "⭐ prefer zone: instead of Eagle (exit 147)". Each zone gets one line: what it moved, "driven through on days 1 and 5, no stops planned", or "not on this route". Avoid zones are explained by asking Valhalla for the route without each one (at most 4, in parallel, cached with the analysis): "the route goes around it: +6 min, +3.1 mi" or "not on this route".
7. **Warnings**: long gaps and over-limit detours as before, plus missed meals, late fuel, a day over the driving limit (with the place that would have kept it inside and what that would have cost: "Close would make it 7 h 50, but the trip would need another day", or "no place to stay (2 or more lodgings) within 8 h 00 of A"), arriving after 19:00, and arriving after sunset.

### Decisions I made

- **Settings live in `trip.breaks`** next to the break settings: `meals` (lunch, dinner, food filter), `fuel` (range, refuel after, fill at overnight, fuel-stop minutes, merge minutes) and `days` (start, driving minutes, arrive by, automatic overnights, min lodging, stop at sunset). The request gets `meals`, `fuel`, `days` and `day_start`. Pins have a `kind` (break, lunch, dinner, overnight); old pins default to break.
- **Zones other than avoid never reach the analysis cache key** (`PlanRequest.analysis_request()`), and the page re-plans them with `updateStopZones()` instead of re-routing: switching Glenwood from prefer to no-overnight sends one `/api/plan` and no `/api/route`.
- **A meal on arrival counts.** Lunch is only planned on the road when the driving runs past 13:30; arriving at 13:25 means lunch at the destination. Same for dinner at the trip's end.
- **Fuel is assumed full at departure**, and an overnight that sells no fuel still fills up (the hotel town is assumed to have some).
- **Places to stay use the cluster's lodging count** (lodging attached to the exit or town by the phase 2 importer), not a fresh 2-mile radius search. An exit's place to stay is named by its town: "Glenwood Springs (exit 116)".
- **The phase 3 break tests now turn meals, fuel and automatic overnights off** (`BREAKS_ONLY` in `test_schedule.py`, also used by the two phase 3 integration tests), because they check the break rules alone. `test_schedule.py`'s hand-made route moved from Kansas to Utah/Colorado: it used to cross the Central time line at mile 192, which now adds a clock row. `test_api.py`'s fake road also crosses into Central time, so two of its row lists gained a `clock` row. No other phase 3 test changed.
- **Stop markers** use icons per kind (☕ 🍴 ⛽ 🛏, a small ⛽ badge when merged); overnights and meals can be dragged to another place like breaks and get pinned for the same purpose. The candidate card gained "Lunch here", "Dinner here" and "Stay here".
- **"Avoid this road"** is a button on a closure row that is closed on the trip's dates. It adds an avoid zone (a concave hull of the closed road's ways, padded 400 m, simplified; `seasonal.avoid_ring`). In the browser, Estes Park → Grand Lake on Jan 15 went from 47 mi over Trail Ridge Road to 145 mi round by Berthoud Pass. On the loop it makes waypoint B (on Trail Ridge Road) sit inside the zone, and the existing check says so.

## What was built

| file | does |
| --- | --- |
| `models.py` | `Meal`, `MealSettings`, `FuelSettings`, `DaySettings`, `StopRef.kind`, `PlanRequest.analysis_request()` |
| `zones.py` | stop zones: `stop_zones`, `zones_at`, `ruled_out_by`, `zone_words` |
| `seasonal.py` | `avoid_ring` |
| `planner/choices.py` | zones per candidate, meal cost and meal place, places to stay, `place_name` |
| `planner/clock.py` | time zone lookup, UTC minutes ↔ local, crossings, sunset, next morning |
| `planner/days.py` | stretches, the overnight path, alternatives, why a day is long |
| `planner/stops.py` | the label path: breaks, meals, fuel |
| `planner/graph.py` | `Node` gains meal and fuel fields; `Rules.fuel_late_ok`; the break-only path stays as the reference |
| `planner/picker.py` | meal alternatives (window, food, zone), zone-ruled places listed |
| `planner/schedule.py` | the pipeline above, rows for meals / fuel / auto overnights / clock changes, UTC clock, days with sunset and chips, warnings, zone effects |
| `planner/analysis.py` | `avoid_ring` on closed roads, `avoid_effects` |
| `pyproject.toml` | `timezonefinder`, `tzdata`, `astral` (image rebuilt) |
| `frontend/state.js` | example trip with Ouray and the four zones, meal / fuel / day defaults, `updateStopZones` |
| `frontend/edits.js` | pin kinds, `setTripSettings`, `avoidClosure`, zone changes re-route only for avoid zones |
| `frontend/sidebar.js` | day chips, rows for meals, fuel, merged stops, overnights, clock changes, sunset; "Avoid this road"; the meals / fuel / days editor; the zone type editor with effects |
| `frontend/map.js` | markers per kind, picker for meals and overnights ("Stay at … instead"), day chips and the selected day on the route, candidate card pins per purpose |
| `frontend/timeline.js` | meal blocks, lunch and dinner windows, 🛏 blocks, clock change and sunset marks |

Tests added (50): `test_days.py` (11: limit, balance, prefer, no-overnight with its alternative and zone effect, user overnights fixed, over-limit warning with the alternative, nowhere to stay, stay here instead, skip, too little lodging, auto off), `test_meals_fuel.py` (15: lunch window and break reset, dinner at the overnight, dinner on the road, no-meals zone moves lunch, food filter, missed meal, timed stop over lunch, pinned lunch, fuel by the due mile and merged, fuel-only stop, merge within 20 min, fill at overnight and across days, through a timed stop, fuel off, state path = break path), `test_zones_clock.py` (19: each zone type, prefer close call, no-stops moving a break, zone off the route, stop zones never in the route request, Texas / New Mexico crossing, local times and the clock row, local meal windows, sunset and after dark, stop at sunset, the avoid ring), `test_api.py` (+2), `test_integration.py` (+3: the example loop within the rules, Denver → Durango lunch and fuel, avoid Trail Ridge in winter).

## Results on the example trips

Default settings, pace 1.05, Valhalla's routes, everything in Mountain time.

**Denver → Durango**, Fri Sep 24, 2027, 08:00. One day, 337 mi, 6 h 21 driving, arriving 15:37 (sunset 19:05):

| arrive | stop | mile | note |
| --- | --- | --- | --- |
| 09:37 | ☕ Break, Fairplay | 85 | 1 h 38 after Denver, in the window |
| 11:40 | 🍴 Lunch, Saguache | 182 | the only place with food inside 11:30–13:30 on that stretch (2 places to eat) |
| 14:11 | ☕ Break + ⛽ fuel, Pagosa Springs | 277 | merged: fuel was due by mile 300 |
| 15:37 | Durango | 337 | |

The mockup has fuel at South Fork before Wolf Creek Pass. The planner puts it at Pagosa Springs, after the pass, because the tank is only due at mile 300 and Pagosa is the better break. With a no-meals zone over Saguache (checked in the browser), lunch moves to South Fork at 12:50 and takes the fuel with it: "🍴 Lunch + ⛽ fuel · South Fork · moved from Saguache: no-meals zone · merged: fuel was due by mile 300", which is the mockup's South Fork stop for a different reason.

**Colorado loop**, Sat Sep 25 – Wed Sep 29, 2027, with the Ouray through point and the four example zones. 928 mi, 18 h 22 driving, 4 nights (2 chosen by the planner), 9 stops:

| day | from → to | miles | driving | stops (arrival) | arrive | notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Sat | Denver → Glenwood Springs (exit 116), auto | 286 | 5 h 52 | ☕ Estes Park 09:23 (early: nothing on Trail Ridge Road) · 🍴 Hot Sulphur Springs 11:37 · ☕ Edwards rest area 14:12 | 15:09 | ⭐ prefer zone, instead of Eagle (exit 147) at 5 h 23; chip "short day: prefer zone"; dinner near the hotel |
| 2 Sun | Glenwood Springs → Durango (C) | 247 | 4 h 54 | ☕ Golden Gate Gas 09:26 · through Ouray 11:20 · ☕ rest area near Ouray 11:26 | 13:25 | no lunch stop: arrival is inside the lunch window; Montrose (mile 426) is passed at about 10:40, before it |
| 3 Mon | no driving, Durango | | | | | |
| 4 Tue | Durango → South Fork, auto | 103 | 2 h 02 | | 10:01 | see surprises |
| 5 Wed | South Fork → Great Sand Dunes (D, 3 h) → Denver (E) | 293 | 5 h 35 | 🍴 lunch during the dunes stop (09:20–12:20) · ☕ rest area near Poncha Springs 13:54 · ☕ Pine Junction 16:04 | 17:05 | |

What the planner did, asked in the brief:

- **Day 1 ends at Glenwood Springs**, as in the mockup, but not for the mockup's reason. Without the prefer zone it would end at Eagle (exit 147), the most even split (5 h 23 + 5 h 23); the prefer zone's bonus moves it 31 mi on (5 h 52 + 4 h 54). Grand Junction's motels are not on this route: Valhalla leaves I-70 at Palisade (exit 42) and takes US-50 through Clifton and Whitewater to Delta and Montrose, so the mockup's "Grand Junction: 7 h 50" becomes Palisade (exit 42, 4 lodgings, about 7 h 10), which loses on balance.
- **Lunches**: day 1 at Hot Sulphur Springs (11:37, one restaurant: the thin-food cost loses to the timing), day 5 during the 3-hour dunes stop. Day 2 has none on the road (arrival 13:25).
- **Montrose is not skipped for lunch**, because no lunch falls near it: it is passed at about 10:40, before the window. The no-meals zone says "driven through on day 2, nothing changed". The zone works (tests, and the Saguache check in the browser), but this loop does not exercise it.
- **Fuel**: no fuel stop at all. Every day is under 300 mi and every overnight fills the tank. Denver → Durango shows the merged fuel stop.
- **Zones**: Boulder: "not on this route: it is the same without the zone" (Valhalla's route to Estes Park already misses downtown Boulder). Denver metro: "driven through on days 1 and 5, no stops planned". Montrose: as above. Glenwood Springs: "chosen for the night on day 1 (instead of Eagle (exit 147))".

The plan with the loop's 123 choices takes about 300 ms (two plans: one to explain the zones); Denver → Durango about 70 ms.

Browser checks (screenshots in `prompts/phase-4/`): the loop's day 1 itinerary with the overnight row and day chips; the Glenwood night's picker with its alternatives and "Stay at Eagle (exit 147) instead" (which pinned it, and unpinning brought Glenwood back); the zone editor (switching Glenwood to no-overnight re-planned with one `/api/plan` and no `/api/route`, and the night went back to Eagle); Denver → Durango with lunch moved by a zone, the merged fuel break, and the day strip with the lunch block and window; "Avoid this road" on Estes Park → Grand Lake in January.

## Surprises

- **Day 4 of the loop is a two-hour day.** Durango → Great Sand Dunes (3 h) → Denver is 7 h 36 of driving, inside the 8 h limit, but with the dunes and the stops it arrives about 19:50, after 19:00. Splitting it is cheaper. OSM has almost no lodging on US-285 after the dunes (Poncha Springs, Buena Vista and Johnson Village have at most 1 lodging each attached to the route), so the choice is South Fork (2 h 02, then 5 h 35 with the dunes) or Fairplay (6 h 00 with the dunes, then 1 h 38); squares favour South Fork by a little. The mockup's Salida is 5 mi off the route, outside the 2-mile corridor. Taking the dunes day long and the last morning short would be as reasonable; I did not tune for it.
- **Balance needs fewest-days first.** Sum of squares alone always prefers more, shorter days; the 100-per-day cost keeps the day count at the minimum. The limits are soft at 3 per minute, so a day that is 20 minutes over stays one day rather than adding a night ("Close would make it 7 h 50, but the trip would need another day").
- **The plain plan knows nothing of zones**, so "moved by a zone" looks the plain plan's place up in the zones directly. The first version compared zone lists and never found a move.
- **Meal early-cost is the break early-cost.** A meal 50 minutes after a break pays the same "early" cost as a break would. It moves breaks around lunch nicely (Fairplay 09:37 → Saguache 11:40 → Pagosa 14:11), and I left it.
- **Hand-made test routes cross time zones easily.** Both phase 3 test fixtures that ran east along latitude 38–39 crossed into Central time in western Kansas.
- `timezonefinder` loads in about 10 ms and answers in well under a millisecond; lookups are cached at 3 decimals.
- The browser pane is about 800 px wide; screenshots were taken with a 1100–1280 px emulated viewport, scaled down.

## What phase 5 needs

- **Trip files** must save `trip.breaks` as it now is: `settings`, `meals`, `fuel`, `days` (with `start`), `pins` (each with `kind`) and `skips`. Old trips without `meals` / `fuel` / `days` load with the defaults (`ensureBreaks`). The trip's zones carry `type`; avoid is the only one that changes the route.
- **Zone library**: `plan.zone_effects` is keyed by zone id; a library zone switched on for a trip can use the same ids. Effects for zones that are off need a plan with the zone on (one extra `/api/plan` per zone; for avoid zones one extra route, like `analysis.avoid_effects`).
- **Settings page**: everything it edits is in `trip.breaks`, and the compact editors in the sidebar footer show what each field means. `min_lodging` and the fuel-stop and merge minutes have no editor yet.
- **Exports** have everything per row: local `arrive` / `depart` with `tz`, `day`, `type` (start, through, break, lunch, dinner, fuel, stop, overnight with `auto`, clock, end), `lat` / `lon`, `refuel` and `fuel_note`, `hotel_dinner`, and per day `sunset`, `miles`, `driving_minutes` and `chips`. Day sheets can print the clock-change rows as they are. GPX and Google Maps links per day can take the rows between a day's start and end.
- **Not done**: a brand filter for food and lodging (PLAN says later); the day-cost arrival estimate ignores detours; sunset is taken on the trip's first date for every stretch (a few minutes off over a week); the meal place of a merged group may sell fuel when the break place does not (fuel follows the place of the visit).
