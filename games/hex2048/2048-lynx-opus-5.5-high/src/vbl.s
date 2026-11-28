;
; Vertical blank counter. Timer 2 (the display line counter) interrupts once
; per frame; cc65's Lynx IRQ stub calls this and then acknowledges INTSET.
; Also ORs the joystick into a latch so short taps are never missed.
;
        .interruptor    vbl_irq
        .export         _vbl_count, _joy_latch

INTSET   = $FD81
JOYSTICK = $FCB0
TIMER2   = $04

        .bss
_vbl_count:
        .res    1
_joy_latch:
        .res    1

        .code
vbl_irq:
        lda     INTSET
        and     #TIMER2
        beq     @done
        inc     _vbl_count
        lda     JOYSTICK
        ora     _joy_latch
        sta     _joy_latch
@done:  clc                     ; let other interruptors run too
        rts
