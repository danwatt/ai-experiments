# Prompts

- **Model:** claude-opus-5-5
- **Effort:** high
- **Session(s):** 316054d2-3be0-4bed-a769-5960d6d18b47
- **Tokens:** input 118, output 132552, cache read 10822453, cache write 189515
- **Cost (tokscale estimate):** $6.33

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

Hex 2048 now runs as a Game Boy ROM in [games/2048-gba-opus-5.5-high](games/2048-gba-opus-5.5-high/index.html). I read "Gameboy assembly" as the original Game Boy and its SM83 CPU, so it is not a Game Boy Advance game, despite "gba" in the folder name.

**Testing:** a headless script plays random moves in the emulator and compares each board and score with a separate JavaScript copy of the rules. 2000 moves over 3 complete games matched with 0 errors, including the game-over check and the new-game reset. I also played it in the browser with the keyboard and the touch buttons, and checked it at phone width. Sound produces output in the emulator, but I couldn't listen to it.

**What's there:**
- **The game, in [main.asm](games/2048-gba-opus-5.5-high/src/main.asm):** a 19-cell hex board where tiles slide in six directions. It has a title screen, scores, a "you made 2048" message, game over, and a confirm prompt for a new game. Sound effects pitch up as merged tiles get bigger. The best score is kept in battery-backed cartridge memory.
- **The emulator, [gb.js](games/2048-gba-opus-5.5-high/gb.js):** written from scratch. It covers the CPU, graphics, timer, buttons, cartridge memory and sound. In the browser, cartridge memory is saved to the browser's local storage.
- **The page, [index.html](games/2048-gba-opus-5.5-high/index.html):** a handheld-style case with a six-way touch pad, A/B and Start/Select, plus a choice of four colour palettes. The ROM is embedded in `rom.js`, so the page also opens straight from disk.
- **Controls:** W E / A D / Z X are the six directions; on a keyboard they form a hexagon around S. On a real D-pad, Left/Right slide straight across. Up/Down need Left/Right or B/A to pick the diagonal.
- **Build:** `build.sh` turns the source into `hex2048.gb`. A Node script draws the tiles and font and works out the board tables. `build/` is git-ignored.

Changes outside the game folder:
- I installed the RGBDS assembler with Homebrew (`brew install rgbds`).
- I added a `2048-gba` entry to `.claude/launch.json`, serving on port 8807.
- I added a card to the root landing page.
- I generated `prompt.md`; it puts the cost at about $5.10.

I didn't look at or reuse any other code in the project.

Two bugs came up and are fixed. The ROM froze at startup waiting for a screen refresh while the screen was switched off. Quick browser key taps were missed because the game reads the buttons only once per frame; each press is now held for at least 3 frames.

## You

Commit the working tree changes with a sensible message.

## Claude

`hexahedron-opus-5.5` changes were already there before this session; they belong to other work. Committing only Hex 2048 GB files.

Committed on master as `8f9aa61` ("2048-gba: hex 2048 as a Game Boy ROM in SM83 assembly"). It includes the demo folder, the landing-page card and the `.claude/launch.json` preview entry.

I left the `games/hexahedron-opus-5.5/` changes out of the commit. They were already in the working tree before this session started, so they look like other work. They're still uncommitted, and nothing is pushed.

## You

What other gaming platforms could we build this for that could be emulated in the browser?

## Claude

Good candidates fall into four groups, roughly from best fit to wildest stretch. Each entry gives the CPU, toolchain and browser emulator, then why it suits a hex board.

**Close to what we just built (tile-based consoles with 8-button pads)**
- **NES.** 6502 CPU, assembled with ca65 (from cc65) or asm6. Browser emulators include jsnes, or I could write one, which is doable much like `gb.js`. Same tile approach as the Game Boy, but in colour with a 256×240 screen, so tile values can have real colours. The pad is the same as the Game Boy's, so the diagonal scheme carries over unchanged.
- **Sega Master System / Game Gear.** Z80 CPU, a close cousin of the Game Boy's SM83. Assembled with WLA-DX; runs in the browser on jsSMS, or on a hand-written emulator. Much of the game logic would port over almost line for line.
- **Game Boy Advance.** ARM assembly or C with devkitARM; runs on mGBA compiled to WebAssembly. This fits the "gba" in the folder name. A 240×160 bitmap mode lets you draw true hexagons and animate tiles sliding.

**Stronger 16-bit consoles**
- **SNES.** 65816 CPU, assembled with ca65 or WLA-DX; runs on a WebAssembly build of snes9x. Its Mode 7 graphics could rotate the whole board towards the direction of each slide.
- **Sega Genesis.** 68000 CPU, assembled with vasm; runs on Genesis Plus GX through EmulatorJS. The 68000 is pleasant to write assembly for, and the system has a strong sound chip.

**Home computers**
- **Commodore 64.** 6502 CPU, assembled with ACME or ca65; runs in VICE.js. Custom character sets make hex cells easy, and the SID chip can play the music.
- **ZX Spectrum.** Z80 CPU, assembled with pasmo or sjasmplus; runs in JSSpeccy. Its rule of only two colours per 8×8 block forces interesting choices in how hex cells are drawn.
- **MSX** (WebMSX), **Apple II** (apple2js), **BBC Micro** (jsbeeb) and **Amiga** (vAmigaWeb) are also options.

**Odd fits that would make memorable demos**
- **Vectrex.** 6809 CPU, runs in vecx.js. Its screen draws lines rather than pixels, so the hexes would be true glowing vector outlines. This is my favourite visual pick.
- **Atari 2600.** 6502 CPU, assembled with dasm; runs in Javatari or a JavaScript build of Stella. It has no frame buffer, so every line is drawn while the TV beam sweeps. Fitting 19 numbered cells into that is the hardest challenge on this list.
- **CHIP-8.** A tiny 64×32 virtual machine with a 16-key hexadecimal keypad (a nice pun for a hex game). The emulator would be about 200 lines. The screen is too small for numbers, so tiles would show exponents or patterns.
- **PICO-8 and TIC-80.** Fantasy consoles that run in the browser natively. They're easy, but they don't involve real hardware.

**Emulator choice:** For NES, Master System, CHIP-8 and the Atari 2600, writing our own emulator is realistic, as `gb.js` was. For GBA, SNES and Genesis, an existing WebAssembly emulator is the practical route.

**My picks:** Vectrex for the most striking result, NES as the natural next step, and the Atari 2600 if you want the hardest build. If you choose one, I'd keep the same structure: assembly source, a generator for graphics and tables, a headless rules test and a handheld-style page.

## You

what about some more advanced consoles, like the N64 or others from the same era?

## Claude

Most consoles from that era can run in the browser through emulators compiled to WebAssembly. The main difference from the earlier list is that I wouldn't write the emulator myself any more. I'd bundle an existing one, for example through EmulatorJS, which packages emulators from the RetroArch project.

**Strong candidates**
- **PlayStation 1.** CPU: MIPS R3000. Toolchain: PSn00bSDK in C, or plain MIPS assembly with armips. Browser: PCSX ReARMed or Beetle PSX through EmulatorJS.
  - Its graphics chip draws flat and shaded polygons, so hexes become real polygons rather than tiles. Tiles could slide smoothly, merges could pulse, and the board could be tilted in 3D.
  - Writing it all in assembly is realistic, because the hardware is simple and well documented.
  - The catch is the BIOS. The original is copyrighted, so we'd use OpenBIOS (the open-source replacement from the pcsx-redux project) or an emulator's built-in BIOS stand-in.
  - **This is my top pick from this era.**
- **Nintendo 64.** CPU: MIPS R4300i, plus a separate graphics coprocessor. Toolchain: libdragon, which is modern, open source and C-based. Browser: mupen64plus-next through EmulatorJS.
  - It could show a real 3D hex board with lighting and a bit of camera motion.
  - The biggest risk is accuracy. libdragon's graphics code expects an accurate emulator, and browser N64 emulators take shortcuts. I'd build a "hello triangle" ROM and confirm it renders in the browser before committing to this.
  - Pure assembly is possible but brutal, because setting up the graphics coprocessor needs its own microcode. In practice this would be C with some MIPS assembly.
- **Nintendo DS.** CPU: ARM9 plus ARM7. Toolchain: BlocksDS or devkitARM with libnds. Browser: melonDS through EmulatorJS, or a WebAssembly build of DeSmuME.
  - It suits the game well: the touch screen lets you swipe in six directions, and the second screen holds the score and best.
  - The toolchain is mature, and ARM assembly is pleasant to write.

**Possible, but awkward**
- **Sega Saturn.** Two SH-2 CPUs and two video chips, which are notoriously complex. Toolchains: Jo Engine or Yaul. The browser emulators (Yabause and Kronos) are slow and need a BIOS.
- **Dreamcast.** SH-4 CPU, with the mature KallistiOS toolchain. Browser builds of the Flycast emulator are experimental, so its reliability is uncertain.
- **Atari Jaguar.** A 68000 plus two custom RISC chips. Toolchain: rmac/rln. Browser: Virtual Jaguar through EmulatorJS. It would make a quirky, memorable demo.
- **Virtual Boy.** NEC V810 CPU, toolchain VUEngine, browser emulator Beetle VB. The display is red-only and stereoscopic, so we could build a 3D hex board in red depth layers. It's mostly a novelty.

**Not practical in a browser**
- **GameCube, Wii, PS2 and the original Xbox.** Their emulators (Dolphin, PCSX2, xemu) have no usable browser builds.
- **PSP.** The PPSSPP emulator has WebAssembly builds, but they're shaky.

**Differences from the Game Boy build**
- **Testing:** the headless rules test would need a different approach, because we'd no longer have our own emulator to read memory from. One option is for the ROM to write its state to a known memory address that a test harness can read through the bundled emulator.
- **Emulator files:** the cores are a few MB of WebAssembly. We could load them from a CDN or vendor them into the folder.
- **BIOS:** we'd use only BIOS-free or open-BIOS setups, and never bundle a copyrighted BIOS.

**My picks:** PlayStation 1 offers the best mix of real-hardware feel, feasible assembly and reliable browser emulation. N64 is worth it if you want 3D, as long as the render-check prototype passes first. DS is the best fit for play, thanks to swiping on the touch screen.

## You

lets dockerize the build of the image, instead of relying on homebrew

## Claude

Docker 29 present. Writing Dockerfile: RGBDS v1.0.4 compiled from source (same version as Homebrew, so ROM should match byte-for-byte).

Image builds. Now split scripts: `tools/build-rom.sh` runs inside container, `build.sh` wraps Docker.

Docker build gives byte-identical ROM (same SHA-1), test passes. Updating README.

The ROM now builds in Docker, so Homebrew is no longer needed. I built it both ways: the Docker version of `hex2048.gb` is byte-for-byte identical to the Homebrew one. The 2000-move rules test also passes inside the container.

- **[Dockerfile](games/2048-gba-opus-5.5-high/Dockerfile):** compiles the RGBDS assembler, version 1.0.4 (the same version Homebrew had), from its source code on GitHub. It then copies the tools into a Node image, which runs the generator and the test.
- **[build.sh](games/2048-gba-opus-5.5-high/build.sh):** builds the image if it's missing, then runs the build with the game folder mounted, as your own user. `./build.sh --test` also runs the rules test.
- **[tools/build-rom.sh](games/2048-gba-opus-5.5-high/tools/build-rom.sh):** the actual build steps, which run inside the container. It also works directly on a machine that already has RGBDS and Node.
- **README:** the build section now describes the Docker route.

The first `./build.sh` takes about a minute to compile RGBDS; after that, builds take a few seconds.

Homebrew's `rgbds` is still installed. If you no longer want it:
```bash
brew uninstall rgbds
```

## You

<bash-input>brew uninstall rgbds</bash-input><bash-stdout>Uninstalling /opt/homebrew/Cellar/rgbds/1.0.4... (31 files, 2MB)</bash-stdout><bash-stderr></bash-stderr>

## Claude

Homebrew's `rgbds` is uninstalled. That doesn't affect the build: `./build.sh` uses the RGBDS compiled inside the Docker image. The Docker changes are still uncommitted.

## You

Commit

## Claude

Screenshot count jumped 8 → 27. Checking prompt.md picked right session.

Script grabbed wrong session (another chat's PS1 build is newest). Restore and rerun with this session id.
