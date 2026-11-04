; HEX 2048 for the Nintendo Game Boy (DMG)
; 2048 played on a 19-cell hexagonal board with six slide directions.
;
; Board cells hold exponents: 0 = empty, 1 = "2", 2 = "4", ... 11 = "2048".

INCLUDE "hardware.inc"
INCLUDE "gfx.inc"

DEF ST_PLAY     EQU 0
DEF ST_OVER     EQU 1
DEF ST_CONFIRM  EQU 2

DEF SPAWN_DELAY EQU 5  ; frames between a slide and the new tile appearing
DEF DIR_WINDOW  EQU 4  ; frames to wait for a diagonal after left/right
DEF WIN_EXP     EQU 11 ; 2048
DEF MSG_ROW     EQU VRAM_MAP + 2 * 32

; ============================================================== vectors

SECTION "VBlank vector", ROM0[$40]
    push af
    ld a, 1
    ldh [hVBlank], a
    pop af
    reti

SECTION "Header", ROM0[$100]
    nop
    jp Start
    ds $150 - @, 0          ; filled in by rgbfix

; ============================================================== memory

SECTION "Board", WRAM0, ALIGN[8]
; Everything in this block shares one high byte so it can be indexed with
; `ld h, HIGH(wBoard)` / `ld l, LOW(x) + i`.
wBoard:     ds NUM_CELLS
            ds 32 - NUM_CELLS
wDrawn:     ds NUM_CELLS    ; what is currently on screen ($FF = stale)
            ds 32 - NUM_CELLS
wLineIdx:   ds 5            ; cell indices of the line being slid
wLineVal:   ds 5            ; their values before the slide
wNewVal:    ds 5            ; their values after the slide
wEmpty:     ds NUM_CELLS    ; empty cell list for spawning
wNumBuf:    ds 9            ; decimal string scratch

SECTION "Variables", WRAM0
wLineLen:   ds 1
wLinesLeft: ds 1
wMoved:     ds 1
wMergeMax:  ds 1            ; largest exponent created by a merge this move
wScore:     ds 4            ; BCD, little endian
wBest:      ds 4
wWon:       ds 1
wState:     ds 1
wRng:       ds 2
wFrame:     ds 1
wJoy:       ds 1
wJoyNew:    ds 1
wDirArmed:  ds 1
wDirTimer:  ds 1
wDirAccum:  ds 1
wSpawnTimer: ds 1
wMsgTimer:  ds 1
wSfxPtr:    ds 2
wSfxWait:   ds 1

SECTION "HRAM", HRAM
hVBlank:    ds 1

SECTION "Save", SRAM
sMagic:     ds 4
sBest:      ds 4

; ============================================================== startup

SECTION "Main", ROM0

Start:
    di
    ld sp, $E000
.waitVBlank
    ldh a, [rLY]
    cp 144
    jr c, .waitVBlank
    xor a
    ldh [rLCDC], a

    ld hl, $C000            ; WRAM, minus the top page holding the stack
    ld bc, $1F00
    call ClearMem
    ld hl, $8000            ; VRAM
    ld bc, $2000
    call ClearMem
    ld hl, $FE00            ; OAM: no sprites
    ld bc, 160
    call ClearMem

    ld de, TileData
    ld hl, $8000
    ld bc, TileDataEnd - TileData
    call CopyMem

    ld a, %11100100
    ldh [rBGP], a
    ldh [rOBP0], a
    xor a
    ldh [rSCX], a
    ldh [rSCY], a

    ld a, $80               ; sound on, full volume to both speakers
    ldh [rNR52], a
    ld a, $77
    ldh [rNR50], a
    ld a, $FF
    ldh [rNR51], a

    call LoadBest

    ld a, $A5
    ld [wRng], a
    ld a, $3C
    ld [wRng + 1], a

    ld a, IE_VBLANK
    ldh [rIE], a
    xor a
    ldh [rIF], a
    ei

; ============================================================== title

Title:
    call LcdOff
    call ClearMap
    ld hl, TitleScreen
    call PrintList
    ld hl, VRAM_MAP + 2 * 32 + 1
    ld b, 10
    call DrawCellAt
    ld hl, VRAM_MAP + 2 * 32 + 8
    ld b, 10
    call DrawCellAt
    ld hl, VRAM_MAP + 2 * 32 + 15
    ld b, 11
    call DrawCellAt
    call LcdOn

.loop
    call Frame
    ld a, [wFrame]
    and $1F
    jr nz, .noBlink
    ld de, StrPressStart
    ld a, [wFrame]
    and $20
    jr z, .show
    ld de, StrBlank20
.show
    ld hl, VRAM_MAP + 17 * 32 + 3
    call PrintStrN14
.noBlink
    ld a, [wJoyNew]
    and PAD_START | PAD_A
    jr z, .loop

    ldh a, [rDIV]           ; seed from the moment START was pressed
    ld [wRng], a
    ld a, [wFrame]
    or 1
    ld [wRng + 1], a
    ld hl, JingleStart
    call PlayJingle
    ; fall through

; ============================================================== game

NewGame:
    call LcdOff
    call ClearMap
    ld hl, GameScreen
    call PrintList

    ld h, HIGH(wBoard)
    ld l, LOW(wBoard)
    ld b, NUM_CELLS
.clearBoard
    xor a
    ld [hl], a
    ld a, l
    add 32                  ; matching wDrawn slot
    ld l, a
    ld [hl], $FF
    sub 31
    ld l, a
    dec b
    jr nz, .clearBoard

    xor a
    ld hl, wScore
    ld [hl+], a
    ld [hl+], a
    ld [hl+], a
    ld [hl], a
    ld [wWon], a
    ld [wState], a
    ld [wDirArmed], a
    ld [wSpawnTimer], a
    ld [wMsgTimer], a

    call Spawn
    call Spawn
    call DrawBoard
    call DrawScores
    call LcdOn

GameLoop:
    call Frame
    ld a, [wState]
    cp ST_OVER
    jp z, .over
    cp ST_CONFIRM
    jp z, .confirm

    ; --- playing
    ld a, [wMsgTimer]
    and a
    jr z, .msgDone
    dec a
    ld [wMsgTimer], a
    call z, ClearMsg
.msgDone
    ld a, [wSpawnTimer]
    and a
    jr z, .input
    dec a
    ld [wSpawnTimer], a
    jr nz, GameLoop
    call Spawn
    call DrawBoard
    call CanMove
    jr nz, GameLoop
    ld a, ST_OVER
    ld [wState], a
    ld de, MsgOver
    call ShowMsg
    ld hl, JingleOver
    call PlayJingle
    jr GameLoop

.input
    ld a, [wJoyNew]
    and PAD_SELECT
    jr z, .direction
    ld a, ST_CONFIRM
    ld [wState], a
    ld de, MsgConfirm
    call ShowMsg
    jr GameLoop

.direction
    call ReadDirection
    cp $FF
    jr z, GameLoop
    call DoMove
    ld a, [wMoved]
    and a
    jr nz, .moved
    call SfxBump
    jp GameLoop

.moved
    call DrawBoard
    call UpdateBest
    call DrawScores
    ld a, SPAWN_DELAY
    ld [wSpawnTimer], a
    ld a, [wMergeMax]
    and a
    jr z, .slideOnly
    call SfxMerge
    jr .checkWin
.slideOnly
    call SfxSlide
.checkWin
    ld a, [wWon]
    and a
    jp nz, GameLoop
    ld a, [wMergeMax]
    cp WIN_EXP
    jp c, GameLoop
    ld a, 1
    ld [wWon], a
    ld de, MsgWin
    call ShowMsg
    ld a, 180
    ld [wMsgTimer], a
    ld hl, JingleWin
    call PlayJingle
    jp GameLoop

.over
    ld a, [wJoyNew]
    and PAD_START | PAD_A
    jp z, GameLoop
    ld hl, JingleStart
    call PlayJingle
    jp NewGame

.confirm
    ld a, [wJoyNew]
    bit 0, a                ; A: yes
    jr z, .notYes
    ld hl, JingleStart
    call PlayJingle
    jp NewGame
.notYes
    and PAD_B | PAD_SELECT
    jp z, GameLoop
    xor a
    ld [wState], a
    ld [wDirArmed], a       ; ignore whatever is held until released
    call ClearMsg
    jp GameLoop

; ============================================================== input

; Reads the pad into wJoy and the newly pressed buttons into wJoyNew.
ReadJoy:
    ld a, $20               ; select the d-pad
    ldh [rP1], a
    ldh a, [rP1]
    ldh a, [rP1]
    cpl
    and $0F
    swap a
    ld b, a
    ld a, $10               ; select the buttons
    ldh [rP1], a
    ldh a, [rP1]
    ldh a, [rP1]
    ldh a, [rP1]
    ldh a, [rP1]
    ldh a, [rP1]
    ldh a, [rP1]
    cpl
    and $0F
    or b
    ld b, a
    ld a, $30
    ldh [rP1], a
    ld a, [wJoy]
    cpl
    and b
    ld [wJoyNew], a
    ld a, b
    ld [wJoy], a
    ret

; Turns d-pad input into one of the six hex directions.
; Left/Right alone slide W/E. Up/Down need a horizontal partner: either a
; diagonal on the d-pad or B (left) / A (right) held. Left/Right wait a few
; frames for Up/Down to join so keyboard diagonals register reliably.
; Returns a = direction 0..5 (E, W, NE, NW, SE, SW) or $FF for none.
ReadDirection:
    ld a, [wJoy]
    and $F0
    ld b, a                 ; b = d-pad now
    ld a, [wDirArmed]
    and a
    jr nz, .armed
    ld a, b                 ; wait for all directions to be released
    and a
    jr nz, .none
    inc a
    ld [wDirArmed], a
    xor a
    ld [wDirAccum], a
    ld [wDirTimer], a
.none
    ld a, $FF
    ret

.armed
    ld a, [wDirAccum]
    or b
    ld [wDirAccum], a
    ld c, a                 ; c = everything pressed since arming
    and PAD_LEFT | PAD_RIGHT
    jr nz, .hasHorizontal
    ld a, c
    and a
    jr z, .none
    ld a, [wJoy]            ; vertical only: B/A pick the side
    and PAD_A | PAD_B
    jr z, .verticalOnly
    bit 0, a
    ld a, PAD_RIGHT
    jr nz, .addSide
    ld a, PAD_LEFT
.addSide
    or c
    ld c, a
    jr .resolve
.verticalOnly
    ld a, b                 ; released without a side: forget it
    and a
    jr nz, .none
    ld [wDirAccum], a
    jr .none

.hasHorizontal
    ld a, c
    and PAD_UP | PAD_DOWN
    jr nz, .resolve
    ld a, b
    and a
    jr z, .resolve          ; already released: take it as is
    ld a, [wDirTimer]
    inc a
    ld [wDirTimer], a
    cp DIR_WINDOW
    jr c, .none

.resolve                    ; c = pad bits to interpret
    xor a
    ld [wDirArmed], a
    ld e, 0                 ; e = vertical code * 3
    ld a, c
    and PAD_UP | PAD_DOWN
    jr z, .vDone
    cp PAD_UP | PAD_DOWN
    jr z, .none
    ld e, 3
    cp PAD_UP
    jr z, .vDone
    ld e, 6
.vDone
    ld a, c
    and PAD_LEFT | PAD_RIGHT
    jr z, .hDone
    cp PAD_LEFT | PAD_RIGHT
    jr z, .none
    inc e
    cp PAD_RIGHT
    jr z, .hDone
    inc e
.hDone
    ld d, 0
    ld hl, DirTable
    add hl, de
    ld a, [hl]
    ret

;           none  right left
DirTable:
    db $FF, 0,   1      ; no vertical
    db $FF, 2,   3      ; up
    db $FF, 4,   5      ; down

; ============================================================== rules

; Slides the board in direction a. Sets wMoved, wMergeMax, adds to wScore.
DoMove:
    ld b, a                 ; hl = LineTable + a * 24
    add a, a
    add a, b
    add a, a
    add a, a
    add a, a
    ld e, a
    ld d, 0
    ld hl, LineTable
    add hl, de
    xor a
    ld [wMoved], a
    ld [wMergeMax], a
    ld a, 5
    ld [wLinesLeft], a
.line
    ld a, [hl+]
    ld [wLineLen], a
    ld b, a
    ld c, 0
.gather                     ; copy indices and values of this line
    ld a, [hl+]
    push hl
    ld e, a
    ld h, HIGH(wBoard)
    ld a, LOW(wLineIdx)
    add c
    ld l, a
    ld [hl], e
    ld l, e
    ld d, [hl]
    ld a, LOW(wLineVal)
    add c
    ld l, a
    ld [hl], d
    pop hl
    inc c
    dec b
    jr nz, .gather

    push hl
    call SlideLine
    pop hl
    ld a, [wLinesLeft]
    dec a
    ld [wLinesLeft], a
    jr nz, .line
    ret

; Compacts and merges wLineVal into wNewVal, then writes it to the board.
SlideLine:
    ld h, HIGH(wBoard)
    ld l, LOW(wNewVal)
    xor a
    ld [hl+], a
    ld [hl+], a
    ld [hl+], a
    ld [hl+], a
    ld [hl], a
    ld bc, 0                ; b = read index, c = write index
    ld e, 0                 ; e = last placed value still able to merge
.next
    ld a, [wLineLen]
    cp b
    jr z, .write
    ld a, LOW(wLineVal)
    add b
    ld l, a
    ld a, [hl]
    inc b
    and a
    jr z, .next
    ld d, a
    cp e
    jr nz, .place
    inc d                   ; merge into the previous tile
    ld a, LOW(wNewVal) - 1
    add c
    ld l, a
    ld [hl], d
    ld e, 0
    call AddScore
    ld a, [wMergeMax]
    cp d
    jr nc, .next
    ld a, d
    ld [wMergeMax], a
    jr .next
.place
    ld a, LOW(wNewVal)
    add c
    ld l, a
    ld [hl], d
    inc c
    ld e, d
    jr .next

.write
    ld b, 0
.writeLoop
    ld a, [wLineLen]
    cp b
    ret z
    ld a, LOW(wNewVal)
    add b
    ld l, a
    ld d, [hl]
    ld a, LOW(wLineVal)
    add b
    ld l, a
    ld a, [hl]
    cp d
    jr z, .same
    ld a, 1
    ld [wMoved], a
.same
    ld a, LOW(wLineIdx)
    add b
    ld l, a
    ld l, [hl]
    ld [hl], d
    inc b
    jr .writeLoop

; wScore += 2^d. Preserves bc, de, hl.
AddScore:
    push bc
    push de
    push hl
    ld a, d
    add a, a
    add a, a
    ld e, a
    ld d, 0
    ld hl, ScoreBCD
    add hl, de
    ld de, wScore
    ld b, 4
    and a
.add
    ld a, [de]
    adc [hl]
    daa
    ld [de], a
    inc de
    inc hl
    dec b
    jr nz, .add
    pop hl
    pop de
    pop bc
    ret

; Places a 2 (90%) or 4 (10%) on a random empty cell.
Spawn:
    ld h, HIGH(wBoard)
    ld de, wEmpty
    ld bc, 0                ; b = empty count, c = cell
.scan
    ld l, c
    ld a, [hl]
    and a
    jr nz, .full
    ld a, c
    ld [de], a
    inc de
    inc b
.full
    inc c
    ld a, c
    cp NUM_CELLS
    jr nz, .scan
    ld a, b
    and a
    ret z
.pick
    call Rand
    and 31
    cp b
    jr nc, .pick
    add LOW(wEmpty)
    ld l, a
    ld c, [hl]
    call Rand
    cp 26
    ld a, 1
    jr nc, .place
    inc a
.place
    ld l, c
    ld [hl], a
    ret

; Returns nz if any slide is possible (an empty cell or equal neighbours).
CanMove:
    ld h, HIGH(wBoard)
    ld l, 0
.empty
    ld a, [hl+]
    and a
    jr z, .yes
    ld a, l
    cp NUM_CELLS
    jr nz, .empty
    ld de, NeighborPairs
    ld b, NUM_PAIRS
.pair
    ld a, [de]
    inc de
    ld l, a
    ld c, [hl]
    ld a, [de]
    inc de
    ld l, a
    ld a, [hl]
    cp c
    jr z, .yes
    dec b
    jr nz, .pair
    xor a
    ret
.yes
    or 1
    ret

; xorshift16. Returns a random byte in a. Preserves bc, de, hl.
Rand:
    push hl
    ld a, [wRng]
    ld l, a
    ld a, [wRng + 1]
    ld h, a
    rra
    ld a, l
    rra
    xor h
    ld h, a
    ld a, l
    rra
    ld a, h
    rra
    xor l
    ld l, a
    xor h
    ld h, a
    ld a, l
    ld [wRng], a
    ld a, h
    ld [wRng + 1], a
    pop hl
    ret

; ============================================================== best score

UpdateBest:
    ld hl, wScore + 3
    ld de, wBest + 3
    ld b, 4
.compare
    ld a, [de]
    cp [hl]
    jr c, .newBest
    ret nz
    dec hl
    dec de
    dec b
    jr nz, .compare
    ret
.newBest
    ld de, wScore
    ld hl, wBest
    ld bc, 4
    call CopyMem
    ; fall through

SaveBest:
    ld a, $0A
    ld [MBC_RAMG], a
    ld de, wBest
    ld hl, sBest
    ld bc, 4
    call CopyMem
    xor a
    ld [MBC_RAMG], a
    ret

LoadBest:
    ld a, $0A
    ld [MBC_RAMG], a
    ld hl, sMagic
    ld de, SaveMagic
    ld b, 4
.check
    ld a, [de]
    cp [hl]
    jr nz, .fresh
    inc de
    inc hl
    dec b
    jr nz, .check
    ld de, sBest
    ld hl, wBest
    ld bc, 4
    call CopyMem
    jr .done
.fresh
    ld de, SaveMagic
    ld hl, sMagic
    ld bc, 4
    call CopyMem
    xor a
    ld hl, sBest
    ld [hl+], a
    ld [hl+], a
    ld [hl+], a
    ld [hl], a
    ld hl, wBest
    ld [hl+], a
    ld [hl+], a
    ld [hl+], a
    ld [hl], a
.done
    xor a
    ld [MBC_RAMG], a
    ret

SaveMagic: db "HX48"

; ============================================================== drawing

; Redraws every cell whose value differs from what is on screen.
DrawBoard:
    ld c, 0
.loop
    ld h, HIGH(wBoard)
    ld l, c
    ld b, [hl]
    ld a, LOW(wDrawn)
    add c
    ld l, a
    ld a, [hl]
    cp b
    jr z, .next
    ld [hl], b
    push bc
    call DrawCell
    pop bc
.next
    inc c
    ld a, c
    cp NUM_CELLS
    jr nz, .loop
    ret

; Draws cell c with value b.
DrawCell:
    ld a, c
    add a, a
    ld e, a
    ld d, 0
    ld hl, CellVram
    add hl, de
    ld a, [hl+]
    ld h, [hl]
    ld l, a
    ; fall through

; Draws a 4x3 tile hex for value b with its top-left tile at hl.
DrawCellAt:
    ld a, b                 ; de = CellTiles + b * 12
    add a, a
    add a, b
    add a, a
    add a, a
    add LOW(CellTiles)
    ld e, a
    ld a, HIGH(CellTiles)
    adc 0
    ld d, a
    ld c, 3
.row
    ld b, 4
.col
    ldh a, [rSTAT]
    and STAT_BUSY
    jr nz, .col
    ld a, [de]
    ld [hl+], a
    inc de
    dec b
    jr nz, .col
    ld a, l
    add 32 - 4
    ld l, a
    ld a, h
    adc 0
    ld h, a
    dec c
    jr nz, .row
    ret

DrawScores:
    ld hl, wScore + 3
    call BcdToStr
    ld hl, VRAM_MAP + 32 + 1
    call PrintNum
    ld hl, wBest + 3
    call BcdToStr
    ld hl, VRAM_MAP + 32 + 12
    ; fall through

; Prints wNumBuf at hl, padded with spaces to 8 characters.
PrintNum:
    ld de, wNumBuf
    call PrintStr
    ld a, e
    sub LOW(wNumBuf)
    ld c, a
    ld a, 8
    sub c
    ret z
    ld c, a
.pad
    ldh a, [rSTAT]
    and STAT_BUSY
    jr nz, .pad
    ld [hl], ' '
    inc hl
    dec c
    jr nz, .pad
    ret

; Converts the 4-byte BCD number whose top byte is at hl to a decimal string
; in wNumBuf without leading zeros.
BcdToStr:
    ld de, wNumBuf
    ld b, 4
    ld c, 0                 ; becomes $80 once a nonzero digit is seen
.byte
    ld a, [hl]
    swap a
    call .digit
    ld a, [hl]
    call .digit
    dec hl
    dec b
    jr nz, .byte
    ld a, c
    and a
    jr nz, .end
    ld a, '0'
    ld [de], a
    inc de
.end
    xor a
    ld [de], a
    ret
.digit
    and $0F
    or c
    ret z
    and $0F
    add '0'
    ld [de], a
    inc de
    ld c, $80
    ret

; Prints the zero-terminated string de at hl. Safe with the LCD on.
PrintStr:
    ld a, [de]
    and a
    ret z
    ld b, a
.wait
    ldh a, [rSTAT]
    and STAT_BUSY
    jr nz, .wait
    ld [hl], b
    inc hl
    inc de
    jr PrintStr

; Prints the first 14 characters of string de at hl (title blink).
PrintStrN14:
    ld c, 14
.loop
    ld a, [de]
    and a
    ret z
    ld b, a
.wait
    ldh a, [rSTAT]
    and STAT_BUSY
    jr nz, .wait
    ld [hl], b
    inc hl
    inc de
    dec c
    jr nz, .loop
    ret

; Prints a list of [dw address, string, 0] entries ended by dw 0.
PrintList:
    ld a, [hl+]
    ld e, a
    ld a, [hl+]
    ld d, a
    or e
    ret z
    push de                 ; swap: de = string, hl = screen address
    ld d, h
    ld e, l
    pop hl
    call PrintStr
    inc de                  ; skip the terminator
    ld h, d
    ld l, e
    jr PrintList

ShowMsg:
    ld hl, MSG_ROW
    jr PrintStr

ClearMsg:
    ld de, StrBlank20
    jr ShowMsg

ClearMap:
    ld hl, VRAM_MAP
    ld bc, 32 * 32
    ; fall through

ClearMem:
    xor a
    ld [hl+], a
    dec bc
    ld a, b
    or c
    jr nz, ClearMem
    ret

; Copies bc bytes from de to hl.
CopyMem:
    ld a, [de]
    ld [hl+], a
    inc de
    dec bc
    ld a, b
    or c
    jr nz, CopyMem
    ret

; ============================================================== frame

Frame:
    xor a
    ldh [hVBlank], a
.wait
    halt
    ldh a, [hVBlank]
    and a
    jr z, .wait
    ld hl, wFrame
    inc [hl]
    call ReadJoy
    jp SfxTick

LcdOff:
    ldh a, [rLCDC]
    bit 7, a
    ret z                   ; already off: no VBlank would ever come
    call Frame
    xor a
    ldh [rLCDC], a
    ret

LcdOn:
    ld a, LCDC_ON
    ldh [rLCDC], a
    ret

; ============================================================== sound

SfxSlide:
    xor a
    ldh [rNR41], a
    ld a, $62
    ldh [rNR42], a
    ld a, $46
    ldh [rNR43], a
    ld a, $80
    ldh [rNR44], a
    ret

; Chirp on channel 1, pitched by the biggest merge of the move.
SfxMerge:
    ld a, [wMergeMax]
    add a, a
    ld e, a
    ld d, 0
    ld hl, MergeFreq
    add hl, de
    ld a, $16               ; quick upward sweep
    ldh [rNR10], a
    ld a, $80
    ldh [rNR11], a
    ld a, $C3
    ldh [rNR12], a
    ld a, [hl+]
    ldh [rNR13], a
    ld a, [hl]
    or $80
    ldh [rNR14], a
    ret

SfxBump:
    ld a, $40
    ldh [rNR21], a
    ld a, $81
    ldh [rNR22], a
    ld a, $0A
    ldh [rNR23], a
    ld a, $84
    ldh [rNR24], a
    ret

; Plays the note list at hl on channel 2: [dw freq, db frames]...,
; freq $FE00 = rest, $FF00 = end.
PlayJingle:
    ld a, l
    ld [wSfxPtr], a
    ld a, h
    ld [wSfxPtr + 1], a
    ld a, 1
    ld [wSfxWait], a
    ret

SfxTick:
    ld a, [wSfxPtr + 1]
    and a
    ret z
    ld hl, wSfxWait
    dec [hl]
    ret nz
    ld hl, wSfxPtr
    ld a, [hl+]
    ld h, [hl]
    ld l, a
    ld a, [hl+]
    ld c, a
    ld a, [hl+]
    ld b, a
    cp $FF
    jr z, .end
    ld a, [hl+]
    ld [wSfxWait], a
    ld a, l
    ld [wSfxPtr], a
    ld a, h
    ld [wSfxPtr + 1], a
    ld a, b
    cp $FE
    ret z
    ld a, $80
    ldh [rNR21], a
    ld a, $A3
    ldh [rNR22], a
    ld a, c
    ldh [rNR23], a
    ld a, b
    or $80
    ldh [rNR24], a
    ret
.end
    xor a
    ld [wSfxPtr + 1], a
    ret

; GB frequency value for a note: 2048 - 131072 / Hz
MACRO note
    dw 2048 - 131072 / \1
    db \2
ENDM

JingleStart:
    note 523, 4             ; C5
    note 659, 4             ; E5
    note 784, 4             ; G5
    note 1047, 8            ; C6
    dw $FF00

JingleWin:
    note 784, 6             ; G5
    note 1047, 6            ; C6
    note 1319, 6            ; E6
    note 1568, 10           ; G6
    dw $FE00
    db 4
    note 1319, 6            ; E6
    note 1568, 20           ; G6
    dw $FF00

JingleOver:
    note 392, 10            ; G4
    note 330, 10            ; E4
    note 262, 10            ; C4
    note 196, 24            ; G3
    dw $FF00

; ============================================================== text

StrPressStart:  db "  PRESS START ", 0
StrBlank20:     db "                    ", 0
MsgWin:         db "  YOU MADE 2048!!   ", 0
MsgOver:        db " GAME OVER - START  ", 0
MsgConfirm:     db "NEW GAME? A:YES B:NO", 0

MACRO at
    dw VRAM_MAP + (\1) * 32 + (\2)
ENDM

TitleScreen:
    at 0, 5
    db "HEXAGONAL", 0
    at 3, 6
    db "+", 0
    at 3, 13
    db "=", 0
    at 6, 0
    db "SLIDE THE HEX TILES", 0
    at 7, 0
    db "SIX WAYS. MATCH TWO", 0
    at 8, 0
    db "TO MERGE THEM!", 0
    at 10, 0
    db "<   >  LEFT / RIGHT", 0
    at 11, 0
    db "[   \\  UP + L / R", 0
    at 12, 0
    db "]   ^  DOWN + L / R", 0
    at 13, 7
    db "(OR B / A)", 0
    at 15, 0
    db "SELECT: NEW GAME", 0
    dw 0

GameScreen:
    at 0, 1
    db "SCORE", 0
    at 0, 12
    db "BEST", 0
    dw 0
