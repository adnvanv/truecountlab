// Shared blackjack table inside an online room, drawn like the solo table: the big felt,
// your hand in the middle at full size, the other players beside you, your controls in
// the dock and your private hand log in the side column. The server deals and grades.
import { h, cardEl, trayEl, numberField, signed, money, typingInField, pct, shoePopup } from '../ui.js';
import { sfx, configure, shuffleShoe } from '../sfx.js';
import * as online from '../online.js';

const ACTS = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split' };
const ICON = { H: '+', S: '✋', D: '×2', P: '⇹' };
const SEATS = 5;

// Casino chips seen from above, like the solo table's betting circle.
function chipStack(amount) {
  const chips = [];
  let left = Math.floor(amount);
  for (const [d, c] of /** @type {[number, string][]} */ ([[100, 'black'], [25, 'green'], [5, 'red'], [1, 'white']])) {
    while (left >= d && chips.length < 8) { chips.push([d, c]); left -= d; }
  }
  return h('div', { class: 'chip-pile', title: money(amount), style: `--n:${chips.length}` },
    h('div', { class: 'pile' }, chips.map(([d, c], i) => h('i', { class: `pchip ${c}`, style: `--i:${i}` },
      i === chips.length - 1 ? h('span', {}, String(d)) : null))),
    h('span', { class: 'chip-amt' }, money(amount)));
}

// opts: { ctx, bar, chat, chatButton(cls), onLeave() }: the room's info bar, its players
// and chat panel, a maker for the chat button used on narrow screens, and how to leave.
export function tableUI({ ctx, bar, chat, chatButton, onLeave }) {
  const S = ctx.settings;
  const hud = h('div', { class: 'hud' });
  const mhud = h('div', { class: 'mhud' });
  const fb = h('div', { class: 'feedback', 'aria-live': 'polite', onclick: () => fb.classList.toggle('expanded') });
  const dealerZone = h('div', { class: 'zone dealer-zone' });
  const seatsZone = h('div', { class: 'zone seats' });
  const trayBox = h('div', { class: 'felt-tray' });
  const shoeEl = h('div', { class: 'felt-shoe', 'aria-hidden': 'true' }, h('div', { class: 'shoe-body' }, h('div', { class: 'shoe-card' })), h('span', { class: 'felt-tag' }, 'Shoe'));
  const arc = h('svg:svg', { class: 'felt-arc', viewBox: '0 0 600 110', 'aria-hidden': 'true' },
    h('svg:path', { id: 'arc-online', d: 'M 30 18 Q 300 150 570 18', fill: 'none' }),
    h('svg:path', { id: 'arc-onlineb', d: 'M 70 42 Q 300 160 530 42', fill: 'none' }),
    h('svg:text', { class: 'arc-big' }, h('svg:textPath', { href: '#arc-online', startOffset: '50%', 'text-anchor': 'middle' }, 'BLACKJACK PAYS 3 TO 2')),
    h('svg:text', { class: 'arc-small' }, h('svg:textPath', { href: '#arc-onlineb', startOffset: '50%', 'text-anchor': 'middle' }, 'Dealer stands on all 17s · Insurance pays 2 to 1')));
  const eventLine = h('div', { class: 'st-event', 'aria-live': 'polite' });
  const controls = h('div', { class: 'controls' });
  const felt = h('div', { class: 'felt' }, trayBox, shoeEl, dealerZone, arc, seatsZone);
  const el = h('section', { class: 'view table-view online-table' },
    h('div', { class: 'rules-line st-bar' }, bar),
    mhud,
    h('aside', { class: 'side' }, hud, fb, chat),
    felt,
    h('div', { class: 'dock' }, eventLine, controls));

  let g = null;
  let dockKey = '';
  let deadlineAt = 0;
  let total = 0;
  let phaseKey = '';
  let lastPhase = '';
  let notesKey = null;
  let seen = null; // cards already on screen per hand, so only new ones get the deal animation
  let next = {};
  let holeDown = false;

  const tick = setInterval(() => {
    if (!deadlineAt) return;
    const left = Math.max(0, deadlineAt - performance.now());
    for (const t of el.querySelectorAll('.st-time')) t.textContent = `${Math.ceil(left / 1000)}s`;
    for (const b of el.querySelectorAll('.st-timebar i')) b.style.width = total ? `${(100 * left) / total}%` : '0';
  }, 200);

  function update(r) {
    g = r.game;
    const now = performance.now();
    const key = `${g.phase}:${g.turn ? `${g.turn.seat}.${g.turn.hand}` : ''}`;
    if (key !== phaseKey) { phaseKey = key; total = g.deadlineIn || 0; }
    deadlineAt = g.deadlineIn != null ? now + g.deadlineIn : 0;
    sounds();
    drawHud();
    drawFelt();
    drawDock();
    drawLog();
  }

  const me = () => (g.you ? g.seats[g.you.seat] : null);
  // The server only lets you stand up between hands (or while you're not in this one).
  const canLeaveSeat = () => !me()?.hands.length || ['idle', 'betting', 'settle', 'check'].includes(g.phase);

  function sounds() {
    if (g.phase === 'shuffle' && lastPhase !== 'shuffle') {
      // The dealer is shuffling a new shoe: three riffles and the new-shoe pop-up.
      shuffleShoe();
      const cut = g.newShoe === 'cut';
      shoePopup(felt, {
        title: cut ? 'Cut card: new shoe' : 'Fresh shoe',
        sub: cut ? '75% of the shoe is dealt. The dealer shuffles all six decks.' : 'Six decks, shuffled.',
        lines: ['Running count back to 0', `Bets back to ${money(g.minBet)}`],
      }, Math.max(2200, (g.deadlineIn || 3200) - 200));
    }
    const s = me();
    if (g.phase === 'settle' && lastPhase !== 'settle' && s?.net != null && s.hands.length) {
      if (s.hands.some((hd) => hd.result?.text === 'Blackjack!')) sfx.blackjack();
      else if (s.net > 0) sfx.win(); else if (s.net < 0) sfx.lose(); else sfx.push();
    }
    lastPhase = g.phase;
    const list = g.you?.notes || [];
    const last = list[list.length - 1];
    const k = last ? `${list.length}:${last.text}` : '';
    if (notesKey != null && k && k !== notesKey && /^✗/.test(last.text)) sfx.wrong();
    notesKey = k;
  }

  function soundBtn(cls) {
    const label = S.sound.on ? 'Mute sounds' : 'Turn sounds on';
    return h('button', {
      class: `${cls} sound-btn`, title: label, 'aria-label': label,
      onclick: () => { S.sound.on = !S.sound.on; configure(S.sound); ctx.save(); if (S.sound.on) sfx.chip(1); drawHud(); },
    }, S.sound.on ? '🔊' : '🔇');
  }

  // ---- side stats (desktop) and the phone header -----------------------------
  function drawHud() {
    const stat = (k, v) => h('div', { class: 'stat' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
    const y = g.you;
    const st = y?.stats || {};
    const delta = y ? y.stack - 500 * y.buyIns : 0;
    hud.replaceChildren(
      h('div', { class: 'hud-info' },
        y ? stat('Table chips', `${money(y.stack)} (${money(delta, { sign: true })})`) : stat('Watching', 'Pick an empty seat'),
        stat('Plays', y ? `${pct(st.correct || 0, st.decisions || 0)} of ${st.decisions || 0}` : '—'),
        stat('Bets', y ? `${pct(st.betsCorrect || 0, st.bets || 0)} of ${st.bets || 0}` : '—'),
        stat('Count checks', y ? `${pct(st.checksCorrect || 0, st.checks || 0)} of ${st.checks || 0}` : '—'),
        stat('Hands', y ? String(st.hands || 0) : '—')),
      h('div', { class: 'hud-btns' },
        soundBtn('btn ghost'),
        y ? h('button', {
          class: 'btn sm ghost', disabled: !canLeaveSeat(), title: canLeaveSeat() ? 'Stand up and watch' : 'You can leave your seat once this hand is over',
          onclick: () => online.game('stand'),
        }, 'Leave seat') : null));
    mhud.replaceChildren(
      h('div', { class: 'm-stack' }, h('span', { class: 'k' }, y ? 'Chips' : 'Watching'),
        h('span', { class: 'v' }, y ? money(y.stack) : 'Pick a seat'),
        y ? h('span', { class: `m-delta ${delta >= 0 ? 'good' : 'bad'}` }, money(delta, { sign: true })) : null),
      chatButton('m-count'),
      soundBtn('m-icon'),
      h('button', { class: 'm-icon', title: 'Leave the room', 'aria-label': 'Leave the room', onclick: onLeave }, '✕'));
  }

  // ---- the felt ----------------------------------------------------------------
  function cards(list, key) {
    const before = seen?.[key] ?? (seen ? 0 : Infinity); // nothing animates on the very first draw
    next[key] = list.length;
    return list.map((c, i) => {
      const e = cardEl(c, { down: c.down, anim: i >= before });
      if (key === 'dealer' && i === 1 && holeDown && !c.down) e.classList.add('flip');
      return e;
    });
  }

  function drawFelt() {
    next = {};
    trayBox.replaceChildren(trayEl(g.dealt, g.decks), h('span', { class: 'felt-tag' }, 'Discards'));
    shoeEl.style.setProperty('--left', String(1 - g.dealt / (g.decks * 52)));
    dealerZone.replaceChildren(
      h('div', { class: 'zone-label' }, 'Dealer', g.dealerTotal != null ? h('span', { class: `badge${g.dealerTotal > 21 ? ' bust' : ''}` }, String(g.dealerTotal)) : null),
      h('div', { class: 'hand' }, g.dealer.length ? cards(g.dealer, 'dealer') : [h('div', { class: 'slot' }), h('div', { class: 'slot' })]));

    const mine = g.you ? g.you.seat : -1;
    // Seat 0 is first base, on the dealer's left: as you look at the table it's furthest right.
    const centre = mine >= 0 ? mine : 2;
    const left = [];
    const right = [];
    for (let i = SEATS - 1; i >= 0; i--) if (i !== centre) (i > centre ? left : right).push(i);
    const others = (list) => list.map((i) => otherSeat(g.seats[i], i));
    seatsZone.className = `zone seats o${left.length + right.length}`;
    seatsZone.replaceChildren(
      h('div', { class: 'others left' }, others(left)),
      mine >= 0 ? mySeat(g.seats[mine], mine) : watchSeat(centre),
      h('div', { class: 'others right' }, others(right)));
    seen = next;
    holeDown = g.dealer.some((c) => c.down);
  }

  const totalBadge = (hd) => (hd.cards.length
    ? h('span', { class: `badge${hd.total > 21 ? ' bust' : ''}` }, `${hd.soft && hd.total < 21 ? 'soft ' : ''}${hd.total}`) : null);
  const resultBadge = (hd) => h('span', { class: `badge ${hd.result.cls === 'win' ? 'bj' : hd.result.cls === 'lose' ? 'bust' : ''}` }, hd.result.text);

  function status(s) {
    if (!s.connected) return 'offline';
    if (s.waiting && g.phase === 'betting') return 'betting…';
    if (s.waiting && g.phase === 'insurance') return 'insurance?';
    if (s.waiting && g.phase === 'check') return 'count check…';
    if (s.out) return 'sitting out';
    return '';
  }

  function otherSeat(s, i) {
    if (!s) {
      return h('div', { class: 'seat other empty' },
        h('div', { class: 'hand' }, h('div', { class: 'slot' })),
        g.you ? h('div', { class: 'zone-label' }, 'Empty') : h('button', { class: 'btn sm sit-btn', onclick: () => online.game('sit', { seat: i }) }, 'Sit here'));
    }
    const turn = g.turn?.seat === i;
    const hands = s.hands.length ? s.hands : [null];
    const st = status(s);
    return h('div', { class: `seat other${turn ? ' turn' : ''}` },
      h('div', { class: 'other-hands' }, hands.map((hd, k) => h('div', { class: `other-hand${turn && g.turn.hand === k ? ' active' : ''}` },
        h('div', { class: 'hand' }, hd?.cards.length ? cards(hd.cards, `s${i}h${k}`) : h('div', { class: 'slot' })),
        h('div', { class: 'other-meta' }, hd ? (hd.result ? resultBadge(hd) : totalBadge(hd)) : null, hd?.bet ? h('span', { class: 'chip-amt' }, money(hd.bet)) : null)))),
      h('div', { class: 'zone-label' }, h('span', { class: 'o-name' }, s.name), s.guest ? h('span', { class: 'tag' }, 'guest') : null),
      h('div', { class: 'o-sub' }, money(s.stack), st ? ` · ${st}` : '',
        s.net != null && g.phase === 'settle' && s.hands.length ? h('span', { class: s.net > 0 ? 'good' : s.net < 0 ? 'bad' : '' }, ` · ${money(s.net, { sign: true })}`) : null));
  }

  function mySeat(s, i) {
    const turn = g.turn?.seat === i;
    const handEls = s.hands.length
      ? s.hands.map((hd, k) => h('div', { class: `my-hand${turn && g.turn.hand === k ? ' active' : ''}${hd.result ? ` ${hd.result.cls}` : ''}` },
        hd.result ? h('div', { class: 'result-bubble' }, hd.result.text) : null,
        h('div', { class: 'hand' }, cards(hd.cards, `s${i}h${k}`)),
        h('div', { class: 'hand-meta' }, totalBadge(hd)),
        h('div', { class: 'bet-spot' }, chipStack(hd.bet))))
      : [h('div', { class: 'my-hand empty' },
        h('div', { class: 'hand' }, h('div', { class: 'slot' }), h('div', { class: 'slot' })),
        h('div', { class: 'bet-spot' }, s.bet ? chipStack(s.bet) : h('span', { class: 'muted' }, s.out ? 'Out' : 'Bet')))];
    return h('div', { class: 'seat me' },
      h('div', { class: `my-hands n${Math.max(1, s.hands.length)}` }, handEls),
      h('div', { class: 'zone-label you' }, 'You'));
  }

  // Watching: the middle seat is drawn like the others, with a prompt to sit.
  function watchSeat(i) {
    return h('div', { class: 'seat me watching' },
      otherSeat(g.seats[i], i),
      h('div', { class: 'zone-label you' }, g.seats.some((s) => !s) ? 'Watching: pick a seat' : 'Watching: the table is full'));
  }

  // ---- your controls -------------------------------------------------------------
  const timeBar = () => h('span', { class: 'st-timer' }, h('span', { class: 'st-timebar' }, h('i')), h('span', { class: 'st-time mono' }));

  function drawDock() {
    eventLine.textContent = g.events[g.events.length - 1] || '';
    const y = g.you;
    const key = !y ? `watch:${g.seats.some((s) => !s)}` : `${phaseKey}:${Boolean(y.bet)}:${Boolean(y.insurance)}:${y.moves ? Object.values(y.moves).join() : ''}:${y.check ? JSON.stringify(y.check) : ''}`;
    if (key === dockKey) return;
    dockKey = key;
    if (!y) {
      return controls.replaceChildren(h('div', { class: 'st-msg muted' }, g.seats.some((s) => !s)
        ? 'You’re watching. Press “Sit here” on an empty seat to play with $500 in table chips.'
        : 'All five seats are taken. You can watch and chat until one opens.'));
    }
    if (y.bet) {
      return controls.replaceChildren(
        h('div', { class: 'st-prompt' }, 'Place your bet', timeBar()),
        h('div', { class: 'bet-row' },
          h('div', { class: 'bet-quick' }, [25, 50, 75].map((v, i) => h('button', {
            class: `chip-btn ${['green', 'orange', 'purple'][i]}`, disabled: v > y.bet.max, 'aria-label': `Bet $${v}`,
            onclick: () => bet(v, i + 1),
          }, h('span', { class: 'chip-face' }, `$${v}`), h('kbd', {}, String(i + 1))))),
          h('button', { class: 'btn ghost deal', onclick: () => online.game('sitout') }, 'Sit out this hand')));
    }
    if (y.insurance) {
      return controls.replaceChildren(h('div', { class: 'ins-row' },
        h('div', { class: 'st-prompt' }, 'Dealer shows an ace. Insurance?', timeBar()),
        h('div', { class: 'ins-btns' },
          h('button', { class: 'btn', onclick: () => online.game('insurance', { take: true }) }, 'Take insurance', h('kbd', {}, 'Y')),
          h('button', { class: 'btn', onclick: () => online.game('insurance', { take: false }) }, 'No insurance', h('kbd', {}, 'N')))));
    }
    if (y.moves) {
      return controls.replaceChildren(
        h('div', { class: 'st-prompt' }, 'Your turn', timeBar()),
        h('div', { class: 'table-acts four' }, Object.entries(ACTS).map(([k, label]) => h('button', {
          class: `btn act act-${k}`, disabled: !y.moves[k], onclick: () => act(k),
        }, h('span', { class: 'act-icon' }, ICON[k]), h('span', { class: 'act-label' }, label), h('kbd', {}, k)))));
    }
    if (y.check?.pending) {
      const rcF = numberField('Running count');
      const tcF = numberField('True count');
      controls.replaceChildren(h('form', {
        class: 'check',
        onsubmit: (e) => { e.preventDefault(); if (rcF.value != null && tcF.value != null) online.game('check', { rc: rcF.value, tc: tcF.value }); },
      },
      h('div', { class: 'check-title' }, 'Count check ', timeBar()),
      h('div', { class: 'check-fields' }, rcF.el, tcF.el, h('button', { class: 'btn primary', type: 'submit' }, 'Check'))));
      rcF.input.focus();
      return;
    }
    if (y.check && g.phase === 'check') {
      const c = y.check;
      return controls.replaceChildren(h('div', { class: 'st-msg' }, c.missed
        ? h('span', { class: 'bad' }, `✗ Time ran out. Running ${signed(c.answer.rc)}, true ${signed(c.answer.tc)} (${signed(c.answer.rc)} ÷ ${c.answer.est})`)
        : h('span', {},
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
    controls.replaceChildren(h('div', { class: 'st-msg muted' }, msg, ['play', 'betting', 'insurance', 'check'].includes(g.phase) ? timeBar() : null));
  }

  function bet(v, n) {
    if (!g?.you?.bet || v > g.you.bet.max) return;
    sfx.chip(n);
    online.game('bet', { amount: v });
  }

  function act(k) {
    if (!g?.you?.moves?.[k]) return;
    sfx.click();
    online.game('act', { move: k });
  }

  // ---- your hand log -----------------------------------------------------------
  function drawLog() {
    const list = g.you?.notes || [];
    fb.replaceChildren(...list.map((n, i) => {
      const cls = `fb-line ${n.kind} ${n.cat || ''}${i === list.length - 1 ? ' latest' : ''}`;
      const m = n.text.match(/^([✓✗])\s*([\s\S]*)$/);
      if (!m) return h('div', { class: cls }, n.text);
      const ok = m[1] === '✓';
      const tag = { play: ok ? 'Correct' : 'Wrong', bet: ok ? 'Bet OK' : 'Bet off', check: ok ? 'Count OK' : 'Count off' }[n.cat] || '';
      return h('div', { class: cls },
        h('span', { class: 'fb-icon', 'aria-hidden': 'true' }, m[1]),
        h('span', { class: 'fb-text' }, tag ? h('b', { class: 'fb-tag' }, tag) : null, m[2]));
    }));
    fb.scrollTop = fb.scrollHeight;
  }

  function onKey(e) {
    if (!g?.you || typingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toUpperCase();
    const y = g.you;
    if (y.moves && ACTS[k]) { e.preventDefault(); act(k); } else if (y.bet && ['1', '2', '3'].includes(k)) bet([25, 50, 75][Number(k) - 1], Number(k));
    else if (y.insurance && (k === 'Y' || k === 'N')) online.game('insurance', { take: k === 'Y' });
  }
  document.addEventListener('keydown', onKey);

  return { el, update, destroy() { clearInterval(tick); document.removeEventListener('keydown', onKey); } };
}
