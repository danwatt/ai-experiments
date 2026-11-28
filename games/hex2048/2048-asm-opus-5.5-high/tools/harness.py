"""Minimal real-mode DOS/VGA harness on Unicorn: loads a .COM, fakes the
BIOS calls the game uses (int 10h/16h/1Ah/20h) and the VGA DAC/retrace ports,
and captures mode 13h screenshots each time the game waits for a key."""
import sys
from unicorn import *
from unicorn.x86_const import *
from PIL import Image, ImageFont, ImageDraw

SEG=0x1000
def make_font():
    f=ImageFont.load_default()
    data=bytearray(1024)
    for c in range(32,127):
        im=Image.new('1',(8,12),0); d=ImageDraw.Draw(im); d.text((1,-1),chr(c),font=f,fill=1)
        for row in range(8):
            b=0
            for x in range(8):
                if im.getpixel((x,row+1)): b|=0x80>>x
            data[c*8+row]=b
    return bytes(data)
FONT=make_font()

class PC:
    def __init__(s, com, keys):
        s.u=Uc(UC_ARCH_X86,UC_MODE_16); u=s.u
        u.mem_map(0,0x110000)
        u.mem_write(0xF0000,FONT)
        u.mem_write(SEG*16, b'\xCD\x20')
        u.mem_write(SEG*16+0x100, com)
        for r in (UC_X86_REG_CS,UC_X86_REG_DS,UC_X86_REG_ES,UC_X86_REG_SS): u.reg_write(r,SEG)
        u.reg_write(UC_X86_REG_SP,0xFFFC); u.mem_write(SEG*16+0xFFFC,b'\0\0')
        u.reg_write(UC_X86_REG_IP,0x100)
        s.keys=list(keys); s.pal=[(0,0,0)]*256; s.dacidx=0; s.daccomp=0; s.vs=0; s.done=False
        u.hook_add(UC_HOOK_INTR,s.intr)
        u.hook_add(UC_HOOK_INSN,s.inp,None,1,0,UC_X86_INS_IN)
        u.hook_add(UC_HOOK_INSN,s.outp,None,1,0,UC_X86_INS_OUT)
        s.shots=[]
    def intr(s,u,no,ud):
        ip=u.reg_read(UC_X86_REG_IP); cs=u.reg_read(UC_X86_REG_CS)
        n=u.mem_read(cs*16+ip-1,1)[0]
        ax=u.reg_read(UC_X86_REG_AX); ah=ax>>8
        if n==0x10:
            if ax==0x1130: u.reg_write(UC_X86_REG_ES,0xF000); u.reg_write(UC_X86_REG_BP,0)
        elif n==0x1A: u.reg_write(UC_X86_REG_CX,0x12); u.reg_write(UC_X86_REG_DX,0x3456)
        elif n==0x16:
            s.shots.append(s.screen())
            if hasattr(s,"on_key"): s.on_key(u)
            if not s.keys: s.done=True; u.emu_stop(); return
            k=s.keys.pop(0)
            if isinstance(k,str): u.reg_write(UC_X86_REG_AX,ord(k))
            else: u.reg_write(UC_X86_REG_AX,k<<8)
        elif n==0x20: s.done=True; u.emu_stop()
    def inp(s,u,port,size,ud):
        if port==0x3DA: s.vs^=8; return s.vs
        return 0
    def outp(s,u,port,size,val,ud):
        if port==0x3C8: s.dacidx=val; s.daccomp=0
        elif port==0x3C9:
            c=list(s.pal[s.dacidx]); c[s.daccomp]=(val&63)*255//63; s.pal[s.dacidx]=tuple(c)
            s.daccomp+=1
            if s.daccomp==3: s.daccomp=0; s.dacidx=(s.dacidx+1)&255
    def screen(s):
        vram=s.u.mem_read(0xA0000,64000)
        im=Image.new('RGB',(320,200)); im.putdata([s.pal[b] for b in vram]); return im
    def run(s):
        while not s.done:
            ip=s.u.reg_read(UC_X86_REG_IP); cs=s.u.reg_read(UC_X86_REG_CS)
            s.u.emu_start(cs*16+ip, 0, count=5_000_000)
