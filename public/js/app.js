import * as store from './store.js';
import * as countdown from './views/countdown.js';
import * as truecount from './views/truecount.js';
import * as basic from './views/basic.js';
import * as deviation from './views/deviation.js';
import * as betting from './views/betting.js';
import * as table from './views/table.js';
import * as sessions from './views/sessions.js';
import * as stats from './views/stats.js';
import * as chart from './views/chart.js';
import * as settings from './views/settings.js';
import * as home from './views/home.js';
import * as calculator from './views/calculator.js';
import { h } from './ui.js';

const VIEWS = [
  { id: 'home', label: 'Home', mount: home.mount },
  { id: 'countdown', label: 'Countdown', mount: (r, c) => countdown.mount(r, c) },
  { id: 'distraction', label: 'Distraction', mount: (r, c) => countdown.mount(r, c, { distraction: true }) },
  { id: 'truecount', label: 'True Count', mount: truecount.mount },
  { id: 'basic', label: 'Basic Strategy', mount: basic.mount },
  { id: 'deviation', label: 'Deviations', mount: deviation.mount },
  { id: 'betting', label: 'Bet Sizing', mount: betting.mount },
  { id: 'table', label: 'Table', mount: table.mount },
  { id: 'sessions', label: 'Sessions', mount: sessions.mount },
  { id: 'training', label: 'Training', mount: (r, c) => table.mount(r, c, { training: true }) },
  { id: 'calculator', label: 'Bankroll Calc', mount: calculator.mount },
  { id: 'stats', label: 'Stats', mount: stats.mount },
  { id: 'chart', label: 'Strategy', mount: chart.mount },
  { id: 'settings', label: 'Settings', mount: settings.mount },
];

const state = await store.init();
const ctx = {
  get settings() { return state.settings; },
  get stats() { return state.stats; },
  get state() { return state; },
  save: store.save,
  resetStats: store.resetStats,
};

const nav = document.getElementById('nav');
const view = document.getElementById('view');
nav.append(...VIEWS.map((v, i) => h('a', { href: `#${v.id}`, 'data-id': v.id }, h('span', { class: 'num' }, i >= 1 && i <= 8 ? String(i) : ''), v.label)));

let unmount = null;
function route() {
  const id = location.hash.slice(1);
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  if (typeof unmount === 'function') unmount();
  view.replaceChildren();
  for (const a of nav.children) a.classList.toggle('active', a.dataset.id === v.id);
  nav.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.title = `${v.label} · Count Trainer`;
  unmount = v.mount(view, ctx);
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
