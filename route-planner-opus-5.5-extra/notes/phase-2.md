# Phase 2: stop data

Date: 2026-11-07. Result: done. `make import` builds `data/pois.sqlite` from the Colorado PBF in about 16 s. The Colorado loop shows 316 candidate stops with detours (3.6 s cold, instant when repeated), the Trail Ridge Road warning (closed on January dates, "open on your dates" in September), and the Waypoints tab searches places by name. `make test`: 109 passed (45 from phase 1).

## What was built

### Importer (`backend/app/pois/`)

| file | does |
| --- | --- |
| `extract.py` | One pass over the PBF with `osmium.FileProcessor` (locations on, key filter on `highway`, `amenity`, `tourism`, `place`, so Python only sees about 3 % of the file). Nodes and closed ways; a way becomes the average of its corners. Rest areas and plazas may also be open ways. Exits learn their road ("I 70") from the motorway or trunk way that contains them, because the junction node itself has no road ref. Separately collects every highway way with `seasonal=*` (not `no`) or `access`, `motor_vehicle`, `vehicle`, `motorcar` `:conditional`, with the tag text as written |
| `clusters.py` | Anchors and the attach rules, below. Pure functions on lists of `Poi`, no database |
| `db.py` | Schema, `write_all` (temp file, then rename, so a running API never reads a half file), the R*Tree box query, FTS5 name search, seasonal lookup, a shared read-only connection that reopens when the file changes |
| `__main__.py` | `python -m app.pois`: prints counts |
| `docker-compose.yml`, `Makefile` | `importer` service (same image as `api`, profile `tools`, mounts `./data` and `./backend`), `make import`. Both services now carry `image: road-trip-planner-backend` so the image is built once |

**Cluster rules.** An amenity (fuel, food, lodging) goes to the first that applies: a service plaza within 0.4 mi, the nearest exit within 1 mi, the nearest city, town or village within 2 mi, otherwise it joins loose amenities within 0.5 mi of each other (single-link) as an `other` cluster named "Near <nearest place within 5 mi>". Rest areas, service plazas, exits and towns are clusters even with nothing attached. The two directions of one exit (two nodes, same ref, same road, under 1.5 km) are one cluster. Repeated place nodes (same name within 8 km) are dropped, bigger kind first (55 dropped). Hamlets are stored and searchable but do not anchor amenities. A cluster's position is the middle of its amenities, or its anchor when it has none. The service-plaza rule (0.4 mi) is my addition to the brief; without it, businesses inside a plaza polygon would have gone to a nearby exit.

**Seasonal ways.** Stored in `seasonal_ways(way_id, highway, name, ref, tags, lat, lon)`; `tags` is the raw text, `" | "` between tags ("access:conditional=no @ Oct 14th - May 31st").

### Counts (`make import`)

```
reading colorado-latest.osm.pbf: 17240 pois and 413 seasonal ways in 13 s
1739 clusters in 0.3 s, written in 0.2 s (3.6 MB file)
pois:     food 10726, fuel 1985, lodging 1687, place 1372, exit 1332, rest_area 46, service_plaza 37
places:   city 34, town 126, village 185, hamlet 1027        (after dropping 55 duplicate nodes)
clusters: exit 822, other 493, town 341, rest_area 46, service_plaza 37
          1263 have at least one amenity; 0 amenities left unclustered
seasonal ways: 413 (seasonal=* 183, motor_vehicle:conditional 146, access:conditional 80, motorcar 3, vehicle 1)
search items: 2417
```

Of the exits, 802 of 1332 nodes have a `ref` and 1057 a road; 471 of 822 exit clusters have something attached. 251 of 341 towns do.

### API

- **`POST /api/route/stops`** (same body as `/api/route`). Returns `{candidates, closures, limit_minutes, timing, from_cache}`. **Why a second endpoint instead of extending `/api/route`:** the map asks `/api/route` on every mouse move while the route line is dragged (preview requests), and detours take seconds. The page asks for stops once the route has settled and draws the route first. It re-requests the route from Valhalla itself (about 0.1–0.4 s, deterministic) rather than sharing a cache with `/api/route`, which keeps `plan_route` and its tests untouched.
- **Candidates** (`planner/candidates.py`, `timeline.py`). The route is cut into 3 km pieces in an STRtree; every cluster within 2 mi gets a mile and minute from `timeline.build(trip, pace)`, which spreads each maneuver's `speeds.maneuver_seconds` (curve correction, then pace) over its shape points by distance. The last minute equals the sum of the sidebar's leg minutes. A cluster the route passes twice (the loop's Denver, Pagosa Springs, South Fork) gets a candidate per pass; the key is `id@mile`. Each candidate: cluster fields (kind, name, near, ref, road, counts, detail with cuisines and brands, toilets, picnic) plus `mile`, `minute` (driving, no stops yet), `off_route_m`, `detour_min`, `over_limit`, `detour_status` (`ok` or `unreachable`).
- **Detours.** A = route point 3 mi before, B = 3 mi after (clamped to the ends). One `/sources_to_targets` request per 12 candidates: sources A₁..A₁₂ and c₁..c₁₂, targets c₁..c₁₂ and B₁..B₁₂; the three numbers per candidate sit on the diagonals of the quadrants. Six requests in parallel. A batch Valhalla refuses (400 km pair limit) is halved down to single candidates; a candidate that still fails or has no path is `unreachable`, which counts as over the limit. Matrix requests carry the trip's avoid zones and road options. Result times are Valhalla's seconds × pace. A `DetourCache` (20,000 entries, in memory) is keyed by candidate, A, B and the options, so editing one end of a trip reuses the rest.
- **Limit.** 5 minutes of extra driving in total, as the brief says. PLAN.md's decisions table says "5 min each way"; the two are not the same (the matrix detour covers there and back). Left as the brief says; the constant is `DETOUR_LIMIT_MIN`.
- **Seasonal** (`seasonal.py`). The route (thinned to a point per 25 m) is cut into chunks under 120 km and 6,000 points and sent to `/trace_attributes` (`map_snap`, `edge.way_id`), four at a time. Matching ids are looked up in `seasonal_ways`, grouped per road, and judged: a `no`/`private` conditional with a month range ("Oct 14th - May 31st", "Nov 15-May 15", also wrapping the new year) is compared with the trip's days. Levels: `closed` (every day of the trip inside), `check` (partly inside, no departure date, or no dates in the tag, such as `seasonal=winter`), `open` (outside; shown as grey info). Night-time and other conditions are ignored. The trip's days are a guess until phase 4: departure date plus one day per 8 h of driving plus extra nights at overnights. Each closure carries road, ref, raw `tags`, `range`, `level`, `message`, `ways`, and the miles it spans on the route. The text is never "parsed into" something else: the raw tag is shown under the message.
- **`GET /api/search?q=&limit=`** (FTS5, prefix match on the last word, any word order). Order: city, town, village, hamlet, rest area and plaza, numbered exit, loose group; then relevance; then population. Exits without a number are not searchable. `/api/status` now also reports the database's build time and counts.

### UI

- **Layer toggle** "Candidate stops" (top right, on by default, kept in `localStorage`) with a legend and a note ("316 stops · 106 over the 5 min detour limit", or "Finding stops…"). Pills with a glyph and the food count: 🅿 rest area or plaza (green), the exit number (blue square), 🏘 town, • loose group; over the limit: dashed and grey. Zoomed out only places with 10+ food or 4+ fuel show, zoomed in everything; rest areas always.
- **Card** on click: kind, exit number and road, "near …", mile and driving time, detour (green chip, or red "over the limit", or "no way in from this side of the road"), food (sit-down, fast food, café, top cuisines), fuel and lodging with brands, toilets and picnic for rest areas.
- **Warnings:** closures lead the Itinerary tab (red closed, amber check, grey open) with the road, message, mile range and the raw OSM tag; the status bar shows the worst one. The Itinerary also says how many stops, how many are over the limit, and how long the detours took.
- **Search** in the Waypoints tab: the old paste box doubles as place search. Results as you type, arrow keys and Enter, click to add the place as the new end with its name. Coordinates still paste as before.
- **`fitTrip()` fix:** it now calls `invalidateSize()` first, and if the map is still under 50 px it waits (`fitPending`) for a `ResizeObserver` on `#map` to report a real size.

Screenshots (in the phase record): candidates along the loop, a town card (Buena Vista), a rest-area card, the Trail Ridge warning in January (Itinerary and status bar), place search for "sal".

### Tests (`make test`, 109 passed)

New: `test_pois_extract.py` (hand-written `tests/data/tiny.osm`: exits with a road, brands, a motel drawn as a building, rest area flags, plaza as a way, population, seasonal ways incl. the ones that must not match), `test_clusters.py` (every attach rule, merge of the two exit directions, counts and details, duplicate places), `test_pois_db.py` (R*Tree box query, search ranking, prefix, odd input), `test_candidates.py` (timeline totals, projection, a loop passing twice, detour math with the matrix mocked, over limit kept, unreachable, pace, batches of 12, halving, cache), `test_seasonal.py` (tag text, wrapping ranges, levels, one warning per road, night rules ignored, chunk limits, the lookup), more `test_api.py`, and three integration tests (skipped without Valhalla or `data/pois.sqlite`): far-side rest area detours, Vail Pass, Trail Ridge in January vs September.

## Timing

Valhalla on an M4 Max in Docker, Colorado tiles.

| trip | candidates | matrix requests | detours | whole `/api/route/stops` |
| --- | --- | --- | --- | --- |
| Colorado loop, 880 mi, cold | 316 | 27 | 2.9 s | 3.6 s (route 0.4 s, find 0.03 s, closures 0.25 s) |
| same trip again | 316 | 0 | 0 | instant (result cache) |
| loop with a through point added at Salida | 330 | 12 (195 detours remembered) | 1.1 s | 1.7 s |
| Denver → Durango, 337 mi, cold | 130 | 11 | 0.9 s | 1.1 s |
| Denver → Durango, one through point added | 131 | 3 | 0.3 s | 0.5 s |
| Denver ↔ Grand Junction (I-70), cold | 210 | 18 | 0.9–1.0 s | 1.2 s |

## Direction check

Rest areas on the near and far side of I-70 (detour in minutes, eastbound / westbound):

| rest area | eastbound (Denver → Grand Junction) | westbound |
| --- | --- | --- |
| CDOT Rest Area: Edwards | 0.2 | 6.7 (over the limit) |
| "Rest area" at Funston, I-70 | 10.8 (over the limit) | 0.0 |
| CDOT Rest Area: Vail Pass | 1.9 | 1.7 |
| CDOT Rest Area: Rifle | 3.9 | 4.4 |
| CDOT Rest Area: No Name (Glenwood Canyon) | unreachable | unreachable |

## Coverage spot checks against the mockups

| place | what the data says | mockup |
| --- | --- | --- |
| Fairplay (town) | food 10, fuel 3, lodging 3 | break stop; fine |
| Poncha Springs (town) | food 3, fuel 0, lodging 0. A junction group "Near Poncha Springs" 3.5 mi away has 1 lodging, and a roadside "Rest area" at the junction has 5 food, 2 fuel, 1 lodging | lunch stop; thin in the town itself |
| South Fork | food 6, fuel 1, lodging 5 | break with fuel; fine |
| Ouray | food 15, fuel 1, lodging 26 | food 14, fuel 2, lodging 22 |
| Glenwood Springs | town: food 11, fuel 4, lodging 5; I-70 exit 116 next to it: food 38, fuel 2, lodging 14 (the 1-mile exit rule takes the downtown) | prefer-stops zone |
| Estes Park | food 57, fuel 7, lodging 39 | |
| Grand Lake | food 14, fuel 1, lodging 4 | |
| Vail Pass rest area | present (CDOT Rest Area: Vail Pass), toilets yes, picnic not mapped, no amenities | |

Verdict: **OSM is good enough for Colorado stops.** Every mockup place is there with plausible counts. The gaps are in the details, not the places: brand is tagged on 76 % of fuel (1507 of 1985) but only 45 % of lodging (754 of 1687); cuisine on 78 % of food; toilets on 13 of 46 rest areas, picnic tables on 1, and 26 of 46 have a name. There are no opening hours in what is imported. Rural lodging is where a brand filter will bite first. Overture Places is worth trying in phase 4 (meals and lodging with brand filters) or phase 6 (full US), compared against OSM on a few real overnight stops, not before. I did not download it, so this is a judgment from the OSM counts, not a comparison.

## Surprises

- **Exit nodes have no road.** `highway=motorway_junction` carries `ref` and sometimes `name`, but the road ("I 70") is only on the way that contains it. The importer reads that from the motorway and trunk ways. Without it, exits would say "Exit 116" with nothing to say which highway. 530 of 1332 nodes have no `ref`; those exits are named "Exit near <place>" or left out of search.
- **Suburban sprawl becomes big "other" groups.** Amenities more than 2 mi from a city's centre node and not near an exit are grouped single-link, so the outskirts of Fort Collins, Aurora and Colorado Springs come out as one cluster each, named after the nearest hamlet ("Near Redmond" 134 food, "Near Sullivan" 127, "Near Elsmere" 84). They are real places to eat, but the name means nothing to a driver and the cluster's centre can be miles from where any single restaurant is. Fine for phase 2; a size cap or a split by road would fit phase 3 if such a group is picked as a stop.
- **Valhalla's matrix is limited by pairs (2500) and distance (400 km), not by the 20 locations that `max_locations` suggests.** 25 sources by 25 targets works, so 12 candidates per request (24 × 24 pairs).
- **Trail Ridge has a second flagged road.** Besides "Trail Ridge Road" (19 to 26 ways on the route), the Estes Park → Grand Lake route in January reports "Park Entrance Road" with the same dates. Roads are grouped by name and level; the one odd piece of Trail Ridge with "Oct 1 - May 31st" folds into the main warning.
- **Valhalla still routes over Trail Ridge in January** (phase 0 finding, unchanged). The planner only warns; it does not reroute. With a "closed" level, phase 4 could add the road as an avoid zone.
- **The loop's day count is a guess.** "Sep 25 – Sep 28" for a trip the PLAN calls five days. It only decides the wording; phase 4 will know the real days.
- **A town with an exit next to it splits in two.** Glenwood Springs appears as the town and as I-70 exit 116, a mile apart in clusters but at the same mile along the route. Phase 3 should treat candidates within a few miles of each other as one stop for the "merge" rule, not as separate choices.
- **A destination has a "detour".** Durango, a waypoint where the route turns around, got +9.6 min: A and B are on the same road, so the matrix time is not a fair reference there. Phase 3 should not plan breaks at waypoints anyway.
- **Pane screenshots lag.** The built-in browser pane often showed the previous frame right after typing or clicking; a second screenshot a moment later was right.
- I could not reproduce the old `fitTrip()` bug in the pane (it is not hidden). The fix was checked with the app loaded in a `display: none` iframe: the map was 0 px wide at load and zoom 7 (the whole loop) after it was shown. I did not run the old code to confirm it fit at maximum zoom there.

## What phase 3 (the break planner) needs

- **Input:** the `candidates` list: each has `mile`, `minute` (driving minutes from the start, same clock as the sidebar, no dwell times yet), `kind`, counts (`food`, `fuel`, `lodging`), `detour_min`, `over_limit`, `detour_status`, `key`. Sorted by mile, a loop gives two entries per place. A candidate with `over_limit` true is the one to skip, but it has the reason in `detour_min` (or `unreachable`).
- **Prefer order** from the PLAN: rest area, then service plaza, then exit with fuel and food, then any exit. `kind` and counts are enough; empty exits (`food + fuel + lodging == 0`) are in the list (471 of 822 exit clusters have amenities).
- **Merge** candidates within a few miles into one choice (see Glenwood Springs above); the break window is in minutes (`minute`), the hard maximum in `minute` or `mile`.
- **Keep detours out of the schedule maths at first**: they are extra driving to reach the stop and come back; add them to the stop's dwell, not to the next leg.
- **Call it from the planner directly:** `planner.analysis.analyze(req, con)` returns the same dict as the endpoint; `candidates.find` and `candidates.add_detours` are the parts. The detour cache is a module global, so a re-plan after a pin or a drag only asks for what changed.
- **Zones are not applied to candidates yet** (phase 3 and 4): matrix times respect avoid zones, but no-stops, no-meals and so on do not filter anything. A candidate's position is `lat`/`lon`, ready for `zones.ring_contains`.
- **Waypoint stops** (timed stops, overnights) are not special in the candidate list; the planner should skip the candidates around a waypoint, or take the waypoint itself as the stop.
- **Seasonal closures** are in `closures`; phase 4 decides what to do with a "closed" one (warn only today).
- The Itinerary tab has no clock times and no breaks yet. Phase 3 adds them to the list `renderItinerary` builds; the closure rows sit at the top and need no change.
