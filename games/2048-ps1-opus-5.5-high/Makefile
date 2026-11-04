# Run inside the toolchain container (see build.sh).
CROSS   = mipsel-linux-gnu-
CC      = $(CROSS)gcc
OBJCOPY = $(CROSS)objcopy

CFLAGS  = -march=r3000 -mtune=r3000 -mabi=32 -msoft-float -mno-abicalls -fno-pic -G0 \
          -mno-check-zero-division -O2 -ffreestanding -fno-builtin -nostdlib \
          -fno-stack-protector -fno-asynchronous-unwind-tables -Wall -Wextra -Wno-unused-parameter
LDFLAGS = -nostdlib -static -T src/ps1.ld -Wl,--build-id=none -Wl,--gc-sections

SRCS = src/crt0.s src/main.c src/game.c src/gpu.c src/pad.c src/spu.c src/font.c
OBJS = $(patsubst src/%,build/%.o,$(SRCS))

all: hex2048.exe

build/%.o: src/%
	@mkdir -p build
	$(CC) $(CFLAGS) -ffunction-sections -fdata-sections -c $< -o $@

build/hex2048.elf: $(OBJS) src/ps1.ld
	$(CC) $(CFLAGS) $(LDFLAGS) $(OBJS) -o $@

build/hex2048.bin: build/hex2048.elf
	$(OBJCOPY) -O binary -j .text -j .rodata -j .data $< $@

hex2048.exe: build/hex2048.bin tools/mkexe.py
	python3 tools/mkexe.py $< $@

clean:
	rm -rf build hex2048.exe

.PHONY: all clean
