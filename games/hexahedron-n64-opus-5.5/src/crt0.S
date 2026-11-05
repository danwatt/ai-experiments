# Program entry (loaded at 0x80000400 by boot/ipl3.S).
    .set noreorder
    .set noat
    .section .text.start
    .global _start
_start:
    lui   $t0, 0x2000              # SR: CU1 (FPU usable), 32-bit FPU registers, interrupts off
    mtc0  $t0, $12
    nop
    lui   $t0, 0x0100              # FCR31: flush denormals to zero, no FPU traps
    ctc1  $t0, $31
    li    $sp, 0x807FFFF0
    la    $t0, __bss_start         # clear .bss
    la    $t1, __bss_end
1:  sw    $zero, 0($t0)
    addiu $t0, $t0, 4
    sltu  $t2, $t0, $t1
    bnez  $t2, 1b
    nop
    # exception vectors (TLB refill 0x000, XTLB 0x080, general 0x180) -> exc_entry
    la    $t0, exc_stub
    .irp vec, 0x000, 0x080, 0x180
    li    $t1, 0xA0000000 + \vec
    lw    $t2, 0($t0)
    sw    $t2, 0($t1)
    lw    $t2, 4($t0)
    sw    $t2, 4($t1)
    lw    $t2, 8($t0)
    sw    $t2, 8($t1)
    lw    $t2, 12($t0)
    sw    $t2, 12($t1)
    .endr
    jal   main
    nop
    jal   halt
    nop

exc_stub:
    la    $k0, exc_entry
    jr    $k0
    nop

exc_entry:
    mfc0  $a0, $13                 # Cause
    mfc0  $a1, $14                 # EPC
    mfc0  $a2, $8                  # BadVAddr
    li    $sp, 0x807FC000
    jal   crash
    nop
    jal   halt
    nop
