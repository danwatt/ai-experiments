"""FastAPI app: the JSON API under /api, and the frontend as static files."""

import os
from pathlib import Path

import httpx
from fastapi import Body, FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import here, library, mapdata, routing, trips, valhalla, whatif
from .export import gmaps, gpx, sheet
from .models import ExportRequest, HereRequest, PlanRequest, RouteRequest, WhatIfRequest
from .planner import analysis, choices, schedule
from .pois import db
from .zones import ZoneError

FRONTEND = Path(os.environ.get("FRONTEND_DIR", "/frontend"))

app = FastAPI(title="Road-trip planner")


@app.get("/api/status")
def api_status() -> dict:
    """Report whether Valhalla is up, and what it says about itself."""
    out: dict = {"api": "ok"}
    try:
        out["valhalla"] = {"up": True, **valhalla.status()}
    except httpx.HTTPError as exc:
        out["valhalla"] = {"up": False, "error": str(exc)}
    try:
        out["pois"] = {"up": True, **db.info(db.shared())}
    except FileNotFoundError:
        out["pois"] = {"up": False, "error": "no stop data; run `make import`"}
    out["data"] = mapdata.info()
    return out


@app.exception_handler(trips.TripError)
def trip_error(request: Request, exc: trips.TripError):
    return JSONResponse(status_code=exc.status, content={"error": {"code": "trip_file", "message": exc.message}})


@app.exception_handler(here.HereError)
def here_error(request: Request, exc: here.HereError):
    return JSONResponse(status_code=422, content={"error": {"code": "start_from_here", "message": exc.message}})


@app.post("/api/route")
def api_route(req: RouteRequest):
    """Route a trip: waypoints, zones and road options in; geometry, legs,
    alternates and warnings out. Problems the user can fix come back as 422
    with {"error": {"code", "message", ...}}."""
    try:
        return routing.plan_route(req)
    except ZoneError as exc:
        return JSONResponse(status_code=422, content={"error": exc.as_dict()})
    except routing.RouteError as exc:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "no_route", "message": exc.message, "valhalla_code": exc.valhalla_code}},
        )
    except httpx.HTTPError as exc:
        return JSONResponse(
            status_code=503,
            content={"error": {"code": "valhalla_down", "message": f"Valhalla is not reachable: {exc}"}},
        )


def planner_errors(run):
    """Run a planner request; problems the user can fix come back as 422,
    missing data or a stopped Valhalla as 503 (same shapes as /api/route)."""
    try:
        return run()
    except FileNotFoundError:
        return JSONResponse(status_code=503, content={"error": {"code": "no_stop_data", "message": "No stop data yet. Run `make import`."}})
    except ZoneError as exc:
        return JSONResponse(status_code=422, content={"error": exc.as_dict()})
    except routing.RouteError as exc:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "no_route", "message": exc.message, "valhalla_code": exc.valhalla_code}},
        )
    except httpx.HTTPError as exc:
        return JSONResponse(
            status_code=503,
            content={"error": {"code": "valhalla_down", "message": f"Valhalla is not reachable: {exc}"}},
        )


@app.post("/api/route/stops")
def api_route_stops(req: RouteRequest):
    """Candidate stops along a trip's route, each with its mile, its minute and
    its detour, plus warnings for seasonally closed roads.

    A second endpoint, not part of /api/route: the map asks /api/route on every
    mouse move while the route line is dragged, and detours take a few
    seconds. The page asks for this one once the route has settled. Same body
    as /api/route; same 422 errors.
    """
    return planner_errors(lambda: analysis.analyze(req, db.shared()))


@app.post("/api/plan")
def api_plan(req: PlanRequest):
    """Everything /api/route/stops answers, plus the break plan: breaks with
    clock times, their windows and alternatives, due times, days and warnings.

    The page asks for this one instead of /api/route/stops, once the route has
    settled. The candidates come from the same cache, keyed by the route part
    of the request only, so a re-plan after a pin, a skip or a settings change
    finds them there and makes no Valhalla call.
    """

    def run():
        out, tl = analysis.analyze_with_timeline(req.analysis_request(), db.shared())
        cands = [{**c, "over_limit": not choices.detour_ok(c, req.breaks)} for c in out["candidates"]]
        closures = out["closures"] if req.warn_closures else []
        return {**out, "closures": closures, "candidates": cands, "limit_minutes": 2 * req.breaks.max_detour_each_way, "plan": schedule.plan(req, out, tl)}

    return planner_errors(run)


# ---------- trip files, defaults, the zone library (phase 5) ----------


@app.get("/api/trips")
def api_trips():
    """The user's saved trips (newest first) and the read-only examples."""
    return {"trips": trips.listing(), "examples": trips.examples()}


@app.get("/api/trips/{trip_id}")
def api_trip_get(trip_id: str):
    return trips.read(trip_id)


@app.put("/api/trips/{trip_id}")
def api_trip_put(trip_id: str, doc: dict = Body(...)):
    """Save a trip (replacing the file). The body is the trip file; see trips.TripFile."""
    return trips.write(trip_id, doc)


@app.delete("/api/trips/{trip_id}")
def api_trip_delete(trip_id: str):
    trips.delete(trip_id)
    return {"deleted": trip_id}


@app.get("/api/examples/{example_id}")
def api_example_get(example_id: str):
    return trips.read_example(example_id)


@app.post("/api/examples/{example_id}/copy")
def api_example_copy(example_id: str):
    """Copy an example into the user's trips. Answers {id, trip}."""
    new_id, doc = trips.copy_example(example_id)
    return {"id": new_id, "trip": doc}


@app.get("/api/defaults")
def api_defaults_get():
    return trips.read_defaults()


@app.put("/api/defaults")
def api_defaults_put(doc: dict = Body(...)):
    """Save the settings that new trips start from."""
    return trips.write_defaults(doc)


@app.get("/api/zones")
def api_zones_get():
    """The zone library: {zones, seeded}."""
    return library.read()


@app.put("/api/zones")
def api_zones_put(doc: dict = Body(...)):
    """Replace the zone library. Body: {zones: [...]}."""
    return library.write(doc.get("zones") or [])


@app.get("/api/zones/export.geojson")
def api_zones_export():
    """The library as a GeoJSON FeatureCollection of polygons (name and type in the properties)."""
    body = library.to_geojson(library.read()["zones"])
    return JSONResponse(body, media_type="application/geo+json", headers={"Content-Disposition": 'attachment; filename="zone-library.geojson"'})


@app.post("/api/zones/import")
def api_zones_import(doc: dict = Body(...)):
    """Add the polygons of a GeoJSON document to the library. Answers {library, added}."""
    return library.import_geojson(doc)


@app.post("/api/zones/what-if")
def api_zones_what_if(req: WhatIfRequest):
    """What would switching on each of these (currently off) zones do to the trip?

    Not part of /api/plan: asked on request, so a big library never slows planning.
    A zone that touches nothing costs nothing; a stop zone needs one more plan from
    the cached candidates; an avoid zone needs one more route.
    """

    def run():
        out, tl = analysis.analyze_with_timeline(req.analysis_request(), db.shared())
        return {"effects": whatif.check(req, req.check, out, tl)}

    return planner_errors(run)


@app.post("/api/trip/start-from-here")
def api_start_from_here(req: HereRequest):
    """The changes that make a position on the route the trip's new start, departing now.
    Answers what to change (waypoints, depart, pins, skips, dropped), or {ambiguous, passes}
    when the position is near more than one pass of a looping route."""

    def run():
        out, tl = analysis.analyze_with_timeline(req.trip.analysis_request(), db.shared())
        return here.start_from_here(req.trip, out, tl, req.lat, req.lon, req.now, req.mile)

    return planner_errors(run)


# ---------- exports (phase 5) ----------
#
# The page POSTs the trip as it has it, saved or not, instead of naming a saved
# file: a trip being edited is what people print, and the route and candidates
# come from the same cache /api/plan fills, so these answer in milliseconds.


def planned(req: PlanRequest):
    out, tl = analysis.analyze_with_timeline(req.analysis_request(), db.shared())
    return out, tl, schedule.plan(req, out, tl)


@app.post("/api/export/sheet")
def api_export_sheet(req: ExportRequest):
    """Day sheets as one HTML page, a printed page per driving day."""

    def run():
        out, tl, plan = planned(req)
        closures = out["closures"] if req.warn_closures else []
        html = sheet.build(plan, closures, req.name, mapdata.info()["osm_date"] or "unknown", req.only_days, req.parts)
        return HTMLResponse(html)

    return planner_errors(run)


@app.post("/api/export/gpx")
def api_export_gpx(req: ExportRequest):
    """A GPX file: one track per driving day, a waypoint for every place and stop."""

    def run():
        out, tl, plan = planned(req)
        body = gpx.build(plan, tl, req.name, req.only_days)
        return Response(body, media_type="application/gpx+xml", headers={"Content-Disposition": f'attachment; filename="{gpx.filename(req.name)}"'})

    return planner_errors(run)


@app.post("/api/export/gmaps")
def api_export_gmaps(req: ExportRequest):
    """Google Maps links per driving day: {limit, days: [{day, title, links, note ...}]}."""

    def run():
        out, tl, plan = planned(req)
        return {"limit": gmaps.LIMITS[req.platform], "days": gmaps.build(plan, req.options, req.platform, req.include_stops, req.only_days)}

    return planner_errors(run)


@app.get("/api/lodging-brands")
def api_lodging_brands():
    """Lodging brands in the places database, commonest first, and the share of lodgings that have one."""
    try:
        return db.lodging_brands(db.shared())
    except FileNotFoundError:
        return JSONResponse(status_code=503, content={"error": {"code": "no_stop_data", "message": "No stop data yet. Run `make import`."}})


@app.get("/api/search")
def api_search(q: str = "", limit: int = 8):
    """Places and named stops by name: towns first, then rest areas, exits and roadside groups.

    Each hit: kind, name, detail (a line to show under the name), lat, lon, population.
    """
    try:
        return {"results": db.search(db.shared(), q, max(1, min(limit, 25)))}
    except FileNotFoundError:
        return JSONResponse(status_code=503, content={"error": {"code": "no_stop_data", "message": "No stop data yet. Run `make import`."}})


# Last, so /api routes win. html=True serves index.html for "/".
if FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
