# Phase 3: breaks

Date: 2026-11-07. Result: done. `POST /api/plan` plans a break every 2 h or 150 mi (whichever comes first) at real places, with clock times. Denver → Durango gets three breaks (Fairplay, Saguache, Pagosa Springs). The Colorado loop gets eight. In the browser, pins, skips, "use this one" and dragging a break marker re-plan in 15–40 ms with no Valhalla call. The stop picker shows the window band and ranked alternatives, and the day strip shows driving, stops and due times. `make test`: 150 passed (109 before).

## The algorithm in plain words

1. **Places.** The analysis from phase 2 (`analysis.py`, cached per route) now also returns each waypoint's mile and driving minute, and keeps the route's `Timeline` next to its answer.
2. **Segments** (`schedule.segments`). The trip is cut at every waypoint it stops at: the start, timed stops, overnights and the end. Through points cut nothing. Each segment is planned on its own, so a timed stop resets the break clock, and after an overnight the next day starts at the day-start time (08:00).
3. **Choices** (`choices.prepare`). Candidates are copied and named by place and pass (`1234#2` = the second time the route passes cluster 1234). Then:
   - skipped places are taken out;
   - places within 2 mi of a waypoint the trip stops at are taken out;
   - places within 2 mi of each other along the route become one choice, and the best member represents it. The order is: a pinned member first, then one within the detour limit, then the lowest cost. Glenwood Springs and I-70 Exit 116 merge into one choice;
   - each choice gets its own **stop cost**: 0 for a rest area, 4 for a service plaza, 8 for a place with fuel and food, 16 for anything else. Each minute of detour (there and back) adds 1, and fewer than 3 places to eat or buy fuel adds 4.
4. **Breaks** (`graph.py`). In each segment, the nodes are: segment start → choices in route order → segment end. An edge exists if the drive between its two nodes is at most 110 % of the interval, in minutes *and* in miles. Its cost depends on the **share** of the interval the drive uses (the larger of minutes/N and miles/M):
   - inside 75–100 %, it costs 0;
   - each minute early costs 1. The last drive of a segment is never early, because arriving soon after a break is fine;
   - each minute late (100–110 %) costs 2.

   Every stop also costs a fixed 10 plus its stop cost, so that other things equal there are fewer breaks. The planner takes the cheapest path, in a single forward pass. Looking back from each node, the pass stops at the first pinned node (no edge jumps over a pin) and at the first drive past the hard maximum.
5. **When nothing fits**, the rules relax one step at a time and only as far as needed. Step 1 allows stops over the detour limit (+60 each). Step 2 also allows drives past the hard maximum (+10 per minute over). Step 2 always finds a path, so planning never fails. Each long drive gives a warning that names the stretch ("No stop between South Fork and Near Treasure within 38 min; longest gap 46 min."), and each over-limit stop gives one too.
6. **Clock** (`schedule.clock_rows`). Walk the rows (waypoints and breaks) in route order:
   - the clock moves by the driving minutes between rows (the sidebar's clock: curve correction and pace);
   - a break adds its minutes plus its detour;
   - a timed stop adds its minutes;
   - an overnight jumps to the day-start time after its nights.
7. **Per break** (`picker.py`):
   - the **window** it was chosen from: earliest, latest and hard-maximum minute, as miles and clock times, counted from the stop before;
   - the **alternatives**: every choice between the stop before and the stop after, each judged as if it took this slot with its neighbours fixed (drive in + drive out + stop cost). The ruled-out ones say why: over the detour limit, no way in from this side, too late after the previous stop, leaves too long to the next one, or skipped;
   - the **reason** it won ("fuel and food · 1 h 46 after Fairplay, in the window · on the way · best of 3", or "pinned by you …").
8. **Due times.** After every reset of the break clock, the next break is due when a full interval is used. Each day's last one becomes the "next break would be due at …" note.

### Decisions I made

- **`/api/plan` is a new endpoint that extends `/api/route/stops`**, rather than a change to it. It takes the trip plus `breaks` (settings), `pins`, `skips` and `day_start`. It answers with everything `/api/route/stops` does, plus `plan`. The analysis cache is keyed by the route part of the request only (`PlanRequest.route_request()`), so a pin, a skip or a settings change finds the candidates and detours there and makes no Valhalla call. This is checked by a test that counts the calls. `/api/route/stops` stays as it was for its tests; the page no longer calls it. The page still draws the route from `/api/route` first, and asks `/api/plan` once the route has settled, as before. Dragging the route line is as fast as it was.
- **Detour limit fixed**: `DETOUR_EACH_WAY_MIN = 5` and `DETOUR_LIMIT_MIN = 10`, there and back. The break settings carry `max_detour_each_way`, so `/api/plan` recomputes `over_limit` per trip. The UI says "5 min each way" everywhere. The phase 2 integration test that expected Edwards' far-side rest area (6.7 min there and back) to be over the limit now expects it within.
- **Huge "other" groups are cut down, not split** (`loose.py`). A loose group with more than 12 amenities on the route keeps only the member nearest this pass of the route, plus the members within half a mile of that one. Counts, position, mile and the phase 2 `key` are worked out again from those, and `spread` says "15 of 18 places in this group". This runs before the detours, so the detour is the detour to the place the planner will name. Splitting the whole group along the road would give more candidates but none better placed: a driver stops at the nearest cluster of businesses anyway.
- **Detours count as stop time**, not driving time, as the phase 2 notes suggested. A break's dwell is 15 min plus its detour, and the gaps between breaks are route minutes only. The detour is at most 10 min and is split across both sides, so it hardly changes the gap.
- **"Use this one"** pins the alternative and unpins the old break, if it was pinned. **Dragging** a break marker does the same with the candidate nearest the drop point. Pinned stops are always used, even over the detour limit (the user chose them).
- **Pins and skips live in `trip.breaks`** with the settings (`{settings, pins: [{key, name}], skips: [...]}`), in localStorage like the rest of the trip. A pin or skip whose `key` is no longer among the candidates is dropped by the server with a warning ("Pinned stop Fairplay is no longer on the route; dropped."), and the page removes it from the trip.

## What was built

| file | does |
| --- | --- |
| `models.py` | `BreakSettings` (every_minutes, every_miles, minutes, window_start, window_end, hard_max, max_detour_each_way), `StopRef`, `PlanRequest` |
| `timeline.py` | `minute_at_mile`, `mile_at_minute` |
| `pois/db.py` | `cluster_members` |
| `planner/analysis.py` | caches the Timeline with the answer, adds waypoint miles and minutes, `stop_key` per candidate, runs `loose.tighten` before detours |
| `planner/loose.py`, `choices.py`, `graph.py`, `picker.py`, `schedule.py` | as above |
| `main.py` | `POST /api/plan`; the error handling shared with `/api/route/stops` |
| `frontend/state.js` | `trip.breaks`, `updatePlan()` (re-plan without re-routing), `/api/plan` instead of `/api/route/stops`, forgets dropped pins |
| `frontend/sidebar.js` | Itinerary: one header per day (several days fold, the one picked opens), rows with clock times for depart, breaks (place, mile, detour, what is there, why it won, chips: pinned, over the limit, also here, group spread), through points, timed stops ("the break clock starts again here"), overnights (arrive, then "Leave … after 2 nights"), arrival, and the "next break would be due at …" note. Plan warnings at the top. The sidebar footer has chips (☕ every 2 h or 150 mi · 15 min each · ≤ 5 min off route · pins and skips) that open the break settings editor |
| `frontend/map.js` | Break markers with time labels (☕, or 📌 when pinned). They can be dragged, and snap to the nearest candidate and pin it. The stop picker: a card with the window and ranked alternatives (arrival time, reason, amenities; ruled-out ones greyed with the reason) and Pin / Use / Skip. On the map, the window is a shaded band on the road with an amber stretch up to the hard maximum, and each alternative is a dot with its arrival time. Candidate cards gained "Pin as a break" and "Skip on this trip" |
| `frontend/timeline.js` | The day strip: driving blocks with durations, ☕ and timed-stop blocks (click a ☕ to open its picker), start and end letters, through diamonds, "due" markers, the open picker's window, hour ticks, and a chip per day |

Tests added: `test_graph.py` (13: short, dense, sparse, none, long empty stretch, over-limit only when needed, unreachable never, pins incl. far and over-limit, kind vs timing, miles limit, window cost), `test_choices.py` (12: loop passes, limit each way, preference order, costs, merges incl. Glenwood and the far-side case, pinned member, skips, near waypoints, dropped pins and skips, input untouched), `test_schedule.py` (9: break dwell and detour, timed stop dwell and reset, overnight with nights and day start, through point, window, due times, alternatives, skip and pin, long-gap warning text, settings, no date), `test_loose.py` (2), `test_api.py` (+3, including the no-Valhalla re-plan), `test_integration.py` (+2: Denver → Durango three breaks within the rules, and the loop's resets).

## Results on the example trips

Default settings, pace 1.05, Valhalla's default routes.

**Denver → Durango**, Fri Sep 24, 2027, departing 08:00. 337 mi, 6 h 21 of driving, arriving 15:07 with 47 min stopped:

| arrive | stop | mile | after the last stop | detour | what is there | why |
| --- | --- | --- | --- | --- | --- | --- |
| 09:37 | Fairplay | 85 | 1 h 38 | +1.4 | 10 food, 3 fuel, 3 lodging | in the window, best of 3 |
| 11:40 | Saguache | 182 | 1 h 46 | +0.3 | 2 food, 2 fuel | in the window, best of 3 |
| 13:41 | Pagosa Springs | 277 | 1 h 46 | +0.1 | 12 food, 3 fuel, 8 lodging | in the window, best of 8 |

The next break would fall due at 15:56, 49 min after arriving. In the browser the trip leaves at 08:30, so every time is 30 min later.

**Colorado loop**, Sat Sep 25 – Mon Sep 27, 2027. 878 mi; day 2 has no driving (2 nights in Durango):

| day | arrive | stop | mile | after the last stop | note |
| --- | --- | --- | --- | --- | --- |
| 1 | 09:23 | Estes Park | 69 | 1 h 24 (early) | nothing on Trail Ridge Road, so it goes early, as in the mockup |
| 1 | 10:26 | through Trail Ridge Road (B) | 95 | | |
| 1 | 11:37 | Hot Sulphur Springs | 141 | 1 h 56 | |
| 1 | 13:35 | Leadville North | 228 | 1 h 42 | |
| 1 | 15:45 | Saguache | 327 | 1 h 55 | |
| 1 | 17:46 | Pagosa Springs | 423 | 1 h 46 | |
| 1 | 19:12 | Durango (C), 2 nights | 483 | | a 9 h 55 driving day: phase 4's daily limit and automatic overnights will split it |
| 3 | 10:01 | South Fork | 585 | 2 h 02 (late) | from Durango at 08:00; Wolf Creek Pass has nothing earlier |
| 3 | 11:37–14:37 | Great Sand Dunes (D), 3 h | 651 | | the break clock starts again |
| 3 | 16:11 | Rest area near Poncha Springs | 737 | 1 h 34 | a rest area with 5 food and 2 fuel attached |
| 3 | 18:21 | Pine Junction | 839 | 1 h 54 | |
| 3 | 19:22 | Denver (E) | 878 | | |

Long empty stretch: Denver → Durango with breaks every 35 min or 35 mi warns about two stretches: "No stop between South Fork and Near Treasure within 38 min; longest gap 46 min" (Wolf Creek Pass), and Fairplay → Near Johnson Village (39 min, over Trout Creek Pass).

Browser checks (Denver → Durango): pinning Near Center in Saguache's place moved the next break from Pagosa Springs to Club Wyndham. Skipping Club Wyndham gave Near Dyke, and Club Wyndham shows as "skipped on this trip" in the picker. Dragging the Fairplay marker toward Bailey snapped to Shawnee and pinned it. Each of these sent only `POST /api/plan` (16–38 ms, `from_cache: true`).

## Surprises

- **Fewer breaks needed a cost of their own.** Without a fixed cost per stop, a rest area with no detour costs 0, so an extra break there was free and short segments got pointless stops. Each break now costs 10.
- **Colorado's US-285 / US-160 lines up neatly with 2-hour breaks.** Fairplay, Saguache and Pagosa Springs fall at 1 h 38–1 h 46 each, all inside the window. The mockup's South Fork (fuel before Wolf Creek Pass) is a phase 4 fuel rule; without it, Pagosa wins on cost.
- **"Rest area" has no name in OSM** near Poncha Springs (mile 141). The itinerary adds "near Poncha Springs" from the cluster's `near`.
- **Ruled out "before the window" is not a rule here.** The mockup greys "Delta: before the window". The graph allows early stops at a cost (the loop's Estes Park needs one), so the picker lists early places as possible, labelled "early: 1 h 24 after Denver". Only what the graph forbids is greyed: too late, leaves too long to the next stop, over the detour limit, unreachable, skipped.
- **Valhalla restarted once during `make test`** (restart count 2, not killed for memory, exit code 0, nothing in its log). It came back by itself within seconds. Two Valhalla integration tests failed that run, and the reruns all passed. I could not find the cause.
- **Clicks in the browser pane landed off target while a 1280 × 800 viewport was emulated.** Clicks by element ref worked for list rows. The picker buttons were checked with DOM clicks and a real mouse drag of a break marker.
- The plan itself is fast: 1–4 ms for the loop's 102 choices. The cost is in the first analysis (Valhalla route, detours, closures), as in phase 2.

## What phase 4 needs from this design

- **Automatic overnights** are more segment ends. `schedule.segments()` takes the waypoint places. Add chosen lodging stops as places of type `overnight` (nights 1) before calling it, and the clock, the days, the due times and the itinerary handle them already. Choosing them is a pass of its own over the same choices (lodging ≥ 2, near the daily limit), before the break pass.
- **Meals and fuel** extend `graph.py`. The node state becomes (choice, lunch done, dinner done, fuel left). `cheapest_path` is a forward DP that keeps one best per node, so it would keep one best per (node, state) instead. The lunch and dinner windows are clock windows, so the DP needs the clock at each node. That clock is driving minutes plus the stops so far, which is path-dependent: carry the elapsed stop minutes in the state, or approximate with 15 min per break. A meal resets the break clock (an edge into a meal node is judged like a break). Merging a fuel stop with a break 20 min away is a node cost in the same graph.
- **Daily limits** (8 h driving, arrive by 19:00) are soft. Turn them into segment cost when choosing overnights, and into warnings.
- **Time zones and sunset**: `clock_rows` works in naive local time from `depart`. Put the time zone change at the row where the route crosses it (each row has lat and lon), and add sunset per day from astral.
- **Zones**: no-stops and prefer apply per choice. In `choices.prepare` they can drop a candidate or lower its `cost`; each candidate has `lat`/`lon` for `zones.ring_contains`. No-meals and no-overnight only matter to the meal and overnight nodes.
- **Settings** live in `trip.breaks.settings` and are sent as `breaks`. The phase 5 settings page should edit the same object (and `day_start`, which today is only the default).
- **`stop_key` (id#pass)** is the stable name for anything the user pins or skips, and meals and overnights should use it too.
- The candidate card's "Pin as a break" pins a place that can be outside any break's slot. The graph then plans around it, and the "why" says "pinned by you · early …". Meals will need their own pin kind ("lunch here").
