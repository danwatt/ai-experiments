# Build environment for hex2048.gb: RGBDS (compiled from source) + Node.
# Used by build.sh; the image needs no build context.

FROM debian:bookworm-slim AS rgbds
ARG RGBDS_VERSION=1.0.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl make g++ bison pkg-config libpng-dev \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://github.com/gbdev/rgbds/archive/refs/tags/v${RGBDS_VERSION}.tar.gz" | tar -xz -C /tmp \
 && make -C "/tmp/rgbds-${RGBDS_VERSION}" -j"$(nproc)" Q= \
 && make -C "/tmp/rgbds-${RGBDS_VERSION}" install PREFIX=/opt/rgbds Q=

FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpng16-16 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=rgbds /opt/rgbds/bin/ /usr/local/bin/
WORKDIR /src
