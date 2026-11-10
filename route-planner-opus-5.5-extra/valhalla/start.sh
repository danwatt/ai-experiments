#!/usr/bin/env bash
# Wrapper around the image's entrypoint. Raises Valhalla's service limits for
# exclude_polygons, whose defaults (10 km circumference, 100 vertices) are far
# too small for drawn avoid zones. Everything else is left to the image.
set -euo pipefail

CONFIG=/custom_files/valhalla.json

# On a first start there is no config yet. Write a default one; the image's
# entrypoint then fills in the paths and merges any missing keys.
if [ ! -f "$CONFIG" ]; then
  valhalla_build_config > "$CONFIG"
fi

# Idempotent on every start.
#  - exclude_polygons limits: room for drawn zones (the API checks the same
#    numbers, see backend/app/zones.py).
#  - no default_speeds_config: speeds come from OSM maxspeed tags (see
#    docker-compose.yml). Removing the key only matters for the next tile build.
#  - max_cache_size: tile cache per worker thread. The default (1 GB) times one
#    thread per CPU outgrew the Docker VM. 256 MB x 4 threads (server_threads in
#    docker-compose.yml) stays near 1 GB.
jq '.service_limits.max_exclude_polygons_length = 3000000
    | .service_limits.max_exclude_polygons_vertices = 500
    | .mjolnir.max_cache_size = 268435456
    | del(.mjolnir.default_speeds_config)' "$CONFIG" | sponge "$CONFIG"

exec /valhalla/scripts/docker-entrypoint.sh "$@"
