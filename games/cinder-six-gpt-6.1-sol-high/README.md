# Cinder Six

A standalone, six-degree-of-freedom mine shooter made with Three.js. Built from scratch for this demo, independently of other games in this repository.

## Play

Requires Node.js 18+ and a desktop browser with WebGL2.

```sh
cd games/cinder-six-gpt-6.1-sol-high
npm start
```

Open **http://127.0.0.1:8086** and select **Enter the mine**. No dependency installation or build is needed to play. Alternatively, serve this directory with any static HTTP server. ES modules require HTTP; double-clicking `index.html` is insufficient.

## Mission

Find the red key above the lava in the Smelter Vault. Visit Munitions Bay for the plasma lance. Ascend the vertical shaft, pass through Security Control, and unlock the red reactor bulkhead. Shoot the reactor, then follow the green beacons through Exhaust Gallery to Extraction Gate before the 100-second meltdown expires.

- **14 named rooms**, 408 cubic segments, two elevations, a vertical shaft, branches, and a loop. Five bulkheads include the red key lock. Designed for a several-minute first playthrough.
- **Full six-axis flight:** local pitch, yaw, roll, forward/back, strafe, and vertical thrust. Inertial damping and an afterburner with rechargeable fuel.
- **Three robot classes:** fast pursuing Scouts, strafing burst-fire Sentries, and armored Brutes with heavy projectiles. 21 enemies total.
- **A lava floor** damages the ship on contact; flying above it is safe.
- **Two weapons:** the default pulse cannon and a collectible plasma lance. Both have unlimited ammunition.
- **Exploration automap:** visited and visible-but-unvisited cubes have different colors. Camera-frustum rays stop at walls and sealed doors. No unseen level silhouette is exposed. Drag to orbit and scroll to zoom. The simulation pauses while mapping.
- Health pickups, generated sound effects, target readouts, death/restart, win statistics, and a reactor evacuation sequence.

## Controls

| Input | Action |
|---|---|
| Mouse | Pitch / yaw |
| W / S | Forward / reverse |
| A / D | Strafe |
| Space / C | Local up / down |
| Q / E | Roll |
| Shift | Afterburner |
| Left click / X | Fire |
| F | Open a nearby door |
| 1 / 2 | Pulse cannon / plasma lance |
| Tab / M | Automap |
| Escape | Pause and release mouse |
| Arrow keys | Alternative pitch / yaw |

Normal doors can also be shot open. Fly through pickups to collect them. Sensitivity and inverted vertical look are available in the flight manual. Click Resume Flight to regain mouse control after pausing. The header audio button toggles sound.

## Implementation

`level.js` authors rooms and links, then produces a grid of traversable cube cells. Shared cube faces are removed when producing the textured hull. Static metalwork is batched by material. Collision uses substepped ship movement against that grid. Doors block a corridor cell until their opening animation completes. The same grid traversal governs line of sight, weapon impacts, and map visibility, keeping discovery consistent with sealed doors.

`main.js` contains rendering, flight, combat, mission logic, audio, and the orbitable automap. `style.css` supplies the launch screen and HUD. Textures and models are generated locally. Three.js r180 is vendored under `vendor/`, with its MIT license. Optional Google Fonts fall back to local system fonts if offline. No external game assets or game code are used.

The geometry uses regular cubic segments rather than arbitrary deformed hexahedra. This demo has one authored level; it does not include an editor, multiplayer, or persistence. Desktop keyboard and mouse are required.

## Verification

With the server running:

```sh
npm install
npx playwright install chromium
npm test
```

The browser smoke check verifies room connectivity, the red lock and map occlusion, key/weapon collection, lava damage and safe altitude, enemy destruction, reactor destruction, extraction, hull collision, actual keyboard movement, and automap interaction. It also checks for browser errors and captures screenshots under `/tmp`. `GAME_URL`, `CHROME_EXECUTABLE`, and `PLAYWRIGHT_MODULE_PATH` can override the test defaults.

The inspection interface used by these checks exists only when launched with `?test`.
