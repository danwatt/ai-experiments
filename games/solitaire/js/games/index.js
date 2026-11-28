// Registry of playable modes. A "tile" on the menu can hold several modes
// (Spider's 1, 2 and 4 suits).
import { makeKlondike } from './klondike.js';
import { makeSpider } from './spider.js';
import { makeFreeCell } from './freecell.js';
import { makePyramid } from './pyramid.js';
import { makeTriPeaks } from './tripeaks.js';

export const MODES = {
  spider1: makeSpider(1),
  spider2: makeSpider(2),
  spider4: makeSpider(4),
  klondike1: makeKlondike(1),
  klondike3: makeKlondike(3),
  freecell: makeFreeCell(),
  pyramid: makePyramid(),
  tripeaks: makeTriPeaks(),
};

export const TILES = [
  { id: 'spider', modes: ['spider1', 'spider2', 'spider4'], title: 'Spider', blurb: 'Build King-to-Ace runs of one suit.' },
  { id: 'klondike1', modes: ['klondike1'], title: 'Classic Solitaire', blurb: 'The one everybody knows, turning one card at a time.' },
  { id: 'klondike3', modes: ['klondike3'], title: 'Klondike', blurb: 'Classic rules, turning three cards at a time.' },
  { id: 'freecell', modes: ['freecell'], title: 'FreeCell', blurb: 'Every card face up. Pure skill.' },
  { id: 'pyramid', modes: ['pyramid'], title: 'Pyramid', blurb: 'Pair up cards that add to 13.' },
  { id: 'tripeaks', modes: ['tripeaks'], title: 'TriPeaks', blurb: 'One higher or one lower. Go for long streaks.' },
];

export const modeLabel = (id) => {
  const g = MODES[id];
  return g.family === 'spider' ? `Spider · ${g.subtitle}` : g.title;
};
