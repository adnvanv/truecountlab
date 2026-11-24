// Strategy drill: random hand vs upcard, pick the play.
import { h, cardEl, signed, head, field, select, typingInField } from '../ui.js';
import { randInt, pick, makeCard, cardForValue, KEYS, TENS } from '../cards.js';
import { correctAction, insuranceCorrect, applicableDevs, devIndex, handLabel, upLabel, ACTIONS, CODE_TEXT } from '../strategy.js';

export function mount(root, ctx) {
  const S = ctx.settings;
  const cfg = S.stratDrill;
  const st = ctx.stats.strategy;
  const rules = { h17: S.h17, das: S.das, surrender: S.surrender };
  const canDev = S.system === 'hilo';
  let sc = null;
  let answered = false;
  let autoTimer = null;

  const stage = h('div', { class: 'strat-stage' });
  const buttons = h('div', { class: 'actions' });
  const result = h('div', { class: 'answer' });
  const record = h('div', { class: 'mini-stats' });

  const rulesText = `${S.decks} decks, ${S.h17 ? 'H17' : 'S17'}, ${S.das ? 'DAS' : 'no DAS'}${S.surrender ? ', late surrender' : ''}`;
  root.append(h('section', { class: 'view' },
    head('Strategy Drill', `Pick the right play. Rules: ${rulesText} (change in Settings).`),
    h('div', { class: 'panel toolbar' },
      field('Index plays', canDev
        ? select([['1', 'Include (Hi-Lo I18 + Fab 4)'], ['0', 'Basic strategy only']], cfg.devs ? '1' : '0', (v) => { cfg.devs = v === '1'; ctx.save(); next(); })
        : h('span', { class: 'static' }, 'Hi-Lo only')),
      field('After a correct answer', select([['1', 'Auto-advance'], ['0', 'Wait']], cfg.auto ? '1' : '0', (v) => { cfg.auto = v === '1'; ctx.save(); }))),
    stage, buttons, result, record));

  const devMode = () => canDev && cfg.devs;

  function hardCards(total) {
    const opts = [];
    for (let a = 2; a <= 10; a++) { const b = total - a; if (b >= 2 && b <= 10 && b !== a) opts.push([a, b]); }
    const [a, b] = opts.length ? pick(opts) : [total / 2, total / 2];
    return [cardForValue(a), cardForValue(b)];
  }

  function upcard(v) { return v ? cardForValue(v) : makeCard(pick(['A', '2', '3', '4', '5', '6', '7', '8', '9', ...TENS])); }

  function scenario() {
    if (devMode()) {
      const devs = applicableDevs(rules);
      if (Math.random() < 0.5) {
        const d = pick(devs);
        const tc = devIndex(d, rules) + randInt(5) - 2;
        if (d.kind === 'ins') return { type: 'ins', up: makeCard('A'), tc };
        const cards = d.kind === 'pair' ? [makeCard(pick(TENS)), makeCard(pick(TENS))] : hardCards(d.total);
        return { type: 'play', cards, up: cardForValue(d.up), tc };
      }
    }
    const tc = devMode() ? randInt(9) - 3 : null;
    const r = Math.random();
    let cards;
    if (r < 0.25) {
      const k = pick(KEYS);
      const rank = k === 'T' ? pick(TENS) : k;
      cards = [makeCard(rank), makeCard(k === 'T' ? pick(TENS) : rank)];
    } else if (r < 0.5) {
      cards = [makeCard('A'), cardForValue(2 + randInt(8))];
    } else {
      cards = hardCards(5 + randInt(15));
    }
    return { type: 'play', cards, up: upcard(), tc };
  }

  function next() {
    clearTimeout(autoTimer);
    sc = scenario();
    answered = false;
    result.replaceChildren();
    render();
  }

  function render() {
    const tcTag = sc.tc != null ? h('div', { class: 'tc-pill mono' }, `TC ${signed(sc.tc)}`) : null;
    if (sc.type === 'ins') {
      stage.replaceChildren(
        h('div', { class: 'strat-hand' }, h('div', { class: 'k' }, 'Dealer'), h('div', { class: 'hand' }, cardEl(sc.up))),
        h('div', { class: 'strat-q' }, tcTag, h('div', {}, 'Take insurance?')));
      buttons.replaceChildren(
        h('button', { class: 'btn act', onclick: () => answer('Y') }, 'Yes', h('kbd', {}, 'Y')),
        h('button', { class: 'btn act', onclick: () => answer('N') }, 'No', h('kbd', {}, 'N')));
      return;
    }
    const pair = sc.cards[0].rank === sc.cards[1].rank || (TENS.includes(sc.cards[0].rank) && TENS.includes(sc.cards[1].rank));
    stage.replaceChildren(
      h('div', { class: 'strat-hand' }, h('div', { class: 'k' }, 'Dealer'), h('div', { class: 'hand' }, cardEl(sc.up))),
      h('div', { class: 'strat-q' }, tcTag),
      h('div', { class: 'strat-hand' }, h('div', { class: 'k' }, `You · ${handLabel(sc.cards)}`), h('div', { class: 'hand' }, sc.cards.map((c) => cardEl(c)))));
    const acts = ['H', 'S', 'D', 'P'].concat(rules.surrender ? ['R'] : []);
    buttons.replaceChildren(...acts.map((a) => h('button', {
      class: `btn act act-${a}`, disabled: a === 'P' && !pair, onclick: () => answer(a),
    }, h('span', {}, ACTIONS[a]), h('kbd', {}, a))));
  }

  function answer(a) {
    if (answered) return;
    answered = true;
    let ok;
    let label;
    let explain;
    if (sc.type === 'ins') {
      const right = insuranceCorrect(sc.tc, true) ? 'Y' : 'N';
      ok = a === right;
      label = 'Insurance';
      explain = `Insurance: take at TC ≥ +3. At TC ${signed(sc.tc)} → ${right === 'Y' ? 'take it' : 'decline'}.`;
    } else {
      const up = upValueOf(sc.up);
      const o = { canDouble: true, canSplit: true, canSurrender: rules.surrender, das: rules.das };
      const res = correctAction(sc.cards, up, rules, o, sc.tc, devMode());
      ok = a === res.action;
      label = `${handLabel(sc.cards)} vs ${upLabel(up)}`;
      explain = res.dev
        ? `${res.note}. At TC ${signed(sc.tc)} → ${ACTIONS[res.action]}.${res.basic !== res.action ? ` (Basic strategy alone says ${ACTIONS[res.basic]}.)` : ''}`
        : `Basic strategy: ${CODE_TEXT[res.info.code] || ACTIONS[res.action]}.`;
      if (!ok) explain = `Correct play: ${ACTIONS[res.action]}. ${explain}`;
    }
    st.attempts++;
    if (ok) { st.correct++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); }
    else { st.streak = 0; st.misses[label] = (st.misses[label] || 0) + 1; }
    ctx.save();
    for (const b of buttons.querySelectorAll('button')) b.disabled = true;
    result.replaceChildren(
      h('div', { class: `verdict ${ok ? 'good' : 'bad'}` }, ok ? '✓ Correct' : '✗ Not quite'),
      h('div', { class: 'muted' }, explain),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: next }, 'Next', h('kbd', {}, 'Enter'))));
    renderRecord();
    if (ok && cfg.auto) autoTimer = setTimeout(next, 900);
  }

  function upValueOf(card) { return card.rank === 'A' ? 11 : TENS.includes(card.rank) ? 10 : Number(card.rank); }

  function renderRecord() {
    record.replaceChildren(
      h('span', {}, `Streak ${st.streak} (best ${st.bestStreak})`),
      h('span', {}, `Accuracy ${st.attempts ? Math.round((100 * st.correct) / st.attempts) : 0}% (${st.attempts})`));
  }

  function onKey(e) {
    if (typingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (answered && (k === 'enter' || k === ' ')) { e.preventDefault(); next(); return; }
    if (answered) return;
    if (sc.type === 'ins' && (k === 'y' || k === 'n')) answer(k.toUpperCase());
    else if (sc.type === 'play' && k.length === 1 && 'hsdpr'.includes(k)) {
      const btn = [...buttons.querySelectorAll('button')].find((b) => b.querySelector('kbd')?.textContent === k.toUpperCase());
      if (btn && !btn.disabled) answer(k.toUpperCase());
    }
  }
  addEventListener('keydown', onKey);
  renderRecord();
  next();

  return () => { clearTimeout(autoTimer); removeEventListener('keydown', onKey); };
}
