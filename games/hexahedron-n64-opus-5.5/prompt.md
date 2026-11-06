# Prompts

- **Model:** claude-opus-5-5
- **Effort:** high
- **Session(s):** d56185cc-61ad-4518-84b5-9336f0a84455
- **Tokens:** input 706, output 379062, cache read 151258038, cache write 683875
- **Cost (tokscale estimate):** $43.31

## You

Lets take what we have learned from some other experiments to make a new one.

Lets take `hexahedron`, the descent 1 inspired game, and make a version that can run on the N64 using an emulator in the browser.

Do not install any tools locally, use Docker.

We can skip some of the more advanced features, like importing PIG/HOG files from D1, and just stick with the basic enemies, weapons, and 3 demo maps.

## Claude

Studying hexahedron's 3 missions and the PS1/Lynx emulator demos. Next: pick N64 toolchain + check which browser N64 core can run homebrew microcode.

Found: browser N64 cores (parallel_n64, mupen64plus_next) include Angrylion RDP + cxd4 LLE RSP, so libdragon microcode should run. Now fetching libdragon toolchain image.

Docker image building in background. Meanwhile reading game.js for enemy/weapon behaviour to port.

Exporter works (825 / 2308 / 2550 cells). Now checking libdragon GL/rdpq API in image.

Image includes a prebuilt `gldemo.z64` — testing that in browser emulator first to de-risk.

![screenshot 1](prompt-assets/001.webp)

Emulator boots ROM but screen black with parallel_n64+Angrylion. Trying mupen64plus_next core.

![screenshot 2](prompt-assets/002.webp)

![screenshot 3](prompt-assets/003.webp)

Emulator frozen at frame 1 because Browser pane hidden (no rAF). Opening pane.

![screenshot 4](prompt-assets/004.webp)

parallel_n64 crashes (stack overflow) and mupen64plus_next crashes (table OOB) on libdragon gldemo. Trying other option combos.

![screenshot 5](prompt-assets/005.webp)

Crash is deterministic. Building my own minimal test ROMs (CPU-only, rdpq, GL) to isolate which layer each core handles.

![screenshot 6](prompt-assets/006.webp)

![screenshot 7](prompt-assets/007.webp)

![screenshot 8](prompt-assets/008.webp)

Even CPU-only test ROM shows black and core halts — testing core/plugin matrix with error overlay.

![screenshot 9](prompt-assets/009.webp)

![screenshot 10](prompt-assets/010.webp)

Both cores crash even on CPU-only ROM — suspect libdragon IPL3 boot vs emulator CIC handling. Checking libdragon IPL3 variants.

libdragon needs accurate emulation (MI repeat, PI DMA); old cores may choke. Cheap test first: pad ROMs to 2 MB (old cores assume ≥1 MB).

![screenshot 11](prompt-assets/011.webp)

![screenshot 12](prompt-assets/012.webp)

Same crashes. Checking whether in-app browser is the culprit — testing same page in Chrome.

![screenshot 13](prompt-assets/013.webp)

Same crash in Chrome, so it's ROM/core, not browser. Next test: bare-metal ELF (no libdragon runtime) booted by libdragon IPL3 — isolates boot vs runtime.

Bare-metal test ROM built. Running it in both cores.

![screenshot 14](prompt-assets/014.webp)

![screenshot 15](prompt-assets/015.webp)

Crash identical for every ROM → likely my EmulatorJS options, not ROMs. Testing pure defaults.

![screenshot 16](prompt-assets/016.webp)

![screenshot 17](prompt-assets/017.webp)

EmulatorJS caches core settings in browser storage — clearing it and retesting defaults.

![screenshot 18](prompt-assets/018.webp)

Even bare-metal ROM crashes both cores → suspect libdragon's IPL3 itself on these old cores. Next test: my own trivial IPL3 (PI DMA flat binary → 0x80000400, jump).

![screenshot 19](prompt-assets/019.webp)

![screenshot 20](prompt-assets/020.webp)

Both cores run with my custom IPL3 — root cause is libdragon's IPL3 on these old cores. Next: try libdragon runtime as flat binary under my IPL3.

![screenshot 21](prompt-assets/021.webp)

![screenshot 22](prompt-assets/022.webp)

![screenshot 23](prompt-assets/023.webp)

No crash now but black — libdragon init likely stuck somewhere. Building probe ROM that paints a raw-VI color per init stage.

![screenshot 24](prompt-assets/024.webp)

![screenshot 25](prompt-assets/025.webp)

![screenshot 26](prompt-assets/026.webp)

Likely cause: parallel_n64 defaults to 4 MB (expansion pak off) while probe/stack use 8 MB. Enabling expansion memory.

![screenshot 27](prompt-assets/027.webp)

![screenshot 28](prompt-assets/028.webp)

Option applied but still black. Making IPL3 probe real RDRAM size (4 vs 8 MB) instead of assuming 8 MB, and keep probe framebuffer under 4 MB.

![screenshot 29](prompt-assets/029.webp)

![screenshot 30](prompt-assets/030.webp)

![screenshot 31](prompt-assets/031.webp)

![screenshot 32](prompt-assets/032.webp)

![screenshot 33](prompt-assets/033.webp)

![screenshot 34](prompt-assets/034.webp)

Reached constructor(135), hangs in a default-priority libdragon constructor. Listing the ctor table to bisect.

Order after c135: `__joybus_init`, `__rompak_init`, `__n64sys_hwmemset_emucheck`, … Patching ctor table to skip each suspect, one variant per ROM.

![screenshot 35](prompt-assets/035.webp)

![screenshot 36](prompt-assets/036.webp)

![screenshot 37](prompt-assets/037.webp)

Both `__rompak_init` and `__n64sys_hwmemset_emucheck` hang on these cores. Checking what depends on them.

Hypothesis: my IPL3's PI DMA leaves PI interrupt pending → interrupt storm once libdragon enables interrupts. Clearing PI interrupt in IPL3.

![screenshot 38](prompt-assets/038.webp)

![screenshot 39](prompt-assets/039.webp)

Bare-metal path chosen. Pulling RDP bitfield constants (other modes, combiner) from libdragon headers to get commands right.

Have constants. Checking PS1 demo's font/source to reuse for bare-metal HUD.

Toolchain has o32 libgcc; bare-metal plan set. Grabbing ship-physics and door constants from browser version before writing the C engine.

Got constants (THRUST 72, DRAG 2.4, doors open once and stay). Writing bare-metal engine now: hardware layer first.

Writing RDP command module (raw DP commands from CPU, triangle setup ported from libdragon's public-domain `rdpq_tri.c`).

Writing level loader (parses exporter's binary from ROM).

Writing procedural textures (32x32 RGBA16, in TMEM-sized chunks).

Writing renderer: portal-culled cell traversal, CPU transform + clipping, fog/headlight vertex lighting, sliding doors, meshes and glows.

Writing build files and a first fly-through main to validate rendering in emulator.

Compiled. Testing in emulator.

Page froze (likely emulator stuck inside RDP work). Building staged debug ROMs: CPU-only, RDP clear, full world.

In-app browser wedged; switching to Chrome for testing.

![screenshot 40](prompt-assets/040.webp)

![screenshot 41](prompt-assets/041.webp)

Old hung tab holds the origin's IndexedDB lock. Using `127.0.0.1` (separate origin).

Found it: IPL3 DMAs the image to RDRAM 0x0 but my program is linked at 0x80000400 (libdragon's flat images happened to start at 0x80000000). Fixing IPL3 destination.

![screenshot 42](prompt-assets/042.webp)

![screenshot 43](prompt-assets/043.webp)

Stage 0 runs: 59 fps, level loaded, player in HANGAR. Trying RDP clear (s1) then world (s2).

![screenshot 44](prompt-assets/044.webp)

RDP wait never completes (black, CPU stuck in idle-wait). Probably emulator leaves busy bits set; waiting only on `DPC_CURRENT == DPC_END`, and adding DPC status to debug overlay.

![screenshot 45](prompt-assets/045.webp)

Possibly EmulatorJS's ROM cache serving old builds with same name/size. Disabling its databases in test page.

![screenshot 46](prompt-assets/046.webp)

![screenshot 47](prompt-assets/047.webp)

Hypothesis: RDP runs deferred (after my CPU text), so its clear wipes the text. Testing with a red RDP rectangle.

![screenshot 48](prompt-assets/048.webp)

![screenshot 49](prompt-assets/049.webp)

![screenshot 50](prompt-assets/050.webp)

Now adding RDP text functions to the renderer.

![screenshot 51](prompt-assets/051.webp)

Crash handler works: TLB-load miss at EPC 0x800079A4, bad addr 0x40783E16. Locating.

Stack smash: `clip_poly` writes up to 9 clipped vertices back into the caller's 3–4 element array. Fixing with local buffers.

![screenshot 52](prompt-assets/052.webp)

**Rendering works**: textured, lit Hangar with sliding door, 29 fps, ~83 triangles. Now finding EmulatorJS's N64 input ids to drive the ship.

Got EmulatorJS N64 ids (0 A, 1 B, 3 Start, 10 L, 11 R, 12 Z, 16–19 stick, 20–23 C). Flying forward to check performance deeper in level.

![screenshot 53](prompt-assets/053.webp)

Writing small audio synth (AI DMA, polled; square/saw/noise voices with sweeps).

Now the main game logic.

Full game compiles cleanly. Testing title screen.

![screenshot 54](prompt-assets/054.webp)

Title renders, but HUD text ignores its colour (all white, no shadow) and glyphs show stray marks. Zooming in to inspect.

![screenshot 55](prompt-assets/055.webp)

![screenshot 56](prompt-assets/056.webp)

![screenshot 57](prompt-assets/057.webp)

![screenshot 58](prompt-assets/058.webp)

Emulator stalls at frame 20 deterministically. Suspect new audio path; testing build without audio.

![screenshot 59](prompt-assets/059.webp)

Audio was stalling the emulator (frames advance without it). Screen still static though; adding a debug heartbeat to the title.

![screenshot 60](prompt-assets/060.webp)

![screenshot 61](prompt-assets/061.webp)

Game loop is alive (30 fps, ~95 tris). Remaining bug: prim colour seemingly ignored (text all white, tint gray). Isolating with a pure-red tint test.

![screenshot 62](prompt-assets/062.webp)

![screenshot 63](prompt-assets/063.webp)

![screenshot 64](prompt-assets/064.webp)

![screenshot 65](prompt-assets/065.webp)

Text/tints now render but vertex (shade) colour seems ignored everywhere — likely walls too. Building a direct RGB-shaded triangle test.

![screenshot 66](prompt-assets/066.webp)

![screenshot 67](prompt-assets/067.webp)

No more crash. World renders behind title. But my RGB test triangle shows flat dark gray → shade interpolation is broken. Zooming in.

![screenshot 68](prompt-assets/068.webp)

Walls (shade+tex+z) shade correctly; only my z-less triangles lose shade. Trying HUD triangles with a (ignored) Z block too.

![screenshot 69](prompt-assets/069.webp)

![screenshot 70](prompt-assets/070.webp)

![screenshot 71](prompt-assets/071.webp)

![screenshot 72](prompt-assets/072.webp)

Fill mode is correct; every 1-cycle combiner output is the same dark gray, even prim colour. Inspecting the actual RDP command words in emulator RDRAM to verify my encoding.

Command encoding checks out in RDRAM. Dumping one HUD triangle's full packet to check shade values.

Packet data is correct (shade ints e.g. 122/176/204 present). Only difference from working walls: perspective bit. Testing with `SOM_PERSP` enabled for 2D/untextured modes.

![screenshot 73](prompt-assets/073.webp)

Commands encode correctly, yet colour inputs appear ignored. Testing whether wall shading actually applies (forcing wall vertex colour red).

![screenshot 74](prompt-assets/074.webp)

![screenshot 75](prompt-assets/075.webp)

Plugin option has no visible effect → probably the core picked its renderer before EmulatorJS applied my options. Trying a core restart after options are set.

![screenshot 76](prompt-assets/076.webp)

Restart didn't change it. Decisive test: draw walls with the SHADE-only combiner. Textured result ⇒ Set Combine ignored; solid red ⇒ my TEX×SHADE constant is wrong.

![screenshot 77](prompt-assets/077.webp)

Set Combine is ignored entirely → not Angrylion; the core is still on its default HLE plugin. Looking at how EmulatorJS writes core options before boot.

No core-options file is written before boot. Checking how EmulatorJS fills `defaultCoreOpts` (the pre-boot option file).

![screenshot 78](prompt-assets/078.webp)

![screenshot 79](prompt-assets/079.webp)

![screenshot 80](prompt-assets/080.webp)

![screenshot 81](prompt-assets/081.webp)

mupen64plus_next hangs on my game ROM. Back to parallel_n64: checking which renderer is truly active via its output size and core log.

Strong clue: my CPU-drawn text earlier vanished even after the RDP finished — that's how an HLE (Glide64) renderer behaves, not Angrylion. Verifying with Angrylion's unique "Depth" VI overlay.

![screenshot 82](prompt-assets/082.webp)

Confirmed: no Angrylion depth overlay → parallel_n64 silently uses Glide64 HLE. Trying mupen64plus_next with Angrylion + cxd4 written pre-boot (its earlier hangs were under default GLideN64).

mupen64plus_next still freezes the page. Measuring it on the trivial bare-metal ROM (bm2) with Angrylion to see if it's speed or a crash.

![screenshot 83](prompt-assets/083.webp)

bm2 runs fine on mupen64plus_next + Angrylion. Bisecting what in my game hangs it with staged ROMs.

![screenshot 84](prompt-assets/084.webp)

Page alive now (frame 2, slow start). Waiting.

![screenshot 85](prompt-assets/085.webp)

![screenshot 86](prompt-assets/086.webp)

Title now looks right and runs ~30 fps. Starting a mission to test gameplay.

![screenshot 87](prompt-assets/087.webp)

In-game HUD works. Two problems: door halves show black wedges, and gameplay runs ~12 fps (83 ms) with only 83 triangles → CPU-bound. Adding a per-phase profiler to the debug HUD.

![screenshot 88](prompt-assets/088.webp)

![screenshot 89](prompt-assets/089.webp)

![screenshot 90](prompt-assets/090.webp)

Flat-bottom fix works (all test quads full). Now: CPU trims (fixed-point conversion, fewer fan walls, idle robots skip physics, cached pickup cells), then re-enable audio on mupen.

![screenshot 91](prompt-assets/091.webp)

![screenshot 92](prompt-assets/092.webp)

Not a hard stall: with audio active the emulator is paced by the suspended AudioContext (~7 fps). A real click is a user gesture that should resume it — clicking the game canvas.

Click resumed audio and emulation runs full speed. Final page will use EmulatorJS's click-to-start button for that gesture. Now playing: launch, fly into the Hangar door.

![screenshot 93](prompt-assets/093.webp)

Gameplay works: flew through the door and tunnel into the Junction, took fire (shield 76). Testing turning, firing and robot rendering.

![screenshot 94](prompt-assets/094.webp)

Back at title (my scripted Start/Z presses hit Pause→Abandon). Before more play-testing, listing mupen's Angrylion options to finalize the player page.

Now writing the real player page (`index.html`): mupen64plus_next/GLideN64, pre-boot options, keyboard + gamepad mapping, click-to-start for audio.

![screenshot 95](prompt-assets/095.webp)

![screenshot 96](prompt-assets/096.webp)

Player page loads with Start Game button. Clicking it and checking boot.

![screenshot 97](prompt-assets/097.webp)

Title runs at 60 fps on the real page. Testing real keyboard input: Enter → briefing → launch, then fly.

![screenshot 98](prompt-assets/098.webp)

Keyboard works and gameplay runs ~60 fps here (draw 14 ms). Flying through to the Junction to see robots and combat.

![screenshot 99](prompt-assets/099.webp)

In the Junction, getting shot. Backing up and turning to find the drones.

![screenshot 100](prompt-assets/100.webp)

Dropped back to the title unexpectedly. Checking whether the game is frozen (crash) or genuinely on the title.

![screenshot 101](prompt-assets/101.webp)

Title is live, so the game really left the mission. I'll show raw pad bits in the debug HUD to verify how EmulatorJS ids map to N64 buttons.

Built. Re-testing on the page with pad bits visible.

![screenshot 102](prompt-assets/102.webp)

id 1 maps to N64 B correctly (we reversed into the exit door: "EXIT SEALED" works, shield pickup visible). Reproducing the earlier sequence step by step: stick-left next.

![screenshot 103](prompt-assets/103.webp)

No issue from stick input. Re-running the exact earlier route (into the Junction under fire) and watching frame by frame.

Old tab group is gone (hung tabs closed). Continuing in a fresh tab.

![screenshot 104](prompt-assets/104.webp)

Chrome tab group keeps vanishing (you may be using Chrome). Switching testing to the in-app browser.

![screenshot 105](prompt-assets/105.webp)

![screenshot 106](prompt-assets/106.webp)

Running in the in-app browser. Replaying the Junction route with snapshots.

![screenshot 107](prompt-assets/107.webp)

![screenshot 108](prompt-assets/108.webp)

![screenshot 109](prompt-assets/109.webp)

Still playing (backed through the Hangar tunnel; orange bolt glows visible). Watching a few more seconds to catch the title regression.

![screenshot 110](prompt-assets/110.webp)

![screenshot 111](prompt-assets/111.webp)

![screenshot 112](prompt-assets/112.webp)

![screenshot 113](prompt-assets/113.webp)

![screenshot 114](prompt-assets/114.webp)

![screenshot 115](prompt-assets/115.webp)

Lasers fire (blue glows), but shield drains ~18/s with no robot in view — suspicious. Adding debug counters (awake robots with line of sight, live enemy shots, last damage source).

![screenshot 116](prompt-assets/116.webp)

![screenshot 117](prompt-assets/117.webp)

![screenshot 118](prompt-assets/118.webp)

![screenshot 119](prompt-assets/119.webp)

![screenshot 120](prompt-assets/120.webp)

![screenshot 121](prompt-assets/121.webp)

![screenshot 122](prompt-assets/122.webp)

![screenshot 123](prompt-assets/123.webp)

Pacing is now real-time (~60 VI/s), but title dropped to 30 fps since audio mixing costs CPU. Optimizing: silent buffers skip mixing entirely.

![screenshot 124](prompt-assets/124.webp)

Now real-time and 30 fps in play; turned 180° back toward the Hangar (green exit door visible). Turning back and pushing into the Junction while firing.

![screenshot 125](prompt-assets/125.webp)

![screenshot 126](prompt-assets/126.webp)

![screenshot 127](prompt-assets/127.webp)

Let me look around the Junction for the drones at full resolution.

![screenshot 128](prompt-assets/128.webp)

![screenshot 129](prompt-assets/129.webp)

![screenshot 130](prompt-assets/130.webp)

![screenshot 131](prompt-assets/131.webp)

Clock is now real-time (8.1 s game vs 8.0 s real) and the Hangar runs 60 fps. Using the debug warp (L + D-down) to test key → reactor → escape.

![screenshot 132](prompt-assets/132.webp)

Red key acquired in the lava cavern (HUD shows R). Warping to the reactor and firing.

![screenshot 133](prompt-assets/133.webp)

![screenshot 134](prompt-assets/134.webp)

Died in the lava cavern (leeches and drones visible in the death view — robots render). For flow testing I'll make the debug warp also enable invulnerability.

![screenshot 135](prompt-assets/135.webp)

In the Reactor Core (objective updated after red key). Turning to face the reactor and firing.

![screenshot 136](prompt-assets/136.webp)

Easier: make the reactor warp face the reactor. Patching the debug warp.

![screenshot 137](prompt-assets/137.webp)

![screenshot 138](prompt-assets/138.webp)

Reactor visible (its cage hides the core; I'll make the cage translucent). Continuing to fire.

![screenshot 139](prompt-assets/139.webp)

Reactor destroyed, escape countdown running. Warping to the exit.

![screenshot 140](prompt-assets/140.webp)

Full mission loop verified: red key → red door/reactor → countdown → exit → "MINE CLEARED". Now checking the automap and the other two missions.

![screenshot 141](prompt-assets/141.webp)

![screenshot 142](prompt-assets/142.webp)

Mission 2 loads after the win. Found a bug: Automap and Pause open and close on the same button press (the entry frame re-reads the press). Fixing both with an entry guard.

![screenshot 143](prompt-assets/143.webp)

![screenshot 144](prompt-assets/144.webp)

Rebuilding with the slim image and a clean release build.

Release ROM built (4 MB, 85 KB program). Verifying mission 3 (Citadel) in the release build.

![screenshot 145](prompt-assets/145.webp)

![screenshot 146](prompt-assets/146.webp)

Mission 3 (Overseer Citadel) loads and plays in the release ROM. Checking how landing-page screenshots are produced in this repo.

I'll grab a landing-page screenshot from the emulator's own screenshot API. First framing a robot in view.

![screenshot 147](prompt-assets/147.webp)

Too punishing for keyboard play (dead in 14 s idle at the Citadel start). Easing robot damage and fire rates a bit; also adding a `-DGOD` build flag for capturing screenshots.

![screenshot 148](prompt-assets/148.webp)

Lava cavern looks over-saturated. Comparing against the browser version's look.

![screenshot 149](prompt-assets/149.webp)

Hangar matches the original's look; I'll tone the lava cavern down in the exporter (it was clipping to full orange).

![screenshot 150](prompt-assets/150.webp)

Darker, textured cavern now; drones visible below. Framing the shot.

![screenshot 151](prompt-assets/151.webp)

Capturing this frame via the emulator's screenshot API and converting to 640×480 WebP.

Emulator screenshot comes back blank (WebGL buffer cleared). Trying a direct `readPixels` from the WebGL canvas inside an animation frame.

WebGL readback isn't possible here; I'll use the browser capture instead and convert it to WebP in Docker. Moving the mouse off the emulator so its menu bar hides.

![screenshot 152](prompt-assets/152.webp)

![screenshot 153](prompt-assets/153.webp)

![screenshot 154](prompt-assets/154.webp)

I'll use the previous Upper Hall frame (ceiling light panel, brute at right). Converting it to WebP in Docker.

Screenshot saved. Building the final release ROM (no god/warp/debug).

Writing the README.

Final check of the release ROM on the player page.

![screenshot 155](prompt-assets/155.webp)

Release ROM boots and plays. Stopping the extra test server (the regular `hexahedron-n64` server on 8819 stays up).

I've built **Hexahedron 64** in [games/hexahedron-n64-opus-5.5/](games/hexahedron-n64-opus-5.5/index.html). It's a 4 MB ROM that runs in the browser through EmulatorJS's mupen64plus-next core, and everything was built in Docker (images for Node, Debian and libdragon's toolchain).

**What's in it**
- **Maps:** all three missions (Prospect Station, Hexahedron Deep Works, Overseer Citadel). A script runs the browser game's `level.js` in Docker and exports them, so the cube layout, doors and lighting are the same as the original.
- **Enemies:** drones, leeches and brutes. The browser version's other robot types are mapped onto these three.
- **Weapons:** twin laser, spreadfire and homing missiles.
- **Gameplay:** blue, yellow and red key doors, the reactor (or the Overseer's core) with a 50-second escape countdown, lava damage, shield pickups and an automap.
- **Menus and sound:** a title screen with mission select, a briefing, pause, game-over and win screens, and simple sound effects.
- **Controls:** keyboard (arrows to look, WASD/R/F to move, Space to fire, X for missiles, M for the map) or a gamepad.

**How it runs**
- libdragon didn't work in these emulators. Its boot code crashes both N64 cores in EmulatorJS, and even with my own boot code its startup hangs. So the game is plain C with no SDK: it drives the hardware directly, as the PS1 demo did. I adapted the triangle setup code from libdragon, which is public domain.
- The two N64 cores render very differently. parallel_n64 ignores the setting for its accurate renderer and draws everything without colour or lighting. mupen64plus-next draws it correctly, so the page uses that core and writes its settings before it boots.
- I worked around several emulator problems:
  - triangles with a flat bottom edge weren't drawn;
  - the game clock ran about twice as fast;
  - the emulator ran too fast until sound was playing;
  - a setting I had wrong froze the whole browser tab.
- The README explains each of these.

**What I tested in the browser**
- On one mission, using a debug-only teleport: red key, through the reactor door, reactor destroyed, countdown, reaching the exit and the "Mine Cleared" screen.
- Game over and retry, the automap, pause, and that missions 2 and 3 load and play.
- Speed: about 60 fps in small rooms and about 20 fps in the lava cavern.

**Not done or not checked**
- I didn't play missions 2 or 3 to the end.
- Difficulty: I lowered robot damage and fire rate because an idle ship died within seconds. Nobody has played it with a real keyboard yet.
- Nothing is committed, and there's no `prompt.md` yet. The landing-page card in `demos.js` and the screenshot are added; the card's "prompt" link won't work until `prompt.md` exists.

It's running at http://localhost:8819. Click **Start Game** first, because the browser blocks sound until you click.

```bash
open http://localhost:8819
```

## You

Write prompt.md
