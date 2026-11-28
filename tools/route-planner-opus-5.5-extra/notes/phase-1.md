# Phase 1: speed calibration, map and routing

Date: 2026-11-07. Result: done. Valhalla's drive times now match real-world times for 8 of 9 Colorado reference drives within 10 %, and Denver → Durango takes US-285 by default. The map UI does every phase 1 interaction in the browser, and `make test` passes (45 tests).

## Part A: speed calibration

### Why rural highways were slow

The tiles had US-285 at 62 km/h (38 mph) where OSM says `maxspeed=65 mph`. The chain of causes:

1. **The image builds with a default speeds table.** `valhalla-scripted` has `use_default_speeds_config=True` by default. It downloads `default_speeds.json` (OpenStreetMapSpeeds, 2.6 MB: speeds per country/state, per rural/suburban/urban, per road class) and sets `mjolnir.default_speeds_config`.
2. **That table replaces every edge's speed, tagged or not.** In Valhalla 3.9.1 `SpeedAssigner::UpdateSpeed` (src/mjolnir/speed_assigner.h) runs in the enhance stage, looks the edge up in the table and, if found, sets the speed and `speed_type = classified`, whatever the parser took from `maxspeed`. `/locate` and `/trace_attributes` showed every edge on the route as `classified`, with the `maxspeed` value kept only as `speed_limit`.
3. **The table lookup fell through to the world default.** The lookup tries `US.CO`, then `US`, then `""`. `admins.sqlite` is empty: the Colorado extract has the state relations (Colorado, Kansas, …, tagged `ISO3166-2=US-CO` etc.) but not the US country relation (admin_level 2), and Valhalla's admin builder keeps nothing without a country. So every edge got the world rural row: motorway 99, trunk 62, primary 51, secondary 44 km/h. The Colorado row would have said trunk 91, primary 77.

Evidence on Denver → Durango via a through point at Saguache (`/trace_attributes`, chunks under the 200 km trace limit):

| road class | miles | avg speed in tiles | OSM `maxspeed` on those ways |
| --- | --- | --- | --- |
| trunk (US-285, US-160) | 232 | 38 mph | tagged 25–65 mph, mostly 50–65 (15 ways untagged) |
| motorway | 68 | 60 mph | tagged |
| primary | 42 | 31 mph | tagged |

pyosmium check in the api container: of the 542 trunk and primary ways on the route, 525 carry `maxspeed` (for example `US 160`: `maxspeed=60 mph` and `65 mph`).

Other knobs checked:

- **`date_time`** changes no speeds: there is no traffic or predicted-speed data, so free-flow and constrained speeds are 0 and Valhalla uses the edge speed. (It does matter for timed closures, and it switches off alternates, see below.)
- **Costing options.** `top_speed` (default 140 km/h) only caps; `top_speed: 100` adds 6 min to Denver → Durango. `fixed_speed` forces one speed on every edge (80 km/h: 6:47), useless here. Turn penalties are small next to a 2-hour error. None of them can fix per-road speeds.

### Reference drives

Real-world times are estimates from route sites and visitor bureaus; they disagree with each other by 10–20 %, so 10 % is about as close as this can be judged.

| drive | reference | source |
| --- | --- | --- |
| Denver → Durango via US-285 | 338 mi, 6:15 | Google Maps about 6:00 (planning-session estimate, not checked); durango.org "six and a half hour drive" |
| Denver → Grand Junction (I-70) | 244 mi, 4:00 | AAA TripCanvas 246.6 mi 4:11; Google about 3:50 |
| Denver → Estes Park | 65 mi, 1:30 | Google 64 mi 1:30 (nationalparkstraveler.org); AAA 68.6 mi 1:43 |
| Glenwood Springs → Ouray | 185 mi, 3:30 | visitouray.com: 185 mi, 3.5 h (a round number; likely pessimistic) |
| Ouray → Durango (US-550) | 70 mi, 2:00 | visitouray.com: 70 mi, 2 h; Fodor's forum 1.5–2 h |
| Alamosa → Salida | 82 mi, 1:32 | 1map route site: 82.2 mi, 1:32 |
| Durango → Pagosa Springs | 60 mi, 1:11 | 1map: 60.4 mi, 1:11; MapQuest 61 mi |
| Salida → Gunnison (Monarch Pass) | 65 mi, 1:15 | coloradotopia.com 1:15; wanderlog 1:41 |
| Denver → Colorado Springs (I-25) | 70 mi, 1:08 | route sites: 60–75 min without traffic |

### Options compared

Before rebuilding, I recomputed each reference route's time from its edges (`/trace_attributes`) under each option (fixed route, so route choice is ignored):

| drive | tiles as built | `US.CO` table (fix the admin db) | OSM `maxspeed` (no table) |
| --- | --- | --- | --- |
| Denver → Durango | +44 % | +3 % | +4 % |
| Denver → Grand Junction | +7 % | −6 % | −6 % |
| Denver → Estes Park | +15 % | −12 % | −9 % |
| Glenwood Springs → Ouray | +14 % | −14 % | −17 % |
| Ouray → Durango | −3 % | **−34 %** | −18 % |
| Alamosa → Salida | +43 % | 0 % | −6 % |
| Durango → Pagosa Springs | +40 % | −4 % | −3 % |

Both fix the two-lane highways. The state table is much too fast on mountain roads (US-550 is "rural trunk", 91 km/h), and it would come back for any region whose admin db works (a full-US extract has the country relation). `maxspeed` tags are dense in Colorado and degrade gracefully: untagged edges get Valhalla's own class defaults.

### The fix, in order of the preferred layers

1. **Build setting (Valhalla).** `use_default_speeds_config: "False"` in `docker-compose.yml`, and `valhalla/start.sh` deletes `mjolnir.default_speeds_config` from `valhalla.json` on every start, so the next build uses `maxspeed`. New `make rebuild-tiles` (sets `force_rebuild=True` for one start; the rebuild took 70 s). After it, the US-285 edge reads `{"default": 105, "type": "tagged"}`.
2. **No costing option** helps (above).
3. **Planner-side correction (Python, `backend/app/speeds.py`).** Nobody drives a hairpin at the posted limit. Every 25 m of the route the planner measures the bend over ±50 m, takes the curve radius, and caps the speed at `sqrt(1.5 m/s² × radius)` (27 mph in a 100 m curve, 19 mph in a 50 m hairpin), keeping Valhalla's average speed on the straight parts of each maneuver. 1.5 m/s² is below the physical comfort limit (about 3) because it also stands in for braking and climbing; it was chosen with the calibration script (1.5 to 2.5 all give 7–8 of 9; 1.5 is best). It is a correction by geometry, not by road class: a class rule cannot tell US-550 from US-285, which are both trunk.
4. **Pace multiplier** on top, user-facing, default 1.05 as in the plan.

The correction changes times only. Valhalla still picks the route with its own speeds.

### Result (`make calibrate`)

```
drive                                 reference        before        valhalla now      planner       x pace
-----------------------------------------------------------------------------------------------------------
Denver > Durango via US-285         338 mi  6:15    8:59  +44%   337 mi  5:56   -5%   6:04   -3%   6:22   +2%
Denver > Grand Junction (I-70)      244 mi  4:00    4:17   +7%   244 mi  3:46   -6%   3:51   -4%   4:03   +1%
Denver > Estes Park                  65 mi  1:30    1:44  +15%    70 mi  1:19  -13%   1:21  -10%   1:25   -6%
Glenwood Springs > Ouray            185 mi  3:30    4:00  +14%   176 mi  2:50  -19%   2:53  -18%   3:01  -14%
Ouray > Durango (US-550)             70 mi  2:00    1:51   -7%    71 mi  1:34  -22%   1:43  -14%   1:48  -10%
Alamosa > Salida                     82 mi  1:32    2:11  +43%    82 mi  1:23  -10%   1:24   -9%   1:28   -4%
Durango > Pagosa Springs             60 mi  1:11    1:35  +34%    60 mi  1:06   -7%   1:06   -7%   1:10   -2%
Salida > Gunnison (Monarch Pass)     65 mi  1:15    1:44  +39%    65 mi  1:11   -5%   1:15   -0%   1:18   +5%
Denver > Colorado Springs (I-25)     70 mi  1:08    1:22  +21%    69 mi  1:05   -5%   1:05   -5%   1:08   +0%

8 of 9 within 10 % after the planner correction and pace.
```

"before" is Valhalla on the phase 0 tiles, measured before the rebuild and stored in `backend/spikes/calibration_baseline.json`. The miss is Glenwood Springs → Ouray (−14 %), against the weakest reference (a round "3.5 hours"). Valhalla runs that drive on I-70 at 72 mph average (`maxspeed=75`), which is fast but legal; if real drives show I-70 too fast, the next lever is a cap on motorway speeds, not the pace.

### Denver → Durango now

Plain request, no through point: **US-285 and US-160, 337 mi, Valhalla 5:56, planner 6:22 with pace**. Alternates: I-25 → Walsenburg → US-160, 382 mi, about +20 min; and I-25 → CO-115 → US-50 → US-285, 373 mi, about +35 min by Valhalla's clock. A through point at Ouray now does pull the route west onto US-550 (372 mi).

## Part B: what was built

### Backend (`backend/app/`)

| module | does |
| --- | --- |
| `models.py` | pydantic request models: `Waypoint` (through / stop + minutes / overnight + nights), `Zone` (type, ring, shape, enabled), `RoadOptions`, `RouteRequest` (waypoints, zones, options, depart, pace) |
| `zones.py` | avoid zones → `exclude_polygons`; `check_waypoints` (names the zone and the waypoint); `check_sizes` (Valhalla's limits, summed over zones: 3,000 km of outline, 500 vertices) |
| `routing.py` | `build_request` (type mapping, costing options, zones, alternates, date), `plan_route`, `summarize` (one GeoJSON line, legs, waypoint positions, alternates with adopt points, warnings), friendly messages for Valhalla errors |
| `speeds.py` | the curve correction and the pace |
| `geometry.py` | local projection, resampling, ring perimeter and containment (shapely), nearest shape point, farthest point |
| `valhalla.py` | phase 0 client plus `post_route(body)` |
| `main.py` | `POST /api/route`, `GET /api/status`, the frontend as static files |

`POST /api/route` answers 200 with `{geometry, legs[{from, to, through, miles, minutes, valhalla_minutes, span}], total, waypoint_positions, alternates[{geometry, miles, minutes, extra_minutes, adopt}], warnings, valhalla_ms}`, or 422 with `{"error": {code, message, zone_id?, waypoint_id?}}` (codes `waypoint_in_avoid_zone`, `zone_too_large`, `zone_too_many_points`, `no_route`), or 503 when Valhalla is down. shapely was added to the image.

### Frontend (`frontend/`, no build step)

`index.html`, `styles.css` (GeoTagger tokens from the mockups), `state.js` (trip state, `localStorage`, routing requests), `edits.js` (shared trip edits and formatting), `map.js` (Leaflet + Geoman), `sidebar.js` (summary and the three tabs), `app.js` (wiring, status bar). Leaflet 1.9.4 and Leaflet-Geoman free 2.17.0 are vendored in `frontend/vendor/`.

Interactions, each exercised in the browser:

- Map tools: ✋ Move map, 📍 Waypoint (click adds the new end), ◇ Through point (click inserts into the leg whose route passes closest, else the cheapest straight-line slot), ▭ Box zone, ⬠ Polygon zone. Esc returns to Move map.
- Drag a waypoint marker to move it. Click it for the card: name, ◇ Through / 📍 Stop (minutes) / 🛏 Overnight (nights), coordinates and mile, Remove. The start and end show their role instead of a type.
- Right-click menu: add a stop / through point / overnight here, start or end the trip here, draw a zone from here (Geoman box with its first corner at the click), copy coordinates (shown in the header).
- Drag the blue route line: a dashed preview follows the pointer, replaced by the real roads once a preview route comes back (throttled, one request in flight), with the extra time in the tip and the status bar. Release inserts a through point into the leg that was grabbed (by route position, so loops work).
- Zones: draw, then a card with name, type (only ⛔ Avoid is active; the others are stored and marked "phase 4"), on/off, ✎ edit shape (Geoman vertex editing; rectangles stay rectangles), delete. The Zones tab lists them with the same controls.
- Waypoints tab: rows with drag to reorder and ✕, a paste box ("lat, lon", one pair per line), road options (avoid tolls / ferries / unpaved, alternates 0–2), departure date and time, pace.
- Itinerary tab: per leg, depart / through / arrive rows with miles and cumulative driving time; warnings; alternates summary.
- Alternates: grey dashed lines with a chip (`Alternate +20 min · 382 mi`); clicking the line or the chip adds a through point at the spot farthest from the main route and the other alternates.
- Errors: a red banner over the map, the zone outlined thicker, the waypoint ringed in red, the rows marked in both tabs, and the code in the status bar.
- The trip survives a reload (`localStorage`); with nothing saved the Colorado loop loads, with a Boulder avoid zone and a Montrose no-meals zone.

Screenshots in the phase record: the Colorado loop, a drag-to-insert in progress, the waypoint card, an avoid zone moving Denver → Durango off US-285 (330 → 347 mi), and the zone-holds-a-waypoint error.

### Tests

`make test`: 45 passed. `test_routing.py` (type mapping, request building, through-point snapping, dated requests, summary legs/positions/pace, alternates' extra time and adopt point, zone error before any Valhalla call, 442 message, the second request for alternates), `test_zones.py` (pre-check, polygon zones, disabled and non-avoid zones, size and vertex limits summed), `test_speeds.py` (radius of a circle, straight road unchanged, hairpin slowed, gentle curve not), `test_api.py` (422 shapes, validation), `test_integration.py` (against the running Valhalla, skipped when down: Denver → Durango on US-285 in 5.5–6.75 h, alternates with a date, avoid zone changes the route, Ouray through point, the loop's waypoint order).

## Surprises

- **CARTO raster tiles now need an API key.** Every `basemaps.cartocdn.com` tile, `dark_all` included, is a grey "API KEY REQUIRED" image. The app uses Stadia Maps `alidade_smooth_dark` instead, which serves pages on `localhost` without a key. The CARTO entry stays in `map.js` for whoever gets a key. If the app is ever served from another host, Stadia needs a key too; the offline PMTiles option in the plan avoids both.
- **`date_time` switches off alternates.** Valhalla's time-dependent search returns none. For two-waypoint trips with a departure date the API makes a second, undated request just for the alternates. Undated requests apply timed closures as of today (phase 0 finding), so an alternate can in theory use a road the trip date would close; acceptable for display.
- **Through points snapped to farm tracks.** A click east of Colorado Springs snapped to a `track` with `surface=path` at 2 km/h 600 m away and added 8 hours. Through points now carry `search_filter: {min_road_class: "residential"}`; stops keep the default, since a visitor centre may sit on a service road.
- **Valhalla's alternates for exactly two locations only.** Even one through point in between gives none (3.9.1).
- **A route via a zone's alternate can be "faster" than the main route** after the curve correction (seen: an alternate at −2 min), because Valhalla chooses with uncorrected speeds. The chip shows the sign honestly.
- **Leaflet popup clicks.** Card buttons that re-render the card detach themselves before the click reaches the map, and Leaflet then closes the popup. Clicks inside cards now stop at the card.
- The built-in browser pane throttles timers when hidden, which made routing look slow while testing; not an app issue.

## Left for later

- The day strip under the map (phase 3–4), clock times, breaks.
- Place-name search (phase 2, once there is a places table). Waypoints added by click or paste have no name until the user types one.
- Trip files, the Save and Export buttons, the settings page (phase 5). "New trip" and "Example trip" replace the current trip after a confirm.
- Zone library shared between trips (phase 5): zones live in the trip for now.
- The other zone types do nothing yet (phase 4).
- Drag preview tip shows the extra time for the whole trip; a per-day figure needs days.

## For phases 2–5

- **Admin db is empty for a single-state extract.** No country relation in the PBF, so no admins, no country access rules, no state codes. Speeds no longer depend on it. For phase 2 POI work, use your own state lookup (or `timezonefinder` style data) rather than Valhalla's admin info. For phase 6, keep `use_default_speeds_config: "False"`: a full-US extract has the country relation, and the table would otherwise come back and override `maxspeed` everywhere.
- **Times come from `speeds.leg_seconds()`**, per maneuver; the breaks planner (phase 3) should use the same function on stretches so its clock matches the sidebar. `timeline.py` in the plan can be built on `speeds.curve_radii` and the maneuver times.
- **Waypoint positions on the route line** (`waypoint_positions`, indexes into `geometry.coordinates`) are already returned and are what drag-to-insert uses. Candidates in phase 2 can be projected onto the same line.
- **`/trace_attributes`** needs chunks under 200 km (`service_limits.trace.max_distance`) or a raised limit in `start.sh`; `edge_walk` failed on a full Valhalla shape with a through point, `map_snap` worked.
- **Two Valhalla requests** per two-waypoint dated trip (main + alternates). Each is 50–150 ms.
- The frontend keeps all trip state in `state.trip`; phase 5 trip files can save exactly that object.
