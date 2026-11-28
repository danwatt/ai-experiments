# Phase 5: trip files, the zone library, settings, exports, start from here

Date: 2026-11-09. Result: done. Trips save to `trips/<slug>.json` and load back; zones live in a shared library that each trip switches on and off; a settings page edits every rule the planner reads; day sheets, GPX and Google Maps links come out of the trip as it is on screen; two small phase 4 gaps are closed; and a button makes the car's position the new start. `make test`: 300 passed (200 before, 100 new). Nothing committed.

## What was built

| area | where | does |
| --- | --- | --- |
| trip files | `backend/app/trips.py`, `GET /api/trips`, `GET`/`PUT`/`DELETE /api/trips/{id}` | plain JSON, `version`, whole trip, validated on the way in and out, atomic write, slug ids only |
| examples | `examples/*.json`, `GET /api/examples/{id}`, `POST /api/examples/{id}/copy` | the two PLAN.md trips, read-only, "Copy to my trips" picks a free id |
| defaults | `trips/defaults.json`, `GET`/`PUT /api/defaults` | what a new trip starts from |
| zone library | `backend/app/library.py`, `GET`/`PUT /api/zones`, `GET /api/zones/export.geojson`, `POST /api/zones/import` | shared zones, GeoJSON in and out |
| "what would it do" | `backend/app/whatif.py`, `POST /api/zones/what-if` | one plan (stop zone) or one route (avoid zone) per off zone, on request |
| exports | `backend/app/export/{sheet,gpx,gmaps}.py`, `POST /api/export/{sheet,gpx,gmaps}` | day sheets, GPX, Google links |
| start from here | `backend/app/here.py`, `POST /api/trip/start-from-here` | position and time in, trip changes out |
| settings the planner did not read before | `models.py`, `planner/choices.py`, `planner/stops.py`, `planner/candidates.py` | stop order, search distance, lodging brands, closure warnings, meal resets the break clock |
| phase 4 fixes | `planner/days.py` | each day's own sunset; arrival counts half the hotel's detour |
| map data card | `backend/app/mapdata.py`, `/api/status` (`data`), `/api/lodging-brands` | Valhalla version and tile date, OSM date, places counts, the `make` commands |
| page | `frontend/{trips,library,settings,export,here,dialog}.js`, changes to `state.js`, `sidebar.js`, `map.js`, `app.js` | trip picker, Save, dialogs, Zones tab with two groups, settings page, export page, start from here |

Compose: `./trips:/trips` and `./examples:/examples:ro` were not mounted yet; the api container was recreated for that. The image gained `gpxpy` (rebuilt). Valhalla was not touched.

### The page

- **Trip picker** (toolbar): the name, an amber dot while there are unsaved changes, and a panel with My trips (open, ✕ delete with a confirm), the examples (Open, Copy to my trips), New trip, Save as and a rename field. **Save** writes the trip to its file (or asks for a name the first time; the name makes the file name). Opening, creating or copying over unsaved work asks first: Save then go on, Discard, Cancel. All dialogs are built into the page (`dialog.js`).
- **Draft:** `localStorage` still holds the working trip, now with the id of the file it came from and what the file held when it was last loaded or saved. A reload keeps unsaved work, and "unsaved" is the difference between the trip's file form and that snapshot.
- **First visit** (no draft) opens the Colorado loop example as an unsaved trip.
- **Zones tab:** two groups, "On for this trip" and "In the library, off for this trip", each row with its switch, a badge (📚 library or this trip only) and what it did. Off zones have "What would it do?" (one zone) and "What would each one do?" (all): on request only. The zone card on the map has a "Keep it in: The library / This trip only" switch; a new zone starts in the library. Editing a library zone saves the library after half a second; switching it on or off is a trip change.
- **Settings page** (⚙ Settings): cards for Schedule, Breaks (as a sentence with the numbers editable in place), Meals, Fuel, Where to stop (draggable ladder), Lodging, Roads and Map data. The scope switch picks This trip (changes re-plan at once) or Defaults for new trips (saved to `trips/defaults.json`; changes no existing trip). Derived limits sit under the fields ("Hard limit: 2 h 12 or 165 mi at these settings", "Fuel is due by mile 300, with 100 mi in reserve"). The compact editors in the sidebar footer were removed: the page edits every field they did, plus the rest, and "Unpin all" / "Un-skip all" moved into the Breaks card. The footer chips stay, as a summary that opens the page.
- **Export page** (📤 Export): a live preview of the day sheets on the left; on the right the day sheets (pick days and parts, "Open N day sheets to print" opens a new tab), the GPX file ("colorado-loop.gpx · 4 tracks · 15 waypoints") and the Google Maps links (phone or computer limit, include planned stops or not, a Copy link and an Open button per link).
- **Start from here** (toolbar 📍): choose "Use my position" (browser geolocation) or "Click the route" (a crosshair, Esc cancels). A confirm says where on the route that is, what departs when, what is dropped and what stays. Nothing changes before the confirm.

## File formats

All three are plain JSON, indented, with `version`. Unknown newer versions are refused with a message; files from an older version (or with fields missing) load with the defaults.

**Trip** (`trips/colorado-loop.json`; the committed examples have the same shape):

```json
{
  "version": 1,
  "name": "Colorado loop",
  "saved_at": "2026-11-10T03:32:06Z",
  "depart": "2027-09-25T08:00",
  "pace": 1.05,
  "search_miles": 2.0,
  "options": { "avoid_tolls": false, "avoid_ferries": false, "avoid_unpaved": false, "alternates": 2 },
  "waypoints": [
    { "id": "loop-a", "name": "Denver, CO", "lat": 39.7392, "lon": -104.9903, "type": "stop", "minutes": 30, "nights": 1 },
    { "id": "loop-b", "name": "Trail Ridge Road", "lat": 40.4413, "lon": -105.7546, "type": "through", "minutes": 30, "nights": 1 }
  ],
  "zones": [],
  "library_on": ["boulder-downtown", "denver-metro", "montrose", "glenwood-springs"],
  "breaks": {
    "settings": { "every_minutes": 120, "every_miles": 150, "minutes": 15, "window_start": 0.75, "window_end": 1.0, "hard_max": 1.1,
                  "max_detour_each_way": 5, "stop_order": ["rest_area", "service_plaza", "services", "any"] },
    "meals": { "lunch": { "on": true, "start": "11:30", "end": "13:30", "minutes": 45 },
               "dinner": { "on": true, "start": "17:30", "end": "19:30", "minutes": 60 }, "food": "all", "resets_break_clock": true },
    "fuel": { "on": true, "range_miles": 400, "refuel_after": 0.75, "fill_at_overnight": true, "minutes": 10, "merge_minutes": 20 },
    "days": { "start": "08:00", "driving_minutes": 480, "arrive_by": "19:00", "auto_overnights": true, "min_lodging": 2, "stop_at_sunset": false },
    "lodging": { "brands": ["Hampton"], "rule": "prefer" },
    "warn_closures": true,
    "pins": [{ "key": "1234#1", "name": "Fairplay", "kind": "lunch" }],
    "skips": [{ "key": "99#1", "name": "Bailey" }]
  },
  "summary": { "miles": 927.7, "driving_minutes": 1102, "days": 5, "arrive": "2027-09-29T17:05" }
}
```

`zones` holds only zones of this trip alone (each with `id`, `name`, `type`, `shape`, `ring`, `enabled`). Library zones are not copied in: `library_on` lists the ones that are on. `summary` is what the page knew of the route when it saved; the trip list shows it. Ids are lower-case slugs (`^[a-z0-9][a-z0-9-]{0,62}$`; `zones` and `defaults` are taken by the other two files).

**Zone library** (`trips/zones.json`; the starting set is `examples/zones.json`: Boulder downtown, Denver metro, Montrose, Glenwood Springs, Aspen, I-70 Glenwood Canyon, DFW core). Rings are `[lon, lat]`, one point per line. The per-trip switch is not stored here:

```json
{ "version": 1, "zones": [
  { "id": "montrose", "name": "Montrose", "type": "no_meals", "shape": "rectangle",
    "ring": [[-107.93, 38.44], [-107.83, 38.44], [-107.83, 38.52], [-107.93, 38.52], [-107.93, 38.44]] } ] }
```

GeoJSON export is a FeatureCollection of Polygons with `{"name", "type", "shape"}` in the properties. Import takes Polygons, MultiPolygons (one zone each, holes dropped), Features or a bare geometry; `type` may be `no-stops` and the like, a missing type means avoid.

**Defaults** (`trips/defaults.json`): the same as a trip without its places, zones, pins, skips and dates (`version`, `pace`, `search_miles`, `options`, `breaks` with `settings`, `meals`, `fuel`, `days`, `lodging`, `warn_closures`). A new trip departs tomorrow at `days.start`.

## Decisions

- **Exports POST the trip** (the same body as `/api/plan` plus the name and choices), not "plan from the saved file". A trip being edited is what people print; the page already has it; and the route and candidates come from the cache `/api/plan` filled, so the exports answer in about 50 ms. The cost is that an export is not reproducible from the file alone: the export page says when the trip has unsaved changes. The day sheets open from a Blob URL, so they do not exist at any address.
- **A library zone is a trip zone with `lib: true`** in `state.trip.zones`. The map, the planner request and the zone effects needed no change; only saving and loading split the two apart (`tripToFile`, `tripFromFile`, `mergeLibrary`). The library is the whole set of `lib` zones in the trip, so editing it from any trip writes the full list.
- **What-if is cheap or not asked.** A zone the route does not touch (checked with shapely on the route line, and on the candidate stops for stop zones) answers "not on this route: switching it on changes nothing" with no plan and no route. Stop zones: one `schedule.plan` from the cached analysis, reading `zone_effects` for that zone. Avoid zones: one Valhalla route with the zone added, compared with the route the trip has now (both as Timelines, so same speeds). Answers are good only while the trip is unchanged.
- **Brand matching is a substring**, in any case: "Hampton" matches "Hampton Inn & Suites" (the data has both). 45 % of Colorado lodging (754 of 1,687) has a `brand` (or `operator`) tag; the settings page says so under the brand rule. "Prefer" takes 8 off a night's cost (`days.BRAND_BONUS`); "Only these" counts just those lodgings toward the minimum and so can leave a town with no place to stay (the plan then warns the day is over the limit).
- **Stop order** is the ladder's four kinds, costs 0, 4, 8 and 16 by position (before it was a fixed table in the same order).
- **A meal resets the break clock** was always on; it is a real setting now (`MealSettings.resets_break_clock`, `stops.Setup.meal_resets`). Off: a meal is a stop, but the next break is still due on the old schedule.
- **Search distance** is a route-level setting (`RouteRequest.search_miles`), so it is part of the analysis cache key.
- **Day sheets carry no "highest point"**: the app has no elevation data (Valhalla was built without it). The shaded rows are clock changes and road notes (the seasonal-closure messages, in place along the day). No "alternate routes" option either: alternates come from `/api/route`, not from the plan.
- **Start from here** keeps the "end" waypoint always, drops waypoints within 0.5 mi ahead of the car as passed, renumbers pins and skips (the pass number of a place counts only passes still ahead), assumes a full tank, and treats the result as a changed trip (Save overwrites the file, Save as keeps the original). A position near two passes of a looping route (Denver at both ends of the loop) is ambiguous: the answer lists the miles and the page asks which one.
- **Sunset per day**: each edge of the overnight path knows its trip day (`Stretch.base_day` plus the days before it in the path), and each place's sunset is a function of that day. A user overnight with N nights moves the next stretch's day count by N. The sunset shown in the plan was already per day.
- **Arrival estimate with detours**: the day-cost arrival now includes half of the night's own there-and-back detour. It still leaves out the detours of the breaks on the way: they are not known until the stops are chosen (note left in `days.day_between`).

## Google Maps links

Source: Google's Maps URLs documentation, Directions action ([developers.google.com/maps/documentation/urls/get-started](https://developers.google.com/maps/documentation/urls/get-started), read 2026-11-09):

- "The number of waypoints allowed varies by the platform where the link opens, with up to three waypoints supported on mobile browsers, and a maximum of nine waypoints supported otherwise." So **3 on a phone browser, 9 elsewhere**. The page does not say whether the native Android and iOS apps count as "mobile browsers"; the page offers both limits and defaults to the phone's.
- `waypoints` are separated by `|` (written `%7C`); a place is a name, an address or `lat,lon`; the URL must stay under 2,048 characters (ours are 120 to 200).
- The format: `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&travelmode=driving&waypoints=…`, plus `avoid=tolls,ferries` when the trip avoids them.

A link's destination is a stop too, so with the phone limit one link covers 3 waypoints plus where it ends (4 places between its origin and the next link's origin); a day with more is several links that follow each other, each starting where the last ended, and the card says "open them in order". Through points are sent as waypoints so Google drives the same roads; Google has no way to mark one as "pass, don't stop", so each shows as a stop. The planned breaks, meals and fuel are also sent unless that switch is off. The card says Google may still route between the points differently (its own roads, speeds and traffic).

On the loop with the phone limit: day 1 is 2 links (4 stops), day 2 is 2 links (5 stops), days 4 and 5 are one each.

## Results

Both examples, with default settings (the phase 4 numbers came out unchanged, as they should):

| trip | day sheets | GPX | Google links (phone) |
| --- | --- | --- | --- |
| Denver → Durango | 1 page: Depart 08:00, Fairplay 09:37, lunch Saguache 11:40, break + fuel Pagosa Springs 14:11, arrive 15:37 | 1 track, 5 waypoints, `denver-to-durango.gpx` | 1 link, 3 waypoints |
| Colorado loop | 4 pages (day 3 has no driving), Trail Ridge Road note on day 1, sunset per day (19:01, 19:02, 18:54, 18:45) | 4 tracks, 15 waypoints, `colorado-loop.gpx` (1.3 MB: the full route shape) | 6 links over 4 days |

Checked in the browser at `http://localhost:8000` (screenshots in `prompts/phase-5/`): the trip picker with saved trips and examples; Save as, rename, delete, copy example, discard prompt; the Zones tab with both groups and what-if answers (Glenwood Canyon: "29 min longer, 14 mi shorter", then switched on: 913 mi, 18 h 51, the same); the zone card with "Keep it in"; moving a zone between the library and this trip only (the library file changed both ways); the settings page (break interval 120 → 90 min re-planned 5 → 8 breaks; defaults scope saved to `trips/defaults.json` and changed no trip; reset); brand add and remove; the export page with its preview, copying links (6 links, all `www.google.com/maps/dir/?api=1…`, parsed with `URL`); start from here on Denver → Durango (a click on the route gave "mile 195, 142 mi to go", departing now at 20:38 MST, Denver dropped, a 2-day plan with the night at South Fork).

GPX: both files parsed with `gpxpy` inside the container (4 tracks of 9.0k, 6.1k, 2.1k and 4.8k points; waypoints with UTC times: 08:00 MDT is 14:00Z).

The print layout was checked by printing the sheets to PDF with the host's Chrome (`--headless --print-to-pdf`, nothing installed): 4 pages, one per driving day, footer at the bottom of each page, the strip and the shaded note row intact.

## Surprises

- **Five fields on the settings card were not inputs to the planner yet**: the stop-kind order, the search distance, lodging brands, the closure warning and "a meal resets the break clock". "Every field takes effect on the next plan" meant adding them to the models and the planner first (stop order and meal reset also changed the plan code; both default to the old behaviour, and the 200 phase 1 to 4 tests did not change).
- **The compose file had no `trips/` mount**, though PLAN.md said so. `docker compose up -d api` recreated only the api container.
- **`mkstemp` makes files `0600`**; trip files are the user's own, so they are chmod'ed `0644` before the rename.
- **Pydantic ignores unknown fields by default**, which is what lets an old file load, and also what let `pace: 9` through `defaults.json` until the settings model got the same bounds as the route request. A test now checks it.
- **A link's destination counts as a stop**: the first version of the splitting test expected 3 links for 7 stops at the phone limit; 7 takes 2 (3 + destination, then 3).
- **The in-app browser pane cannot open the day sheets tab** (`window.open` makes no tab there), so the new-tab step could not be watched in the pane; the preview on the export page is the same HTML in an iframe, and the print layout was checked with Chrome (above). Geolocation was not exercised in the pane either: the click flow was, the "Use my position" button calls `navigator.geolocation.getCurrentPosition` and says so in a message if the browser refuses.
- **Emulating a 1280 px window in the pane crops screenshots to the pane's 800 px**; the native 1024 px layout is used for the screenshots, which made the toolbar overflow: the data note now gives way first and the brand shrinks to its icon under 1180 px.
- **Rings were one number per line** in `json.dump(indent=2)`; the writer puts each `[lon, lat]` pair on one line so a zone file reads as a list of points.
- The OSM date on the sheet's footer and the settings card is the replication timestamp in the PBF header (2026-11-06; read with pyosmium), not the file's date.

## What is left

- **Highest point on the day sheets** (no elevation data) and the mockup's "Alternate routes" option.
- **Geolocation** on a phone browser is untested, and "start from here" needs the page open on a device that can reach the app (it runs on localhost).
- **Breaks' detours in the day arrival estimate** (see Decisions); a brand filter for food (PLAN says later).
- **A trip's file name does not follow a rename** (the name inside changes; the id stays).
- **Library edits are last write wins**, and two browser tabs on different trips can overwrite each other's library changes. Fine for one person; a version check would fix it.
- **What-if answers are not remembered across reloads**; they are asked again on request.
- **Phase 6** (full-US data) was not touched; the Map data card reads the extract's name from the PBF file name.
