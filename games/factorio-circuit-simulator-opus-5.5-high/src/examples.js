// Example circuits, each with a short lesson. Same format as Export/Import.

const B = { red: true, green: true };
const R = { red: true, green: false };
const G = { red: false, green: true };
const cond = (first, cmp, value, extra = {}) => ({ first, cmp, second: { kind: 'const', value }, firstNets: { ...B }, secondNets: { ...B }, ...extra });
const sig = (id, value) => ({ id, value });
const n = (id, kind, x, y, config = {}, label) => ({ id, kind, x, y, config, label });
const w = (from, to, color = 'red') => ({ from, to, color });

export const WELCOME = {
  title: 'Welcome',
  html: `<p>This is a sandbox for learning how the circuit network in Factorio works. Each box is a <b>combinator</b> or a stand-in <b>building</b>. Wires carry <b>signals</b>: a name (an item, letter or colour) with a whole number.</p>
  <h4>The rules</h4>
  <ul>
    <li><b>Wiring:</b> drag from a socket on the right side of a box to a socket on the left side of the same colour. Click a wire to cut it.</li>
    <li>Everything joined by wires of one colour is a single <b>network</b> (labelled R1, G2, …). Every value put on a network is <b>added up</b>, and everyone on it sees the total.</li>
    <li>Red and green networks never mix on the wire. A combinator <b>adds red and green together</b> when it reads its input, unless you tell it to read only one colour.</li>
    <li>Combinators have separate <b>input</b> and <b>output</b> points. Their result shows up <b>one tick</b> (1/60 s) after the input changes.</li>
    <li>Buildings have <b>one</b> point. They read and write the same network.</li>
    <li>Numbers are 32-bit signed integers. A signal with value 0 doesn't exist.</li>
  </ul>
  <h4>Getting around</h4>
  <ul>
    <li>Add parts from the left panel. Drag empty space to pan, scroll to zoom.</li>
    <li>Select a box to see its full explanation and live values in <b>Inspect</b>. <b>Networks</b> lists every network.</li>
    <li>Pause and use <b>Step</b> to watch signals move one tick at a time.</li>
    <li>Your work autosaves in this browser. Use Export/Import to keep copies.</li>
  </ul>
  <p>Start with an example from the <b>Examples</b> menu.</p>`,
};

export const EXAMPLES = [
  {
    key: 'lamp',
    title: '1 · Lamp on a chest',
    html: `<p>A chest with <b>read contents</b> puts its inventory on the red wire. The lamp lights while <i>Iron plate &gt; 100</i>.</p>
      <p>The display is wired <b>through</b> the lamp: buildings have a single connection point, so the chest, lamp and display are all one network (R1).</p>
      <h4>Try</h4><ul><li>Change the chest's iron to 80.</li><li>Change the lamp condition to <i>Anything &gt; 200</i>.</li><li>Cut the wire to the lamp: an unconnected lamp is always on.</li></ul>`,
    data: {
      nodes: [
        n('c', 'chest', 0, 0, { items: [sig('iron-plate', 150), sig('coal', 30)] }),
        n('l', 'lamp', 360, 0, { condition: cond('iron-plate', '>', 100) }),
        n('d', 'display', 720, 0),
      ],
      wires: [w('c', 'l'), w('l', 'd')],
    },
  },
  {
    key: 'colors',
    title: '2 · Red, green and summing',
    html: `<p>Two constant combinators: one on a <b>red</b> wire (10 iron), one on a <b>green</b> wire (5 iron). The display shows the two networks separately.</p>
      <p>Arithmetic combinator 1 reads <b>both</b> colours, so it sees 15. Arithmetic combinator 2 has only its <b>R</b> checkbox ticked, so it sees 10.</p>
      <h4>Try</h4><ul><li>Tick and untick the R/G checkboxes on the arithmetic combinators.</li><li>Add a second red constant combinator into the same red network: the values add up.</li></ul>`,
    data: {
      nodes: [
        n('kr', 'constant', 0, 0, { signals: [sig('iron-plate', 10)] }, 'Red source'),
        n('kg', 'constant', 0, 299, { signals: [sig('iron-plate', 5)] }, 'Green source'),
        n('d', 'display', 360, -40),
        n('a1', 'arithmetic', 360, 318, { left: { kind: 'signal', id: 'iron-plate' }, op: '+', right: { kind: 'const', value: 0 }, output: 'iron-plate' }, 'Both colours'),
        n('a2', 'arithmetic', 360, 732, { left: { kind: 'signal', id: 'iron-plate' }, leftNets: R, op: '+', right: { kind: 'const', value: 0 }, output: 'iron-plate' }, 'Red only'),
        n('d1', 'display', 760, 318),
        n('d2', 'display', 760, 732),
      ],
      wires: [w('kr', 'd'), w('kg', 'd', 'green'), w('kr', 'a1'), w('kg', 'a1', 'green'), w('kr', 'a2'), w('kg', 'a2', 'green'), w('a1', 'd1'), w('a2', 'd2')],
    },
  },
  {
    key: 'arith',
    title: '3 · Arithmetic and Each',
    html: `<p>The constant combinator sends A = 6 and B = 7. The first arithmetic combinator computes <i>A × B → C</i>. Its output is a <b>separate network</b>: the display after it only shows C.</p>
      <p>The second uses <b>Each</b>: every input signal is multiplied by 10 separately.</p>
      <h4>Try</h4><ul><li>Pause, change A, then press Step and watch the result appear one tick later.</li><li>Set the second combinator's output to a single signal (e.g. T): you get the <i>sum</i> of all results.</li><li>Try 2147483647 + 1. Integers wrap around.</li></ul>`,
    data: {
      nodes: [
        n('k', 'constant', 0, 100, { signals: [sig('signal-A', 6), sig('signal-B', 7)] }),
        n('a1', 'arithmetic', 360, 0, { left: { kind: 'signal', id: 'signal-A' }, op: '*', right: { kind: 'signal', id: 'signal-B' }, output: 'signal-C' }),
        n('a2', 'arithmetic', 360, 414, { left: { kind: 'signal', id: 'signal-each' }, op: '*', right: { kind: 'const', value: 10 }, output: 'signal-each' }),
        n('d1', 'display', 760, 0),
        n('d2', 'display', 760, 414),
      ],
      wires: [w('k', 'a1'), w('k', 'a2', 'green'), w('a1', 'd1'), w('a2', 'd2', 'green')],
    },
  },
  {
    key: 'filter',
    title: '4 · Decider: filtering with Each',
    html: `<p>Decider 1: <i>Each &gt; 50 → Each (input count)</i> passes through only the signals above 50.</p>
      <p>Decider 2: <i>Each &gt; 50 → N = 1</i> outputs how <b>many</b> signals passed.</p>
      <p>Decider 3: <i>Anything &lt; 10 → Everything</i>: while any signal is below 10, copy the whole input.</p>
      <h4>Try</h4><ul><li>Raise stone above 10 and watch Decider 3 go quiet.</li><li>Switch Decider 2's output to <i>Input count</i>: now N is the sum of the passing values.</li></ul>`,
    data: {
      nodes: [
        n('k', 'constant', 0, 300, { signals: [sig('iron-plate', 120), sig('copper-plate', 40), sig('coal', 300), sig('stone', 5), sig('iron-gear', 75)] }),
        n('d1', 'decider', 360, 0, { conditions: [cond('signal-each', '>', 50)], outputs: [{ signal: 'signal-each', mode: 'input', value: 1, nets: { ...B } }] }),
        n('d2', 'decider', 360, 528, { conditions: [cond('signal-each', '>', 50)], outputs: [{ signal: 'signal-N', mode: 'one', value: 1, nets: { ...B } }] }),
        n('d3', 'decider', 360, 1056, { conditions: [cond('signal-anything', '<', 10)], outputs: [{ signal: 'signal-everything', mode: 'input', value: 1, nets: { ...B } }] }),
        n('x1', 'display', 850, 0),
        n('x2', 'display', 850, 528),
        n('x3', 'display', 850, 1056),
      ],
      wires: [w('k', 'd1'), w('k', 'd2'), w('k', 'd3'), w('d1', 'x1'), w('d2', 'x2'), w('d3', 'x3')],
    },
  },
  {
    key: 'clock',
    title: '5 · Clock (a loop)',
    html: `<p>The classic timer. The constant combinator adds C = 1. The decider's <b>output is wired back to its own input</b>, so every tick it sees its previous output + 1. While <i>C &lt; 60</i> it passes C through; at 60 it outputs nothing and the count restarts. One cycle = 60 ticks = 1 second.</p>
      <p>Everything here is one red network, so the lamp and display see the count too.</p>
      <h4>Try</h4><ul><li>Change 60 to 120 for a two-second clock.</li><li>Make the lamp blink: on when <i>C &gt; 30</i>.</li><li>Pause and step through the wrap-around.</li></ul>`,
    data: {
      nodes: [
        n('k', 'constant', 0, 0, { signals: [sig('signal-C', 1)] }, 'Tick +1'),
        n('d', 'decider', 360, 0, { conditions: [cond('signal-C', '<', 60)], outputs: [{ signal: 'signal-C', mode: 'input', value: 1, nets: { ...B } }] }, 'Counter'),
        n('l', 'lamp', 850, -40, { condition: cond('signal-C', '>', 30) }),
        n('x', 'display', 850, 377),
      ],
      wires: [w('k', 'd'), w('d', 'd'), w('d', 'l'), w('d', 'x')],
    },
  },
  {
    key: 'memory',
    title: '6 · Memory cell and counter',
    html: `<p>A decider wired output → input <b>remembers</b> its value: <i>R = 0 → Everything (input count)</i> keeps copying whatever is on its input back onto it.</p>
      <p>Press <b>+1</b>: the button puts C = 1 on the wire for exactly one tick, and it is added to the stored value. Press <b>Reset</b>: R appears for one tick, the condition fails, the output drops to nothing and the memory is empty.</p>
      <h4>Try</h4><ul><li>Change the +1 button's value to 10 or −1.</li><li>Switch the +1 button to <i>Toggle</i>: the count runs up by 1 every tick while it's held on.</li></ul>`,
    data: {
      nodes: [
        n('inc', 'button', 0, -40, { signal: 'signal-C', value: 1, mode: 'pulse' }, '+1'),
        n('rst', 'button', 0, 361, { signal: 'signal-R', value: 1, mode: 'pulse' }, 'Reset'),
        n('m', 'decider', 340, 60, { conditions: [cond('signal-R', '=', 0)], outputs: [{ signal: 'signal-everything', mode: 'input', value: 1, nets: { ...B } }] }, 'Memory'),
        n('x', 'display', 830, -40),
        n('l', 'lamp', 830, 268, { condition: cond('signal-C', '>=', 5) }),
      ],
      wires: [w('inc', 'm'), w('rst', 'm'), w('m', 'm'), w('m', 'x'), w('m', 'l')],
    },
  },
  {
    key: 'selector',
    title: '7 · Selector combinator',
    html: `<p>Three selector combinators read the same chest.</p>
      <ul><li><b>Select input</b>, descending, index 0: the item there is most of.</li><li><b>Count inputs</b>: how many different items (N).</li><li><b>Stack size</b>: each item's stack size.</li></ul>
      <h4>Try</h4><ul><li>Set the index to 1 for the second-largest, or switch to ascending for the smallest.</li><li>Change one to <i>Random input</i>.</li></ul>`,
    data: {
      nodes: [
        n('c', 'chest', 0, 220, { items: [sig('iron-ore', 40), sig('copper-ore', 90), sig('coal', 70), sig('stone', 10)] }),
        n('s1', 'selector', 360, 0, { mode: 'select', descending: true, index: { kind: 'const', value: 0 } }),
        n('s2', 'selector', 360, 464, { mode: 'count', countSignal: 'signal-N' }),
        n('s3', 'selector', 360, 896, { mode: 'stack' }),
        n('x1', 'display', 730, 0),
        n('x2', 'display', 730, 464),
        n('x3', 'display', 730, 896),
      ],
      wires: [w('c', 's1'), w('c', 's2'), w('c', 's3'), w('s1', 'x1'), w('s2', 'x2'), w('s3', 'x3')],
    },
  },
  {
    key: 'stock',
    title: '8 · Keeping stock (with hysteresis)',
    html: `<p><b>Top:</b> an assembler reads its own stock and works while <i>gears &lt; 100</i>. It hovers right at 100, switching on and off almost every tick.</p>
      <p><b>Bottom:</b> an <b>SR latch</b> adds hysteresis: start below 50, keep going until 200. Decider: <i>gears &lt; 50 <b>OR</b> (S &gt; 0 <b>AND</b> gears &lt; 200) → S = 1</i>, with its output looped back on <b>green</b>.</p>
      <p>Why are the gear tests set to <b>R only</b>? The assembler has one point, so its stock is on its green wire as well. Reading both colours would count the gears twice.</p>
      <h4>Try</h4><ul><li>Set the gear tests back to R+G and see the band shift.</li><li>Change 50 and 200.</li></ul>`,
    data: {
      nodes: [
        n('a1', 'assembler', 0, -60, { recipe: 'iron-gear', craftSeconds: 0.25, demandPerSecond: 1.5, condition: cond('iron-gear', '<', 100) }, 'Simple'),
        n('x1', 'display', 370, -60),
        n('a2', 'assembler', 0, 508, { recipe: 'iron-gear', craftSeconds: 0.25, demandPerSecond: 1.5, condition: cond('signal-S', '>', 0) }, 'Latched'),
        n('l', 'decider', 370, 508, {
          conditions: [
            cond('iron-gear', '<', 50, { firstNets: { ...R } }),
            cond('signal-S', '>', 0, { join: 'or' }),
            cond('iron-gear', '<', 200, { join: 'and', firstNets: { ...R } }),
          ],
          outputs: [{ signal: 'signal-S', mode: 'one', value: 1, nets: { ...B } }],
        }, 'SR latch'),
        n('x2', 'display', 860, 508),
      ],
      wires: [w('a1', 'x1'), w('a2', 'l'), w('l', 'l', 'green'), w('l', 'a2', 'green'), w('a2', 'x2')],
    },
  },
  {
    key: 'power',
    title: '9 · Backup power (SR latch)',
    html: `<p>Solar panels can't cover the factory at night. The accumulator reports its charge as A (percent) on the red wire.</p>
      <p>The latch: <i>A &lt; 20 <b>OR</b> (S &gt; 0 <b>AND</b> A &lt; 90) → S = 1</i>, output looped back to its input on green. The generator runs while S &gt; 0. It starts at 20% and keeps running until 90%, instead of flickering around one threshold.</p>
      <h4>Try</h4><ul><li>Speed up the simulation to 4× or 16×.</li><li>Delete the OR row and the AND row (leave <i>A &lt; 20</i>): watch the generator stutter at 20%.</li><li>Raise the factory load.</li></ul>`,
    data: {
      nodes: [
        n('sol', 'solar', 0, -120, { peakKW: 300, daySeconds: 40 }),
        n('load', 'load', 0, 139, { demandKW: 220 }),
        n('acc', 'accumulator', 0, 487, { capacityKJ: 6000, maxKW: 800, startPercent: 60 }),
        n('l', 'decider', 360, 300, {
          conditions: [
            cond('signal-A', '<', 20),
            cond('signal-S', '>', 0, { join: 'or' }),
            cond('signal-A', '<', 90, { join: 'and' }),
          ],
          outputs: [{ signal: 'signal-S', mode: 'one', value: 1, nets: { ...B } }],
        }, 'SR latch'),
        n('gen', 'generator', 850, 220, { outputKW: 450, condition: cond('signal-S', '>', 0) }),
        n('lamp', 'lamp', 850, 638, { condition: cond('signal-S', '>', 0) }, 'Backup on'),
      ],
      wires: [w('acc', 'l'), w('l', 'l', 'green'), w('l', 'gen', 'green'), w('gen', 'lamp', 'green')],
    },
  },
];
