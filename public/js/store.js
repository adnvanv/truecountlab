// Settings, stats, bankroll and sessions. Saved to localStorage and synced to
// the server (api/state) so phone and PC share progress.
import { RULES } from './cards.js';

const KEY = 'bjtrainer.v2';
const RUN_CAP = 600;

export const DEFAULT_SETTINGS = {
  others: 2,
  dealSpeed: 380,
  countCheck: 'random',
  showCount: false,
  surrender: false,
  sound: { on: true, volume: 0.6 },
  countdown: { auto: true, ms: 500, range: '15-20' },
  distraction: { auto: true, ms: 600, range: '15-20', audio: true, voice: true, popups: true, chatter: true, volume: 0.5 },
  tcDrill: { display: 'tray' },
  betDrill: { display: 'tc' },
  basic: { focus: false, auto: true },
  deviation: { auto: true, mode: 'mixed', focus: true },
  training: { cheat: true },
  calc: { bankroll: 3000, unit: 25, spread: 3, hands: 80 },
};

export function freshStats() {
  return {
    countdown: { runs: [] },
    distraction: { runs: [] },
    truecount: { runs: [] },
    basic: { runs: [], cells: {} },
    deviation: { runs: [] },
    betting: { runs: [] },
    training: { hands: 0, decisions: 0, correct: 0, devs: 0, devsCorrect: 0, checks: 0, checksCorrect: 0, bets: 0, betsCorrect: 0, peeks: 0, misses: {} },
    table: { hands: 0, decisions: 0, correct: 0, devs: 0, devsCorrect: 0, checks: 0, checksCorrect: 0, bets: 0, betsCorrect: 0, peeks: 0, misses: {} },
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return base;
  for (const [k, v] of Object.entries(over)) {
    if (isObj(base[k]) && isObj(v) && k !== 'misses' && k !== 'cells') merge(base[k], v);
    else base[k] = v;
  }
  return base;
}

function normalize(raw) {
  return {
    savedAt: raw?.savedAt || 0,
    settings: merge(structuredClone(DEFAULT_SETTINGS), raw?.settings),
    stats: merge(freshStats(), raw?.stats),
    bankroll: typeof raw?.bankroll === 'number' ? raw.bankroll : RULES.bankroll,
    session: raw?.session || null,
    sessions: Array.isArray(raw?.sessions) ? raw.sessions : [],
  };
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function writeLocal(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
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
  } catch { /* offline */ }
  state = normalize((remote?.savedAt || 0) > (local?.savedAt || 0) ? remote : local);
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
function flush() { if (timer) { clearTimeout(timer); push(); } }

// True when progress syncs to the server (private network only until accounts exist).
export const syncing = () => serverOK;

export function resetStats() { state.stats = freshStats(); save(); }

export function addRun(bucket, run) {
  bucket.runs.push({ t: Date.now(), ...run });
  if (bucket.runs.length > RUN_CAP) bucket.runs.splice(0, bucket.runs.length - RUN_CAP);
}
