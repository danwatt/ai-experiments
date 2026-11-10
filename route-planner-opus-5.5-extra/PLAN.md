# Road trip planner: plan

Status: phase 5 done (trip files, the zone library, the settings page, day sheets, GPX, Google Maps links, "start from here"; see [`notes/phase-5.md`](notes/phase-5.md)). Phase 4 was the automatic overnights, meals, fuel, time zones, sunset, all zone types, "avoid this road"; see [`notes/phase-4.md`](notes/phase-4.md)). Phase 3 was the break planner with clock times, pins and skips, stop picker and day strip ([`notes/phase-3.md`](notes/phase-3.md)). Phase 2 was stop data, candidates with detours, seasonal warnings and place search ([`notes/phase-2.md`](notes/phase-2.md)). Phase 1 was the map, routing and speed calibration ([`notes/phase-1.md`](notes/phase-1.md)). UI mockups live in [`design/index.html`](design/index.html).

## Goal

A desktop road-trip planner that does what Microsoft Streets & Trips did, and what it did not:

- Plan stops across several days, with a break every N minutes or M miles.
- Put those stops where a person would actually stop: highway rest areas, exits with fuel and food, towns with lodging.
- Route A → B → C → D, where B and C can be shaping points (no stop) or real stops.
- Draw zones on the map: areas to avoid driving through, and areas that are fine to drive through but not to stop in for meals or lodging.
- Do as much of the input as possible directly on the map.

It runs on one machine for one person. Routing and stop data work without internet. The backend is Python and meant to be read.

## Decisions

Settled in the planning conversation on 2026-11-07. The user took every default offered.

| Topic | Decision |
| --- | --- |
| Routing engine | Valhalla, run as a Docker container, called over HTTP from Python |
| Map data | OpenStreetMap extracts from Geofabrik. Development region: Colorado only (369 MB extract, against 1.3 GB for the Texas, New Mexico, Arizona and Oklahoma set first considered). Full US later |
| Example trips | A five-day Colorado sightseeing loop and a one-day Denver → Durango drive (see Example trips). They drive the mockups, the tests and the README screenshots |
| Stop data | Extracted from the same OSM files: rest areas, service plazas, numbered exits, fuel, food, lodging, towns. Overture Places only if OSM coverage proves thin |
| Offline | Routing and stop data offline. Basemap tiles online (free raster tiles: Stadia Maps dark, keyless on localhost; CARTO now needs an API key, phase 1). Fully offline basemap (PMTiles) is a later option |
| Use | Before the trip and during it ("start from here, now") |
| Vehicle | Gas car. No towing or height limits. EV is out of scope |
| Road options | Avoid tolls / ferries / unpaved, per trip |
| Speeds | Valhalla's speeds from OSM `maxspeed` tags (the image's default speeds table is switched off, phase 1), slowed in tight curves by the planner, times one multiplier (default 1.05). See Routing with Valhalla |
| Breaks | Every N min or M mi, whichever comes first. 15 min. Window 75–100% of N, hard max N + 10% |
| Stop preference | Rest area, then service plaza, then exit with fuel and food, then any exit. Max detour 5 min each way |
| Merging | A fuel stop and a break within 20 min of each other become one stop. Fuel is due after 75 % of a 400 mi range (300 mi), the tank fills at every overnight (phase 4) |
| Meals | Lunch 11:30–13:30 (45 min), dinner 17:30–19:30 (60 min), breakfast at the hotel. A meal resets the break clock. Dinner at an overnight reached by 19:30 happens there. Food filter: all / sit-down / fast food; brand filter later |
| Days | 8 h driving per day, start 08:00, arrive by 19:00, optionally stop at sunset (off by default). All soft limits, with a warning that says why when exceeded |
| Lodging | An exit or town with at least 2 lodgings (as grouped by the importer). Brands (OSM `brand`, else `operator`; a name matches any brand containing it): prefer, or only these. About 45 % of Colorado lodging has one (phase 5) |
| Waypoints | Each one is through (shaping only), stop for N minutes, or N nights |
| Booking | Out of scope |
| Map editing | Drag the route line to add a through point. Right-click menu for start / stop / through / overnight / end |
| Zones | Rectangle and polygon. Types: avoid, no stops, no overnight, no meals, prefer stops. Avoid is a hard exclusion. Zones live in a shared library and are switched on per trip |
| Waypoint order | The user's order. Loops allowed. No automatic reordering |
| Alternates | Show up to 2 alternate routes |
| Exports | Printable day sheets, GPX, Google Maps links per day: 3 waypoints per link on a phone browser, 9 elsewhere, longer days split (phase 5, Google's Maps URLs documentation) |
| Storage | Trips as JSON files in `trips/`, the zone library in `trips/zones.json`, defaults for new trips in `trips/defaults.json`; two example trips in `examples/` (phase 5) |
| Dates | Departure date and time per trip (time zones, DST, sunset) |
| Repo | Large data in gitignored `data/`, rebuilt by scripts. Landing card in the `tools` section shows screenshots only |
| Local environment | Docker for everything. Nothing installed on the host beyond Docker |
| Look | The GeoTagger design system: dark, dense, system font, emoji icons paired with labels |

## Architecture

Three containers, one `docker compose up`. The browser talks only to the API container.

```
 browser (localhost:8000)
   │  static files + JSON API
   ▼
 ┌──────────────────────────┐      HTTP :8002     ┌──────────────────────────┐
 │ api  (Python, FastAPI)    │ ──────────────────▶ │ valhalla                  │
 │  - planner                │                     │  ghcr.io/valhalla/        │
 │  - POI queries (SQLite)   │                     │    valhalla-scripted      │
 │  - trips, zones, exports  │                     │  builds tiles on first    │
 └──────────────────────────┘                     │  start, then serves       │
   │ reads /data/pois.sqlite                       └──────────────────────────┘
   │ reads/writes /trips                                │ /custom_files
   ▼                                                    ▼
 ./data  ◀──────────── importer (same image as api) ── ./data/valhalla/*.osm.pbf
                         one-shot: OSM → pois.sqlite
```

### Services (`docker-compose.yml`)

| Service | Image | Purpose | Ports | Mounts |
| --- | --- | --- | --- | --- |
| `valhalla` | `ghcr.io/valhalla/valhalla-scripted:3.9.1` (arm64 build exists) | Downloads the PBFs listed in `tile_urls`, builds routing tiles once, serves the routing API. Settings are lowercase env vars: `tile_urls`, `build_admins=True`, `build_time_zones=True`, `build_elevation=False`, `use_tiles_ignore_pbf=True`. `valhalla/start.sh` wraps the entrypoint to raise `max_exclude_polygons_length` (default 10 km is too small) and `max_exclude_polygons_vertices` | `127.0.0.1:8002` (debugging only) | `./data/valhalla:/custom_files` |
| `api` | built from `backend/Dockerfile` (`python:3.12-slim` + uv) | FastAPI app: planner, POI lookups, trips, zones, exports. Also serves `frontend/` | `127.0.0.1:8000` | `./backend:/app`, `./frontend:/frontend:ro`, `./data:/data`, `./trips:/trips` |
| `importer` | same image as `api`, compose profile `tools` | One-shot: reads the PBFs Valhalla downloaded and writes `data/pois.sqlite` | none | `./data:/data` |

Later and optional: a `tiles` service (`protomaps/go-pmtiles`) serving a local PMTiles basemap for fully offline use.

### Day-to-day commands

A `Makefile` wraps compose so nothing needs remembering:

```
make up          # docker compose up -d (first run builds tiles, takes a while)
make import      # docker compose run --rm importer
make test        # docker compose run --rm api pytest
make calibrate   # Valhalla's times against nine real Colorado drives
make rebuild-tiles  # rebuild routing tiles from the PBF already downloaded (about 1–2 min)
make logs        # docker compose logs -f api valhalla
make down
make clean-data  # removes ./data (tiles, PBFs, POI index); trips are kept
```

The API container runs `uvicorn --reload` against the bind-mounted source, so edits show up without rebuilding the image.

### Docker Desktop notes

- The Docker VM has about 8 GB of memory today. That is plenty for Colorado. A full-US tile build wants 16 GB or more; raise it in Docker Desktop settings before phase 6.
- All data lives in bind mounts under the project folder, on the Mac's own disk, not inside Docker's VM disk image. `make clean-data` frees it.
- Optional: a local `uv sync` gives an editor autocomplete and type checking. Nothing requires it.

## Repository layout

```
route-planner-opus-5.5-extra/
  PLAN.md
  README.md                  how to run it, screenshots
  docker-compose.yml
  Makefile
  valhalla/start.sh          wrapper entrypoint: raises exclude_polygons limits, drops the default speeds table
  .env.example               REGION_URLS (Geofabrik extracts), ports
  backend/
    Dockerfile
    pyproject.toml           fastapi, uvicorn, httpx, shapely, osmium,
                             timezonefinder, tzdata, astral (phase 4), gpxpy later, pytest
    app/
      main.py                FastAPI app, static files, routers
      valhalla.py            thin HTTP client: route, matrix, locate
      geometry.py            polyline decoding, along-route projection, corridors
      timeline.py            route → miles and minutes at every shape point (phase 2)
      seasonal.py            routes against seasonal / conditional-access ways (phase 2)
      models.py              request models: waypoints, zones, road options (phase 1)
      routing.py             trip → /route request, answer → legs, alternates (phase 1)
      speeds.py              curve correction and pace on top of Valhalla's times (phase 1)
      pois/                  (phase 2; `python -m app.pois` is what `make import` runs)
        extract.py           pyosmium handler: OSM → rows
        db.py                SQLite: schema, R*Tree and FTS5 queries
        clusters.py          group POIs onto exits and towns
      planner/
        candidates.py        stops near the route, with detour and amenities (phase 2)
        analysis.py          what /api/route/stops answers: candidates + closures (phase 2)
        loose.py             big roadside groups cut to the part nearest the route (phase 3)
        choices.py           candidates -> choices: pass keys, skips, merges, stop cost (phase 3)
        graph.py             the cheapest-path break chooser for one segment (phase 3)
        picker.py            alternatives and "why it won" for each break (phase 3)
        schedule.py          segments, clock times, windows, due times, days (phase 3)
        stops.py             breaks, lunch, dinner and fuel in one segment: the path with state (phase 4)
        days.py              day splits, overnight choice (phase 4)
        clock.py             time zones, DST, sunset (phase 4)
      zones.py               Valhalla exclusions and the stop-zone rules (phase 4); zone library in phase 5
      trips.py               JSON trip files, example trips, defaults (phase 5)
      library.py             the zone library and GeoJSON (phase 5)
      whatif.py              what switching an off zone on would do (phase 5)
      here.py                start from here, now (phase 5)
      mapdata.py             OSM date, file sizes, rebuild commands for the settings page (phase 5)
      export/
        sheet.py  gpx.py  gmaps.py  common.py   (phase 5)
    spikes/                  phase0.py, calibration.py (`make calibrate`)
    tests/
  frontend/
    index.html  app.js  map.js  sidebar.js  timeline.js  styles.css
    state.js  edits.js       trip state + localStorage, shared edits (phase 1)
    trips.js  library.js  settings.js  export.js  here.js  dialog.js   (phase 5)
    vendor/                  Leaflet and Leaflet-Geoman, pinned, no CDN at runtime
  design/
    index.html               UI mockups
  examples/                  colorado-loop.json, denver-to-durango.json, zones.json (the starting zone library); committed, read-only in the app
  data/                      gitignored: PBFs, Valhalla tiles, pois.sqlite
  trips/                     gitignored: your saved trips, zones.json (the library), defaults.json
```

## Routing with Valhalla

One `/route` request per plan, built from the trip:

- Waypoints map to Valhalla location types. The start and end are `break`. A through point is `through` (no stop, no U-turn, no leg split). A timed stop or an overnight is `break`; the planner adds the dwell time itself.
- Avoid zones go in `exclude_polygons`. Before routing, the API checks that no waypoint sits inside an avoid zone and says which one if it does.
- `costing_options.auto`: `use_tolls`, `use_ferry`, `exclude_unpaved`, from the trip's road options.
- `alternates: 2` for alternate routes. Valhalla returns alternates only for two locations, and none at all when `date_time` is set, so a dated two-waypoint trip makes a second, undated request for them (phase 1).
- `date_time` with the departure time, so Valhalla returns local times and applies timed closures. It does not change speeds (no traffic data).
- Through points carry `search_filter: {min_road_class: "residential"}`, so a click near a farm track lands on a real road.

**Speeds** (phase 1). The `valhalla-scripted` image by default builds with a table of speeds per road class (OpenStreetMapSpeeds `default_speeds.json`) that overrides every edge's speed, `maxspeed` tags included. With the Colorado extract the admin db is empty (no country boundary in the file), so the table's world row applied: 62 km/h on US-285. The build now has the table off (`use_default_speeds_config: "False"`, and `valhalla/start.sh` removes the key), so speeds come from `maxspeed`, with Valhalla's class defaults where a road has none. On top, `backend/app/speeds.py` caps the speed in tight curves at `sqrt(1.5 m/s² × radius)`; that only changes times, not the route Valhalla picks. Then the pace multiplier. `make calibrate` checks the result against nine Colorado drives: 8 within 10 %.

Detour cost for a candidate stop (phase 2): the route point 3 miles before it (A), the stop (c) and the route point 3 miles after (B), as Valhalla drive times from `/sources_to_targets` in batches of 12 candidates: `time(A→c) + time(c→B) − time(A→B)`. That makes direction of travel come out right on its own: a rest area on the far side of a divided highway shows up with a long detour and is marked over the limit. Matrix times are Valhalla's own, times the pace (no curve correction).

## Stop data

`importer` reads the OSM extracts with pyosmium and keeps only what the planner needs:

| OSM tags | Becomes |
| --- | --- |
| `highway=rest_area`, `highway=services` | rest area / service plaza, with toilets and picnic flags |
| `highway=motorway_junction` (`ref`, `name`) | exit, with its number |
| `amenity=fuel` | fuel (brand) |
| `amenity=restaurant`, `fast_food`, `cafe` | food (cuisine, brand, sit-down or fast food) |
| `tourism=hotel`, `motel`, `guest_house` | lodging (brand) |
| `place=city`, `town`, `village` + `population` | town |

Each fuel, food and lodging row is attached to a service plaza within 0.4 mi, else the nearest exit within 1 mi, else the nearest city, town or village within 2 mi; amenities near none of those form small "other" clusters (named "Near <place>"). Rest areas and service plazas are clusters of their own. Hamlets are stored (search, naming) but do not anchor amenities. The planner works with those clusters ("Holbrook, Exit 286: 9 food, 4 fuel, 6 lodging"), not with single businesses.

## Planner

1. **Timeline.** Decode the route shape. Use the maneuver boundaries to get cumulative miles and minutes at every shape point, interpolating between them.
2. **Candidates.** Pull clusters within 2 mi of the route from the R*Tree. Project each one onto the route (shapely `project`) to get its mile and minute; a loop that passes a place twice gives it two candidates. Compute each one's detour. Candidates over the limit (5 min each way: 10 min for the matrix's there-and-back figure; phase 2 had 5 in total) are marked, not dropped, so the UI can show why; the stop chooser uses them only when nothing else fits.
3. **Zones.** Drop candidates inside no-stops zones, drop meal candidates inside no-meals zones, drop overnight candidates inside no-overnight zones. Give candidates inside prefer zones a bonus (8 as a stop, 15 as a night: wins close calls, never adds a stop). Every stop a zone moved says so, found by planning again without the stop zones.
4. **Days.** Pick each overnight from places with at least 2 lodgings: a cheapest path per stretch between the user's fixed overnights, with 100 per day (fewest days first), (hours of driving)² (balanced days) and 3 per minute past the soft limits. Over-limit days are allowed with a warning that names the alternative ("Close would make it 7 h 50, but the trip would need another day"). An automatic overnight can be pinned ("stay here instead") or skipped.
5. **Stops within a day.** Shortest path through a graph of the day's candidates in route order. Each way of reaching a place carries the clock, lunch done, dinner done, the mile of the last fill-up and where the break clock last restarted. At a place it can stop for a break, lunch or dinner (inside the window, with matching food) or fuel only; a break or meal at a place with fuel can also fill the tank ("merged"). An edge is allowed if the drive stays under the hard break maximum and fuel is bought by mile 300 since the last fill-up. Costs: the gap's distance from the window, the stop's detour and amenities, a large cost for a meal window passed without the meal, and a large one for a fuel-only stop, so fuel merges into a break or meal when it can.
6. **Clock.** Times run in UTC; each row is shown in its place's time zone (timezonefinder, zoneinfo). Each crossing of a time zone becomes a row in the itinerary. Sunset from astral, per day, with a warning when arriving after dark.
7. **Pins.** A stop the user pinned or dragged is a fixed node the path must pass through. Everything else is planned again around it. Pins and skips are keyed by cluster id and pass number (`1234#2`), so they survive small route changes; ones whose place left the route are dropped with a notice (phase 3).

Phase 3 built steps 5 (breaks only), 6 (local times without time zones) and 7. Phase 4 built steps 3 and 4, meals and fuel in step 5, and time zones and sunset in step 6; see `notes/phase-4.md` for the algorithm as built.

Each step is a plain function with unit tests on small hand-made routes.

## Frontend

Plain HTML, CSS and JavaScript with no build step. Leaflet for the map and Leaflet-Geoman for drawing and dragging, both vendored. The styling follows the GeoTagger design system: dark surfaces, one blue accent, status colors that always come with a word, emoji icons paired with labels, 13–14 px system font.

Layout: toolbar on top, map with a drawing toolbar, a right sidebar (Itinerary, Waypoints, Zones), a day timeline strip under the map, and a status bar. Settings is its own page. See [`design/index.html`](design/index.html).

## API sketch

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `/api/plan` | (phase 3) the trip plus break settings, pins and skips in; candidates, closures and the plan (rows with clock times, windows, alternatives, due times, days, warnings) out. Re-plans from the cached candidates without calling Valhalla. Phase 4 adds `meals`, `fuel`, `days` and pin kinds in; meal, fuel, overnight and clock-change rows, local times with `tz`, sunset and chips per day, `zone_effects`, and `avoid_ring` on closed roads out. Zones other than avoid zones do not touch the cache |
| `POST` | `/api/route/stops` | (phase 2) the trip's candidate stops with mile, minute and detour, plus seasonal-closure warnings. Separate from `/api/route` so dragging the route line never waits for detours |
| `GET` | `/api/search?q=` | (phase 2) places and named stops by name, towns first |
| `GET` | `/api/stops/{trip}/{stop}/alternatives` | dropped in phase 3: each break in `/api/plan` carries its ranked alternatives |
| `GET` | `/api/trips` | (phase 5) the saved trips (name, dates, miles, saved time) and the examples |
| `GET`/`PUT`/`DELETE` | `/api/trips/{id}` | (phase 5) load, save and delete a trip file; ids are plain slugs |
| `GET` | `/api/examples/{id}`, `POST /api/examples/{id}/copy` | (phase 5) read an example; copy it into the user's trips |
| `GET`/`PUT` | `/api/defaults` | (phase 5) the settings a new trip starts from |
| `GET`/`PUT` | `/api/zones` | (phase 5) the zone library |
| `GET` / `POST` | `/api/zones/export.geojson`, `/api/zones/import` | (phase 5) GeoJSON out and in |
| `POST` | `/api/zones/what-if` | (phase 5) what switching each of these off zones on would do: no work for a zone off the route, one plan for a stop zone, one route for an avoid zone |
| `POST` | `/api/export/sheet`, `/api/export/gpx`, `/api/export/gmaps` | (phase 5) the trip as the page has it (the `/api/plan` body plus name and choices) in; day sheets (HTML), a GPX file, Google Maps links per day out. They plan from the same cache as `/api/plan`, so they work on unsaved trips |
| `POST` | `/api/trip/start-from-here` | (phase 5) a position and the time in; the new start, departure, waypoints, pins and skips out (or the passes to choose from on a loop) |
| `GET` | `/api/status` | Valhalla health, data dates, POI counts; phase 5 adds `data` (region, OSM date, file sizes, `make` commands) |
| `GET` | `/api/lodging-brands` | (phase 5) commonest lodging brands and the share of lodging that has one |

## Example trips

Both stay inside Colorado, so the development data covers them completely.

**Denver → Durango, one day** (Fri Sep 24, 2027). US-285 and US-160 over Kenosha, Trout Creek, Poncha and Wolf Creek passes. Valhalla's default route since the phase 1 speed fix: 337 mi, 5:56 by Valhalla, about 6:20 with the curve correction and the 1.05 pace. Phase 4 plans, leaving 08:00: break at Fairplay 09:37, lunch at Saguache 11:40, break with fuel at Pagosa Springs 14:11 (merged: fuel was due by mile 300), arriving 15:37. The mockup's lunch at Poncha Springs (it leaves 08:30) and fuel at South Fork come out differently: Poncha is reached before 11:30, and fuel is not due before Wolf Creek Pass. The alternate via I-25 and Walsenburg comes out about 20 minutes longer (382 mi); a second one via I-25, CO-115 and US-50 about 35 minutes longer.

**Colorado loop, five days** (Sat Sep 25 – Wed Sep 29, 2027). 928 mi as routed in phase 4 (Valhalla, A → F without the Mesa Verde day trip): 532 mi to Durango over Trail Ridge Road, I-70 and US-550, 169 mi to Great Sand Dunes, 227 mi back to Denver. It is the starting trip in the app.

| Waypoint | Type | Why it is there |
| --- | --- | --- |
| A Denver | start | |
| B Trail Ridge Road, Alpine Visitor Center | through | pulls the route over Rocky Mountain National Park instead of I-70 |
| C Ouray | through | pulls day 2 across the Western Slope: I-70 to Palisade, US-50 through Delta and Montrose, US-550 over Red Mountain Pass (phase 4) |
| D Durango | 2 nights | Mesa Verde day trip on day 3 |
| E Great Sand Dunes | stop, 3 h | a timed stop with no food on site |
| F Denver | end | closes the loop |

Zones on for this trip: avoid Boulder downtown, no stops in metro Denver, no meals in Montrose, prefer stops in Glenwood Springs. They are in the zone library (phase 5), together with no overnight in Aspen, avoid I-70 Glenwood Canyon and no overnight in DFW, which are off for this trip. Turning Glenwood Canyon on makes the loop 29 minutes longer and 14 miles shorter.

Phase 4 result with the default settings: day 1 ends at Glenwood Springs (automatic, the prefer zone wins over Eagle), 286 mi, 5 h 52, lunch at Hot Sulphur Springs; day 2 Glenwood Springs → Durango, 247 mi, 4 h 54, arriving 13:25 (no lunch stop; Montrose is passed before the lunch window); day 3 in Durango; day 4 Durango → South Fork, 103 mi (the dunes day would arrive after 19:00, and OSM has almost no lodging on US-285 after the dunes); day 5 South Fork → dunes (lunch during the stop) → Denver, 293 mi, arriving 17:05. No fuel stop: every day is under 300 mi and each overnight fills the tank. See `notes/phase-4.md`.

Late September is deliberate: Trail Ridge Road and Independence Pass are open, and both close for winter in October or November.

What Colorado does not exercise: crossing a time zone. That logic has unit tests on a hand-made route (Amarillo → Albuquerque across the Texas / New Mexico line, phase 4), and the first trip outside Colorado (phase 6) checks it for real.

## Phases

Each phase ends with something visible and tests passing in Docker.

0. **Spike.** Compose file with Valhalla building Colorado. A Python script in the api container routes Denver → Durango with one `through` point and one `exclude_polygons` box, and prints the summary. Done when both visibly change the route. (Planned with Ouray; with phase 0's speeds the plain route already ran over US-550 and Ouray, so the spike used Saguache on US-285. Since the phase 1 speed fix the plain route takes US-285, and Ouray does pull it onto US-550.)
1. **Map and routing.** Click to add waypoints, drag them, switch through / stop / overnight, drag the line to add a through point, draw avoid zones, show distance and time. Alternate routes. Done, with a speed calibration step first (notes/phase-1.md).
2. **Stop data.** Done. Importer for Colorado (`make import`, 16 s), candidate clusters along the route with direction-aware detours (3.6 s for the 880-mile loop, cold), seasonal-closure warnings, place search.
3. **Breaks.** Done. Break every N min / M mi with the graph planner, clock times, pins, skips and drag-to-pin without a Valhalla call, stop picker with the window band, day strip, break settings editor.
4. **Days.** Done. Automatic overnights near the daily limit with balanced days, lunch and dinner in their windows, fuel by mile 300 merged into breaks and meals, local times with clock-change rows, sunset, all five zone types with what each did to the trip, "avoid this road" for closed roads.
5. **Output.** Done. Trip files and the example trips, the zone library with what-if answers and GeoJSON, the settings page (this trip or the defaults), the export page (day sheets, GPX, Google Maps links), start from here, now. Plus the phase 4 gaps: sunset on each day's own date, detour to the night in the arrival estimate.
6. **Scale.** Full US build. Overture Places if OSM coverage is thin. Optional offline basemap.

Finishing: `README.md` with screenshots, a landing card in the `tools` section, `prompt.md` via `scripts/prompt-md.sh`.

## Risks

- **OSM gaps.** Rural motels and restaurants can be missing, and closed rest areas can linger. "Skip this place" in the stop picker covers it until Overture is tried.
- **Optimistic speeds.** OSM speeds are close to posted limits, and mountain roads (Trail Ridge, Red Mountain Pass) are where that hurts most. Phase 1: one multiplier could not fit both I-70 and US-550, so the planner slows tight curves by their radius instead of a second multiplier. Remaining misses: US-550 about 10 % fast, Glenwood Springs → Ouray 14 % fast (I-70 at its 75 mph limit). For the full-US build keep the default speeds table off; with a country boundary in the data it would apply and override `maxspeed`.
- **Seasonal closures.** Phase 0 result: the Colorado data tags Trail Ridge Road (`access:conditional=no @ Oct 14 - May 31st`) and Independence Pass (`motor_vehicle:conditional=no @ Nov 15-May 15`), and Valhalla stores both as timed restrictions. With `date_time` it closes Independence Pass on the right dates but still routes January traffic over Trail Ridge Road. So do not rely on Valhalla: the importer keeps the OSM way ids of ways with `seasonal` or `*:conditional` access tags (413 in Colorado), and `/api/route/stops` snaps the route with `/trace_attributes` (which returns `way_id` per edge, in chunks under 200 km) and warns on any hit: closed, check dates, or open on the trip's dates (phase 2). A road closed on the trip's dates offers "avoid this road": an avoid zone around its ways (phase 4). Street names are unreliable for this (the Trail Ridge route is labelled `US 36`). See `notes/phase-0.md`.
- **Few interstate rest areas.** Much of a Colorado trip is two-lane highway, so towns do most of the work as stops. Good for testing the town clusters; less so for rest areas.
- **Avoid zones that trap a waypoint** make Valhalla fail. Checked before routing, with a clear message.
- **Full-US build size.** Tens of GB of tiles and more Docker memory. Deferred to phase 6 on purpose.
- **Google Maps links** cap the number of waypoints: 3 on a phone browser, 9 elsewhere (Google's Maps URLs documentation, read 2026-11-09). Long days are split into links that follow each other, and Google may still route between the points differently (phase 5).
