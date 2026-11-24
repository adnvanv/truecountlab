import * as store from './store.js';
import * as table from './views/table.js';
import * as speed from './views/speed.js';
import * as deck from './views/deck.js';
import * as truecount from './views/truecount.js';
import * as strategy from './views/strategy.js';
import * as chart from './views/chart.js';
import * as stats from './views/stats.js';
import * as settings from './views/settings.js';
import { h } from './ui.js';

const VIEWS = [
  { id: 'table', label: 'Table', mod: table },
  { id: 'speed', label: 'Speed Count', mod: speed },
  { id: 'deck', label: 'Deck Countdown', mod: deck },
  { id: 'truecount', label: 'True Count', mod: truecount },
  { id: 'strategy', label: 'Strategy', mod: strategy },
  { id: 'chart', label: 'Charts', mod: chart },
  { id: 'stats', label: 'Stats', mod: stats },
  { id: 'settings', label: 'Settings', mod: settings },
];

const state = await store.init();
const ctx = {
  get settings() { return state.settings; },
  get stats() { return state.stats; },
  save: store.save,
  resetStats: store.resetStats,
};

const nav = document.getElementById('nav');
const view = document.getElementById('view');
nav.append(...VIEWS.map((v) => h('a', { href: `#${v.id}`, 'data-id': v.id }, v.label)));

let unmount = null;
function route() {
  const id = location.hash.slice(1);
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  if (typeof unmount === 'function') unmount();
  view.replaceChildren();
  for (const a of nav.children) a.classList.toggle('active', a.dataset.id === v.id);
  nav.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.title = `${v.label} · Count Trainer`;
  unmount = v.mod.mount(view, ctx);
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
