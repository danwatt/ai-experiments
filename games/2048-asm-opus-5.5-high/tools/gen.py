"""Generates the hex geometry tables pasted into hex2048.asm: cell centres,
the slide lines for each of the six directions, and hexagon scanline widths."""
import math
R=21          # cell spacing
CX,CY=210,100
cells=[(q,r) for r in range(-2,3) for q in range(-2,3) if max(abs(q),abs(r),abs(q+r))<=2]
cells.sort(key=lambda c:(c[1]+c[0]/2, c[0]))
idx={c:i for i,c in enumerate(cells)}
pos=[(round(CX+1.5*R*q), round(CY+math.sqrt(3)*R*(r+q/2))) for q,r in cells]
# clockwise: N, NE, SE, S, SW, NW
dirs=[(0,-1),(1,-1),(1,0),(0,1),(-1,1),(-1,0)]
out=[]
out.append("; ---- generated tables ----")
out.append("cell_x: dw "+",".join(str(p[0]) for p in pos))
out.append("cell_y: dw "+",".join(str(p[1]) for p in pos))
out.append("; lines[dir][5][5]: cell indices, front (toward move) first, FFh pad")
out.append("lines:")
for dq,dr in dirs:
    groups={}
    for c in cells:
        q,r=c
        if dq==0: k=q
        elif dr==0: k=r
        else: k=q+r
        groups.setdefault(k,[]).append(c)
    rows=[]
    for k in sorted(groups):
        g=sorted(groups[k], key=lambda c:-(c[0]*dq+c[1]*dr))
        row=[idx[c] for c in g]+[255]*(5-len(g))
        rows.append(",".join(str(x) for x in row))
    out.append("    db "+", ".join(rows)+f"   ; dir ({dq},{dr})")
def hexrows(rad,name):
    H=int(rad*math.sqrt(3)/2)
    w=[int(round(rad - abs(y)/math.sqrt(3))) for y in range(-H,H+1)]
    out.append(f"{name}: db {H}, "+",".join(map(str,w)))
hexrows(22,"hex_big")
hexrows(19,"hex_tile")
hexrows(8,"hex_icon")
print("\n".join(out))
