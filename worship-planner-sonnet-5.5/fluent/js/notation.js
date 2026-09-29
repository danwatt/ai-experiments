'use strict';
/* ---------------------------------------------------------------------
   Procedural "sheet music" slide renderer.
   Real slides would be images from the slide database; this generates
   believable four-part hymn layouts (grand staff, key signature, lyrics)
   so the mockup can show what a hymn slide looks like.
---------------------------------------------------------------------- */
const Notation = (() => {
  const W = 1280, H = 720;

  function rng(seed) {
    let s = 2166136261;
    for (const c of seed) s = Math.imul(s ^ c.charCodeAt(0), 16777619) >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  const beatsOf = t => {
    const [n, d] = t.split('/').map(Number);
    if (d === 8) return n / 3;
    if (d === 2) return n * 2;
    return n;
  };
  const PATTERNS = {
    2: [[1, 1], [1, 1], [2]],
    3: [[1, 1, 1], [1, 1, 1], [2, 1], [1, 2]],
    4: [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [2, 2], [3, 1]]
  };
  const SHARPS_T = [38, 35, 39, 36, 33, 37, 34], FLATS_T = [34, 37, 33, 36, 32, 35, 31];
  const SHARPS_B = [24, 21, 25, 22, 19, 23, 20], FLATS_B = [20, 23, 19, 22, 18, 21, 17];
  const CHORDS = [[0, 2, 4], [3, 5, 0], [4, 6, 1], [5, 0, 2]];   // I IV V vi (scale degrees, 0-based)

  /* Generate voices for `sys` systems. Returns [{measures:[{notes:[{dur,s,a,t,b}]}]}] */
  function compose(h, sys, refrain) {
    const r = rng(h.id + (refrain ? '~r' : ''));
    const beats = Math.max(2, Math.min(4, Math.round(beatsOf(h.time))));
    const tonicL = 'CDEFGAB'.indexOf(h.key[0]);
    let tonic = 28 + tonicL;
    if (Math.abs(tonic + 7 - 34) < Math.abs(tonic - 34)) tonic += 7;
    const lo = tonic - 2, hi = tonic + 4;
    let cur = Math.min(hi, Math.max(lo, tonic + (h.start || 1) - 1));
    const perSys = Math.min(7, Math.ceil(18 / beats));
    const systems = [];
    for (let si = 0; si < sys; si++) {
      const measures = [];
      for (let mi = 0; mi < perSys; mi++) {
        const last = si === sys - 1 && mi === perSys - 1;
        let pat = last ? [beats] : PATTERNS[beats][Math.floor(r() * PATTERNS[beats].length)];
        const notes = pat.map((dur, ni) => {
          if (last) cur = tonic;
          else if (!(si === 0 && mi === 0 && ni === 0)) {
            const step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)];
            cur += step;
            if (cur > hi) cur -= 2; if (cur < lo) cur += 2;
          }
          const deg = (((cur - tonic) % 7) + 7) % 7;
          const opts = CHORDS.filter(c => c.includes(deg));
          const chord = opts[Math.floor(r() * opts.length)];
          const below = (from, min) => { for (let i = from - 1; i >= from - 6; i--) if (chord.includes((((i - tonic) % 7) + 7) % 7) && i >= min) return i; return from - 2; };
          const a = below(cur, 29);
          let t = below(a, 18);
          while (t > 27) t -= 7;
          let b = tonic - 14 + chord[0];
          while (b > 25) b -= 7; while (b < 15) b += 7;
          if (t <= b) t = b + 2;
          return { dur, s: cur, a, t, b };
        });
        measures.push({ notes });
      }
      systems.push({ measures });
    }
    return { systems, beats };
  }

  /* --------------------------- SVG helpers --------------------------- */
  function drawNote(idx, x, baseIdx, botY, sp, dur, stemUp, out) {
    const y = botY - (idx - baseIdx) * sp / 2;
    // ledger lines
    if (idx <= baseIdx - 2) for (let k = baseIdx - 2; k >= idx; k -= 2) { const ly = botY - (k - baseIdx) * sp / 2; out.push(`<line x1="${x - 11}" x2="${x + 11}" y1="${ly}" y2="${ly}" class="st"/>`); }
    if (idx >= baseIdx + 10) for (let k = baseIdx + 10; k <= idx; k += 2) { const ly = botY - (k - baseIdx) * sp / 2; out.push(`<line x1="${x - 11}" x2="${x + 11}" y1="${ly}" y2="${ly}" class="st"/>`); }
    const hollow = dur >= 2;
    out.push(`<ellipse cx="${x}" cy="${y}" rx="${sp * .52}" ry="${sp * .38}" transform="rotate(-20 ${x} ${y})" class="${hollow ? 'nh' : 'nf'}"/>`);
    if (dur < 4) {
      const len = sp * 2.3;
      out.push(stemUp
        ? `<line x1="${x + sp * .5}" x2="${x + sp * .5}" y1="${y - 1}" y2="${y - len}" class="sm"/>`
        : `<line x1="${x - sp * .5}" x2="${x - sp * .5}" y1="${y + 1}" y2="${y + len}" class="sm"/>`);
    }
    if (dur === 3) {
      const onLine = (idx - baseIdx) % 2 === 0;
      out.push(`<circle cx="${x + sp * 1}" cy="${onLine ? y - sp / 2 : y}" r="1.9" class="nf"/>`);
    }
    return y;
  }

  function musicSVG(h, secIndex, opts = {}) {
    const [label, lines] = h.sec[secIndex];
    const refrain = /refrain/i.test(label);
    const nLines = lines ? lines.length : 4;
    const sys = Math.min(3, Math.max(1, Math.ceil(nLines / 2)));
    const { systems, beats } = compose(h, sys, refrain);
    const sp = sys === 3 ? 8.6 : sys === 2 ? 12.8 : 13.5;
    const stGap = sp * 8.6;
    const sysH = sp * 4 * 2 + stGap;
    const gap = sys === 3 ? 34 : 44;
    const top0 = sys === 1 ? 240 : sys === 2 ? 152 : 148;
    const sig = SIG[h.key] || 0, nSig = Math.abs(sig);
    const x0 = 96, x1 = 1196;
    const out = [];

    systems.forEach((S, si) => {
      const top = top0 + si * (sysH + gap);
      const tBot = top + sp * 4, bTop = tBot + stGap, bBot = bTop + sp * 4;
      const fs = sp * 1.5, lyricY = tBot + stGap / 2 + fs * 0.32;
      // staves
      for (let i = 0; i < 5; i++) {
        out.push(`<line x1="${x0}" x2="${x1}" y1="${tBot - i * sp}" y2="${tBot - i * sp}" class="st"/>`);
        out.push(`<line x1="${x0}" x2="${x1}" y1="${bBot - i * sp}" y2="${bBot - i * sp}" class="st"/>`);
      }
      out.push(`<line x1="${x0}" x2="${x0}" y1="${tBot - 4 * sp}" y2="${bBot}" class="sm"/>`);
      out.push(`<path d="M${x0 - 5} ${tBot - 4 * sp} q-13 ${(bBot - tBot + 4 * sp) / 2} 0 ${bBot - tBot + 4 * sp}" class="brace"/>`);
      // clefs
      out.push(`<text x="${x0 + 8}" y="${tBot - sp * .9}" class="clef" style="font-size:${sp * 6.6}px">\u{1D11E}</text>`);
      out.push(`<text x="${x0 + 8}" y="${bBot - sp * 3}" class="clef" style="font-size:${sp * 4.6}px">\u{1D122}</text>`);
      // key signature
      const ksT = sig > 0 ? SHARPS_T : FLATS_T, ksB = sig > 0 ? SHARPS_B : FLATS_B;
      for (let k = 0; k < nSig; k++) {
        const g = sig > 0 ? '♯' : '♭', kx = x0 + 52 + k * 10.5;
        out.push(`<text x="${kx}" y="${tBot - (ksT[k] - 30) * sp / 2 + (sig > 0 ? sp * .55 : sp * .35)}" class="acc" style="font-size:${sp * 2.1}px">${g}</text>`);
        out.push(`<text x="${kx}" y="${bBot - (ksB[k] - 18) * sp / 2 + (sig > 0 ? sp * .55 : sp * .35)}" class="acc" style="font-size:${sp * 2.1}px">${g}</text>`);
      }
      let px = x0 + 52 + nSig * 10.5 + 10;
      if (si === 0) {
        const [n, d] = h.time.split('/');
        out.push(`<text x="${px + 8}" y="${tBot - sp * 2}" class="ts" style="font-size:${sp * 2.6}px">${n}</text><text x="${px + 8}" y="${tBot}" class="ts" style="font-size:${sp * 2.6}px">${d}</text>`);
        out.push(`<text x="${px + 8}" y="${bBot - sp * 2}" class="ts" style="font-size:${sp * 2.6}px">${n}</text><text x="${px + 8}" y="${bBot}" class="ts" style="font-size:${sp * 2.6}px">${d}</text>`);
        px += 30;
      }
      // measures
      const weights = S.measures.map(m => m.notes.length + 1.4);
      const totalW = weights.reduce((a, b) => a + b, 0), avail = x1 - px - 8;
      let mx = px;
      const sopX = [];
      S.measures.forEach((m, mi) => {
        const mw = avail * weights[mi] / totalW;
        let pos = 0;
        m.notes.forEach(n => {
          const nx = mx + 16 + (mw - 30) * (pos / beats);
          const close = n.s - n.a <= 1;
          drawNote(n.s, nx + (close ? sp * .95 : 0), 30, tBot, sp, n.dur, true, out);
          drawNote(n.a, nx, 30, tBot, sp, n.dur, false, out);
          drawNote(n.t, nx, 18, bBot, sp, n.dur, true, out);
          drawNote(n.b, nx, 18, bBot, sp, n.dur, false, out);
          sopX.push(nx);
          pos += n.dur;
        });
        mx += mw;
        const endBar = mi === S.measures.length - 1;
        const final = endBar && si === systems.length - 1;
        out.push(`<line x1="${mx}" x2="${mx}" y1="${tBot - 4 * sp}" y2="${bBot}" class="${final ? 'st' : 'sm'}"/>`);
        if (final) out.push(`<line x1="${mx + 5}" x2="${mx + 5}" y1="${tBot - 4 * sp}" y2="${bBot}" class="bar-thick"/>`);
        else if (!endBar) { /* interior bar is drawn once */ }
      });
      // lyrics
      if (lines) {
        const words = (lines[si * 2] || '').split(/\s+/).concat((lines[si * 2 + 1] || '').split(/\s+/)).filter(Boolean);
        const N = sopX.length, Wd = words.length;
        if (Wd) {
          const slots = new Map(); let ni = 0, lastEnd = -1e9, lastIdx = -1;
          const wids = words.map(w => w.length * fs * 0.5);
          const xa = sopX[0] - 14, xb = sopX[N - 1] + 30;
          const gapX = Math.max(8, (xb - xa - wids.reduce((p, c) => p + c, 0)) / Wd);
          let cum = xa;
          words.forEach((w, k) => {
            const wid = wids[k], target = cum + gapX / 2 + wid / 2; cum += wid + gapX;
            let best = -1, bd = 1e9;
            for (let i = ni; i < N; i++) {
              if (sopX[i] - wid / 2 < lastEnd + 6) continue;
              const dd = Math.abs(sopX[i] - target); if (dd < bd) { bd = dd; best = i; }
            }
            if (best < 0) {
              if (lastIdx >= 0) { slots.set(lastIdx, slots.get(lastIdx) + ' ' + w); lastEnd = sopX[lastIdx] + slots.get(lastIdx).length * fs * 0.25; }
              return;
            }
            slots.set(best, w); lastIdx = best; ni = best + 1; lastEnd = sopX[best] + wid / 2;
          });
          slots.forEach((w, ni2) => out.push(`<text x="${sopX[ni2]}" y="${lyricY}" class="lyr" style="font-size:${fs}px">${esc(w)}</text>`));
        }
        if (si === 0) out.push(`<text x="${x0 + 56 + nSig * 10.5}" y="${lyricY}" class="vnum" style="font-size:${fs}px">${/^\d+$/.test(label) ? label + '.' : ''}</text>`);
      } else if (si === 0) {
        out.push(`<text x="${(x0 + x1) / 2}" y="${lyricY}" class="lyr lic" style="font-size:${sp * 1.2}px">Licensed lyrics appear on the purchased slide pack</text>`);
      }
      if (refrain && si === 0) out.push(`<text x="${x0}" y="${top - 14}" class="refl" style="font-size:22px">${esc(label)}</text>`);
    });
    return out.join('');
  }

  const STYLE = `
    .sl .st{stroke:#20242c;stroke-width:1.15}
    .sl .sm{stroke:#20242c;stroke-width:1.5}
    .sl .bar-thick{stroke:#20242c;stroke-width:5}
    .sl .nf{fill:#20242c}
    .sl .nh{fill:#fff;stroke:#20242c;stroke-width:1.7}
    .sl .brace{fill:none;stroke:#20242c;stroke-width:3}
    .sl .clef,.sl .acc{fill:#20242c;font-family:"Noto Music","Apple Symbols","Segoe UI Symbol","Bravura Text",serif}
    .sl .ts{fill:#20242c;font-family:Georgia,serif;font-weight:700;text-anchor:middle}
    .sl .lyr{fill:#20242c;font-family:Georgia,"Times New Roman",serif;text-anchor:middle}
    .sl .lic{fill:#8a8f9c;font-style:italic}
    .sl .vnum{fill:#20242c;font-family:Georgia,serif;font-weight:700}
    .sl .refl{fill:#20242c;font-family:Georgia,serif;font-style:italic;font-weight:700}
    .sl .ttl{fill:#1a2033;font-family:Georgia,"Iowan Old Style",serif;font-weight:700;text-anchor:middle}
    .sl .cr{fill:#7b8290;font-family:-apple-system,"Segoe UI",Roboto,sans-serif}
  `;

  const cache = new Map();

  /** Full hymn slide (one section) as an SVG string. */
  function hymnSlide(h, secIndex = 0, { mini = false } = {}) {
    const key = h.id + '|' + secIndex + '|' + mini;
    if (cache.has(key)) return cache.get(key);
    const hn = Object.entries(h.hn)[0];
    const credit = `Words: ${h.by}  ·  Music: ${h.music}${h.tune ? ' (' + h.tune + ')' : ''}  ·  ${h.pd ? 'Public domain' : h.lic}`;
    const svg =
      `<svg class="sl" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(h.title)} slide">
        <style>${STYLE}</style>
        <rect width="${W}" height="${H}" fill="#fff"/>
        <text x="${W / 2}" y="76" class="ttl" style="font-size:44px">${esc(h.title)}</text>
        ${mini ? '' : `<text x="${W / 2}" y="108" class="cr" style="font-size:17px;text-anchor:middle">${esc(h.meter)}  ·  Key of ${h.key}  ·  ${h.time}</text>`}
        ${hn ? `<text x="1196" y="52" class="cr" style="font-size:20px;text-anchor:end;font-weight:600">${hn[0]} ${hn[1]}</text>` : ''}
        ${musicSVG(h, secIndex)}
        <text x="${W / 2}" y="${H - 34}" class="cr" style="font-size:15px;text-anchor:middle">${esc(credit)}</text>
      </svg>`;
    cache.set(key, svg);
    return svg;
  }

  /** Plain text slide (scripture, sermon title, prayer, etc.). */
  function textSlide({ kicker = '', title = '', sub = '', tone = 'navy' }) {
    const bg = { navy: ['#1b2544', '#2c3f78'], wine: ['#3a1424', '#6b2740'], teal: ['#0f3b40', '#22666d'], gold: ['#3a2b0d', '#7a5a1a'], slate: ['#232838', '#3a4159'] }[tone] || ['#1b2544', '#2c3f78'];
    const words = title.split(' '); const lns = []; let ln = '';
    words.forEach(w => { if ((ln + ' ' + w).trim().length > 26) { lns.push(ln.trim()); ln = w; } else ln += ' ' + w; }); if (ln.trim()) lns.push(ln.trim());
    const fs = lns.length > 2 ? 64 : 80, y0 = H / 2 - (lns.length - 1) * fs * .55 + 10;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
      <defs><linearGradient id="g${tone}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g${tone})"/>
      <text x="${W / 2}" y="${y0 - fs - 6}" fill="#e2bd72" text-anchor="middle" style="font:600 26px -apple-system,'Segoe UI',sans-serif;letter-spacing:.22em;text-transform:uppercase">${esc(kicker)}</text>
      ${lns.map((l, i) => `<text x="${W / 2}" y="${y0 + i * fs * 1.1}" fill="#fff" text-anchor="middle" style="font:700 ${fs}px Georgia,'Iowan Old Style',serif">${esc(l)}</text>`).join('')}
      <text x="${W / 2}" y="${y0 + lns.length * fs * 1.1 + 24}" fill="#c9d2ee" text-anchor="middle" style="font:400 30px -apple-system,'Segoe UI',sans-serif">${esc(sub)}</text>
    </svg>`;
  }

  return { hymnSlide, textSlide };
})();
