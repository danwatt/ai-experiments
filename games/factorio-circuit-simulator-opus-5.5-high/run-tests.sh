#!/bin/sh
# Runs the simulator unit tests with Node inside Docker (nothing installed on the host).
cd "$(dirname "$0")"
exec docker run --rm -v "$PWD":/w -w /w node:22-alpine sh -c 'node --test tests/*.test.mjs'
