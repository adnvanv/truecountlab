// Session log (mode 8): simulator sessions log themselves; real casino sessions are added by hand.
import { h, head, field, money, lineChart, toast } from '../ui.js';
import { RULES } from '../cards.js';

const SIM = '#e3bc5f';
const REAL = '#84c8ff';

export function mount(root, ctx) {
  const G = ctx.state;
  let filter = 'all';

  const draw = () => {
    const all = [...G.sessions].sort((a, b) => a.t - b.t);
    const of = (k) => all.filter((s) => s.kind === k);
    const sum = (arr, f) => arr.reduce((a, s) => a + f(s), 0);
    const net = (s) => s.cashOut - s.buyIn;

    const summary = (kind, label, bankroll) => {
      const ss = of(kind);
      const hrs = sum(ss, (s) => s.hours || 0);
      const n = sum(ss, net);
      const acc = ss.filter((s) => s.countAcc != null);
      return h('div', { class: 'tile' },
        h('h2', {}, label),
        h('dl', {},
          h('dt', {}, 'Bankroll'), h('dd', {}, money(bankroll)),
          h('dt', {}, 'Sessions'), h('dd', {}, ss.length),
          h('dt', {}, 'Net'), h('dd', { class: n > 0 ? 'good' : n < 0 ? 'bad' : '' }, money(n, { sign: true })),
          h('dt', {}, 'Hours'), h('dd', {}, hrs.toFixed(1)),
          h('dt', {}, 'Per hour'), h('dd', {}, hrs ? money(Math.round(n / hrs), { sign: true }) : '—'),
          h('dt', {}, 'Avg counting accuracy'), h('dd', {}, acc.length ? `${Math.round(sum(acc, (s) => s.countAcc) / acc.length)}%` : '—')));
    };

    const cumulative = (kind) => { let c = 0; return of(kind).map((s) => ({ x: s.end || s.t, y: (c += net(s)) })); };
    const accPoints = (kind) => of(kind).filter((s) => s.countAcc != null).map((s) => ({ x: s.end || s.t, y: s.countAcc }));

    const shown = all.filter((s) => filter === 'all' || s.kind === filter).reverse();
    const simBank = G.bankroll + (G.session?.stack || 0);
    const realBank = RULES.bankroll + sum(of('real'), net);

    root.replaceChildren(h('section', { class: 'view' },
      head('Session Log', `Table sessions log themselves when you cash out or hit the stop-loss. Add real casino sessions below. Bankrolls start at ${money(RULES.bankroll)}, with ${money(RULES.buyIn)} buy-ins.`),
      G.session ? h('div', { class: 'panel note' }, `Simulator session in progress: ${money(G.session.stack)} stack after ${G.session.hands} hands. Cash out at the Table to log it.`) : null,
      h('div', { class: 'tiles' }, summary('sim', 'Simulator', simBank), summary('real', 'Real casino', realBank)),
      h('div', { class: 'chart-block' }, h('h2', {}, 'Results over time (cumulative)'),
        lineChart([{ name: 'Simulator', color: SIM, points: cumulative('sim') }, { name: 'Real', color: REAL, points: cumulative('real') }], { yFmt: (v) => money(v), zero: true })),
      h('div', { class: 'chart-block' }, h('h2', {}, 'Counting accuracy by session'),
        lineChart([{ name: 'Simulator', color: SIM, points: accPoints('sim') }, { name: 'Real', color: REAL, points: accPoints('real') }], { yFmt: (v) => `${v}%`, yMin: 0, yMax: 100 })),
      addForm(),
      h('div', { class: 'chart-block' },
        h('div', { class: 'row spread' }, h('h2', {}, 'Sessions'),
          h('div', { class: 'seg' }, [['all', 'All'], ['sim', 'Simulator'], ['real', 'Real']].map(([k, l]) => h('button', { class: `btn sm${filter === k ? ' on' : ''}`, onclick: () => { filter = k; draw(); } }, l)))),
        shown.length ? h('div', { class: 'chart-scroll' }, h('table', { class: 'devs sessions' },
          h('thead', {}, h('tr', {}, ['Date', 'Type', 'Buy-in', 'Cash-out', 'Net', 'Hours', 'Count acc.', 'Play acc.', 'Notes', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, shown.map((s) => h('tr', {},
            h('td', {}, new Date(s.t).toLocaleDateString()),
            h('td', {}, h('span', { class: `kind ${s.kind}` }, s.kind === 'sim' ? 'Sim' : 'Real')),
            h('td', {}, money(s.buyIn)), h('td', {}, money(s.cashOut)),
            h('td', { class: net(s) > 0 ? 'good' : net(s) < 0 ? 'bad' : '' }, money(net(s), { sign: true })),
            h('td', {}, s.hours != null ? s.hours.toFixed(2) : '—'),
            h('td', {}, s.countAcc != null ? `${s.countAcc}%` : '—'),
            h('td', {}, s.decisionAcc != null ? `${s.decisionAcc}%` : '—'),
            h('td', { class: 'muted' }, s.notes || ''),
            h('td', {}, h('button', { class: 'link', title: 'Delete this session', onclick: () => remove(s) }, 'Delete')))))))
          : h('p', { class: 'muted' }, 'No sessions yet.'))));
  };

  function addForm() {
    const today = new Date();
    const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const date = h('input', { type: 'date', value: iso, class: 'num wide' });
    const buyIn = h('input', { type: 'number', min: 0, step: 25, value: RULES.buyIn, class: 'num wide', inputmode: 'decimal' });
    const cashOut = h('input', { type: 'number', min: 0, step: 1, class: 'num wide', inputmode: 'decimal', placeholder: 'e.g. 650' });
    const hours = h('input', { type: 'number', min: 0, step: 0.25, class: 'num wide', inputmode: 'decimal', placeholder: 'e.g. 2.5' });
    const acc = h('input', { type: 'number', min: 0, max: 100, step: 1, class: 'num wide', inputmode: 'numeric', placeholder: 'optional' });
    const notes = h('input', { type: 'text', class: 'num wide text', placeholder: 'Casino, table, anything notable' });
    return h('form', {
      class: 'panel form-grid',
      onsubmit: (e) => {
        e.preventDefault();
        const b = Number(buyIn.value);
        const c = Number(cashOut.value);
        const hr = Number(hours.value);
        if (cashOut.value === '' || !(b >= 0) || !(c >= 0)) { toast('Enter a buy-in and cash-out.'); return; }
        const [y, m, d] = date.value.split('-').map(Number);
        const t = new Date(y, m - 1, d, 12).getTime();
        G.sessions.push({
          id: `${Date.now()}`, kind: 'real', t, end: t, buyIn: b, cashOut: c, hours: hr || 0,
          countAcc: acc.value === '' ? null : Math.max(0, Math.min(100, Number(acc.value))), decisionAcc: null, notes: notes.value.trim(),
        });
        ctx.save();
        toast('Session added.');
        draw();
      },
    },
    h('h2', {}, 'Add a real casino session'),
    h('div', { class: 'form-row' },
      field('Date', date), field('Buy-in ($)', buyIn), field('Cash-out ($)', cashOut),
      field('Hours played', hours), field('Counting accuracy (%)', acc), field('Notes', notes)),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add session')));
  }

  function remove(s) {
    if (!confirm(`Delete the ${s.kind === 'sim' ? 'simulator' : 'real'} session from ${new Date(s.t).toLocaleDateString()}?`)) return;
    const i = G.sessions.indexOf(s);
    if (i >= 0) G.sessions.splice(i, 1);
    if (s.kind === 'sim') toast('Removed from the log. Simulator bankroll is unchanged.');
    ctx.save();
    draw();
  }

  draw();
}
