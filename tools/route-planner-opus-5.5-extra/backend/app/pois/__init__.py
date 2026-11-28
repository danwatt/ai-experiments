"""Stop data: places to stop along a route, read from OpenStreetMap.

    extract.py   OSM file -> rows (pyosmium)
    clusters.py  rows -> clusters: an exit or town with what is around it
    db.py        SQLite: schema, writing, spatial queries and name search
    __main__.py  `python -m app.pois`, what `make import` runs
"""
