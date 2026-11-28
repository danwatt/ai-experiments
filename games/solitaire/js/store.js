// Everything remembered between visits lives in this browser's localStorage:
// settings, statistics, daily-deal results and games in progress.

const P = 'solitaire.';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(P + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(P + key);
    else localStorage.setItem(P + key, JSON.stringify(value));
  } catch {}
}

export const DEFAULTS = {
  table: 'green',
  back: 'lattice',
  fourColor: false,
  large: false,
  sound: true,
  speed: 'normal',
  winnable: true,
  autoPlay: true,
  showTimer: true,
  spiderSuits: 1,
  lastTile: null,
};

export const settings = { ...DEFAULTS, ...read('settings', {}) };
export function saveSettings() {
  write('settings', settings);
}

// ---------- statistics ----------

const stats = read('stats', {});
const blank = () => ({ played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: null, bestMoves: null, bestScore: null, totalTime: 0 });

export function statsFor(mode) {
  return { ...blank(), ...(stats[mode] || {}) };
}
export function allStats() {
  return stats;
}
export function recordStart(mode) {
  const s = (stats[mode] = statsFor(mode));
  s.played++;
  write('stats', stats);
}
/** Returns what is new or notable about this win, for the win screen. */
export function recordWin(mode, { time, moves, score }) {
  const s = (stats[mode] = statsFor(mode));
  const notes = [];
  s.won++;
  s.streak++;
  s.totalTime += time;
  if (s.streak > s.bestStreak) { s.bestStreak = s.streak; if (s.streak > 1) notes.push(`${s.streak} wins in a row \u2013 your best streak yet!`); }
  if (s.won > 1 && (s.bestTime === null || time < s.bestTime)) notes.push('New fastest time!');
  if (s.bestTime === null || time < s.bestTime) s.bestTime = time;
  if (s.bestMoves === null || moves < s.bestMoves) s.bestMoves = moves;
  if (score != null && (s.bestScore === null || score > s.bestScore)) { if (s.won > 1 && s.bestScore !== null) notes.push('New high score!'); s.bestScore = score; }
  if (s.won === 1) notes.unshift('Your first win at this game!');
  else if ([5, 10, 25, 50, 100, 250, 500, 1000].includes(s.won)) notes.unshift(`That is win number ${s.won}!`);
  write('stats', stats);
  return { notes, stats: { ...s } };
}
export function recordLoss(mode) {
  const s = (stats[mode] = statsFor(mode));
  s.streak = 0;
  write('stats', stats);
}
export function resetStats() {
  for (const k of Object.keys(stats)) delete stats[k];
  write('stats', stats);
}

// ---------- daily deals ----------

const daily = read('daily', {});
export function dailyDay(date) {
  return daily[date] || {};
}
export function recordDaily(date, tile, info) {
  daily[date] = { ...(daily[date] || {}), [tile]: info };
  write('daily', daily);
}
export function dailyStreak(today) {
  let n = 0;
  const d = new Date(today + 'T12:00:00');
  if (!Object.keys(dailyDay(today)).length) d.setDate(d.getDate() - 1);
  for (;;) {
    const k = dateKey(d);
    if (!Object.keys(dailyDay(k)).length) break;
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- saved games ----------

export const slotKey = (mode, date) => (date ? `daily:${date}:${mode}` : mode);
export function loadGame(slot) {
  return read('game.' + slot, null);
}
export function saveGame(slot, data) {
  write('game.' + slot, data);
}
export function clearGame(slot) {
  write('game.' + slot, undefined);
}

// ---------- recently dealt winnable seeds (to avoid repeats) ----------

const recent = read('recentSeeds', {});
export function recentSeeds(mode) {
  return recent[mode] || [];
}
export function noteSeed(mode, seed) {
  const a = (recent[mode] = (recent[mode] || []).filter((x) => x !== seed));
  a.push(seed);
  if (a.length > 400) a.splice(0, a.length - 400);
  write('recentSeeds', recent);
}

export const celebrationsSeen = read('celebrations', []);
export function noteCelebration(kind) {
  celebrationsSeen.push(kind);
  if (celebrationsSeen.length > 10) celebrationsSeen.splice(0, celebrationsSeen.length - 10);
  write('celebrations', celebrationsSeen);
}
