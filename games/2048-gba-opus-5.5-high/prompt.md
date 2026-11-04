# Prompts

- **Model:** claude-opus-5-5
- **Effort:** high
- **Session(s):** 316054d2-3be0-4bed-a769-5960d6d18b47
- **Tokens:** input 82, output 118297, cache read 6825903, cache write 170530
- **Cost (tokscale estimate):** $5.1

## You

Build me a game of 2048, but on a hexagonal grid. Let store this in `games/2048-gba-opus-5.5-high`.

Platform : Gameboy assembly. Run in the browser via a JS emulator.

Do not reference any other code in this project

## Claude

Toolchain ready (RGBDS installed, generator works). Now writing game in SM83 assembly.

My script dropped both includes. Re-add.

Ass­embled clean. Now the JS emulator.

![screenshot 1](prompt-assets/001.png)

Debugging boot: ROM stuck in memory clear loop. Tracing.

Bug found: `LcdOff` waits for VBlank while LCD already off — hangs (real hardware would too). Fix.

400 moves match JS rules model, zero errors. Check visuals + longer run with game overs.

![screenshot 2](prompt-assets/002.png)

![screenshot 3](prompt-assets/003.png)

![screenshot 4](prompt-assets/004.png)

Game logic verified (3000 moves, 5 full games, 0 mismatches). Now web page + controls.

Page served. Checking it in browser.

![screenshot 5](prompt-assets/005.jpg)

Return tap not registered: key down+up inside one frame never reaches game. Need minimum hold. Fixing input latch + key legend layout.

![screenshot 6](prompt-assets/006.jpg)

Keyboard play works. Check touch hex-pad and phone width.

![screenshot 7](prompt-assets/007.jpg)

Mobile overflows (content cut left). Fix main width.

![screenshot 8](prompt-assets/008.jpg)

Touch pad works, no overflow at 375px. Quick audio sanity check in Node.

Tests pass. Generating `prompt.md`.
