// Anonymous usage totals: how many solo hands, graded plays and drills get played on the
// site. Only the counts are sent (no account, settings or results), in small batches when
// the page is hidden or every couple of minutes. See the privacy page.
/** @type {Record<'hand' | 'play' | 'drill', number>} */
const pending = { hand: 0, play: 0, drill: 0 };
let timer = 0;

/** @param {'hand' | 'play' | 'drill'} kind */
export function tally(kind) {
  pending[kind]++;
  if (!timer) timer = window.setTimeout(flush, 120000);
}

function flush() {
  clearTimeout(timer);
  timer = 0;
  if (!pending.hand && !pending.play && !pending.drill) return;
  const body = JSON.stringify(pending);
  pending.hand = 0; pending.play = 0; pending.drill = 0;
  // sendBeacon survives the page closing; fall back to fetch where it isn't available.
  const blob = new Blob([body], { type: 'application/json' });
  if (!navigator.sendBeacon?.('/api/tally', blob)) {
    fetch('/api/tally', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
}

addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
addEventListener('pagehide', flush);
