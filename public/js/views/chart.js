// Strategy: pick the strategy every mode grades against, see what it is and how it does,
// and (with an account) copy one and change anything: the chart, the count, the index
// plays and the bet ramp. A worker simulates a custom strategy's edge as you edit.
import { h, signed, head, money, pct } from '../ui.js';
import { RULES } from '../cards.js';
import { DEV_GROUPS, UPCARDS, upLabel, ACTIONS, indexName, rampText, devNote, HARD } from '../strategy.js';
import { PRESETS, COMPUTED, newCustom, cleanStrategy, deckSum, defaultIrc, CHART_CODES, MAX_UNITS, PLAY_CHOICES, strategyById } from '../strategies.js';
import { currentUser } from '../store.js';
import { strategyChanged } from '../online.js';

/** @typedef {import('../strategy.js').Strategy} Strategy */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
const RANK_LABEL = (k) => (k === 'T' ? '10s' : k === 'A' ? 'A' : k);
const HARD_ROWS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const SOFT_ROWS = [13, 14, 15, 16, 17, 18, 19, 20];
const PAIR_ROWS = ['A', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const rowLabel = (kind, r) => (kind === 'hard' ? (r === 8 ? '5–8' : r === 17 ? '17+' : String(r)) : kind === 'soft' ? `A,${r - 11}` : r === 'T' ? '10,10' : `${r},${r}`);
const pctEdge = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;

/** Player accuracy with a strategy, from every mode. @param {Record<string, number>} b @param {string} id */
function accuracy(b, id) {
  const plays = b[`${id}:plays`] || 0; const counts = b[`${id}:counts`] || 0;
  if (!plays && !counts) return null;
  return [plays ? `${pct(b[`${id}:playsOk`] || 0, plays)} of ${plays} plays` : null, counts ? `${pct(b[`${id}:countsOk`] || 0, counts)} of ${counts} counts` : null].filter(Boolean).join(' · ');
}

/** "+0.54% with its ramp · −0.32% flat" @param {{ flat: number, ramp: number } | undefined} e @param {Strategy} s */
function edgeLine(e, s) {
  if (!e) return null;
  return s.ramp.length
    ? [h('strong', { class: e.ramp > 0 ? 'good' : 'bad' }, `${pctEdge(e.ramp)} player edge`), ' with its bet ramp · ', h('span', { class: 'muted' }, `${pctEdge(e.flat)} betting flat`)]
    : [h('strong', { class: e.flat > 0 ? 'good' : 'bad' }, `${pctEdge(e.flat)}`), ' (house edge, flat bets)'];
}

// ---- the edge simulator (custom strategies) ----------------------------------------
let worker = null;
let jobId = 0;
/** Simulate a strategy's edge; onUpdate gets running estimates. @param {Strategy} s @param {boolean} surrender @param {(e: any) => void} onUpdate */
function simulateEdge(s, surrender, onUpdate) {
  if (!worker) {
    try { worker = new Worker(new URL('../edge-worker.js', import.meta.url), { type: 'module' }); } catch { return; }
  }
  const id = ++jobId;
  worker.onmessage = (e) => { if (e.data.id === jobId) onUpdate(e.data); };
  worker.postMessage({ id, strategy: s, surrender });
}

export function mount(root, ctx) {
  const G = ctx.state;
  const S = ctx.settings;
  const signedIn = Boolean(currentUser());
  let viewing = ctx.strategy.id; // whose details are open
  let editing = false;
  /** @type {any} */
  let live = null; // the running edge estimate for the strategy being edited

  const mine = () => G.strategies;
  const isActive = (s) => ctx.strategy.id === s.id;

  function use(s) {
    if (!signedIn) { location.hash = '#account?mode=signup'; return; }
    S.strategy = s.id;
    ctx.save();
    strategyChanged();
    draw();
  }
  function copy(s) {
    if (!signedIn) { location.hash = '#account?mode=signup'; return; }
    const c = newCustom(s);
    G.strategies.push({ ...c, updatedAt: Date.now() });
    S.strategy = c.id;
    viewing = c.id;
    editing = true;
    live = null;
    ctx.save();
    draw();
    startSim(c);
    root.querySelector('.strat-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function remove(s) {
    if (!confirm(`Delete "${s.name}"? Your accuracy with it is kept in your stats.`)) return;
    G.strategies = G.strategies.filter((x) => x.id !== s.id);
    if (S.strategy === s.id) S.strategy = PRESETS[0].id;
    if (viewing === s.id) { viewing = S.strategy; editing = false; }
    ctx.save();
    draw();
  }
  /** Save an edited custom strategy (checked first), and re-simulate its edge. @param {Strategy} s */
  function commit(s) {
    const clean = cleanStrategy(s);
    if (!clean) { alert('That change makes the strategy invalid.'); draw(); return; }
    const i = G.strategies.findIndex((x) => x.id === s.id);
    G.strategies[i] = { ...clean, updatedAt: Date.now() };
    ctx.save();
    if (S.strategy === s.id) strategyChanged();
    live = null;
    draw();
    startSim(G.strategies[i]);
  }
  let simTimer = null;
  function startSim(s) {
    clearTimeout(simTimer);
    simTimer = setTimeout(() => simulateEdge(s, S.surrender, (e) => { live = e; drawEdge(); }), 250);
  }

  const edgeBox = h('div', { class: 'edge-live' });
  function drawEdge() {
    if (!live) { edgeBox.replaceChildren(h('span', { class: 'muted' }, 'Simulating this strategy…')); return; }
    const s = strategyById(viewing, mine());
    edgeBox.replaceChildren(
      ...(edgeLine({ flat: live.flat, ramp: live.ramp }, s) || []),
      h('span', { class: 'muted small' }, ` · ±${(s.ramp.length ? live.rampSE : live.flatSE).toFixed(2)}% after ${(live.hands / 1e6).toFixed(1)} million simulated hands${live.done ? '' : '…'}`));
  }

  function card(s) {
    const acc = accuracy(ctx.stats.byStrategy, s.id);
    const active = isActive(s);
    return h('div', { class: `panel strat-card${active ? ' active' : ''}${viewing === s.id ? ' open' : ''}` },
      h('div', { class: 'strat-card-head' },
        h('h3', {}, s.name), active ? h('span', { class: 'pill basic' }, 'In use') : null, s.preset ? null : h('span', { class: 'pill' }, 'Yours')),
      h('p', { class: 'muted small' }, s.desc || `${s.count.name} · ${s.devs.length} index plays`),
      h('div', { class: 'strat-facts' },
        h('span', {}, s.count.name), h('span', {}, `${s.devs.length} index plays`), h('span', {}, s.ramp.length ? `${money(RULES.minBet)}–${money(Math.max(...s.ramp.map((r) => r.units)) * RULES.minBet)} bets` : 'Flat bets')),
      s.edge ? h('div', { class: 'strat-edge' }, edgeLine(s.edge, s)) : h('div', { class: 'strat-edge muted' }, 'Edge: open it to simulate'),
      acc ? h('div', { class: 'strat-acc' }, 'Your accuracy: ', acc) : null,
      h('div', { class: 'row' },
        active ? null : h('button', { class: 'btn sm primary', onclick: () => use(s) }, signedIn ? 'Use this' : 'Use this (free account)'),
        h('button', { class: 'btn sm', onclick: () => { viewing = s.id; editing = false; live = null; draw(); if (!s.preset) startSim(s); root.querySelector('.strat-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 'Details'),
        h('button', { class: 'btn sm ghost', onclick: () => copy(s) }, s.preset ? 'Copy and customize' : 'Duplicate'),
        s.preset ? null : h('button', { class: 'btn sm ghost', onclick: () => { viewing = s.id; editing = true; live = null; draw(); startSim(s); } }, 'Edit'),
        s.preset ? null : h('button', { class: 'btn sm ghost danger', onclick: () => remove(s) }, 'Delete')));
  }

  // ---- details (read-only, or the editor for your own strategies) ----------------
  function detail(s) {
    const edit = editing && !s.preset;
    const n = indexName(s);
    const draft = structuredClone(s);
    const set = (fn) => { fn(draft); commit(draft); };

    const countEl = h('div', { class: 'chart-block' },
      h('h2', {}, `Count: ${s.count.name}`),
      h('div', { class: 'count-tags' }, RANKS.map((k) => h('label', { class: 'count-tag' },
        h('span', {}, RANK_LABEL(k)),
        edit
          ? h('select', { onchange: (e) => set((d) => { d.count.values[k] = Number(e.target.value); d.count.name = 'Custom count'; delete d.count.irc; }) },
            [-3, -2, -1, 0, 1, 2, 3].map((v) => h('option', { value: v, selected: v === s.count.values[k] }, signed(v))))
          : h('strong', { class: `mono ${s.count.values[k] > 0 ? 'pos' : s.count.values[k] < 0 ? 'neg' : ''}` }, signed(s.count.values[k]))))),
      s.count.kind === 'running'
        ? h('p', { class: 'muted' }, `Unbalanced: a full deck adds ${signed(deckSum(s.count.values))}. There's no true count: bets and index plays use the running count (so you'll likely want to change the indexes and ramp steps below; the KO strategy is a good model), which starts each shoe at `,
          edit ? h('input', { class: 'text-input mini', type: 'number', value: s.count.irc, onchange: (e) => set((d) => { d.count.irc = Math.round(Number(e.target.value)) || defaultIrc(d.count.values); }) }) : h('strong', {}, signed(s.count.irc || 0)), '.')
        : h('p', { class: 'muted' }, 'Balanced: a full deck adds up to 0. Bets and index plays use the true count (running count ÷ decks left, rounded down).'));

    const grid = (title, kind, rows) => h('div', { class: 'chart-block' },
      h('h2', {}, title),
      h('div', { class: 'chart-scroll' }, h('table', { class: `chart${edit ? ' editable' : ''}` },
        h('thead', {}, h('tr', {}, h('th', {}, ''), UPCARDS.map((u) => h('th', {}, upLabel(u))))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('th', {}, rowLabel(kind, r)), s.chart[kind][r].map((c, ci) => {
          const changed = kind === 'hard' && HARD[r] && HARD[r][ci] !== c;
          return h('td', {
            class: `c-${c[0]}${changed ? ' changed' : ''}`,
            title: edit ? 'Tap to change' : undefined,
            onclick: edit ? () => set((d) => { const codes = CHART_CODES[kind]; d.chart[kind][r][ci] = codes[(codes.indexOf(c) + 1) % codes.length]; }) : undefined,
          }, c);
        })))))));

    const devRows = Object.entries(DEV_GROUPS).flatMap(([g, label]) => {
      const ds = s.devs.filter((d) => d.group === g);
      if (!ds.length) return [];
      return [h('tr', { class: 'group-row' }, h('td', { colspan: edit ? 5 : 4 }, g === 'surrender' ? `${label} (${S.surrender ? 'on' : 'off; turn it on in Settings'})` : label)),
        ...ds.map((d) => h('tr', {},
          h('td', {}, d.name),
          h('td', { class: 'mono' }, edit
            ? h('input', { class: 'text-input mini', type: 'number', value: d.tc, onchange: (e) => set((x) => { const t = x.devs.find((y) => y.id === d.id); if (t) t.tc = Math.round(Number(e.target.value)) || 0; }) })
            : signed(d.tc)),
          h('td', {}, d.kind === 'ins' ? 'Take insurance' : ACTIONS[d.at]),
          h('td', {}, d.kind === 'ins' ? 'Decline' : d.kind === 'surrender' ? 'Play normally' : ACTIONS[d.below]),
          edit ? h('td', {}, h('button', { class: 'link', onclick: () => set((x) => { x.devs = x.devs.filter((y) => y.id !== d.id); }) }, 'Remove')) : null))];
    });
    const available = PLAY_CHOICES.filter((p) => !s.devs.some((d) => d.id === p.id));
    const pickPlay = h('select', { class: 'add-play', 'aria-label': 'Index play to add' }, available.map((p) => h('option', { value: p.id }, `${p.name}: ${p.kind === 'ins' ? 'insurance' : p.kind === 'surrender' ? 'surrender' : `${ACTIONS[p.at]} instead of ${ACTIONS[p.below]}`}`)));
    const addPlay = edit && available.length ? h('div', { class: 'row' }, pickPlay,
      h('button', { class: 'btn sm', onclick: () => { const p = PLAY_CHOICES.find((x) => x.id === pickPlay.value); if (p) set((x) => { x.devs.push(structuredClone(p)); }); } }, 'Add index play')) : null;

    const rampEl = h('div', { class: 'chart-block' },
      h('h2', {}, 'Bet ramp'),
      h('p', {}, rampText(s), '.'),
      edit ? h('div', { class: 'ramp-edit' },
        ...s.ramp.map((r, i) => h('div', { class: 'row tight' },
          `At ${n} ≥ `, h('input', { class: 'text-input mini', type: 'number', value: r.at, onchange: (e) => set((d) => { d.ramp[i].at = Math.round(Number(e.target.value)) || 0; }) }),
          ' bet ', h('select', { onchange: (e) => set((d) => { d.ramp[i].units = Number(e.target.value); }) },
            Array.from({ length: MAX_UNITS }, (_, u) => u + 1).map((u) => h('option', { value: u, selected: u === r.units }, money(u * RULES.minBet)))),
          h('button', { class: 'link', onclick: () => set((d) => { d.ramp.splice(i, 1); }) }, 'Remove'))),
        s.ramp.length < 10 ? h('button', { class: 'btn sm', onclick: () => set((d) => { const last = d.ramp[d.ramp.length - 1]; d.ramp.push({ at: last ? last.at + 1 : 2, units: Math.min(MAX_UNITS, last ? last.units + 1 : 2) }); }) }, 'Add a step') : null) : null);

    return h('div', { class: 'strat-detail' },
      h('div', { class: 'row spread' },
        edit ? h('input', { class: 'text-input strat-name', value: s.name, maxlength: 30, 'aria-label': 'Strategy name', onchange: (e) => set((d) => { d.name = e.target.value; }) }) : h('h2', {}, s.name),
        s.preset ? null : h('button', { class: `btn sm${edit ? ' primary' : ''}`, onclick: () => { editing = !editing; draw(); } }, edit ? 'Done' : 'Edit')),
      edit ? h('p', { class: 'muted' }, 'Tap a chart cell to change the play, set any card\'s count value, change an index or add one, and shape the bet ramp. Changes save as you go and the edge below re-simulates.') : null,
      s.preset ? (s.edge ? h('p', { class: 'strat-edge' }, edgeLine(s.edge, s), h('span', { class: 'muted small' }, ` · simulated over ${(s.edge.hands / 1e6).toFixed(0)} million hands`)) : null) : edgeBox,
      COMPUTED.has(s.id) ? h('p', { class: 'muted small' }, `The ${s.count.name} index numbers were computed by TrueCountLab's own simulator (the same method lands on the published Hi-Lo Illustrious 18 to within one point), so they can differ a little from the book's.`) : null,
      countEl,
      h('div', { class: 'legend' }, [['H', 'Hit'], ['S', 'Stand'], ['D', 'Double, else hit'], ['Ds', 'Double, else stand'], ['P', 'Split']].map(([c, t]) => h('span', {}, h('i', { class: `c-${c[0]}` }, c), t))),
      h('div', { class: 'charts' }, grid('Hard totals', 'hard', HARD_ROWS), grid('Soft totals', 'soft', SOFT_ROWS), grid('Pairs', 'pairs', PAIR_ROWS)),
      h('div', { class: 'chart-block' },
        h('h2', {}, 'Index plays'),
        h('p', { class: 'muted' }, s.devs.length ? `At or above the index (${n === 'RC' ? 'running count' : 'true count'}), make the first play; below it, the other one. ${s.devs.find((d) => d.kind === 'ins') ? devNote(s.devs.find((d) => d.kind === 'ins'), s) + '.' : 'Never take insurance.'}` : 'None: this strategy always plays the chart.'),
        s.devs.length ? h('div', { class: 'chart-scroll' }, h('table', { class: 'devs' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Hand'), h('th', {}, 'Index'), h('th', {}, 'At or above'), h('th', {}, 'Below'), edit ? h('th', {}, '') : null)),
          h('tbody', {}, devRows))) : null,
        addPlay),
      rampEl);
  }

  function draw() {
    const s = strategyById(viewing, mine());
    if (s.id !== viewing) viewing = s.id;
    root.replaceChildren(h('section', { class: 'view strategy-view' },
      head('Strategy', `Every mode grades you against the strategy you use. Pick a premade one, or copy one and change anything. ${RULES.text}.`),
      signedIn ? null : h('div', { class: 'guest-banner' },
        h('span', {}, 'Guests train with the TrueCountLab strategy. Create a free account to switch strategies or build your own.'),
        h('a', { class: 'btn primary sm', href: '#account?mode=signup' }, 'Create account')),
      h('h2', {}, 'Premade'),
      h('div', { class: 'strat-grid' }, PRESETS.map(card)),
      h('h2', {}, 'Yours'),
      mine().length ? h('div', { class: 'strat-grid' }, mine().map(card)) : h('p', { class: 'muted' }, signedIn ? 'None yet. Copy a premade strategy to start: everything in it is editable.' : 'Custom strategies are for accounts.'),
      detail(s)));
    drawEdge();
  }
  draw();
  const cur = strategyById(viewing, mine());
  if (!cur.preset) startSim(cur);
  return () => { clearTimeout(simTimer); if (worker) { worker.terminate(); worker = null; } };
}
