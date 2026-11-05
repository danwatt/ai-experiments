# N64 build image: libdragon's prebuilt MIPS toolchain (gcc + binutils + libgcc).
# The game itself is bare metal and links nothing from libdragon. Nothing is
# installed on the host.
FROM debian:bookworm-slim
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl make python3 \
 && case "$TARGETARCH" in arm64) A=arm64 ;; *) A=amd64 ;; esac \
 && curl -fsSL -o /tmp/tc.deb \
      https://github.com/DragonMinded/libdragon/releases/download/toolchain-continuous-prerelease/gcc-toolchain-mips64-$A.deb \
 && apt-get install -y --no-install-recommends /tmp/tc.deb \
 && rm -rf /tmp/tc.deb /var/lib/apt/lists/*
ENV N64_INST=/opt/libdragon
ENV PATH=$N64_INST/bin:$PATH
WORKDIR /src
