// Progress across every mode.
import { h, head, pct, money } from '../ui.js';

const tile = (title, rows, footer) => h('div', { class: 'tile' },
  h('h2', {}, title),
  h('dl', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
  footer || null);

export function mount(root, ctx) {
  const draw = () => {
    const s = ctx.stats;
    const t = s.table;
    const misses = {};
    for (const src of [t.misses, s.strategy.misses]) for (const [k, v] of Object.entries(src)) misses[k] = (misses[k] || 0) + v;
    const weak = Object.entries(misses).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const deckAvg = (() => {
      const ok = s.deck.history.filter((r) => r.ok).slice(-5);
      return ok.length ? `${(ok.reduce((a, r) => a + r.ms, 0) / ok.length / 1000).toFixed(1)}s` : '—';
    })();
    const speedTop = s.speed.history.filter((r) => r.ok).reduce((m, r) => (m == null || r.ms < m.ms ? r : m), null);

    root.replaceChildren(h('section', { class: 'view' },
      head('Stats', 'Saved on your Optiplex, so progress follows you between devices.'),
      h('div', { class: 'tiles' },
        tile('Table', [
          ['Hands played', t.hands],
          ['Decisions correct', `${pct(t.correct, t.decisions)} (${t.correct}/${t.decisions})`],
          ['Index plays correct', `${pct(t.devsCorrect, t.devs)} (${t.devsCorrect}/${t.devs})`],
          ['Count checks', `${pct(t.checksCorrect, t.checks)} (${t.checksCorrect}/${t.checks})`],
          ['Bets on the ramp', `${pct(t.betsCorrect, t.bets)}`],
          ['Count peeks', t.peeks],
          ['Net result', money(t.net)],
          ['Bankroll', t.bankroll == null ? '—' : money(t.bankroll)],
        ]),
        tile('Speed Count', [
          ['Runs', s.speed.attempts],
          ['Accuracy', pct(s.speed.correct, s.speed.attempts)],
          ['Fastest correct', speedTop ? `${speedTop.ms} ms/flash · ${speedTop.n} cards` : '—'],
        ]),
        tile('Deck Countdown', [
          ['Runs', s.deck.attempts],
          ['Accuracy', pct(s.deck.correct, s.deck.attempts)],
          ['Best time', s.deck.best ? `${(s.deck.best / 1000).toFixed(1)}s` : '—'],
          ['Avg (last 5 correct)', deckAvg],
        ]),
        tile('True Count', [
          ['Attempts', s.truecount.attempts],
          ['Accuracy', pct(s.truecount.correct, s.truecount.attempts)],
          ['Best streak', s.truecount.bestStreak],
        ]),
        tile('Strategy Drill', [
          ['Attempts', s.strategy.attempts],
          ['Accuracy', pct(s.strategy.correct, s.strategy.attempts)],
          ['Best streak', s.strategy.bestStreak],
        ]),
        h('div', { class: 'tile' },
          h('h2', {}, 'Weak spots'),
          weak.length
            ? h('ol', { class: 'weak' }, weak.map(([k, v]) => h('li', {}, h('span', {}, k), h('span', { class: 'muted' }, `${v} miss${v === 1 ? '' : 'es'}`))))
            : h('p', { class: 'muted' }, 'No misses recorded yet.'))),
      h('div', { class: 'row' }, h('button', {
        class: 'btn danger',
        onclick: () => {
          if (!confirm('Reset all stats and the table bankroll? Settings are kept.')) return;
          ctx.resetStats();
          draw();
        },
      }, 'Reset stats'))));
  };
  draw();
}
