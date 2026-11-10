# Phase 0: routing spike

Date: 2026-11-07. Host: Apple M4 Max, Docker Desktop 29.5.3 (arm64, 8 GB VM). Result: the stack works. A through point (Saguache) and an exclusion polygon (Montrose) each change the route; the planned Ouray through point does not, because the plain route already passes it. Two things in the plan need changing: exclude zones need a raised Valhalla limit (done), and Valhalla does not apply the Trail Ridge Road winter closure (it does apply Independence Pass).

## What was built

All in `route-planner-opus-5.5-extra/`; nothing installed on the host.

| File | What |
| --- | --- |
| `docker-compose.yml` | `valhalla` (pinned `ghcr.io/valhalla/valhalla-scripted:3.9.1`, 127.0.0.1:8002, healthcheck on `/status`) and `api` (127.0.0.1:8000, `uvicorn --reload` on the bind-mounted `backend/`, healthcheck on `/api/status`). No `importer` yet |
| `valhalla/start.sh` | Wrapper entrypoint that raises two Valhalla service limits, then runs the image's own entrypoint (see Findings, exclusion limits) |
| `backend/Dockerfile`, `pyproject.toml` | `python:3.12-slim` + uv (0.8.22) + `libexpat1` (needed by the pyosmium wheel). The venv is in `/opt/venv`, outside the bind mount |
| `backend/app/valhalla.py` | Client: `route()`, `status()`, `decode_polyline6()`, `ValhallaError` with Valhalla's error code |
| `backend/app/main.py` | `GET /api/status` reports Valhalla's `/status` |
| `backend/spikes/phase0.py` | The spike. `make spike` |
| `backend/tests/test_valhalla.py` | Polyline decode (known value, round trip, empty) and a Valhalla smoke test that skips when the service is down. `make test`: 4 passed |
| `Makefile`, `.gitignore`, `.env.example`, `README.md` | As specified. `clean-data` asks for `yes` before deleting `./data` |

`make up` gives a healthy `valhalla` and `api` (`docker compose ps` shows both healthy).

## Measurements

| What | Value |
| --- | --- |
| Image tag | 3.9.1 (released 2026-10-06; 3.9.0 and 3.8.3 also have arm64 images). Checked with `docker manifest inspect` |
| Valhalla image size | 681 MB on disk (158 MB compressed pull). API image 424 MB |
| Colorado PBF download | 387.7 MB (369 MiB). Geofabrik was slow: about 0.5 to 1 MB/s, so the download was most of the wait |
| First start to healthy | 620 s (10 min 20 s) from `make up`: about 8.7 min download plus admin and timezone databases, about 1.5 min for the tile build and tar |
| Restart with existing tiles | 7 s to healthy |
| `data/valhalla` | 1.5 GB total: PBF 384 MB, `valhalla_tiles.tar` 493 MB, `valhalla_tiles/` 517 MB, `timezones.sqlite` 128 MB, `admins.sqlite` 6.7 MB, `default_speeds.json` 2.6 MB |
| Peak memory | Valhalla container 3.27 GB during the tile build (`docker stats` every 10 s, so a rough peak). About 0.9 GB while serving. API about 70 MB |
| Graph | 2.85 M edges, 2.15 M nodes, 1.28 M routable ways |
| Request speed | Denver → Durango (400 mi): 0.07 to 0.11 s. With `alternates: 2`: 0.2 s. Estes Park → Grand Lake: 0.03 s |

`valhalla_tiles/` (517 MB) is the loose tile directory; Valhalla serves the `.tar`. The directory looks safe to delete to save space but I left it alone; check before relying on that.

## Spike output (trimmed)

```
=== 1. Denver -> Durango, plain, with alternates ===
  main: 405.3 mi, 8:29
    West 6th Avenue Freeway 9mi@53mph > I 70 225mi@61mph > US 50 160mi@38mph
  alternate 1: 384.7 mi, 8:40
    I 25 South 160mi@59mph > US 160 West 221mi@38mph
  alternate 2: 353.7 mi, 8:58
    West 6th Avenue Freeway 9mi@53mph > I 70 59mi@61mph > CO 9 22mi@38mph > US 285 120mi@36mph > CO 112 13mi@32mph > US 160 West 118mi@38mph

=== 2. Same, with a through point at Ouray ===
  via Ouray: 405.4 mi, 8:31
    West 6th Avenue Freeway 9mi@53mph > I 70 225mi@61mph > US 50 89mi@38mph > US 550 South 70mi@38mph
  plain route already passes 0.01 mi from Ouray, so this through point changes nothing
  US 550 average speed in Valhalla: 38 mph over 70 mi (1:50)

=== 2b. Same, with a through point at Saguache (US-285) ===
  via Saguache: 353.8 mi, 9:00
    West 6th Avenue Freeway 9mi@53mph > I 70 59mi@61mph > CO 9 22mi@38mph > US 285 120mi@36mph > CO 112 13mi@32mph > US 160 West 118mi@38mph
  miles on US 285: plain 0, via Saguache 120

=== 3. Same as 1, with an excluded box on the plain route ===
  plain route passes 0.1 mi from Montrose; box centered at 38.4780, -107.8770
  with box: 353.7 mi, 8:58
    West 6th Avenue Freeway 9mi@53mph > I 70 59mi@61mph > CO 9 22mi@38mph > US 285 120mi@36mph > CO 112 13mi@32mph > US 160 West 118mi@38mph
  plain 405.3 mi -> excluded 353.7 mi

=== 5b. Waypoint inside an excluded box ===
  middle waypoint inside box: ERROR 442: No path could be found for input
  start inside box: ERROR 442: No path could be found for input
  middle through-point inside box: ERROR 442: No path could be found for input

=== 4a. Seasonal tags in the Colorado PBF ===   (scan of the 384 MB PBF takes 63 s)
  Trail Ridge Road (US 34 in RMNP): 72 ways
    x20  highway=secondary  access=permit, access:conditional='no @ Oct 14th - May 31st', hgv=no, vehicle=permit
    x9   highway=primary    access=permit, access:conditional='no @ Oct 14 - May 31st', hgv=no, vehicle=permit
    x13+x3+x3  hgv=destination / designated only (no closure tag)
    x2   access=permit, hgv=no, vehicle=permit (no conditional)
  Independence Pass (CO 82): 51 ways
    x47  highway=secondary  hgv=no, motor_vehicle:conditional='no @ Nov 15-May 15'
  statewide highway ways carrying: seasonal 189, motor_vehicle:conditional 147, access:conditional 81,
    hgv:conditional 139, maxspeed:conditional 182, bicycle:conditional 72, oneway:conditional 44

=== 4b. Estes Park -> Grand Lake in September and in January ===
  mid-September: 47 mi, 1:42; passes 0.5 mi from Alpine Visitor Center; 20 route ways carry closure tags
  mid-January:   47 mi, 1:42; passes 0.5 mi from Alpine Visitor Center; 20 route ways carry closure tags
  no date_time:  150 mi, 4:08; US 36 > CO 93 > I 70 > US 40 > US 34 (avoids Trail Ridge)

=== 4c. Leadville -> Aspen over Independence Pass (CO 82), by date ===
  no date_time, Jul 15, Oct 20, Nov 10 : 58 mi, 2:04 over the pass
  Nov 20, Jan 15, May 10               : 129 mi, 3:03 via I-70 (pass closed)
  May 20                               : 58 mi, 2:04 over the pass
```

## Answers

### Item 4a: seasonal tags in the Colorado data

- **Trail Ridge Road** (name `Trail Ridge Road`, `ref=US 34`): the 29 main ways carry `access=permit`, `vehicle=permit`, `hgv=no` and `access:conditional=no @ Oct 14th - May 31st` (or `Oct 14 - May 31st`). The date text is not clean OSM syntax (`14th`, `31st`). Some segments (13 ways) have no closure tag.
- **Independence Pass** (`ref=CO 82`, no name): 47 ways carry `motor_vehicle:conditional=no @ Nov 15-May 15` and `hgv=no`. This is clean syntax.
- Statewide, 189 highway ways have `seasonal=*` and a few hundred have `*:conditional` tags, so closures are a general pattern in the data.

### Item 4b: does Valhalla close Trail Ridge in January?

**No.** With `date_time` in mid-September or mid-January, and with any other date tried (Oct through June), the Estes Park → Grand Lake route stays on Trail Ridge Road, 47 mi, 1:42, passing 0.5 mi from the Alpine Visitor Center. The tiles do hold the restriction: `/locate` shows a `timed_denied` restriction for cars on Trail Ridge edges. It just is not enforced when a date is given.

Two oddities:
- Without `date_time`, Valhalla routes around Trail Ridge (150 mi, 4:08 via I-70). The spike date is Nov 7, so my best explanation is that the no-date path checks against today's date (closed since Oct 14) while the dated path does not. I did not prove that.
- **Independence Pass works.** The same test over CO 82 flips exactly on the tag dates: open through Nov 10, closed Nov 20 through May 10, open May 20. January routes go 129 mi via I-70 and Leadville.

So Valhalla handles `motor_vehicle:conditional` with clean dates and not the Trail Ridge `access:conditional` ways. Don't rely on Valhalla for winter closures.

What works instead: `/trace_attributes` on the route's shape returns the OSM `way_id` of each edge (`filters.attributes=["edge.way_id"]`). Intersecting those ids with the ways the importer flags (any `seasonal`, `access:conditional`, `motor_vehicle:conditional`, `vehicle:conditional`) found 20 closure-tagged ways on the Trail Ridge route. That gives the planned itinerary warning ("this route uses a road tagged closed Oct 14 – May 31") for any date, with exact road and dates. Limit: `trace_attributes` rejects paths over 200 km by default, so check per leg or raise `service_limits.trace.max_distance`.

Street names are unreliable for this: the Trail Ridge route is labelled `US 36` in the maneuvers, not `US 34` or `Trail Ridge Road`. Match on way ids or geometry, never names.

### Item 5

- **Env vars.** All names are lowercase and match the image's own scripts (`/valhalla/scripts/configure_valhalla.sh`): `tile_urls`, `build_admins`, `build_time_zones`, `build_elevation`, `use_tiles_ignore_pbf`. They worked as written. The image defaults already are `build_admins=True`, `build_time_zones=True`, `build_elevation=False`, `use_tiles_ignore_pbf=True`, so only `tile_urls` is needed, but setting them keeps the intent visible. Tiles are built only when none exist; changing `tile_urls` later does nothing unless `data/valhalla` is cleared.
- **Waypoint inside an exclusion box.** It fails, for any waypoint type. A middle `break`, a start, and a middle `through` point inside the box all return HTTP 400, `error_code 442`, `"No path could be found for input"`. The message does not say a zone caused it, so the pre-check in the plan (find which zone holds a waypoint, name it) is needed.
- **Exclude polygon limits.** Valhalla's default limits are `max_exclude_polygons_length = 10000` m (circumference) and `max_exclude_polygons_vertices = 100`. A box 0.1° wide (about 7 mi on a side) is rejected with `Exceeded maximum circumference for exclude_polygons: 10000 meters`. That is a 2.5 km square, useless for drawn zones. `valhalla/start.sh` raises them to 3,000,000 m and 500 vertices on every start (and writes a config first if there is none). The image keeps `update_existing_config=True`, which merges and keeps edited values; changes survive restarts. Zone checks in the API should still tell the user when a zone is too big.
- **Speed.** 0.03 to 0.2 s per request, including `alternates: 2`. No concern for interactive use.
- **Speeds on US-550.** Ouray → Durango 70 mi in 1:50 is 38 mph. That matches what I know of the drive (about 1:45 to 2:00 with Red Mountain, Molas and Coal Bank passes), so plausible. The surprise is elsewhere: Valhalla looks pessimistic, not optimistic, on rural two-lane roads. I-70 averages 61 mph (reasonable), but US-160 and US-285 average 36 to 38 mph, and the I-25 + US-160 alternate crosses Wolf Creek at 38 mph overall. I could not check these against a real drive. If a real drive of US-285 / US-160 is faster, a multiplier above 1.0 may be needed and the plan's "1.05" default should be tested against a drive you know.

### The plain route is not the one the plan expects, and Ouray changes nothing

The plan expects Denver → Durango on US-285 and US-160 (about 338 mi, break at Fairplay). Valhalla's fastest route (405 mi, 8:29) goes I-70 to Grand Junction, then US-50 to Montrose and US-550 over Ouray, Silverton and Red Mountain Pass. The US-285 route is **alternate 2** (354 mi, 8:58, 29 min slower by Valhalla's clock). The I-25 + US-160 route is alternate 1 (385 mi, 8:40).

So the phase 0 check "Ouray through point pulls the route onto US-550" does not show anything: the plain route already passes 0.01 mi from Ouray (the US-550 stretch is labelled `US 50` in the plain route's maneuvers and `US 550 South` only once the through point splits it). Route length is 405.3 vs 405.4 mi. A through point that does reshape the route is Saguache on US-285 (test 2b): the route switches to I-70, CO-9, US-285 (120 mi), US-160, 354 mi. Through points work; Ouray was just a bad choice for this origin and destination. The exclusion test (3) also visibly changes the route: a 0.1° box on Montrose (plain route) forces the US-285 route.

## Recommendations for PLAN.md

Applied in PLAN.md (facts that changed): the pinned tag, env var names and the start script, and the seasonal-closure finding.

Not applied; for you or a later phase to decide:

1. **Example trip.** Make "Denver → Durango" actually take US-285: give the example trip a through point on US-285 (Saguache, Fairplay or Poncha Springs), or call the plain trip "via US-50". The plain route is I-70/US-50/US-550, and US-285 is only alternate 2. Replace "Ouray, which pulls the route onto US-550" in the phase 0 text: the plain route already uses US-550. The Example trips text (US-285, 338 mi, break at Fairplay, I-25 alternate "a little longer") does not match Valhalla's main route either.
2. **Exclusions.** Keep `valhalla/start.sh`. Add to phase 1: a pre-check for waypoints inside an avoid zone with a message that names the zone (Valhalla only says 442).
3. **Seasonal closures (phase 2 importer, phase 4 itinerary).** The importer should keep OSM way ids of every highway way with `seasonal` or a `*:conditional` access tag, with its text. The planner then calls `/trace_attributes` on the route to find the closure-tagged ways, and warns with the dates. Don't parse the dates as a router would; show the tag text. Treat Valhalla's own date handling as a bonus (Independence Pass works), not as the check.
4. **Speeds.** Validate Valhalla's times against a drive you know before deciding on the 1.05 multiplier. Rural two-lane roads look slow.
5. **Disk.** `valhalla_tiles/` (517 MB) next to the `.tar` is probably removable. Full-US scales this by about 30.
