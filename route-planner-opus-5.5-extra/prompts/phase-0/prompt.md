# Prompts

- **Model:** claude-sonnet-5-5
- **Effort:** high
- **Session(s):** 46ca8f3f-fedb-4d65-926b-b6d72fa9b69e
- **Tokens:** input 92, output 59884, cache read 5642313, cache write 129829
- **Cost (tokscale estimate):** $1.68

## You

Background (from the session that started this one):
Project: an offline desktop road-trip planner in `route-planner-opus-5.5-extra/` inside the `ai-experiments` repo. It plans multi-day trips with breaks every N minutes / M miles, places stops at real rest areas, exits and towns, supports A→B→C→D routing with through points (shaping only) and drawn zones (avoid / no stops / no meals / no overnight / prefer). The backend is Python, which the user wants to be able to read. Everything runs in Docker so the host stays clean: a `valhalla` container (routing, built from OpenStreetMap), an `api` container (FastAPI, also serves a plain HTML/JS Leaflet frontend later), and a one-shot `importer` container (later phases). The development region is Colorado only (Geofabrik extract, 369 MB). Planning is finished: `route-planner-opus-5.5-extra/PLAN.md` holds every decision, the architecture, the example trips (Denver → Durango; a five-day Colorado loop) and the phase list; `route-planner-opus-5.5-extra/design/index.html` holds UI mockups. This session is phase 0 of 6, a spike that proves the routing stack works before any real app code. Each phase runs in its own session and leaves a transcript record under `route-planner-opus-5.5-extra/prompts/phase-N/`. Host: Apple M4 Max, Docker Desktop with about 8 GB of VM memory, 93 GB of free disk. The user's commands go through an `rtk` shell hook automatically; ignore it.

Task:
Do phase 0 of `route-planner-opus-5.5-extra/PLAN.md`. Read PLAN.md first, especially the Decisions, Architecture, Routing with Valhalla, Example trips, Phases and Risks sections.

## Build

All inside `route-planner-opus-5.5-extra/`. Install nothing on the host; everything runs through `docker compose`.

1. `docker-compose.yml`:
   - `valhalla`: `ghcr.io/valhalla/valhalla-scripted`, pinned to a real release tag that has an arm64 image (check with `docker manifest inspect`). Use `tile_urls` = the Geofabrik Colorado extract, `build_admins` and `build_time_zones` on, `build_elevation` off, `use_tiles_ignore_pbf` on. Confirm these environment variable names against the image's own docs before relying on them. Bind mount `./data/valhalla` to `/custom_files`. Publish port 8002 on 127.0.0.1 only. Add a healthcheck.
   - `api`: built from `backend/Dockerfile` (`python:3.12-slim` + uv, deps in `backend/pyproject.toml`). Minimal FastAPI app in `backend/app/main.py` with `GET /api/status` that reports Valhalla's `/status`. A small, readable Valhalla client in `backend/app/valhalla.py` (route request, polyline6 decode). Run uvicorn with `--reload` on the bind-mounted source. Publish 127.0.0.1:8000.
   - Leave the `importer` service for phase 2.
2. `Makefile` wrapping compose: `up`, `down`, `logs`, `test`, `spike`, `clean-data` (removes `./data` only after confirming the path).
3. `.gitignore` for `data/` and `trips/`. `.env.example` with the region URL and ports.
4. A short `README.md`: what the project is, that it is at phase 0, and how to run it.

Start the stack and let Valhalla build the Colorado tiles. That takes a while: run it in the background and wait on its logs or healthcheck; don't poll in a tight loop. Record the download size, build time, the size of `data/valhalla`, and peak memory if you can see it.

## Spike

Write `backend/spikes/phase0.py`, run it inside the api container through `make spike`, and print readable summaries: miles, h:mm, and the main road names in order, taken from the maneuvers.

1. Denver → Durango, plain. Also request `alternates: 2` and list each alternate.
2. Same, with a `through` location at Ouray (about 38.02 N, -107.67 W). It should pull the route onto US-550.
3. Same as 1, with one `exclude_polygons` box placed on the plain route (for example around Poncha Pass or Saguache on US-285). It should visibly change the route.
4. Seasonal closures:
   a. Use pyosmium in the api container to scan the Colorado PBF for the Trail Ridge Road (US-34 inside Rocky Mountain National Park) and Independence Pass (CO-82) ways. Report their `seasonal`, `access:conditional`, `motor_vehicle:conditional` and similar tags.
   b. Route Estes Park → Grand Lake with `date_time` set in mid-September and again in mid-January. Report whether Valhalla still sends the January route over Trail Ridge Road.
5. Note anything that changes the plan: which env vars actually worked, whether the polygon exclusion fails when a waypoint sits inside the box (try it and report the error), how fast requests are, and whether OSM speeds on US-550 look plausible.

Add one or two pytest tests (polyline decoding, and a Valhalla smoke test that skips if the service is down). `make test` runs them in the container.

## Write up

- `route-planner-opus-5.5-extra/notes/phase-0.md`: what you built, the measurements, the spike output (trimmed), answers to items 4 and 5, and any recommended changes to PLAN.md.
- Update PLAN.md only where a fact changed: the pinned image tag, the env var names, the seasonal-closure finding. Do not rewrite it.

## Rules

- Do not commit, branch or push. Leave every change in the working tree. This checkout is shared, and it already has unrelated uncommitted changes under `politics/`; do not touch or stage them.
- Edit only inside `route-planner-opus-5.5-extra/`, apart from the record step below.
- Leave the containers running at the end, so the next phase and the user can use them.

## Done when

`make up` gives a healthy Valhalla and api, `make spike` shows the through point and the exclusion each changing the route, `make test` passes, and the notes file exists.

## Last step: record

After your final summary, write this session's record:

```bash
mkdir -p route-planner-opus-5.5-extra/prompts/phase-0
scripts/prompt-md.sh route-planner-opus-5.5-extra/prompts/phase-0 <your-session-id>
```

Run it from the repo root. Your session id is the last path component of your scratchpad directory; pass it explicitly, since other sessions share this repo. Check that the output covers only this session and says whether the cost is available. Then end with a short report: done or not, measurements, surprises, and anything the next phase needs to know.

Shared notes folder for this group of sessions (outside the repo; read siblings' notes there, leave hand-over notes or large findings there instead of pasting them into messages): /Users/danwatt/Library/Application Support/Claude/side-session-notes/local_e3f2f033-dc70-46e4-b2e2-53821eaee896

## Claude

Checking env var defaults and healthcheck tooling in the image.

Env vars are lowercase in this image and defaults already match what we want. Writing the project files now.

Replace the guessed polyline fixture with an encoder-based round-trip test.

Starting the stack, with a background memory sampler.

Build is running. Writing the spike while it goes.

Valhalla is downloading the Colorado extract, which is slow so far (about 66 MB of 369 MB). The tile build starts after it. I'm waiting on the background watchers and will run the spike once Valhalla is healthy.

Tile build started. Waiting for the healthy notification.

Tile build in progress. I'll continue when the healthy notification arrives.

Valhalla healthy, 620 s from `make up`. Running the spike.

pyosmium wheel needs `libexpat1` in slim image. Add to Dockerfile.

Two findings already. The plain route is I-70/US-50 (405 mi), not US-285. And Valhalla caps exclude polygons at 10 km circumference. Checking the config keys.

Now update the spike: box target is Montrose (on the actual plain route), and the road summary shows average mph.

Three things to chase: Valhalla ignored the January closure with `date_time` set, but avoided Trail Ridge with no date. The Estes Park route is labelled "US 36" instead of "US 34". Debugging.

Independence Pass closure works with `date_time`. Trail Ridge does not. Inspecting the Trail Ridge edge in the tiles.

`way_id` works through `trace_attributes`. Adding that check and the Independence Pass test to the spike.

All checks pass. Writing notes and the PLAN.md fact updates.

The Ouray result looks suspicious: Ouray sits on US-550, which the plain route may already use. Checking the plain route's names.

Confirmed: the plain route already passes within 0.01 mi of Ouray, so that through point changes nothing. Adding a through point at Saguache on US-285 that does change the route.

Phase 0 is done. The stack is up and healthy, `make test` passes (4 tests) and `make spike` runs clean. Nothing is committed. The record step comes next.

**Measurements**
- Image: `valhalla-scripted:3.9.1`, which has an arm64 build. The env var names are lowercase, and they worked as written.
- Colorado download: 387.7 MB. First start to healthy took 620 s. About 8.7 min of that was the slow Geofabrik download, and the tile build took about 1.5 min. A restart with tiles takes 7 s.
- `data/valhalla` is 1.5 GB. The loose `valhalla_tiles/` directory is 517 MB of that, next to the 493 MB `.tar`, and is probably safe to delete.
- Memory: Valhalla peaks around 3.3 GB during the tile build (sampled every 10 s) and sits near 0.9 GB while serving. Requests take 0.03 to 0.2 s.

**Surprises, all in `notes/phase-0.md`**
1. **Plain route.** Denver → Durango goes I-70/US-50/US-550 (405 mi, 8:29). The US-285 route is only alternate 2 (354 mi, 8:58).
2. **Ouray through point.** It changes nothing, because the plain route already passes within 0.01 mi of Ouray. A Saguache through point does change the route, onto US-285. The exclusion box on Montrose also changes it.
3. **Exclude polygon limit.** Valhalla's default cap of 10 km circumference rejected a 0.1° box. I added `valhalla/start.sh` to raise it, and PLAN.md says so.
4. **Waypoint inside a box.** Any waypoint type inside an excluded box returns error 442, "No path could be found for input", with no mention of the zone.
5. **Seasonal closures.**
   - Independence Pass closes correctly by date.
   - Trail Ridge Road does not: January routes still cross it.
   - With no `date_time` the Trail Ridge route avoids it. I could not prove why, and my guess is it checks today's date.
   - `/trace_attributes` returns OSM way ids, so the planner can warn from the way ids the importer flags as seasonal or conditional. Street names are unreliable here.
6. **Speeds.** US-550 at 38 mph is plausible. Rural two-lane roads (US-160, US-285) at 36 to 38 mph look slow rather than optimistic. I had no real drive to check against.

**For phase 1 and 2**
- The example trips text needs a through point on US-285 to take that road.
- Phase 1 needs a pre-check that names an avoid zone holding a waypoint.
- The phase 2 importer should keep way ids for tags like `seasonal` and `access:conditional`.

Now the record step.

Phase 0 is done and recorded, with nothing committed or pushed. `make up` gives a healthy Valhalla and api, `make test` passes (4 tests), and `make spike` runs clean. The containers are left running.

**What changed the plan**
- **Ouray through point does nothing.** The plain route already passes 0.01 mi from Ouray. A Saguache through point does reshape it, onto US-285, and an exclusion box on Montrose also changes it.
- **Plain Denver → Durango is I-70/US-50/US-550**, 405 mi, 8:29. The US-285 route is only alternate 2 (354 mi, 8:58).
- **Trail Ridge Road closure is not applied by Valhalla.** Independence Pass closes correctly by date, but January routes still cross Trail Ridge. The planner needs its own check: `/trace_attributes` returns OSM way ids, which can be matched against closure-tagged ways. Street names are unreliable, since the Trail Ridge route is labelled `US 36`.
- **Exclude polygons were capped at 10 km circumference.** I added `valhalla/start.sh` to raise the limit. A waypoint inside an excluded box fails with error 442 and no mention of the zone, so the phase 1 pre-check needs to name it.

**Measurements**
- **Image and download:** `valhalla-scripted:3.9.1`, with a 387.7 MB Colorado download. The env var names are lowercase and worked as written.
- **First start to healthy:** 620 s. About 8.7 min was the slow download and 1.5 min the tile build. A restart takes 7 s.
- **Disk:** `data/valhalla` is 1.5 GB. The loose `valhalla_tiles/` directory is 517 MB of that and is probably safe to delete.
- **Memory:** Valhalla peaks around 3.3 GB during the build (sampled every 10 s) and sits near 0.9 GB while serving.
- **Request speed:** 0.03 to 0.2 s per request.

**For later phases**
- The example trips text expects a US-285 route that Valhalla does not produce by default. It needs a through point on US-285.
- The phase 2 importer should keep way ids for `seasonal` and `*:conditional` tags.
- Rural two-lane roads look slow in Valhalla (36 to 38 mph), but I could not check that against a real drive.

I updated PLAN.md for the pinned tag, the env var names and `valhalla/start.sh`, and the seasonal-closure finding. I did not change the Example trips text or the phase 0 definition of done.

`prompts/phase-0/prompt.md` covers only this session and the cost is available ($1.65). It holds Claude's replies only, because the task brief arrived from another session rather than as a user prompt.

Everything is in `route-planner-opus-5.5-extra/`. Start with `notes/phase-0.md`.
