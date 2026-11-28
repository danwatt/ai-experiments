; HEX 2048 -- 2048 on a 19-cell hexagonal board
; DOS .COM, VGA mode 13h (320x200x256), 386+
; Build: nasm -f bin hex2048.asm -o HEX2048.COM
;
; Controls (flat-top hexes, so tiles slide in 6 directions):
;        W            8
;     Q     E      7     9
;     A     D      1     3
;        S            2
;   (numpad works too: Home/Up/PgUp/End/Down/PgDn)
;   R = new game, Esc = quit

cpu 386
bits 16
org 100h

NCELLS      equ 19
COL_BG      equ 1
COL_BOARD   equ 2
COL_EMPTY   equ 3
COL_DARK    equ 4
COL_LIGHT   equ 5
COL_ACCENT  equ 6
COL_TILE    equ 32          ; tile colour = COL_TILE + exponent
MAXEXP      equ 20

start:
    ; copy the BIOS 8x8 font (chars 0-127) into our own buffer
    mov ax, 1130h
    mov bh, 03h
    int 10h                 ; ES:BP -> font
    push ds
    push es
    pop ds
    mov si, bp
    push cs
    pop es
    mov di, fontbuf
    mov cx, 1024
    rep movsb
    pop ds

    mov ax, 0013h           ; 320x200x256
    int 10h

    ; back buffer lives in the 64K segment after ours
    mov ax, cs
    add ax, 1000h
    mov [bufseg], ax

    call set_palette

    xor ah, ah              ; seed RNG from the BIOS tick count
    int 1Ah
    mov [seed], dx
    mov [seed+2], cx

new_game:
    push cs
    pop es
    mov di, board
    mov cx, NCELLS
    xor al, al
    rep stosb
    mov dword [score], 0
    mov byte [won], 0
    mov byte [over], 0
    call spawn
    call spawn

main_loop:
    call render
.getkey:
    xor ah, ah
    int 16h                 ; AL = ascii, AH = scancode
    cmp al, 27
    je quit
    cmp al, 'A'
    jb .nocase
    cmp al, 'Z'
    ja .nocase
    add al, 20h
.nocase:
    cmp al, 'r'
    je new_game
    cmp byte [over], 0
    jne .getkey

    ; map key -> direction 0..5
    mov si, keymap
.km:
    mov cx, [si]            ; cl = ascii, ch = scancode
    cmp cx, 0FFFFh
    je .getkey
    add si, 3
    test al, al             ; extended key? match on scancode
    jz .scan
    cmp al, 0E0h
    je .scan
    cmp al, cl
    jne .km
    jmp .got
.scan:
    cmp ah, ch
    jne .km
.got:
    movzx bx, byte [si-1]
    call do_move
    cmp byte [moved], 0
    je .getkey
    call spawn
    call check_over
    jmp main_loop

quit:
    mov ax, 0003h
    int 10h
    ret

; ---------------------------------------------------------------
; do_move: BX = direction. Slides/merges every line, sets [moved]
; ---------------------------------------------------------------
do_move:
    mov byte [moved], 0
    imul si, bx, 25
    add si, lines
    mov byte [linecnt], 5
.line:
    ; gather the non-empty tiles of this line, front first
    xor di, di
    xor cx, cx
.g:
    mov bx, cx
    mov al, [si+bx]
    cmp al, 0FFh
    je .gdone
    movzx bx, al
    mov al, [board+bx]
    test al, al
    jz .gnext
    mov [tmp_in+di], al
    inc di
.gnext:
    inc cx
    cmp cx, 5
    jb .g
.gdone:
    ; merge equal neighbours (each tile merges at most once)
    xor bx, bx              ; read index
    xor dx, dx              ; write count
.m:
    cmp bx, di
    jae .mdone
    mov al, [tmp_in+bx]
    inc bx
    cmp bx, di
    jae .store
    cmp al, [tmp_in+bx]
    jne .store
    inc bx
    inc al
    call add_score
    cmp al, 11              ; 2^11 = 2048
    jb .store
    cmp byte [won], 0
    jne .store
    mov byte [won], 1
.store:
    push bx
    mov bx, dx
    mov [tmp_out+bx], al
    pop bx
    inc dx
    jmp .m
.mdone:
    ; write the line back, padding with empties
    xor cx, cx
.w:
    mov bx, cx
    mov al, [si+bx]
    cmp al, 0FFh
    je .wdone
    xor ah, ah
    cmp cx, dx
    jae .z
    mov ah, [tmp_out+bx]
.z:
    movzx bx, al
    cmp [board+bx], ah
    je .same
    mov [board+bx], ah
    mov byte [moved], 1
.same:
    inc cx
    cmp cx, 5
    jb .w
.wdone:
    add si, 5
    dec byte [linecnt]
    jnz .line
    ret

; AL = exponent of new tile; score += 2^AL
add_score:
    push eax
    push cx
    mov cl, al
    mov eax, 1
    shl eax, cl
    add eax, [score]
    mov [score], eax
    cmp eax, [best]
    jbe .x
    mov [best], eax
.x:
    pop cx
    pop eax
    ret

; ---------------------------------------------------------------
; spawn: put a 2 (90%) or 4 (10%) on a random empty cell
; ---------------------------------------------------------------
spawn:
    xor cx, cx
    xor bx, bx
.c:
    cmp byte [board+bx], 0
    jne .cn
    inc cx
.cn:
    inc bx
    cmp bx, NCELLS
    jb .c
    jcxz .ret
    call rand
    xor dx, dx
    div cx                  ; DX = which empty cell
    xor bx, bx
.f:
    cmp byte [board+bx], 0
    jne .fn
    test dx, dx
    jz .found
    dec dx
.fn:
    inc bx
    jmp .f
.found:
    push bx
    call rand
    xor dx, dx
    mov cx, 10
    div cx
    pop bx
    mov al, 1
    test dx, dx
    jnz .s
    mov al, 2
.s:
    mov [board+bx], al
.ret:
    ret

; 32-bit LCG, returns 16 random bits in AX
rand:
    mov eax, [seed]
    imul eax, eax, 1103515245
    add eax, 12345
    mov [seed], eax
    shr eax, 16
    ret

; ---------------------------------------------------------------
; check_over: sets [over] if no empty cell and no equal neighbours
; ---------------------------------------------------------------
check_over:
    xor bx, bx
.e:
    cmp byte [board+bx], 0
    je .no
    inc bx
    cmp bx, NCELLS
    jb .e
    mov si, lines           ; dirs 0,1,2 cover all three axes
    mov dx, 15
.l:
    mov di, si              ; DI walks the line
.p:
    mov ah, [di+1]
    cmp ah, 0FFh
    je .ln
    movzx bx, byte [di]
    mov al, [board+bx]
    movzx bx, ah
    cmp al, [board+bx]
    je .no
    inc di
    lea bx, [si+4]
    cmp di, bx
    jb .p
.ln:
    add si, 5
    dec dx
    jnz .l
    mov byte [over], 1
.no:
    ret

; ---------------------------------------------------------------
; render: draw everything to the back buffer, then blit on vsync
; ---------------------------------------------------------------
render:
    mov es, [bufseg]
    xor di, di
    mov eax, COL_BG * 01010101h
    mov cx, 16000
    rep stosd

    ; board backing
    xor bp, bp
.bk:
    mov ax, [cell_x+bp]
    mov dx, [cell_y+bp]
    mov si, hex_big
    mov bl, COL_BOARD
    call draw_hex
    add bp, 2
    cmp bp, NCELLS*2
    jb .bk

    ; tiles
    xor bp, bp
.tl:
    mov bx, bp
    shr bx, 1
    movzx bx, byte [board+bx]
    mov ax, [cell_x+bp]
    mov dx, [cell_y+bp]
    mov si, hex_tile
    push bx
    test bx, bx
    mov bl, COL_EMPTY
    jz .col
    pop bx
    push bx
    cmp bx, MAXEXP
    jbe .ok
    mov bx, MAXEXP
.ok:
    add bl, COL_TILE
.col:
    call draw_hex
    pop bx
    test bx, bx
    jz .tnext
    ; label, centred
    cmp bx, MAXEXP
    jbe .ok2
    mov bx, MAXEXP
.ok2:
    mov cx, ax              ; cx = centre x
    mov al, COL_DARK
    cmp bx, 3
    jb .tc
    mov al, COL_LIGHT
.tc:
    shl bx, 1
    mov si, [labels+bx]
    mov bl, al
    call strlen             ; AX = length
    shl ax, 2
    sub cx, ax
    sub dx, 4
    mov byte [scale], 1
    call draw_str
.tnext:
    add bp, 2
    cmp bp, NCELLS*2
    jb .tl

    ; ---- left panel ----
    mov byte [scale], 2
    mov bl, COL_DARK
    mov cx, 8
    mov dx, 8
    mov si, s_title1
    call draw_str
    mov dx, 26
    mov bl, COL_TILE+11
    mov si, s_title2
    call draw_str

    mov byte [scale], 1
    mov bl, COL_BOARD
    mov dx, 52
    mov si, s_score
    call draw_str
    mov eax, [score]
    call utoa
    mov byte [scale], 2
    mov bl, COL_DARK
    mov dx, 62
    call draw_str

    mov byte [scale], 1
    mov bl, COL_BOARD
    mov dx, 86
    mov si, s_best
    call draw_str
    mov eax, [best]
    call utoa
    mov bl, COL_DARK
    mov dx, 96
    call draw_str

    mov bl, COL_ACCENT
    mov dx, 106+4
    mov si, s_over
    cmp byte [over], 0
    jne .msg
    mov si, s_win
    cmp byte [won], 0
    je .nomsg
.msg:
    call draw_str
.nomsg:

    ; control compass
    mov ax, 44
    mov dx, 144
    mov si, hex_icon
    mov bl, COL_BOARD
    call draw_hex
    mov bl, COL_DARK
    mov si, compass
.cp:
    lodsb
    test al, al
    jz .cpd
    movzx cx, byte [si]
    movzx dx, byte [si+1]
    add si, 2
    call draw_char
    jmp .cp
.cpd:
    mov bl, COL_BOARD
    mov cx, 8
    mov dx, 174
    mov si, s_keys1
    call draw_str
    mov dx, 186
    mov si, s_keys2
    call draw_str

    ; wait for vertical retrace, then copy to VRAM
    mov dx, 3DAh
.v1:
    in al, dx
    test al, 8
    jnz .v1
.v2:
    in al, dx
    test al, 8
    jz .v2
    push ds
    mov ds, [bufseg]
    mov ax, 0A000h
    mov es, ax
    xor si, si
    xor di, di
    mov cx, 16000
    rep movsd
    pop ds
    ret

; draw_hex: AX = centre x, DX = centre y, SI = half-width table, BL = colour
draw_hex:
    pusha
    movzx cx, byte [si]
    inc si
    sub dx, cx
    shl cx, 1
    inc cx
.row:
    push cx
    movzx cx, byte [si]
    inc si
    mov di, dx
    imul di, di, 320
    add di, ax
    sub di, cx
    shl cx, 1
    inc cx
    push ax
    mov al, bl
    rep stosb
    pop ax
    inc dx
    pop cx
    loop .row
    popa
    ret

; draw_char: AL = char, CX = x, DX = y, BL = colour, [scale]
draw_char:
    pusha
    movzx si, al
    shl si, 3
    add si, fontbuf
    mov di, dx
    imul di, di, 320
    add di, cx
    mov dh, 8
.row:
    mov ah, [si]
    inc si
    mov dl, [scale]
.srow:
    push di
    mov bh, ah
    mov ch, 8
.bit:
    mov cl, [scale]
    shl bh, 1
    jnc .skip
.px:
    mov [es:di], bl
    inc di
    dec cl
    jnz .px
    jmp .nb
.skip:
    inc di
    dec cl
    jnz .skip
.nb:
    dec ch
    jnz .bit
    pop di
    add di, 320
    dec dl
    jnz .srow
    dec dh
    jnz .row
    popa
    ret

; draw_str: SI = asciiz, CX = x, DX = y, BL = colour
draw_str:
    pusha
.n:
    lodsb
    test al, al
    jz .d
    call draw_char
    movzx ax, byte [scale]
    shl ax, 3
    add cx, ax
    jmp .n
.d:
    popa
    ret

; strlen: SI = asciiz -> AX
strlen:
    push si
    xor ax, ax
.l:
    cmp byte [si], 0
    je .d
    inc si
    inc ax
    jmp .l
.d:
    pop si
    ret

; utoa: EAX -> SI = decimal asciiz
utoa:
    push ebx
    push edx
    push di
    mov di, numbuf_end
    mov ebx, 10
.l:
    xor edx, edx
    div ebx
    add dl, '0'
    dec di
    mov [di], dl
    test eax, eax
    jnz .l
    mov si, di
    pop di
    pop edx
    pop ebx
    ret

set_palette:
    mov si, palette
.n:
    lodsb
    cmp al, 0FFh
    je .d
    mov dx, 3C8h
    out dx, al
    inc dx
    mov cx, 3
.c:
    lodsb
    shr al, 2               ; 8-bit -> 6-bit DAC
    out dx, al
    loop .c
    jmp .n
.d:
    ret

; ---------------------------------------------------------------
; data
; ---------------------------------------------------------------
; ascii, scancode, direction   (0=N 1=NE 2=SE 3=S 4=SW 5=NW)
keymap:
    db 'w',48h,0,  'e',49h,1,  'd',51h,2,  's',50h,3,  'a',4Fh,4,  'q',47h,5
    db '8',0,0,    '9',0,1,    '3',0,2,    '2',0,3,    '1',0,4,    '7',0,5
    dw 0FFFFh

; index, r, g, b
palette:
    db COL_BG,     250,248,239
    db COL_BOARD,  187,173,160
    db COL_EMPTY,  214,205,196
    db COL_DARK,   119,110,101
    db COL_LIGHT,  249,246,242
    db COL_ACCENT, 230, 90, 50
    db COL_TILE+1, 238,228,218
    db COL_TILE+2, 237,224,200
    db COL_TILE+3, 242,177,121
    db COL_TILE+4, 245,149, 99
    db COL_TILE+5, 246,124, 95
    db COL_TILE+6, 246, 94, 59
    db COL_TILE+7, 237,207,114
    db COL_TILE+8, 237,204, 97
    db COL_TILE+9, 237,200, 80
    db COL_TILE+10,237,197, 63
    db COL_TILE+11,237,194, 46
    db COL_TILE+12, 94,218,146
    db COL_TILE+13, 60,180,120
    db COL_TILE+14, 64,150,220
    db COL_TILE+15, 40,110,200
    db COL_TILE+16,140, 90,210
    db COL_TILE+17,110, 50,180
    db COL_TILE+18, 60, 58, 50
    db COL_TILE+19, 40, 38, 32
    db COL_TILE+20, 20, 20, 20
    db 0FFh

labels:
    dw 0, l1,l2,l3,l4,l5,l6,l7,l8,l9,l10,l11,l12,l13,l14,l15,l16,l17,l18,l19,l20
l1  db "2",0
l2  db "4",0
l3  db "8",0
l4  db "16",0
l5  db "32",0
l6  db "64",0
l7  db "128",0
l8  db "256",0
l9  db "512",0
l10 db "1024",0
l11 db "2048",0
l12 db "4096",0
l13 db "8192",0
l14 db "16K",0
l15 db "32K",0
l16 db "65K",0
l17 db "131K",0
l18 db "262K",0
l19 db "524K",0
l20 db "1M",0

s_title1 db "HEX",0
s_title2 db "2048",0
s_score  db "SCORE",0
s_best   db "BEST",0
s_over   db "GAME OVER",0
s_win    db "2048! :)",0
s_keys1  db "R  NEW GAME",0
s_keys2  db "ESC  QUIT",0

; char, x, y  (around the little hex at 44,144)
compass:
    db 'W',40,122, 'Q',22,130, 'E',58,130
    db 'A',22,150, 'D',58,150, 'S',40,158
    db 0

; ---- generated geometry (gen.py) ----
; cells in reading order, centres in screen pixels
cell_x: dw 210,178,242,147,210,273,178,242,147,210,273,178,242,147,210,273,178,242,210
cell_y: dw 27,45,45,64,64,64,82,82,100,100,100,118,118,136,136,136,155,155,173
; lines[dir][5][5]: cell indices, front (toward move) first, FFh pad
lines:
    db 3,8,13,255,255, 1,6,11,16,255, 0,4,9,14,18, 2,7,12,17,255, 5,10,15,255,255     ; N
    db 0,1,3,255,255, 2,4,6,8,255, 5,7,9,11,13, 10,12,14,16,255, 15,17,18,255,255     ; NE
    db 5,2,0,255,255, 10,7,4,1,255, 15,12,9,6,3, 17,14,11,8,255, 18,16,13,255,255     ; SE
    db 13,8,3,255,255, 16,11,6,1,255, 18,14,9,4,0, 17,12,7,2,255, 15,10,5,255,255     ; S
    db 3,1,0,255,255, 8,6,4,2,255, 13,11,9,7,5, 16,14,12,10,255, 18,17,15,255,255     ; SW
    db 0,2,5,255,255, 1,4,7,10,255, 3,6,9,12,15, 8,11,14,17,255, 13,16,18,255,255     ; NW
; flat-top hex half-widths: first byte = half height, then one per scanline
hex_big:  db 19, 11,12,12,13,13,14,14,15,16,16,17,17,18,19,19,20,20,21,21,22,21,21,20,20,19,19,18,17,17,16,16,15,14,14,13,13,12,12,11
hex_tile: db 16, 10,10,11,11,12,13,13,14,14,15,16,16,17,17,18,18,19,18,18,17,17,16,16,15,14,14,13,13,12,11,11,10,10
hex_icon: db 6, 5,5,6,6,7,7,8,7,7,6,6,5,5

; ---- variables ----
best    dd 0
seed    dd 0
score   dd 0
bufseg  dw 0
moved   db 0
won     db 0
over    db 0
linecnt db 0
scale   db 1
board   times NCELLS db 0
tmp_in  times 5 db 0
tmp_out times 5 db 0
numbuf  times 11 db 0
numbuf_end db 0
fontbuf times 1024 db 0
