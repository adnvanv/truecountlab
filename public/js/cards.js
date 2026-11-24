// Cards, shoes and counting systems.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const SUIT_NAMES = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const KEYS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
export const TENS = ['10', 'J', 'Q', 'K'];

export const isRed = (suit) => suit === '♥' || suit === '♦';

export function rankKey(rank) {
  if (rank === 'A') return 'A';
  if (TENS.includes(rank)) return 'T';
  return rank;
}

export function bjValue(rank) {
  const k = rankKey(rank);
  return k === 'A' ? 11 : k === 'T' ? 10 : Number(k);
}

const t = (A, _2, _3, _4, _5, _6, _7, _8, _9, T) => ({ A, 2: _2, 3: _3, 4: _4, 5: _5, 6: _6, 7: _7, 8: _8, 9: _9, T });

export const SYSTEMS = {
  hilo: {
    name: 'Hi-Lo', balanced: true, level: 1,
    tags: t(-1, 1, 1, 1, 1, 1, 0, 0, 0, -1),
    desc: 'The standard. 2–6 are +1, 7–9 are 0, tens and aces are −1. Index plays (Illustrious 18 / Fab 4) are built for it.',
  },
  ko: {
    name: 'KO (Knock-Out)', balanced: false, level: 1,
    tags: t(-1, 1, 1, 1, 1, 1, 1, 0, 0, -1),
    desc: 'Unbalanced: 7s also count +1, so no true-count conversion. At the table the count starts at 4 − 4×decks and you bet up at the +4 pivot.',
  },
  hiopt1: {
    name: 'Hi-Opt I', balanced: true, level: 1,
    tags: t(0, 0, 1, 1, 1, 1, 0, 0, 0, -1),
    desc: '3–6 are +1, tens are −1. Aces and 2s are neutral (often side-counted).',
  },
  hiopt2: {
    name: 'Hi-Opt II', balanced: true, level: 2,
    tags: t(0, 1, 1, 2, 2, 1, 1, 0, 0, -2),
    desc: 'Level 2: 4s and 5s are +2, tens are −2. More accurate, harder to keep.',
  },
  omega2: {
    name: 'Omega II', balanced: true, level: 2,
    tags: t(0, 1, 1, 2, 2, 2, 1, 0, -1, -2),
    desc: 'Level 2: 4–6 are +2, 9s are −1, tens are −2. Aces neutral.',
  },
  zen: {
    name: 'Zen Count', balanced: true, level: 2,
    tags: t(-1, 1, 1, 2, 2, 2, 1, 0, 0, -2),
    desc: 'Level 2: 4–6 are +2, tens −2, aces −1.',
  },
};

export const tagOf = (systemId, card) => SYSTEMS[systemId].tags[rankKey(card.rank)];

export function deckTotal(systemId) {
  return RANKS.reduce((s, r) => s + 4 * SYSTEMS[systemId].tags[rankKey(r)], 0);
}

export const initialCount = (systemId, decks) => (systemId === 'ko' ? 4 - 4 * decks : 0);

export function trueCount(rc, decks, mode = 'floor') {
  const raw = rc / Math.max(decks, 0.25);
  const v = mode === 'round' ? Math.round(raw) : mode === 'trunc' ? Math.trunc(raw) : Math.floor(raw);
  return v || 0; // normalise -0
}

export const TC_MODES = {
  floor: 'Floor (round down)',
  trunc: 'Truncate (toward zero)',
  round: 'Round to nearest',
};

// Every true count a careful player could reasonably arrive at: exact decks,
// decks estimated to the nearest half deck, and to the nearest whole deck.
// The first entry is the exact value.
export function tcCandidates(rc, cardsRemaining, mode) {
  const d = Math.max(cardsRemaining / 52, 0.25);
  const ds = [d, Math.max(0.5, Math.round(d * 2) / 2), Math.max(1, Math.round(d))];
  return [...new Set(ds.map((x) => trueCount(rc, x, mode)))];
}

export function randInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % n;
}
export const pick = (arr) => arr[randInt(arr.length)];

export function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let uid = 0;
export const makeCard = (rank, suit = pick(SUITS)) => ({ rank, suit, id: ++uid });

export function makeDecks(n = 1) {
  const out = [];
  for (let d = 0; d < n; d++) for (const s of SUITS) for (const r of RANKS) out.push(makeCard(r, s));
  return out;
}

// A card for a blackjack value (2–11), picking a random ten-value rank for 10.
export function cardForValue(v) {
  if (v === 11) return makeCard('A');
  if (v === 10) return makeCard(pick(TENS));
  return makeCard(String(v));
}

export class Shoe {
  constructor(decks, penetration) {
    this.decks = decks;
    this.penetration = penetration;
    this.shuffle();
  }
  shuffle() {
    this.cards = shuffleInPlace(makeDecks(this.decks));
    this.dealt = 0;
    this.cutIndex = Math.floor(this.cards.length * this.penetration);
  }
  draw() { return this.cards[this.dealt++]; }
  get remaining() { return this.cards.length - this.dealt; }
  get pastCut() { return this.dealt >= this.cutIndex; }
}
