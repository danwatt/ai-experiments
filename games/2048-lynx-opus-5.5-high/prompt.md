# Prompts

- **Model:** claude-opus-5-5
- **Effort:** high
- **Session(s):** 1ce39b2e-9775-4677-bb5c-d15fa21712fd
- **Tokens:** input 164, output 119694, cache read 14098054, cache write 203928
- **Cost (tokscale estimate):** $6.85

## You

Build me a game of 2048, but on a hexagonal grid. Let store this in games/2048-lynx-opus-5.5-high.

Platform : Runnable as an Atari Lynx game, so C or ASM source.
Run in the browser via a JS emulator.

Do not reference any other code in this project

Do not install any software if it can be avoided. Use Docker to run builds if necessary

## Claude

Toolchain checked: Docker works, cc65's Lynx startup code sets up display timing. Next I'm checking whether the browser emulator needs a Lynx BIOS.

Handy core runs Lynx carts without a BIOS (falls back to built-in BIOS emulation). Writing game now.

cc65 2.18 bug: optional LOWCODE segment missing size symbol. Add tiny LOWCODE segment.

ROM builds (7.9 KB). Now browser page.

Page written. Preview server limit hit (other chats hold 5), so checking for an existing local server I can reuse.

Port 8000 already serves repo root. Using it.

![screenshot 1](prompt-assets/001.jpg)

Boots without BIOS, display correct. Start game and test moves.

![screenshot 2](prompt-assets/002.jpg)

![screenshot 3](prompt-assets/003.jpg)

![screenshot 4](prompt-assets/004.jpg)

Key taps too short or mapping off. Probe with held input via JS.

![screenshot 5](prompt-assets/005.jpg)

![screenshot 6](prompt-assets/006.jpg)

Need on-screen debug. Add temp debug readout of joystick/timer per frame.

![screenshot 7](prompt-assets/007.png)

![screenshot 8](prompt-assets/008.jpg)

![screenshot 9](prompt-assets/009.jpg)

![screenshot 10](prompt-assets/010.png)

![screenshot 11](prompt-assets/011.png)

![screenshot 12](prompt-assets/012.png)

Frame counter barely advances: timer-count polling misses VBL in Handy. Switching to polling Mikey's timer-2 interrupt flag (IRQs masked).

![screenshot 13](prompt-assets/013.png)

![screenshot 14](prompt-assets/014.png)

Pane hidden, so browser throttles emulator to ~5 fps; game itself fine. Testing with longer held inputs.

![screenshot 15](prompt-assets/015.png)

![screenshot 16](prompt-assets/016.png)

Game started. Testing moves.

![screenshot 17](prompt-assets/017.png)

![screenshot 18](prompt-assets/018.png)

Move N works. Measure render cost in Lynx frames with debug counter.

![screenshot 19](prompt-assets/019.png)

![screenshot 20](prompt-assets/020.jpg)

![screenshot 21](prompt-assets/021.jpg)

Emulator heavily throttled while pane hidden. Making temporary test page that drives frames with setTimeout instead of rAF.

![screenshot 22](prompt-assets/022.jpg)

![screenshot 23](prompt-assets/023.jpg)

![screenshot 24](prompt-assets/024.png)

Emulator now runs ~57 fps in test page. Debug box flicker is from debug code drawing to visible buffer. Testing moves + render timing.

![screenshot 25](prompt-assets/025.png)

![screenshot 26](prompt-assets/026.png)

![screenshot 27](prompt-assets/027.png)

![screenshot 28](prompt-assets/028.png)

Adding a tiny asm VBL interrupt handler (cc65 interruptor) for a true frame counter.

Now JS tap minimum hold, then retest.

![screenshot 29](prompt-assets/029.png)

![screenshot 30](prompt-assets/030.png)

Moves work but render costs ~20 frames (0x14) — far too slow, inputs dropped during animation. Plan: switch board drawing to Suzy hardware sprites. Reading cc65's Suzy definitions.

Switching board/HUD rendering to Suzy: CPU builds a chain of sprite control blocks (1bpp hex mask, 3x5 glyphs, scaled 1-pixel rects), Suzy blits them. Rewriting renderer.

![screenshot 31](prompt-assets/031.png)

![screenshot 32](prompt-assets/032.png)

Suzy rendering works first try. Now moves + timing.

![screenshot 33](prompt-assets/033.png)

![screenshot 34](prompt-assets/034.png)

Render down to 3 frames from 20. Score 12 confirms merges. Next: cache static HUD/board sprite chain, cheaper slide math, and latch joystick in the VBL IRQ so taps during animation aren't lost.

![screenshot 35](prompt-assets/035.png)

![screenshot 36](prompt-assets/036.png)

Render now 2 frames/step. Verifying each direction with single moves.

![screenshot 37](prompt-assets/037.png)

![screenshot 38](prompt-assets/038.png)

SW correct (tiles to lower-left edge, merges scored). Checking NE, NW, SE singly.

![screenshot 39](prompt-assets/039.png)

![screenshot 40](prompt-assets/040.png)

NE correct (verified against expected cell positions). Testing Left alone, B+Right, and Option 1.

![screenshot 41](prompt-assets/041.png)

![screenshot 42](prompt-assets/042.png)

SE via B+Right correct. Running a random-move bot to reach game over and check the overlay.

![screenshot 43](prompt-assets/043.png)

![screenshot 44](prompt-assets/044.png)

Looks good mid-game. Continuing bot to game over.

![screenshot 45](prompt-assets/045.png)

![screenshot 46](prompt-assets/046.png)

128 text a bit low-contrast on pale yellow; will darken golds. Continuing bot for game-over screen.

![screenshot 47](prompt-assets/047.png)

![screenshot 48](prompt-assets/048.png)

Random bot can't easily lose with six directions; game-over uses same band code as verified title overlay. Polishing: darker golds, clearer hints, then release build.

![screenshot 49](prompt-assets/049.png)

![screenshot 50](prompt-assets/050.png)

![screenshot 51](prompt-assets/051.png)

![screenshot 52](prompt-assets/052.png)

Release build plays well. Cleaning up test page, writing README and landing card.

![screenshot 53](prompt-assets/053.jpg)

![screenshot 54](prompt-assets/054.jpg)

Final page boots fine. Generating prompt.md.
