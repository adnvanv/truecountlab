// Settings + stats, saved to localStorage and synced to the server (api/state).
const KEY = 'bjtrainer.v1';

export const DEFAULT_SETTINGS = {
  system: 'hilo',
  tcMode: 'floor',
  deviations: true,
  decks: 6,
  penetration: 75,
  h17: false,
  das: true,
  surrender: true,
  others: 2,
  dealSpeed: 380,
  countCheck: 'random',
  showCount: false,
  betHints: true,
  bankroll: 1000,
  unit: 10,
  spread: 8,
  speed: { cards: 20, group: 1, ms: 900 },
  deckDrill: { burn: true, group: 1, auto: false, ms: 500 },
  tcDrill: { showDecks: false },
  stratDrill: { devs: true, auto: true },
};

export function freshStats() {
  return {
    table: { hands: 0, decisions: 0, correct: 0, devs: 0, devsCorrect: 0, checks: 0, checksCorrect: 0, bets: 0, betsCorrect: 0, peeks: 0, net: 0, bankroll: null, lastBet: null, misses: {} },
    speed: { attempts: 0, correct: 0, history: [] },
    deck: { attempts: 0, correct: 0, best: null, history: [] },
    truecount: { attempts: 0, correct: 0, streak: 0, bestStreak: 0, history: [] },
    strategy: { attempts: 0, correct: 0, streak: 0, bestStreak: 0, misses: {} },
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return base;
  for (const [k, v] of Object.entries(over)) {
    if (isObj(base[k]) && isObj(v) && k !== 'misses') merge(base[k], v);
    else base[k] = v;
  }
  return base;
}

function normalize(raw) {
  return {
    savedAt: raw?.savedAt || 0,
    settings: merge(structuredClone(DEFAULT_SETTINGS), raw?.settings),
    stats: merge(freshStats(), raw?.stats),
  };
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function writeLocal(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

let state;
let serverOK = false;
let timer = null;

export async function init() {
  const local = readLocal();
  let remote = null;
  try {
    const r = await fetch('api/state', { cache: 'no-store' });
    if (r.ok) { remote = await r.json(); serverOK = true; }
  } catch { /* offline or opened from file */ }
  const raw = (remote?.savedAt || 0) > (local?.savedAt || 0) ? remote : local;
  state = normalize(raw);
  addEventListener('pagehide', flush);
  return state;
}

function push() {
  timer = null;
  if (!serverOK) return;
  fetch('api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state), keepalive: true }).catch(() => {});
}

export function save() {
  state.savedAt = Date.now();
  writeLocal(state);
  clearTimeout(timer);
  timer = setTimeout(push, 800);
}

function flush() {
  if (timer) { clearTimeout(timer); push(); }
}

export function resetStats() {
  state.stats = freshStats();
  save();
}

export function pushHistory(arr, item, cap = 200) {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}
