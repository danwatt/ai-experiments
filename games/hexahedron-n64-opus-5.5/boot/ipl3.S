# Minimal boot code (IPL3) for emulators. libdragon's own IPL3 does full RDRAM
# initialisation and ELF loading, which the N64 cores shipped with EmulatorJS
# (parallel_n64, mupen64plus_next) crash on. This one just copies the flat program
# image from ROM 0x1000 to RDRAM 0x400 with one PI DMA, fills in the boot flags that
# libdragon's entrypoint reads from DMEM, and jumps to 0x80000400.
# The image length is stored by tools/mkrom.py in the ROM header at 0x18.
    .set noreorder
    .set noat
    .section .text
    .global ipl3
ipl3:
    lui   $t0, 0xA460             # PI registers
1:  lw    $t2, 0x10($t0)
    andi  $t2, $t2, 3
    bnez  $t2, 1b
    nop
    lui   $t3, 0xB000
    lw    $t3, 0x18($t3)          # image length (bytes)
    li    $t1, 0x400
    sw    $t1, 0x00($t0)          # PI_DRAM_ADDR = 0x400 (program is linked at 0x80000400)
    li    $t1, 0x10001000
    sw    $t1, 0x04($t0)          # PI_CART_ADDR = ROM + 0x1000
    addiu $t3, $t3, -1
    sw    $t3, 0x0C($t0)          # PI_WR_LEN: start cart -> RDRAM
2:  lw    $t2, 0x10($t0)
    andi  $t2, $t2, 3
    bnez  $t2, 2b
    nop
    li    $t2, 2
    sw    $t2, 0x10($t0)          # PI_STATUS: clear the DMA-complete interrupt
    # RDRAM size: 8 MiB if a word written at 7 MiB reads back, else 4 MiB
    li    $t4, 0x00400000
    lui   $t1, 0xA070
    li    $t2, 0x5AA5C33C
    sw    $t2, 0($t1)
    lw    $t5, 0($t1)
    bne   $t5, $t2, 3f
    nop
    li    $t4, 0x00800000
3:  sw    $zero, 0($t1)
    # boot flags in DMEM (see libdragon src/entrypoint.S)
    lui   $t1, 0xA400
    sw    $t4, 0x00($t1)          # memory size
    li    $t2, 0x12345678
    sw    $t2, 0x04($t1)          # entropy
    li    $t2, 0x00010000         # byte 9: TV type NTSC, 10: cold reset, 11: retail
    sw    $t2, 0x08($t1)
    sw    $zero, 0x0C($t1)
    lui   $t1, 0x8000
    sw    $t4, 0x318($t1)         # legacy memsize location
    lui   $sp, 0x8000
    addu  $sp, $sp, $t4
    addiu $sp, $sp, -16
    li    $t0, 0x80000400
    jr    $t0
    nop
