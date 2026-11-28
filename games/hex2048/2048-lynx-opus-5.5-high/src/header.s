;
; LNX cartridge header for Hex 2048 (read by Handy / Mednafen).
; Replaces the cc65 library default so the cart carries its own name.
;
        .import         __BANK0BLOCKSIZE__
        .import         __BANK1BLOCKSIZE__
        .export         __EXEHDR__: absolute = 1

        .segment "EXEHDR"
        .byte   'L','Y','N','X'         ; magic
        .word   __BANK0BLOCKSIZE__      ; bank 0 page size
        .word   __BANK1BLOCKSIZE__      ; bank 1 page size
        .word   1                       ; version number
        .byte   "Hex 2048"              ; 32 bytes cart name
        .res    32 - 8, 0
        .byte   "Claude"                ; 16 bytes manufacturer
        .res    16 - 6, 0
        .byte   0                       ; rotation: none
        .byte   0,0,0,0,0               ; spare

