// Count battle screen inside an online room. The server sends the whole state; this
// draws it and sends answers back. Answer fields are kept across updates so typing
// isn't interrupted when someone else answers.
import { h, cardEl, numberField, signed, typingInField } from '../ui.js';
import { sfx } from '../sfx.js';
import * as online from '../online.js';

const TYPE_NAME = { rc: 'Running count', play: 'Play the hand' };
const TYPE_HELP = {
  rc: 'Cards flash by. Keep the room’s count (from 0), then type it.',
  play: 'Pick the right play at this true count, deviations included.',
};
const ACTS = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split' };
const shown = (type, v) => (v == null ? 'no answer' : type === 'play' ? ACTS[v] : signed(v));

export function battleUI() {
  const top = h('div', { class: 'b-top' });
  const bar = h('i');
  const timer = h('div', { class: 'b-timer', 'aria-hidden': 'true' }, bar);
  const stage = h('div', { class: 'b-stage' });
  const form = h('div', { class: 'b-form' });
  const board = h('div', { class: 'b-board' });
  const el = h('div', { class: 'battle' }, top, timer, stage, form, board);

  let g = null;
  let room = null;
  let phaseKey = '';
  let stageKey = '';
  let formKey = '';
  let deadlineAt = 0;
  let total = 0;
  let autoAt = 0;
  let lastCard = -1;
  let revealed = '';

  const tick = setInterval(drawTimer, 100);
  function drawTimer() {
    const now = performance.now();
    if (g && ['intro', 'show', 'answer', 'reveal'].includes(g.phase) && deadlineAt && total) {
      const left = Math.max(0, deadlineAt - now);
      bar.style.width = `${(100 * left) / total}%`;
      timer.classList.toggle('low', g.phase === 'answer' && left < 3000);
      timer.hidden = g.phase === 'show';
      const n = el.querySelector('.b-count');
      if (n) n.textContent = String(Math.ceil(left / 1000));
    } else timer.hidden = true;
    const a = el.querySelector('.b-auto');
    if (a && autoAt) a.textContent = `Starting by itself in ${Math.max(0, Math.ceil((autoAt - now) / 1000))}s.`;
  }

  function update(r) {
    room = r;
    g = r.game;
    const now = performance.now();
    const key = `${g.phase}:${g.round?.i ?? ''}`;
    if (key !== phaseKey) {
      phaseKey = key;
      total = g.deadlineIn || 0;
    }
    deadlineAt = g.deadlineIn != null ? now + g.deadlineIn : 0;
    autoAt = g.autoStartIn != null ? now + g.autoStartIn : 0;
    drawTop();
    drawStage();
    drawForm();
    drawBoard();
    drawTimer();
  }

  const isHost = () => room && room.hostId === room.youId;
  const myScore = () => g.players.find((p) => p.id === room.youId);

  function drawTop() {
    const me = myScore();
    if (g.round) {
      top.replaceChildren(
        h('div', { class: 'b-round' }, h('strong', {}, `Round ${g.round.i + 1} of ${g.round.n}`), h('span', { class: 'muted' }, ` · ${TYPE_NAME[g.round.type]}`)),
        me ? h('div', { class: 'b-score' }, h('span', { class: 'muted' }, 'Your score '), h('strong', {}, String(me.score))) : h('span', { class: 'muted' }, 'Watching'));
    } else {
      top.replaceChildren(h('div', { class: 'b-round' }, h('strong', {}, g.phase === 'final' ? 'Battle over' : g.phase === 'intro' ? 'Get ready' : 'Waiting to start')));
    }
  }

  function drawStage() {
    const r = g.round;
    // Redraw when anything shown changes: the card, settings, who hosts, how many are here.
    const here = room.members.filter((m) => m.connected).length;
    const lobbyish = g.phase === 'waiting' || g.phase === 'final';
    const key = `${phaseKey}:${g.phase === 'show' ? r.index : ''}:${lobbyish ? `${JSON.stringify(g.settings)}:${isHost()}:${here}:${g.autoStartIn != null}` : ''}:${g.phase === 'final' ? JSON.stringify(g.final) : ''}`;
    if (key === stageKey) return;
    stageKey = key;
    if (g.phase === 'waiting') return stage.replaceChildren(waiting());
    if (g.phase === 'intro') {
      return stage.replaceChildren(h('div', { class: 'b-intro' },
        h('div', { class: 'b-count' }, '3'),
        h('p', { class: 'muted' }, `${g.settings.rounds} rounds. Right answers score 100, plus up to 100 more for speed.`)));
    }
    if (g.phase === 'final') return stage.replaceChildren(finalView());
    if (g.phase === 'show') {
      if (r.index !== lastCard) { lastCard = r.index; sfx.tick(); }
      return stage.replaceChildren(h('div', { class: 'b-flash' },
        h('div', { class: 'flash' }, cardEl(r.card, { size: 'lg' })),
        h('div', { class: 'muted b-progress' }, `${r.index + 1} / ${r.total}`)));
    }
    lastCard = -1;
    const parts = [];
    if (r.type === 'rc') parts.push(h('div', { class: 'b-q' }, `${r.total} cards. What's the running count?`));
    if (r.type === 'play') {
      parts.push(h('div', { class: 'b-hand' },
        h('div', {}, h('div', { class: 'zone-label' }, 'Dealer'), h('div', { class: 'hand' }, cardEl(r.up))),
        h('div', {}, h('div', { class: 'zone-label' }, 'You'), h('div', { class: 'hand' }, r.cards.map((c) => cardEl(c)))),
        h('div', { class: 'tc-pill big-pill' }, `${r.idx || 'TC'} ${signed(r.tc)}`)));
    }
    if (g.phase === 'answer') parts.push(h('p', { class: 'muted b-help' }, TYPE_HELP[r.type]));
    if (g.phase === 'reveal') parts.push(revealView());
    stage.replaceChildren(...parts);
  }

  function revealView() {
    const r = g.round;
    const me = myScore();
    const last = me?.last;
    const tag = `${r.i}`;
    if (revealed !== tag && last) { revealed = tag; if (last.ok) sfx.right(); else sfx.wrong(); }
    return h('div', { class: 'b-reveal' },
      h('div', { class: 'b-answer' }, h('span', { class: 'muted' }, 'Answer '), h('strong', {}, shown(r.type, r.answer))),
      h('div', { class: 'muted' }, r.explain),
      last ? h('div', { class: `b-you ${last.ok ? 'good' : 'bad'}` }, last.ok
        ? `✓ +${last.points} points${last.ms != null ? ` (${(last.ms / 1000).toFixed(1)}s)` : ''}`
        : `✗ ${last.value == null ? 'No answer' : `You said ${shown(r.type, last.value)}`}`) : null);
  }

  function waiting() {
    const host = isHost();
    const types = [['rc', 'Running count'], ['play', 'Play the hand']];
    const n = room.members.filter((m) => m.connected).length;
    const settings = host
      ? h('div', { class: 'b-settings' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Strategy'),
          h('select', { onchange: (e) => online.game('settings', { settings: { ...g.settings, strategy: e.target.value } }) },
            (g.strategies || []).map((x) => h('option', { value: x.id, selected: x.id === g.settings.strategy }, x.name)))),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Rounds'),
          h('select', { onchange: (e) => online.game('settings', { settings: { ...g.settings, rounds: Number(e.target.value) } }) },
            g.roundCounts.map((c) => h('option', { value: c, selected: c === g.settings.rounds }, String(c))))),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Round types'),
          h('div', { class: 'row tight' }, types.map(([t, label]) => h('label', { class: 'check-opt' },
            h('input', {
              type: 'checkbox', checked: g.settings.types.includes(t),
              onchange: (e) => {
                const next = e.target.checked ? [...g.settings.types, t] : g.settings.types.filter((x) => x !== t);
                if (!next.length) { e.target.checked = true; return; }
                online.game('settings', { settings: { ...g.settings, types: next } });
              },
            }), label)))))
      : h('p', { class: 'muted' }, `${g.strategyName || 'TrueCountLab'} strategy · ${g.settings.rounds} rounds: ${g.settings.types.map((t) => TYPE_NAME[t].toLowerCase()).join(', ')}.`);
    return h('div', { class: 'b-wait' },
      h('p', {}, `Everyone gets the same question at the same moment and plays the same strategy (${g.strategyName || 'TrueCountLab'}). Right answers score 100 points, plus up to 100 more the faster you answer. Wrong or no answer scores 0.`),
      settings,
      h('div', { class: 'row' },
        host ? h('button', { class: 'btn primary', onclick: () => online.game('start') }, n > 1 ? `Start battle (${n} players)` : 'Start (just you)') : h('span', { class: 'muted' }, 'Waiting for the host to start.'),
        g.autoStartIn != null ? h('span', { class: 'b-auto muted' }) : null),
      room.visibility === 'private' && n < 2 ? h('p', { class: 'muted' }, 'Share the invite link to bring friends in.') : null);
  }

  function finalView() {
    const list = g.final || [];
    const medal = (p) => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : String(p));
    return h('div', { class: 'b-final' },
      h('ol', { class: 'b-standings' }, list.map((p) => h('li', { class: p.id === room.youId ? 'me' : '' },
        h('span', { class: 'place' }, medal(p.place)),
        h('span', { class: 'who' }, p.name, p.guest ? h('span', { class: 'tag' }, 'guest') : null),
        h('span', { class: 'pts mono' }, String(p.score)),
        h('span', { class: 'muted' }, `${p.correct} right`),
        p.rating ? h('span', { class: `rating ${p.rating.after >= p.rating.before ? 'good' : 'bad'}` },
          `${p.rating.after >= p.rating.before ? '+' : '−'}${Math.abs(p.rating.after - p.rating.before)} → ${p.rating.after}`) : h('span', {})))),
      list.some((p) => p.rating) ? null : h('p', { class: 'muted' }, 'Ratings change when two or more signed-in players battle.'),
      h('div', { class: 'row' },
        isHost() ? h('button', { class: 'btn primary', onclick: () => online.game('start') }, 'Play again') : h('span', { class: 'muted' }, 'Waiting for the host to start another battle.'),
        g.autoStartIn != null ? h('span', { class: 'b-auto muted' }) : null));
  }

  function drawForm() {
    const r = g.round;
    const playing = g.you.playing;
    const key = `${phaseKey}:${playing}:${g.you.answered}`;
    if (key === formKey) return;
    formKey = key;
    if (g.phase !== 'answer' && !(g.phase === 'show' && !playing)) return form.replaceChildren();
    if (!playing) return form.replaceChildren(h('p', { class: 'muted' }, 'You’re watching this battle. You’ll play in the next one.'));
    if (g.you.answered) {
      return form.replaceChildren(h('div', { class: 'b-locked' }, `Locked in: ${shown(r.type, g.you.answer)}. Waiting for the others…`));
    }
    if (r.type === 'play') {
      return form.replaceChildren(h('div', { class: 'actions four' }, Object.entries(ACTS).map(([k, label]) => h('button', {
        class: `btn act act-${k}`, disabled: k === 'P' && !r.canSplit,
        onclick: () => answer(k),
      }, label, h('kbd', {}, k)))));
    }
    const f = numberField(r.type === 'rc' ? 'Running count' : 'True count');
    form.replaceChildren(h('form', {
      class: 'answer-form',
      onsubmit: (e) => { e.preventDefault(); if (f.value != null) answer(f.value); },
    }, f.el, h('button', { class: 'btn primary', type: 'submit' }, 'Lock in')));
    f.input.focus();
  }

  function answer(value) {
    if (!g || g.phase !== 'answer' || g.you.answered) return;
    sfx.click();
    online.game('answer', { value });
  }

  function drawBoard() {
    if (!g.players.length || g.phase === 'final') {
      board.replaceChildren();
      return;
    }
    const list = [...g.players].sort((a, b) => b.score - a.score);
    board.replaceChildren(h('ol', { class: 'b-scores' }, list.map((p) => {
      let status = null;
      if (g.phase === 'answer') status = p.answered ? h('span', { class: 'good' }, '✓') : h('span', { class: 'muted' }, '…');
      if (g.phase === 'reveal' && p.last) status = h('span', { class: p.last.ok ? 'good' : 'bad' }, p.last.ok ? `+${p.last.points}` : `✗ ${p.last.value == null ? '—' : shown(g.round.type, p.last.value)}`);
      return h('li', { class: p.id === room.youId ? 'me' : '' },
        h('span', { class: 'who' }, p.name, p.guest ? h('span', { class: 'tag' }, 'guest') : null, p.connected ? null : h('span', { class: 'tag off' }, 'offline')),
        h('span', { class: 'st' }, status),
        h('span', { class: 'pts mono' }, String(p.score)));
    })));
  }

  function onKey(e) {
    if (!g || g.phase !== 'answer' || g.round?.type !== 'play' || typingInField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toUpperCase();
    if (ACTS[k] && !(k === 'P' && !g.round.canSplit)) { e.preventDefault(); answer(k); }
  }
  document.addEventListener('keydown', onKey);

  return { el, update, destroy() { clearInterval(tick); document.removeEventListener('keydown', onKey); } };
}
