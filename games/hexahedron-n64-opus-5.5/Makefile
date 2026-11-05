# Build hexahedron64.z64. Run ./build.sh to do this inside Docker.
CC      = mips64-elf-gcc
OBJCOPY = mips64-elf-objcopy
ARCH    = -march=vr4300 -mtune=vr4300 -mabi=32 -mhard-float -mfp32 -G0 -mno-abicalls -fno-pic
CFLAGS  = $(ARCH) -O2 -ffreestanding -fno-builtin -fno-tree-loop-distribute-patterns \
          -fsingle-precision-constant -ffast-math -mno-check-zero-division \
          -Wall -Wno-misleading-indentation $(EXTRA)
LDFLAGS = $(ARCH) -nostdlib -Wl,-n -Wl,-Tsrc/n64.ld -Wl,--gc-sections
SRCS    = src/crt0.S $(wildcard src/*.c)
MISSIONS = filesystem/m1.bin filesystem/m2.bin filesystem/m3.bin

hexahedron64.z64: build/ipl3.bin build/game.bin $(MISSIONS) tools/mkrom.py
	python3 tools/mkrom.py $@ "HEXAHEDRON 64" build/ipl3.bin build/game.bin $(MISSIONS)

build/game.elf: $(SRCS) $(wildcard src/*.h) src/n64.ld
	@mkdir -p build
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $(SRCS) -lgcc
	mips64-elf-size $@

build/game.bin: build/game.elf
	$(OBJCOPY) -O binary -j .text -j .rodata -j .data $< $@

build/ipl3.bin: boot/ipl3.S boot/ipl3.ld
	@mkdir -p build
	$(CC) -march=vr4300 -mabi=32 -mno-abicalls -fno-pic -nostdlib -Wl,-n -Wl,-Tboot/ipl3.ld -o build/ipl3.elf $<
	$(OBJCOPY) -O binary build/ipl3.elf $@

clean:
	rm -rf build hexahedron64.z64

.PHONY: clean
