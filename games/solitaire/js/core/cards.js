// Cards are small immutable objects: { id, r: 1..13, s: 0..3, up }.
// Suits: 0 spades, 1 hearts, 2 diamonds, 3 clubs. A pile is an array whose
// last element is the top card. Turning a card over makes a new object, so
// states can share card objects and undo history stays cheap.

export const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
export const SUIT_GLYPH = ['♠', '♥', '♦', '♣'];
export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const RANK_NAME = ['', 'Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];

export const red = (s) => s === 1 || s === 2;
export const top = (a) => a[a.length - 1];
export const up = (c) => (c.up ? c : { id: c.id, r: c.r, s: c.s, up: true });
export const down = (c) => (c.up ? { id: c.id, r: c.r, s: c.s, up: false } : c);

/** One 13-card run per entry of `sets` (each entry is a suit). */
export function newDeck(sets) {
  const cards = [];
  let id = 0;
  for (const s of sets) for (let r = 1; r <= 13; r++) cards.push({ id: id++, r, s, up: false });
  return cards;
}

export const enc = (id) => String.fromCharCode(48 + id);

/** Stable text for a pile, used in solver state keys. */
export function pileKey(p) {
  let k = '';
  for (const c of p) k += c.up ? enc(c.id) : enc(c.id + 120);
  return k;
}

export function cardName(c) {
  return `${RANK_NAME[c.r]} of ${SUIT_NAMES[c.s]}`;
}

/** Copy piles and move cards src[i..] onto dst. Returns the new piles object and the moved cards. */
export function moveCards(piles, from, i, to) {
  const P = { ...piles };
  const src = piles[from];
  const moving = src.slice(i);
  P[from] = src.slice(0, i);
  P[to] = piles[to].concat(moving);
  return { P, moving };
}

/** Turn over the top card of P[pile] if it is face down. Mutates the (already copied) array. */
export function flipTop(P, pile) {
  const a = P[pile];
  if (a.length && !a[a.length - 1].up) {
    P[pile] = a.slice();
    P[pile][a.length - 1] = up(a[a.length - 1]);
    return true;
  }
  return false;
}
