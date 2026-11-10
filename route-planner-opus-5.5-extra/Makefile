# Thin wrapper around docker compose. `make` with no target lists them.
.PHONY: help up down logs test import spike calibrate rebuild-tiles clean-data

help:
	@echo "make up | down | logs | test | import | spike | calibrate | rebuild-tiles | clean-data"

up:  ## start everything; the first run downloads and builds tiles
	docker compose up -d --build
	@echo "valhalla and api are starting. 'make logs' to watch; 'docker compose ps' shows health."

down:
	docker compose down

logs:
	docker compose logs -f api valhalla

test:  ## pytest inside the api container
	docker compose run --rm api pytest

import:  ## build data/pois.sqlite (rest areas, exits, fuel, food, lodging, towns) from the OSM file
	docker compose run --rm importer

spike:  ## phase 0 routing experiments, run inside the api container
	docker compose run --rm api python spikes/phase0.py

calibrate:  ## Valhalla's drive times against real-world reference drives
	docker compose exec api python spikes/calibration.py

rebuild-tiles:  ## rebuild routing tiles from the PBF already in data/valhalla (about 1-2 min)
	VALHALLA_FORCE_REBUILD=True docker compose up -d --force-recreate valhalla
	@echo "Rebuilding tiles; 'docker compose logs -f valhalla' shows progress."
	@until docker compose exec valhalla curl -fsS http://localhost:8002/status >/dev/null 2>&1; do sleep 5; done
	@# Recreate without force_rebuild, so a later restart does not rebuild again.
	docker compose up -d valhalla
	@echo "Tiles rebuilt."

clean-data:  ## delete ./data (tiles, PBFs). Trips are kept.
	@echo "This will delete: $(CURDIR)/data"
	@read -p "Type 'yes' to continue: " ans && [ "$$ans" = "yes" ] || (echo "aborted"; exit 1)
	docker compose down
	rm -rf "$(CURDIR)/data"
