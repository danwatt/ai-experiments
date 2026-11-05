#!/usr/bin/env python3
"""Assemble an N64 ROM: header + boot/ipl3.bin + flat program image at 0x1000, then
a small table of data files at DATA_BASE (u32 count, then u32 offset/size pairs)
followed by the files. The game reads the table with PI DMA (see src/rom.c).
usage: mkrom.py out.z64 title ipl3.bin program.bin [data files...]"""
import struct, sys

DATA_BASE = 0x00100000
out, title, ipl_fn, prog_fn, *data = sys.argv[1:]
ipl = open(ipl_fn, 'rb').read()
prog = open(prog_fn, 'rb').read()
assert len(ipl) <= 0x1000 - 0x40, 'IPL3 too big'
assert 0x1000 + len(prog) <= DATA_BASE, f'program too big ({len(prog)} bytes)'
rom = bytearray(DATA_BASE)
rom[0x1000:0x1000 + len(prog)] = prog
toc = bytearray(4 + 8 * len(data))
struct.pack_into('>I', toc, 0, len(data))
rom += toc
rom += b'\0' * ((-len(rom)) % 16)
for i, fn in enumerate(data):
    blob = open(fn, 'rb').read()
    struct.pack_into('>II', rom, DATA_BASE + 4 + 8 * i, len(rom), len(blob))
    rom += blob
    rom += b'\0' * ((-len(rom)) % 16)
rom += b'\0' * ((-len(rom)) % (1 << 20))   # whole MiB
struct.pack_into('>IIII', rom, 0, 0x80371240, 0x0000000F, 0x80000400, 0x0000144C)
struct.pack_into('>I', rom, 0x18, (len(prog) + 15) & ~15)
rom[0x20:0x34] = title.encode('ascii')[:20].ljust(20)
rom[0x3B:0x3F] = b'NHXE'
rom[0x40:0x40 + len(ipl)] = ipl
open(out, 'wb').write(rom)
print(f'{out}: {len(rom) >> 10} KiB, program {len(prog) >> 10} KiB, {len(data)} data files')
