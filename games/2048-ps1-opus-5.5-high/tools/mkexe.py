#!/usr/bin/env python3
"""Wrap a raw binary (loaded at 0x80010000) in a 2 KiB PS-X EXE header."""
import struct
import sys

LOAD_ADDR = 0x80010000
STACK_TOP = 0x801FFF00
MARKER = b"Sony Computer Entertainment Inc. for North America area"

def main(src, dst):
    body = open(src, "rb").read()
    body += b"\0" * (-len(body) % 2048)
    hdr = bytearray(2048)
    hdr[0:8] = b"PS-X EXE"
    struct.pack_into("<IIIIIIIIII", hdr, 0x10,
                     LOAD_ADDR,      # initial pc
                     0,              # gp
                     LOAD_ADDR,      # text load address
                     len(body),      # text size
                     0, 0,           # data
                     0, 0,           # bss (cleared by crt0)
                     STACK_TOP, 0)   # stack base / size
    hdr[0x4C:0x4C + len(MARKER)] = MARKER
    open(dst, "wb").write(bytes(hdr) + body)
    print(f"{dst}: {len(hdr) + len(body)} bytes")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
