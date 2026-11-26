// Shared blackjack table inside an online room: five seats at one shoe. The server deals
// and grades; this draws the table and your controls, and plays the sounds.
import { h, cardEl, trayEl, numberField, signed, money, typingInField, pct } from '../ui.js';
import { sfx } from '../sfx.js';
import * as online from '../online.js';

const ACTS = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split' };
const ICON = { H: '+', S: '✋', D: '×2', P: '⇹' };

function chips(amount) {
  const list = [];
  let left = Math.floor(amount);
  for (const [d, c] of [[100, 'black'], [25, 'green'], [5, 'red'], [1, 'white']]) {
    while (left >= d && list.length < 6) { list.push(c); left -= d; }
  }
  return h('div', { class: 'st-chips', title: money(amount) },
    h('div', { class: 'pile' }, list.map((c, i) => h('i', { class: `pchip ${c}`, style: `--i:${i}` }))),
    h('span', { class: 'chip-amt' }, money(amount)));
}

export function tableUI() {
  const head = h('div', { class: 'st-head' });
  const dealerZone = h('div', { class: 'st-dealer' });
  const seatsRow = h('div', { class: 'st-seats' });
  const trayBox = h('div', { class: 'st-tray' });
  const eventsLine = h('div', { class: 'st-events', 'aria-live': 'polite' });
  const felt = h('div', { class: 'st-felt' }, trayBox, dealerZone, eventsLine, seatsRow);
  const dock = h('div', { class: 'st-dock' });
  const notes = h('div', { class: 'st-notes', 'aria-live': 'polite' });
  const el = h('div', { class: 'stable' }, head, felt, dock, notes);

  let g = null;
  let room = null;
  let dockKey = '';
  let deadlineAt = 0;
  let total = 0;
  let phaseKey = '';
  let cardsSeen = 0;
  let notesKey = null;
  let lastPhase = '';

  const tick = setInterval(() => {
    const t = el.querySelector('.st-time');
    if (!t || !deadlineAt) return;
    const left = Math.max(0, deadlineAt - performance.now());
    t.textContent = `${Math.ceil(left / 1000)}s`;
    const b = el.querySelector('.st-timebar i');
    if (b && total) b.style.width = `${(100 * left) / total}%`;
  }, 200);

  function update(r) {
    room = r;
    g = r.game;
    const now = performance.now();
    const key = `${g.phase}:${g.turn ? `${g.turn.seat}.${g.turn.hand}` : ''}`;
    if (key !== phaseKey) { phaseKey = key; total = g.deadlineIn || 0; }
    deadlineAt = g.deadlineIn != null ? now + g.deadlineIn : 0;
    sounds();
    drawHead();
    drawFelt();
    drawDock();
    drawNotes();
  }

  function sounds() {
    const n = g.dealer.length + g.seats.reduce((s, x) => s + (x ? x.hands.reduce((a, hd) => a + hd.cards.length, 0) : 0), 0);
    if (n > cardsSeen) sfx.deal();
    cardsSeen = n;
    if (g.phase === 'shuffle' && lastPhase !== 'shuffle') sfx.shuffle();
    const me = g.you && g.seats[g.you.seat];
    if (g.phase === 'settle' && lastPhase !== 'settle' && me?.net != null && me.hands.length) {
      if (me.hands.some((hd) => hd.result?.text === 'Blackjack!')) sfx.blackjack();
      else if (me.net > 0) sfx.win(); else if (me.net < 0) sfx.lose(); else sfx.push();
    }
    lastPhase = g.phase;
    const list = g.you?.notes || [];
    const last = list[list.length - 1];
    const k = last ? `${list.length}:${last.text}` : '';
    if (notesKey != null && k && k !== notesKey && /^✗/.test(last.text)) sfx.wrong();
    notesKey = k;
  }

  function drawHead() {
    const y = g.you;
    const s = y?.stats || {};
    head.replaceChildren(...[
      h('div', { class: 'muted st-rules' }, g.rules),
      y ? h('div', { class: 'st-mine' },
        h('span', {}, 'Stack ', h('strong', {}, money(y.stack)), h('span', { class: y.stack - 500 * y.buyIns >= 0 ? 'good' : 'bad' }, ` (${money(y.stack - 500 * y.buyIns, { sign: true })})`)),
        h('span', {}, `Plays ${pct(s.correct || 0, s.decisions || 0)}`),
        h('span', {}, `Bets ${pct(s.betsCorrect || 0, s.bets || 0)}`),
        h('span', {}, `Checks ${pct(s.checksCorrect || 0, s.checks || 0)}`),
        h('button', { class: 'btn sm ghost', onclick: () => online.game('stand') }, 'Leave seat')) : null].filter(Boolean));
  }

  function drawFelt() {
    trayBox.replaceChildren(trayEl(g.dealt, g.decks), h('span', { class: 'felt-tag' }, 'Discards'));
    dealerZone.replaceChildren(
      h('div', { class: 'zone-label' }, 'Dealer', g.dealerTotal != null ? h('span', { class: 'st-total' }, String(g.dealerTotal)) : null),
      h('div', { class: 'hand' }, g.dealer.length ? g.dealer.map((c) => cardEl(c, { down: c.down, size: 'sm' })) : [h('div', { class: 'slot' }), h('div', { class: 'slot' })]));
    eventsLine.textContent = g.events[g.events.length - 1] || '';
    const seated = Boolean(g.you);
    seatsRow.replaceChildren(...g.seats.map((s, i) => {
      if (!s) {
        return h('div', { class: 'st-seat empty' },
          seated ? h('span', { class: 'muted' }, 'Empty seat') : h('button', { class: 'btn sm', onclick: () => online.game('sit', { seat: i }) }, 'Sit here'));
      }
      const mine = s.id === room.youId;
      let status = '';
      if (!s.connected) status = 'offline';
      else if (s.waiting && g.phase === 'betting') status = 'betting…';
      else if (s.waiting && g.phase === 'insurance') status = 'insurance?';
      else if (s.waiting && g.phase === 'check') status = 'count check…';
      else if (g.phase === 'betting' && s.bet) status = `bet ${money(s.bet)}`;
      else if (s.out) status = 'sitting out';
      return h('div', { class: `st-seat${mine ? ' me' : ''}${g.turn?.seat === i ? ' turn' : ''}` },
        h('div', { class: 'st-hands' }, s.hands.map((hd, k) => h('div', { class: `st-hand${g.turn?.seat === i && g.turn.hand === k ? ' active' : ''}${hd.result ? ` ${hd.result.cls}` : ''}` },
          hd.result ? h('div', { class: 'result-bubble' }, hd.result.text) : null,
          h('div', { class: 'hand' }, hd.cards.map((c) => cardEl(c, { size: 'sm' }))),
          h('div', { class: 'st-hand-meta' }, hd.cards.length ? h('span', { class: 'st-total' }, `${hd.soft && hd.total < 21 ? 'soft ' : ''}${hd.total}`) : null, chips(hd.bet))))),
        h('div', { class: 'st-name' }, s.name, mine ? h('span', { class: 'tag you' }, 'you') : s.guest ? h('span', { class: 'tag' }, 'guest') : null),
        h('div', { class: 'st-sub muted' }, money(s.stack), status ? ` · ${status}` : '', s.net != null && g.phase === 'settle' && s.hands.length ? h('span', { class: s.net > 0 ? 'good' : s.net < 0 ? 'bad' : '' }, ` · ${money(s.net, { sign: true })}`) : null));
    }));
  }

  const timeBar = () => h('div', { class: 'st-timer' }, h('div', { class: 'st-timebar' }, h('i')), h('span', { class: 'st-time mono' }));

  function drawDock() {
    const y = g.you;
    const key = !y ? `watch:${g.seats.some((s) => !s)}` : `${phaseKey}:${Boolean(y.bet)}:${Boolean(y.insurance)}:${y.moves ? Object.values(y.moves).join() : ''}:${y.check ? JSON.stringify(y.check) : ''}`;
    if (key === dockKey) return;
    dockKey = key;
    if (!y) {
      return dock.replaceChildren(h('div', { class: 'st-msg' }, g.seats.some((s) => !s)
        ? 'You’re watching. Pick an empty seat to play: you get $500 in table chips.'
        : 'All five seats are taken. You can watch and chat until one opens.'));
    }
    if (y.bet) {
      return dock.replaceChildren(h('div', { class: 'st-controls' },
        h('div', { class: 'st-prompt' }, 'Place your bet', timeBar()),
        h('div', { class: 'bet-quick' }, [25, 50, 75].map((v, i) => h('button', {
          class: `chip-btn ${['green', 'orange', 'purple'][i]}`, disabled: v > y.bet.max,
          onclick: () => { sfx.chip(i + 1); online.game('bet', { amount: v }); },
        }, h('span', { class: 'chip-face' }, `$${v}`), h('kbd', {}, String(i + 1))))),
        h('button', { class: 'btn ghost sm', onclick: () => online.game('sitout') }, 'Sit out this hand')));
    }
    if (y.insurance) {
      return dock.replaceChildren(h('div', { class: 'st-controls' },
        h('div', { class: 'st-prompt' }, 'Dealer shows an ace. Insurance?', timeBar()),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => online.game('insurance', { take: true }) }, 'Take insurance', h('kbd', {}, 'Y')),
          h('button', { class: 'btn', onclick: () => online.game('insurance', { take: false }) }, 'No insurance', h('kbd', {}, 'N')))));
    }
    if (y.moves) {
      return dock.replaceChildren(h('div', { class: 'st-controls' },
        h('div', { class: 'st-prompt' }, 'Your turn', timeBar()),
        h('div', { class: 'table-acts four' }, Object.entries(ACTS).map(([k, label]) => h('button', {
          class: `btn act act-${k}`, disabled: !y.moves[k], onclick: () => act(k),
        }, h('span', { class: 'act-icon' }, ICON[k]), h('span', { class: 'act-label' }, label), h('kbd', {}, k))))));
    }
    if (y.check?.pending) {
      const rcF = numberField('Running count');
      const tcF = numberField('True count');
      dock.replaceChildren(h('form', {
        class: 'st-controls',
        onsubmit: (e) => { e.preventDefault(); if (rcF.value != null && tcF.value != null) online.game('check', { rc: rcF.value, tc: tcF.value }); },
      }, h('div', { class: 'st-prompt' }, 'Count check: what are the counts right now?', timeBar()),
      h('div', { class: 'check-fields' }, rcF.el, tcF.el, h('button', { class: 'btn primary', type: 'submit' }, 'Check'))));
      rcF.input.focus();
      return;
    }
    if (y.check && !y.check.pending && g.phase === 'check') {
      const c = y.check;
      return dock.replaceChildren(h('div', { class: 'st-msg' }, c.missed ? 'Time ran out on the count check.' : h('span', {},
        h('span', { class: c.rcOk ? 'good' : 'bad' }, `${c.rcOk ? '✓' : '✗'} Running ${signed(c.answer.rc)}`), ' · ',
        h('span', { class: c.tcOk ? 'good' : 'bad' }, `${c.tcOk ? '✓' : '✗'} True ${signed(c.answer.tc)} (${signed(c.answer.rc)} ÷ ${c.answer.est})`))));
    }
    const turn = g.turn ? g.seats[g.turn.seat] : null;
    const msg = {
      idle: 'Waiting for players…',
      betting: 'Bet placed. Waiting for the others…',
      shuffle: 'The dealer is shuffling a fresh shoe.',
      dealing: 'Dealing…',
      insurance: 'Waiting for the others to decide on insurance…',
      play: turn ? `${turn.name} is playing…` : 'Playing…',
      dealer: 'Dealer’s turn.',
      settle: 'Next hand in a moment.',
      check: 'Waiting for the others to finish the count check…',
    }[g.phase] || '';
    dock.replaceChildren(h('div', { class: 'st-msg muted' }, msg, ['play', 'betting', 'insurance', 'check'].includes(g.phase) ? timeBar() : null));
  }

  function act(k) {
    if (!g?.you?.moves?.[k]) return;
    sfx.click();
    online.game('act', { move: k });
  }

  function drawNotes() {
    const list = g.you?.notes || [];
    notes.hidden = !list.length;
    notes.replaceChildren(...list.slice(-5).map((n, i, a) => h('div', { class: `fb-line ${n.kind}${i === a.length - 1 ? ' latest' : ''}` }, n.text)));
  }

  function onKey(e) {
    if (!g?.you || typingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toUpperCase();
    const y = g.you;
    if (y.moves && ACTS[k]) { e.preventDefault(); act(k); } else if (y.bet && ['1', '2', '3'].includes(k)) {
      const v = [25, 50, 75][Number(k) - 1];
      if (v <= y.bet.max) { sfx.chip(Number(k)); online.game('bet', { amount: v }); }
    } else if (y.insurance && (k === 'Y' || k === 'N')) online.game('insurance', { take: k === 'Y' });
  }
  document.addEventListener('keydown', onKey);

  return { el, update, destroy() { clearInterval(tick); document.removeEventListener('keydown', onKey); } };
}
