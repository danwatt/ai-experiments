# Cross toolchain for the PlayStation's MIPS R3000A (little-endian MIPS I).
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-mipsel-linux-gnu binutils-mipsel-linux-gnu make python3-minimal \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
