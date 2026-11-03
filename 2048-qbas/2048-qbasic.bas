' ============================================================
'  HEX 2048  -  for QBJS (qbjs.org)
'  A 19-cell hexagonal board; tiles slide in six directions.
'
'  Keys:   Q  W  E      ->   NW  N  NE
'          A  S  D      ->   SW  S  SE
'  Numpad 7 8 9 / 1 2 3 work too.
'  Or click / tap on the screen toward the direction to slide.
'  R = new game      Esc = quit
' ============================================================

CONST RAD = 2 ' board radius (2 = 19 cells, 3 = 37 cells)
CONST HS = 46 ' hex size, center to corner, in pixels
CONST SCRW = 640
CONST SCRH = 600

DIM SHARED s3, bx, by, ncells, won, over
DIM SHARED score AS LONG, best AS LONG
DIM SHARED cq(60), cr(60), tv(60), merged(60), dist(60)
DIM SHARED idx(10, 10)
DIM SHARED dqs(5), drs(5)
DIM SHARED pow2(30) AS LONG
DIM SHARED tcr(30), tcg(30), tcb(30)

SCREEN _NEWIMAGE(SCRW, SCRH, 32)
_TITLE "Hex 2048"
RANDOMIZE TIMER

s3 = SQR(3)
bx = SCRW / 2
by = 320

' Axial directions for flat-top hexes: 0=N 1=NE 2=SE 3=S 4=SW 5=NW
dqs(0) = 0: drs(0) = -1
dqs(1) = 1: drs(1) = -1
dqs(2) = 1: drs(2) = 0
dqs(3) = 0: drs(3) = 1
dqs(4) = -1: drs(4) = 1
dqs(5) = -1: drs(5) = 0

' Build the list of cells inside the hexagon
ncells = 0
FOR q = -RAD TO RAD
    FOR r = -RAD TO RAD
        idx(q + RAD, r + RAD) = -1
        IF ABS(q + r) <= RAD THEN
            cq(ncells) = q
            cr(ncells) = r
            idx(q + RAD, r + RAD) = ncells
            ncells = ncells + 1
        END IF
    NEXT
NEXT

pow2(0) = 0
pow2(1) = 2
FOR e = 2 TO 30
    pow2(e) = pow2(e - 1) * 2
NEXT

' Tile colors by exponent (0 = empty)
FOR e = 0 TO 30
    SetT e, 60, 58, 50
NEXT
SetT 0, 205, 193, 180
SetT 1, 238, 228, 218
SetT 2, 237, 224, 200
SetT 3, 242, 177, 121
SetT 4, 245, 149, 99
SetT 5, 246, 124, 95
SetT 6, 246, 94, 59
SetT 7, 237, 207, 114
SetT 8, 237, 204, 97
SetT 9, 237, 200, 80
SetT 10, 237, 197, 63
SetT 11, 237, 194, 46

best = 0
NewGame
dirty = 1
prevB = 0

DO
    mv = -1
    k$ = UCASE$(INKEY$)
    SELECT CASE k$
        CASE "W", "8": mv = 0
        CASE "E", "9": mv = 1
        CASE "D", "3": mv = 2
        CASE "S", "2": mv = 3
        CASE "A", "1": mv = 4
        CASE "Q", "7": mv = 5
        CASE "R"
            NewGame
            dirty = 1
    END SELECT

    ' Mouse / touch: click toward a direction from the board center
    WHILE _MOUSEINPUT: WEND
    b = _MOUSEBUTTON(1)
    IF b <> 0 AND prevB = 0 THEN
        mx = _MOUSEX - bx
        my = _MOUSEY - by
        IF mx * mx + my * my > 400 THEN
            bestDot = -999999999
            FOR d = 0 TO 5
                vx = 1.5 * dqs(d)
                vy = s3 * (drs(d) + dqs(d) / 2)
                dt = mx * vx + my * vy
                IF dt > bestDot THEN
                    bestDot = dt
                    mv = d
                END IF
            NEXT
        END IF
    END IF
    prevB = b

    IF mv >= 0 AND over = 0 THEN
        IF DoMove(mv) THEN
            Spawn
            IF score > best THEN best = score
            IF CanMove = 0 THEN over = 1
            dirty = 1
        END IF
    END IF

    IF dirty THEN
        DrawBoard
        _DISPLAY
        dirty = 0
    END IF
    _LIMIT 60
LOOP UNTIL k$ = CHR$(27)
END

' ------------------------------------------------------------

SUB SetT (e, rr, gg, bb)
    tcr(e) = rr: tcg(e) = gg: tcb(e) = bb
END SUB

SUB NewGame
    FOR i = 0 TO ncells - 1
        tv(i) = 0
    NEXT
    score = 0
    won = 0
    over = 0
    Spawn
    Spawn
END SUB

SUB Spawn
    DIM empties(60)
    n = 0
    FOR i = 0 TO ncells - 1
        IF tv(i) = 0 THEN
            empties(n) = i
            n = n + 1
        END IF
    NEXT
    IF n = 0 THEN EXIT SUB
    i = empties(INT(RND * n))
    IF RND < 0.9 THEN
        tv(i) = 1
    ELSE
        tv(i) = 2
    END IF
END SUB

FUNCTION CellAt (q, r)
    CellAt = -1
    IF ABS(q) <= RAD AND ABS(r) <= RAD AND ABS(q + r) <= RAD THEN
        CellAt = idx(q + RAD, r + RAD)
    END IF
END FUNCTION

FUNCTION DoMove (d)
    dq = dqs(d): dr = drs(d)
    moved = 0

    ' How far is each cell from the edge in this direction?
    FOR i = 0 TO ncells - 1
        merged(i) = 0
        k = 0
        q = cq(i): r = cr(i)
        DO WHILE CellAt(q + dq, r + dr) >= 0
            q = q + dq: r = r + dr
            k = k + 1
        LOOP
        dist(i) = k
    NEXT

    ' Process tiles front-first so each merges at most once
    FOR k = 0 TO 2 * RAD
        FOR i = 0 TO ncells - 1
            IF dist(i) = k AND tv(i) > 0 THEN
                cur = i
                DO
                    n = CellAt(cq(cur) + dq, cr(cur) + dr)
                    IF n < 0 THEN EXIT DO
                    IF tv(n) = 0 THEN
                        tv(n) = tv(cur)
                        tv(cur) = 0
                        cur = n
                        moved = 1
                    ELSEIF tv(n) = tv(cur) AND merged(n) = 0 THEN
                        tv(n) = tv(n) + 1
                        tv(cur) = 0
                        merged(n) = 1
                        score = score + pow2(tv(n))
                        IF tv(n) >= 11 AND won = 0 THEN won = 1
                        moved = 1
                        EXIT DO
                    ELSE
                        EXIT DO
                    END IF
                LOOP
            END IF
        NEXT
    NEXT
    DoMove = moved
END FUNCTION

FUNCTION CanMove
    CanMove = 0
    FOR i = 0 TO ncells - 1
        IF tv(i) = 0 THEN
            CanMove = 1
            EXIT FUNCTION
        END IF
        FOR d = 1 TO 3
            n = CellAt(cq(i) + dqs(d), cr(i) + drs(d))
            IF n >= 0 THEN
                IF tv(n) = tv(i) THEN
                    CanMove = 1
                    EXIT FUNCTION
                END IF
            END IF
        NEXT
    NEXT
END FUNCTION

' Filled flat-top hexagon drawn with horizontal scanlines
SUB FillHex (cx, cy, s, rr, gg, bb)
    h = s * s3 / 2
    FOR y = -INT(h) TO INT(h)
        hw = s - ABS(y) / s3
        LINE (cx - hw, cy + y)-(cx + hw, cy + y), _RGB(rr, gg, bb)
    NEXT
END SUB

' Text rendered small, then scaled up onto the screen
SUB BigText (cx, cy, t$, sc, fr, fg, fb, br, bgc, bb)
    DIM img AS LONG
    w = LEN(t$) * 8
    h = 16
    img = _NEWIMAGE(w, h, 32)
    _DEST img
    COLOR _RGB(fr, fg, fb), _RGB(br, bgc, bb)
    _PRINTSTRING (0, 0), t$
    _DEST 0
    _PUTIMAGE (cx - w * sc / 2, cy - h * sc / 2)-(cx + w * sc / 2 - 1, cy + h * sc / 2 - 1), img
    _FREEIMAGE img
END SUB

SUB CenterText (y, t$, rr, gg, bb)
    COLOR _RGB(rr, gg, bb), _RGB(250, 248, 239)
    _PRINTSTRING (bx - LEN(t$) * 4, y), t$
END SUB

SUB DrawBoard
    LINE (0, 0)-(SCRW - 1, SCRH - 1), _RGB(250, 248, 239), BF

    BigText bx, 32, "HEX 2048", 3, 119, 110, 101, 250, 248, 239
    CenterText 66, "SCORE: " + LTRIM$(STR$(score)) + "      BEST: " + LTRIM$(STR$(best)), 119, 110, 101

    IF over THEN
        CenterText 92, "No moves left!  Press R for a new game.", 200, 60, 40
    ELSEIF won THEN
        CenterText 92, "You made 2048!  Keep going...", 200, 150, 20
    END IF

    ' Board frame: full-size hexes in the border color
    FOR i = 0 TO ncells - 1
        px = bx + HS * 1.5 * cq(i)
        py = by + HS * s3 * (cr(i) + cq(i) / 2)
        FillHex px, py, HS + 1, 187, 173, 160
    NEXT

    ' Tiles
    FOR i = 0 TO ncells - 1
        px = bx + HS * 1.5 * cq(i)
        py = by + HS * s3 * (cr(i) + cq(i) / 2)
        e = tv(i)
        FillHex px, py, HS - 5, tcr(e), tcg(e), tcb(e)
        IF e > 0 THEN
            t$ = LTRIM$(STR$(pow2(e)))
            L = LEN(t$)
            IF L <= 3 THEN
                sc = 2
            ELSEIF L = 4 THEN
                sc = 1.75
            ELSE
                sc = 1.25
            END IF
            IF e <= 2 THEN
                BigText px, py, t$, sc, 119, 110, 101, tcr(e), tcg(e), tcb(e)
            ELSE
                BigText px, py, t$, sc, 249, 246, 242, tcr(e), tcg(e), tcb(e)
            END IF
        END IF
    NEXT

    CenterText 538, "Q W E = NW N NE     A S D = SW S SE     (numpad 7 8 9 / 1 2 3)", 119, 110, 101
    CenterText 558, "Or click toward a direction to slide.", 119, 110, 101
    CenterText 578, "R = new game     Esc = quit", 119, 110, 101
END SUB
