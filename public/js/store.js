// Settings, stats, bankroll and sessions.
// Signed in: saved in this browser and synced to the account (api/progress), with
// revision numbers so devices merge instead of overwriting each other.
// Guests: settings stay in this browser, but progress lasts for this visit only (this
// tab's sessionStorage, so it survives a sign-in redirect). Creating an account keeps it.
import { RULES } from './cards.js';
import { tally } from './tally.js';
import { strategyById, cleanStrategy, DEFAULT_ID } from './strategies.js';

const KEY = 'bjtrainer.v2'; // progress document
const META_KEY = 'tcl.sync'; // { owner, rev, pending }: who this copy belongs to and its sync state
const RUN_CAP = 600;

export const DEFAULT_SETTINGS = {
  others: 2,
  dealSpeed: 380,
  countCheck: 'random',
  showCount: false,
  surrender: false,
  sound: { on: true, volume: 0.6 },
  countdown: { auto: true, ms: 500, range: '15-20' },
  tcDrill: { display: 'tray' },
  basic: { focus: false, auto: true },
  deviation: { auto: true, mode: 'mixed', focus: true },
  training: { cheat: true },
  calc: { bankroll: 3000, unit: 25, spread: 3, hands: 80 },
  strategy: DEFAULT_ID, // which strategy every mode grades against (accounts can pick)
  money: { bankroll: RULES.bankroll, buyIn: RULES.buyIn, practice: 5000 }, // solo table and training chips
  tips: {}, // first-time tips already shown, by mode
};

export function freshStats() {
  return {
    countdown: { runs: [] },
    basic: { runs: [], cells: {} },
    deviation: { runs: [] },
    training: { hands: 0, decisions: 0, correct: 0, devs: 0, devsCorrect: 0, checks: 0, checksCorrect: 0, bets: 0, betsCorrect: 0, peeks: 0, misses: {} },
    table: { hands: 0, decisions: 0, correct: 0, devs: 0, devsCorrect: 0, checks: 0, checksCorrect: 0, bets: 0, betsCorrect: 0, peeks: 0, misses: {} },
    // Accuracy per strategy, every mode together: '<id>:plays', '<id>:playsOk', '<id>:counts', '<id>:countsOk'.
    byStrategy: {},
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function fill(base, over) {
  if (!isObj(over)) return base;
  for (const [k, v] of Object.entries(over)) {
    if (isObj(base[k]) && isObj(v) && k !== 'misses' && k !== 'cells') fill(base[k], v);
    else base[k] = v;
  }
  return base;
}

function normalize(raw) {
  return {
    savedAt: raw?.savedAt || 0,
    // When stats and the session history were last reset. A copy from before a reset
    // never merges its old numbers back in (see mergeInto).
    epochs: { stats: Number(raw?.epochs?.stats) || 0, sessions: Number(raw?.epochs?.sessions) || 0 },
    settings: fill(structuredClone(DEFAULT_SETTINGS), raw?.settings),
    stats: fill(freshStats(), raw?.stats),
    bankroll: typeof raw?.bankroll === 'number' ? raw.bankroll : RULES.bankroll,
    session: raw?.session || null,
    sessions: Array.isArray(raw?.sessions) ? raw.sessions : [],
    busts: Number(raw?.busts) || 0, // times the solo bankroll ran out and was reset
    // Custom strategies (accounts only), each with the time it was last edited.
    strategies: Array.isArray(raw?.strategies)
      ? raw.strategies.map((x) => { const c = cleanStrategy(x); return c && { ...c, updatedAt: Number(x.updatedAt) || 0 }; }).filter(Boolean)
      : [],
  };
}

const FIELDS = ['savedAt', 'epochs', 'settings', 'stats', 'bankroll', 'session', 'sessions', 'busts', 'strategies'];
const payload = () => Object.fromEntries(FIELDS.map((k) => [k, state[k]]));

// Swap in a whole new document, keeping the same state object (the app holds on to it).
function replaceContents(next) {
  for (const k of FIELDS) state[k] = next[k];
}

const hasProgress = (s) => Object.values(s.stats).some((b) => b.runs?.length || b.hands)
  || Object.keys(s.stats.basic.cells).length > 0 || s.sessions.length > 0;

// ---- merging ---------------------------------------------------------------------
// mode 'sum': adding a separate history (guest progress into an account).
// mode 'max': two copies of the same history that drifted apart (two devices); taking
//             the larger count never double-counts.
function mergeInto(target, src, mode) {
  // Two copies of one account: whichever side was reset later wins outright, so a device
  // that was offline during a reset can't bring the old numbers back.
  if (mode === 'max') {
    for (const part of /** @type {const} */ (['stats', 'sessions'])) {
      const t = target.epochs[part];
      const s = src.epochs[part];
      if (s === t) continue;
      if (s > t) {
        target.epochs[part] = s;
        if (part === 'stats') target.stats = structuredClone(src.stats);
        else { target.sessions = structuredClone(src.sessions); target.bankroll = src.bankroll; target.session = src.session; }
      }
      src = { ...src, [part === 'stats' ? 'stats' : 'sessions']: part === 'stats' ? freshStats() : [], ...(part === 'sessions' ? { session: null } : {}) };
    }
  }
  const num = (a, b) => (mode === 'sum' ? (a || 0) + (b || 0) : Math.max(a || 0, b || 0));
  for (const [name, bucket] of Object.entries(src.stats)) {
    const t = target.stats[name];
    if (!t) { target.stats[name] = bucket; continue; }
    if (Array.isArray(bucket.runs)) {
      const seen = new Set(t.runs.map((r) => `${r.t}:${r.ms ?? ''}:${r.ok}`));
      for (const r of bucket.runs) if (!seen.has(`${r.t}:${r.ms ?? ''}:${r.ok}`)) t.runs.push(r);
      t.runs.sort((a, b) => a.t - b.t);
      if (t.runs.length > RUN_CAP) t.runs.splice(0, t.runs.length - RUN_CAP);
    }
    if (bucket.cells) {
      for (const [k, c] of Object.entries(bucket.cells)) {
        const tc = t.cells[k] || (t.cells[k] = { n: 0, miss: 0 });
        tc.n = num(tc.n, c.n);
        tc.miss = num(tc.miss, c.miss);
      }
    }
    for (const [k, v] of Object.entries(bucket)) {
      if (typeof v === 'number') t[k] = num(t[k], v);
    }
    if (bucket.misses) {
      t.misses = t.misses || {};
      for (const [k, v] of Object.entries(bucket.misses)) t.misses[k] = num(t.misses[k], v);
    }
  }
  // Strategies: the most recently edited copy of each.
  for (const s of src.strategies || []) {
    const i = target.strategies.findIndex((x) => x.id === s.id);
    if (i < 0) target.strategies.push(s);
    else if ((s.updatedAt || 0) > (target.strategies[i].updatedAt || 0)) target.strategies[i] = s;
  }
  if (mode === 'max') target.busts = Math.max(target.busts || 0, src.busts || 0);
  else target.busts = (target.busts || 0) + (src.busts || 0);
  const ids = new Set(target.sessions.map((s) => s.id));
  for (const s of src.sessions) if (!ids.has(s.id)) target.sessions.push(s);
  target.sessions.sort((a, b) => a.t - b.t);
  if (!target.session && src.session && mode === 'max') target.session = src.session;
}

// ---- local storage --------------------------------------------------------------
function readJSON(key, store = localStorage) {
  try { return JSON.parse(store.getItem(key)); } catch { return null; }
}
function writeJSON(key, v, store = localStorage) {
  try { store.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}
// An account's copy lives in localStorage (it works offline and syncs later). A guest's
// settings do too, but their progress only goes to this tab's sessionStorage.
function writeLocal() {
  if (meta.owner != null) writeJSON(KEY, state);
  else {
    writeJSON(KEY, { settings: state.settings });
    writeJSON(KEY, payload(), sessionStorage);
  }
  writeJSON(META_KEY, meta);
}
function clearGuestVisit() {
  try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

// ---- state ------------------------------------------------------------------------
let state = null;
let meta = { owner: null, rev: 0, pending: false };
let user = null;
let timer = null;
let pushing = false;
let pushAgain = false;
const listeners = new Set();

export const currentUser = () => user;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn(user));

// True when progress is saved to an account (not just this browser).
export const syncing = () => Boolean(user);

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = {};
  try { data = await r.json(); } catch { /* empty body */ }
  return { status: r.status, ok: r.ok, data };
}

export async function init() {
  meta = { owner: null, rev: 0, pending: false, ...readJSON(META_KEY) };
  const saved = readJSON(KEY);
  if (meta.owner != null) state = normalize(saved);
  else {
    // Guest: this visit's progress plus this browser's settings. Progress a guest saved
    // before visits stopped keeping it comes along one last time (so signing up keeps it).
    const visit = readJSON(KEY, sessionStorage) || (saved?.stats ? saved : null);
    state = normalize({ ...visit, settings: saved?.settings ?? visit?.settings });
    writeLocal();
  }
  addEventListener('pagehide', flush);
  try {
    const me = await api('GET', '/api/me');
    if (me.ok && me.data.user) await adoptUser(me.data.user, { quiet: true });
  } catch { /* offline: keep the local copy */ }
  return state;
}

// Make this browser's progress belong to `u` (after signing in or on page load).
export async function adoptUser(u, { quiet = false } = {}) {
  user = u;
  const remote = await api('GET', '/api/progress');
  if (!remote.ok) { emit(); return; }
  const remoteState = remote.data.data ? normalize(remote.data.data) : null;
  if (meta.owner === u.id) {
    // Same account: catch up with other devices, keeping unsynced local changes.
    if (remote.data.rev > meta.rev && remoteState) {
      if (meta.pending) mergeInto(state, remoteState, 'max');
      else replaceContents(remoteState);
    }
  } else if (meta.owner == null) {
    // Guest progress in this browser.
    const guest = hasProgress(state) ? structuredClone(payload()) : null;
    if (remoteState) {
      replaceContents(remoteState);
      if (guest && (quiet || confirm('Add the progress you made in this browser as a guest to your account?'))) {
        mergeInto(state, normalize(guest), 'sum');
        meta.pending = true;
      }
    } else {
      meta.pending = true; // new account: upload what's here
    }
  } else {
    // Another account's copy: replace it.
    replaceContents(remoteState || normalize(null));
    meta.pending = !remoteState;
  }
  meta.owner = u.id;
  meta.rev = remote.data.rev;
  clearGuestVisit();
  writeLocal();
  if (meta.pending) push();
  emit();
}

// Signed out (by choice, or the session ended): forget this browser's copy of the account.
export function signOut() {
  user = null;
  clearTimeout(timer);
  replaceContents(normalize({ settings: { ...state.settings, strategy: DEFAULT_ID } }));
  meta = { owner: null, rev: 0, pending: false };
  writeLocal();
  emit();
}

export function setUser(u) { user = u; emit(); }

async function push() {
  timer = null;
  if (!user || !meta.pending) return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await api('PUT', '/api/progress', { baseRev: meta.rev, data: payload() });
      if (r.ok) { meta.rev = r.data.rev; meta.pending = false; writeJSON(META_KEY, meta); return; }
      if (r.status === 409) {
        // Another device saved first: merge its copy in and try again.
        if (r.data.data) mergeInto(state, normalize(r.data.data), 'max');
        meta.rev = r.data.rev;
        writeLocal();
        continue;
      }
      if (r.status === 401) { user = null; emit(); }
      return; // offline or server error: stays pending and goes up with the next save
    }
  } catch { /* offline */ } finally {
    pushing = false;
    if (pushAgain) { pushAgain = false; schedule(); }
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(push, 800);
}

export function save() {
  state.savedAt = Date.now();
  if (meta.owner != null) meta.pending = true;
  writeLocal();
  if (user) schedule();
  saveListeners.forEach((fn) => fn());
}

// Leaving the page: send what's waiting, if it's small enough for a keepalive request.
function flush() {
  if (!timer || !user) return;
  clearTimeout(timer);
  timer = null;
  const body = JSON.stringify({ baseRev: meta.rev, data: payload() });
  if (body.length < 60000) fetch('/api/progress', { method: 'PUT', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

export function resetStats() { state.stats = freshStats(); state.epochs.stats = Date.now(); save(); }

// ---- progress hooks (the sign-up nudge) ---------------------------------------------
const saveListeners = new Set();
/** Called after every save, with how much the visitor has done so far. */
export const onSave = (fn) => { saveListeners.add(fn); return () => saveListeners.delete(fn); };
/** The current stats (this visit's, for a guest). */
export const activityStats = () => state.stats;

/** The strategy every mode grades against. Picking one is for accounts; guests use the default. */
export const activeStrategy = () => strategyById(user || meta.owner != null ? state.settings.strategy : DEFAULT_ID, state.strategies);

/** Count a graded play or count answer toward the active strategy's accuracy. @param {'plays' | 'counts'} kind @param {boolean} ok */
export function scoreFor(kind, ok) {
  const b = state.stats.byStrategy;
  const id = activeStrategy().id;
  b[`${id}:${kind}`] = (b[`${id}:${kind}`] || 0) + 1;
  if (ok) b[`${id}:${kind}Ok`] = (b[`${id}:${kind}Ok`] || 0) + 1;
}

export function addRun(bucket, run) {
  tally('drill');
  bucket.runs.push({ t: Date.now(), ...run });
  if (bucket.runs.length > RUN_CAP) bucket.runs.splice(0, bucket.runs.length - RUN_CAP);
}
