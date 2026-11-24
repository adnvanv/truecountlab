// Cards, shoe, Hi-Lo counting and the house rules this trainer simulates.

export const RULES = {
  decks: 6,
  penetration: 0.75,
  minBet: 25,
  bankroll: 3000,
  buyIn: 500,
  text: '6 decks · dealer stands on soft 17 · double after split · blackjack pays 3:2 · no surrender · 75% penetration · $25 minimum',
};

// Bet ramp: $25 at TC ≤ +1, $50 at +2/+3, $75 at +4 or higher.
export const BETS = [25, 50, 75];
export const betFor = (tc) => (tc <= 1 ? 25 : tc <= 3 ? 50 : 75);

export const SUITS = ['♠', '♥', '♦', '♣'];
export const SUIT_NAMES = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
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

// Hi-Lo: 2–6 = +1, 7–9 = 0, 10–A = −1.
export function hiLo(card) {
  const v = bjValue(card.rank);
  return v <= 6 ? 1 : v <= 9 ? 0 : -1;
}

// Decks remaining as a player estimates them: nearest half deck, at least ½.
export const decksEstimate = (cardsRemaining) => Math.max(0.5, Math.round((cardsRemaining / 52) * 2) / 2);

// True count = running count ÷ estimated decks remaining, rounded down.
export const trueCount = (rc, decks) => Math.floor(rc / decks) || 0;
export const tcFromCards = (rc, cardsRemaining) => trueCount(rc, decksEstimate(cardsRemaining));

// True counts a careful player could reach from the tray: the estimate a few
// cards either side of the exact position can land on a neighbouring half deck.
export function tcCandidates(rc, cardsRemaining) {
  const out = [tcFromCards(rc, cardsRemaining)];
  for (const d of [-6, 6]) out.push(tcFromCards(rc, Math.max(1, cardsRemaining + d)));
  return [...new Set(out)];
}

export function randInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % n;
}
export const pick = (arr) => arr[randInt(arr.length)];
export const chance = (p) => randInt(1_000_000) < p * 1_000_000;

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
export function cardForValue(v) {
  if (v === 11) return makeCard('A');
  if (v === 10) return makeCard(pick(TENS));
  return makeCard(String(v));
}

export class Shoe {
  constructor() { this.shuffle(); }
  shuffle() {
    this.cards = shuffleInPlace(makeDecks(RULES.decks));
    this.dealt = 0;
    this.cutIndex = Math.floor(this.cards.length * RULES.penetration);
  }
  draw() { return this.cards[this.dealt++]; }
  get remaining() { return this.cards.length - this.dealt; }
  get pastCut() { return this.dealt >= this.cutIndex; }
}
