import * as store from './store.js';
import * as countdown from './views/countdown.js';
import * as basic from './views/basic.js';
import * as deviation from './views/deviation.js';
import * as table from './views/table.js';
import * as sessions from './views/sessions.js';
import * as stats from './views/stats.js';
import * as chart from './views/chart.js';
import * as settings from './views/settings.js';
import * as home from './views/home.js';
import * as calculator from './views/calculator.js';
import * as accountView from './views/account.js';
import * as play from './views/play.js';
import { h } from './ui.js';
import { configure as configureSound, loadSamples } from './sfx.js';
import { init as initNudge } from './nudge.js';

const VIEWS = [
  { id: 'home', label: 'Home', mount: home.mount },
  { id: 'countdown', n: '1', label: 'Countdown', mount: countdown.mount },
  { id: 'basic', n: '3', label: 'Basic Strategy', mount: basic.mount },
  { id: 'deviation', n: '4', label: 'Deviations', mount: deviation.mount },
  { id: 'table', n: '5', label: 'Table', mount: table.mount },
  { id: 'play', label: 'Online', mount: play.mount },
  { id: 'sessions', n: '6', label: 'Sessions', mount: sessions.mount },
  { id: 'training', label: 'Training', mount: (r, c) => table.mount(r, c, { training: true }) },
  { id: 'calculator', label: 'Bankroll Calc', mount: calculator.mount },
  { id: 'stats', label: 'Stats', mount: stats.mount },
  { id: 'chart', label: 'Strategy', mount: chart.mount },
  { id: 'settings', label: 'Settings', mount: settings.mount },
  { id: 'account', label: 'Account', mount: accountView.mount, hidden: true },
  { id: 'reset', label: 'Reset password', mount: accountView.mount, hidden: true },
];

const state = await store.init();
initNudge();
configureSound(state.settings.sound);
loadSamples();
const ctx = {
  get settings() { return state.settings; },
  get stats() { return state.stats; },
  get state() { return state; },
  get strategy() { return store.activeStrategy(); },
  save: store.save,
  resetStats: store.resetStats,
};

const nav = document.getElementById('nav');
const view = document.getElementById('view');
nav.append(...VIEWS.filter((v) => !v.hidden).map((v) => h('a', { href: `#${v.id}`, 'data-id': v.id }, v.label)));

// ---- phone navigation: bottom tab bar + bottom sheets ---------------------
const DRILLS = [
  ['countdown', '1', 'Countdown', '15–20 cards, then the count'],
  ['basic', '3', 'Basic Strategy', 'Hands vs upcards + heatmap'],
  ['deviation', '4', 'Deviations', 'Basic or the index play?'],
];
const MORE = [
  ['sessions', '6', 'Sessions', 'Log and charts'],
  ['stats', '▤', 'Stats', 'Accuracy, speed, errors'],
  ['calculator', '$', 'Bankroll Calc', 'EV, SD, risk of ruin'],
  ['chart', '♠', 'Strategy', 'Charts and deviations'],
  ['settings', '⚙', 'Settings', 'Table, sound, data'],
  ['account', '👤', 'Account', 'Sign in and sync your progress'],
];
const TABS = [
  { id: 'home', icon: '⌂', label: 'Home', views: ['home'] },
  { id: 'drills', icon: '◎', label: 'Drills', views: DRILLS.map((d) => d[0]), sheet: DRILLS },
  { id: 'table', icon: '♠', label: 'Table', views: ['table'] },
  { id: 'play', icon: '⚔', label: 'Online', views: ['play'] },
  { id: 'training', icon: '👁', label: 'Training', views: ['training'] },
  { id: 'more', icon: '☰', label: 'More', views: MORE.map((d) => d[0]), sheet: MORE },
];
const sheet = h('div', { class: 'sheet', 'aria-hidden': 'true', onclick: (e) => { if (e.target === sheet) closeSheet(); } }, h('div', { class: 'sheet-panel', role: 'dialog' }));
function openSheet(title, items) {
  sheet.firstChild.replaceChildren(
    h('div', { class: 'sheet-grab', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-title' }, title),
    h('div', { class: 'sheet-list' }, items.map(([id, n, label, desc]) => h('a', { href: `#${id}`, class: 'sheet-item', onclick: closeSheet },
      h('span', { class: 'mode-num' }, n), h('span', { class: 'sheet-text' }, h('span', { class: 'mode-name' }, label), h('span', { class: 'mode-desc muted' }, desc))))));
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
}
function closeSheet() { sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); }
const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, TABS.map((t) => t.sheet
  ? h('button', { class: 'tab', 'data-tab': t.id, onclick: () => openSheet(t.label, t.sheet) }, h('span', { class: 'tab-icon' }, t.icon), h('span', {}, t.label))
  : h('a', { class: 'tab', 'data-tab': t.id, href: `#${t.id}` }, h('span', { class: 'tab-icon' }, t.icon), h('span', {}, t.label))));
document.body.append(tabbar, sheet);
const pageTitle = h('div', { class: 'page-title' });
const topbar = /** @type {HTMLElement} */ (document.querySelector('.topbar'));
// Account button: "Sign in" for guests, your initial and name when signed in.
const acct = h('a', { class: 'acct-chip', href: '#account' });
function drawAcct() {
  const u = store.currentUser();
  acct.classList.toggle('signed-in', Boolean(u));
  acct.title = u ? `Signed in as ${u.displayName}` : 'Sign in to save your progress to an account';
  acct.replaceChildren(...(u
    ? [h('span', { class: 'avatar', 'aria-hidden': 'true' }, u.displayName.slice(0, 1).toUpperCase()), h('span', { class: 'acct-name' }, u.displayName)]
    : [h('span', { class: 'acct-name' }, 'Sign in')]));
}
drawAcct();
topbar.append(pageTitle, acct);
// The table fills exactly the window under the top bar, so it needs the bar's real height.
const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
new ResizeObserver(syncTopbar).observe(topbar);
syncTopbar();

let unmount = null;
const HOME_TITLE = document.title;
function route() {
  const id = location.hash.slice(1).split('?')[0];
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  if (typeof unmount === 'function') unmount();
  closeSheet();
  view.replaceChildren();
  document.body.dataset.view = v.id;
  pageTitle.textContent = v.label;
  for (const t of tabbar.children) t.classList.toggle('active', TABS.find((x) => x.id === t.dataset.tab).views.includes(v.id));
  for (const a of /** @type {HTMLCollectionOf<HTMLElement>} */ (nav.children)) a.classList.toggle('active', a.dataset.id === v.id);
  nav.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // Home keeps the page's own title (the one search results show); other views name themselves.
  document.title = v.id === 'home' ? HOME_TITLE : `${v.label} · TrueCountLab`;
  unmount = v.mount(view, ctx);
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

// Signing in or out swaps in a different saved-progress document, so remount the page.
let lastUserId = store.currentUser()?.id ?? null;
store.onChange((u) => {
  drawAcct();
  configureSound(state.settings.sound);
  const id = u?.id ?? null;
  if (id !== lastUserId) { lastUserId = id; route(); }
});
route();
