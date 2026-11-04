# Build image: Debian's packaged cc65 (includes the Atari Lynx target).
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends cc65 make \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
