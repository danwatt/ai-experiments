"""Fuzz test: drive HEX2048.COM through random moves in a Unicorn-based
real-mode harness and check every move against a Python reference.

Usage: python3 tools/test.py   (needs nasm, plus: pip install unicorn pillow)
"""
import random, re, subprocess, tempfile, os
from pathlib import Path
from harness import PC, SEG

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ASM = ROOT / "hex2048.asm"
COM = ROOT / "HEX2048.COM"

# assemble with a listing so variable addresses are never hard-coded
lst = os.path.join(tempfile.mkdtemp(), "hex2048.lst")
subprocess.run(["nasm", "-f", "bin", str(ASM), "-o", str(COM), "-l", lst], check=True)
def sym(name):
    for line in open(lst):
        m = re.match(r"\s*\d+ ([0-9A-F]{8}) .*?\s" + name + r"\s+(dd|db|dw|times)\b", line)
        if m: return 0x100 + int(m.group(1), 16)
    raise KeyError(name)
BOARD, SCORE, OVER = sym("board"), sym("score"), sym("over")
src = ASM.read_text()
L=[]
for line in src[src.index('\nlines:')+1:].split('\n')[1:7]:
    nums=[int(x) for x in line.split(';')[0].replace('db','').replace(' ','').split(',')]
    L.append([nums[i*5:i*5+5] for i in range(5)])
keys='wedsaq'   # dir 0..5
def ref(b,d):
    b=list(b); sc=0
    for line in L[d]:
        cells=[c for c in line if c!=255]
        v=[b[c] for c in cells if b[c]]
        out=[];i=0
        while i<len(v):
            if i+1<len(v) and v[i]==v[i+1]: out.append(v[i]+1); sc+=1<<(v[i]+1); i+=2
            else: out.append(v[i]); i+=1
        out+=[0]*(len(cells)-len(out))
        for c,x in zip(cells,out): b[c]=x
    return b,sc
def over(b):
    if 0 in b: return False
    return all(ref(b,d)[0]==list(b) for d in range(6))
random.seed(1)
seq=[random.choice(keys) for _ in range(3000)]
pc=PC(COM.read_bytes(), seq)
snaps=[]
rd=lambda u,a,n:bytes(u.mem_read(SEG*16+a,n))
pc.on_key=lambda u: snaps.append((list(rd(u,BOARD,19)), int.from_bytes(rd(u,SCORE,4),'little'), rd(u,OVER,1)[0]))
pc.run()
errs=0; games=0
print("start:",snaps[0][0], "nonzero", sum(1 for x in snaps[0][0] if x))
for i in range(len(snaps)-1):
    b,sc,ov=snaps[i]; b2,sc2,ov2=snaps[i+1]
    k=seq[i]
    if ov:
        if b2!=b: errs+=1; print("moved while over",i)
        continue
    exp,dsc=ref(b,keys.index(k))
    if exp==b:
        if b2!=b or sc2!=sc: errs+=1; print("changed on no-op",i)
        continue
    diff=[j for j in range(19) if exp[j]!=b2[j]]
    if len(diff)!=1 or exp[diff[0]]!=0 or b2[diff[0]] not in (1,2) or sc2!=sc+dsc:
        errs+=1; print("mismatch",i,b,k,exp,b2,sc,dsc,sc2)
    if ov2!=over(b2): errs+=1; print("over flag wrong",i,b2,ov2)
    if ov2: games+=1
print("steps",len(snaps),"errors",errs,"gameovers",games,"final score",snaps[-1][1],"max tile",2**max(snaps[-1][0]))
pc.shots[0].resize((960,600),0).save(HERE/'shot_start.png')
pc.shots[-1].resize((960,600),0).save(HERE/'shot_end.png')
print('screenshots: tools/shot_start.png, tools/shot_end.png (harness font is a stand-in, not the VGA ROM font)')
