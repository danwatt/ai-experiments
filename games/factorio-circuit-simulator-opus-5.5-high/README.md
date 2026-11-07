# Circuit Network Simulator

A browser sandbox for learning how Factorio's circuit network behaves. The node editor is built on [Rete.js](https://retejs.org) v2 with its React renderer.

## What's simulated

- **Combinators:** constant, arithmetic (all 11 operators, Each, per-operand red/green selection), decider (multiple conditions with AND/OR where AND binds first; Everything, Anything and Each; several outputs, each a constant or an input count), and selector (select input, count inputs, random input, stack size).
- **Red and green wires.** Wires are undirected. Every connected group of one colour is a network whose value is the int32 sum of everything put on it. A combinator reads red + green summed and writes its result one tick later.
- **Buildings:** lamp (circuit condition, colour mode), signal display (a probe), storage chest, assembling machine (enable condition, read contents, consumption), push button (one-tick pulse or toggle), and a small electric grid: solar panel with a day/night cycle, steam generator, accumulator (charge % as a signal) and factory load.
- **Nine guided examples:** lamp, red vs green, arithmetic and Each, decider filtering, clock, memory cell and counter, selector, stock control with hysteresis, and backup power with an SR latch.

Not modelled: quality, rocket capacity, multiple constant-combinator sections, trains, and the many other entities with circuit connections.

Building connection points are single points: the left and right sockets of a building are the same point, which lets you daisy-chain wires. Rete connections are directed, so a wire is always dragged from a right-hand socket to a left-hand socket. The simulator ignores the direction when it builds networks.

## Files

| Path | What |
| --- | --- |
| `src/sim.js`, `src/signals.js` | Simulation engine and signal catalogue. Pure JS with no DOM, so they can be unit tested in Node. |
| `src/editor.js` | Rete editor setup, node/wire/socket views, wiring rules, save/load. |
| `src/ui/` | Node settings editors, live read-outs, and help text. |
| `src/main.js`, `src/examples.js` | App shell (toolbar, palette, side panel, run loop, autosave) and example circuits. |
| `vendor/rete-bundle.js` | Rete 2, its area/connection/React plugins, React 18 and htm, bundled with esbuild. |
| `vendor-src/` | `package.json` and entry file for that bundle, plus `build.sh`. |

## Running

Serve the directory with any static file server, for example `python3 -m http.server -d games/factorio-circuit-simulator-opus-5.5-high 8823`. There's no build step for the app itself.

Rebuild the vendored libraries (runs in Docker, installs nothing on the host):

```bash
vendor-src/build.sh
```

Run the simulator unit tests (Node in Docker):

```bash
./run-tests.sh
```
