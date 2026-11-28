# Entry point: set up the stack, mask interrupts (we poll everything),
# clear .bss and jump to main().
        .set noreorder
        .section .text.start, "ax"
        .global _start
_start:
        lui     $sp, 0x801F
        ori     $sp, $sp, 0xFF00

        mfc0    $t0, $12            # COP0 status register
        nop
        li      $t1, 0xFFFFFBFE     # clear IEc and IM2 (hardware IRQ line)
        and     $t0, $t0, $t1
        mtc0    $t0, $12
        nop

        la      $t0, __bss_start
        la      $t1, __bss_end
1:      beq     $t0, $t1, 2f
        nop
        sw      $zero, 0($t0)
        b       1b
        addiu   $t0, $t0, 4
2:
        jal     main
        nop
3:      b       3b
        nop
