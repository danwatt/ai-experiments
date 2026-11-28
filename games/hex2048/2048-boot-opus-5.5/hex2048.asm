; HEX 2048 in a 512-byte boot sector
; 19-cell hexagonal board (flat-top hexes, 5 columns of 3-4-5-4-3).
; 80x25 colour text mode, real mode, 586+ (imul, rdtsc).
; Build: nasm -f bin hex2048.asm -o hex2048.img
;
; Controls:   Q W E     numpad 7 8 9     NW  N  NE
;             A S D     numpad 1 2 3     SW  S  SE
;             R = new game
;
; Board: a 7x7 grid of axial coords (q,r), index = (r+3)*7 + (q+3), with
; the off-board ring filled by a sentinel. The six hex directions are then
; just fixed index offsets: N -7, S +7, NW -1, SE +1, NE -6, SW +6.
; Cell byte: 0 = empty, n = tile 2^n, +80h = merged this move, 40h = wall.

cpu 586
bits 16
org 7C00h

WALL    equ 40h
board   equ 600h            ; 64 bytes (indices 49..63 stay WALL)
seed    equ board+64
score   equ board+66

start:
    xor ax, ax
    mov ds, ax
    mov ax, 3               ; 80x25 colour text, clears screen
    int 10h
    mov ax, 1003h           ; attribute bit 7 = bright background, not blink
    xor bx, bx
    int 10h
    mov ah, 1               ; hide cursor
    mov ch, 20h
    int 10h
    rdtsc
    mov [seed], ax

new_game:
    push ds
    pop es
    mov di, board
    mov cx, 64
    mov al, WALL
    rep stosb
    mov [score], cx
    ; open up the 19 cells: 1<=row,col<=5 and 4<=row+col<=8
    mov bx, 48
    mov dl, 7
.v: mov ax, bx
    div dl                  ; al = r+3, ah = q+3
    sub ax, 0101h
    cmp al, 5
    jae .x
    cmp ah, 5
    jae .x
    add al, ah
    sub al, 2
    cmp al, 5
    jae .x
    mov byte [bx+board], 0
.x: dec bx
    jns .v
    call spawn
    call spawn

main:
    call draw
    ; game over when no cell is empty and no neighbours match
    mov bx, 48
.o: mov al, [bx+board]
    test al, al
    jz key
    cmp al, WALL
    je .w
    cmp al, [bx+board+1]
    je key
    cmp al, [bx+board+6]
    je key
    cmp al, [bx+board+7]
    je key
.w: dec bx
    jns .o
    mov si, over
    mov di, 23*160+35*2
    mov ah, 4Fh
.m: lodsb
    stosw
    cmp si, over+11
    jb .m
key:
    xor ax, ax
    int 16h                 ; ah = scan code
    cmp ah, 13h             ; R: reboot the program (mode set clears screen)
    je start
    push ds
    pop es
    mov al, ah
    mov di, keys
    mov cx, 12
    repne scasb
    jne key
    mov al, [di+11]         ; matching entry in dirs
    cbw
    xchg ax, di             ; di = direction offset
    call move
    test si, si
    jz key                  ; nothing moved: no new tile
    call spawn
    jmp main

; ---- slide every tile in direction di; si = number of changes ----
move:
    xor si, si
    mov bp, 48
.l: mov bx, bp              ; visit cells front-first: descending for +d
    test di, di
    jns .s
    neg bx
    add bx, 48
.s: mov al, [bx+board]
    test al, al
    jz .n
    cmp al, WALL
    jae .n
    mov ah, [bx+di+board]
    test ah, ah
    jz .mv
    cmp ah, al
    jne .n
    inc ax                  ; merge: one exponent up
    mov cl, al
    mov dx, 1
    shl dx, cl
    add [score], dx
    or al, 80h              ; can't merge again this move
.mv:mov [bx+di+board], al
    mov byte [bx+board], 0
    inc si
    add bx, di
    test al, al
    jns .s                  ; keep sliding unless just merged
.n: dec bp
    jns .l
    ret

; ---- drop a 2 (90%) or 4 into a random empty cell ----
spawn:
    mov ax, [seed]
    imul ax, ax, 25173
    add ax, 13849
    mov [seed], ax
    mov bl, ah
    and bx, 3Fh
    cmp byte [bx+board], 0
    jne spawn
    cmp al, 26
    mov al, 1
    adc al, 0
    mov [bx+board], al
    ret

; ---- redraw score and all 19 hexes ----
draw:
    push 0B800h
    pop es
    mov ax, [score]
    mov di, 160+37*2
    mov bh, 0Fh
    call pnum
    mov bx, 48
.c: mov al, [bx+board]
    cmp al, WALL
    je .n
    and al, 7Fh             ; clear merge flags
    mov [bx+board], al
    push bx
    mov cl, al
    mov ax, bx
    mov dl, 7
    div dl                  ; al = r+3, ah = q+3
    mov dl, ah
    shl al, 1
    add al, ah
    shl al, 1
    sub al, 7               ; screen row = 11 + 2*(2r+q)
    mov dh, 160
    mul dh
    xchg ax, di
    mov al, 14
    mul dl
    add di, ax
    add di, 32              ; screen col = 40 - 3 + 7q
    mov bx, colors
    mov al, cl
    xlat
    mov bh, al              ; bh = face attribute
    mov si, 1
    shl si, cl
    and si, -2              ; tile value; exponent 0 -> 0 (blank)
    mov ah, al
    shr ah, 4               ; edge rows: fg = face colour
    mov al, 0DCh            ; lower half block
    call edge
    add di, 320
    mov al, 0DFh            ; upper half block
    call edge
    sub di, 160
    xchg ax, si
    call pnum
    pop bx
.n: dec bx
    jns .c
    ret

edge:
    push di
    scasw                   ; di += 2
    mov cx, 5
    rep stosw
    pop di
    ret

; ---- 7-char field at es:di in attribute bh, ax centred (blank if 0) ----
pnum:
    push ax
    mov ah, bh
    mov al, ' '
    mov cx, 7
    rep stosw
    pop ax
    test ax, ax
    jz .r
    sub di, 7
    mov si, 10
.d: xor dx, dx
    div si
    push dx
    inc cx
    dec di
    test ax, ax
    jnz .d
    and di, -2
.p: pop ax
    add al, '0'
    mov ah, bh
    stosw
    loop .p
.r: ret

over:   db ' GAME OVER '
keys:   db 10h, 11h, 12h, 1Eh, 1Fh, 20h, 47h, 48h, 49h, 4Fh, 50h, 51h
dirs:   db -1, -7, -6, 6, 7, 1, -1, -7, -6, 6, 7, 1
; face attribute (bg<<4 | fg) by exponent: empty, 2, 4, 8 ... 32768
colors: db 80h, 70h, 0F0h, 6Fh, 0CFh, 4Fh, 0DFh, 0E0h
        db 0A0h, 2Fh, 0B0h, 9Fh, 1Fh, 5Fh, 3Fh, 0Fh

    times 510-($-$$) db 0
    dw 0AA55h
