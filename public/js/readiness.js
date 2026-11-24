// "Ready to play" gates, computed from drill history.

const acc = (runs) => (runs.length ? runs.filter((r) => r.ok).length / runs.length : 0);

export function readiness(stats) {
  // Countdown runs whose deck ends at exactly 0 (classic decks, or a removed card worth 0).
  const zeroRuns = stats.countdown.runs.filter((r) => (r.exp ?? (r.burn ? null : 0)) === 0);
  let streak = 0;
  for (let i = zeroRuns.length - 1; i >= 0 && zeroRuns[i].ok && zeroRuns[i].ms < 30000; i--) streak++;

  const basic = stats.basic.runs.slice(-200);
  const tc = stats.truecount.runs.slice(-100);
  const dev = stats.deviation.runs.slice(-100);

  const items = [
    {
      id: 'countdown', link: '#countdown', label: '5 single-deck countdowns in a row ending at exactly 0, each under 30 seconds',
      met: streak >= 5, frac: Math.min(1, streak / 5), detail: `Current streak: ${Math.min(streak, 5)} of 5`,
    },
    {
      id: 'basic', link: '#basic', label: '98%+ on basic strategy over 200 hands',
      met: basic.length >= 200 && acc(basic) >= 0.98,
      frac: Math.min(1, basic.length / 200) * Math.min(1, acc(basic) / 0.98),
      detail: `${basic.length < 200 ? `${basic.length} of 200 hands` : 'Last 200 hands'} · ${basic.length ? Math.round(acc(basic) * 1000) / 10 : 0}%`,
    },
    {
      id: 'truecount', link: '#truecount', label: '95%+ on true count conversions over 100 drills',
      met: tc.length >= 100 && acc(tc) >= 0.95,
      frac: Math.min(1, tc.length / 100) * Math.min(1, acc(tc) / 0.95),
      detail: `${tc.length < 100 ? `${tc.length} of 100 drills` : 'Last 100 drills'} · ${tc.length ? Math.round(acc(tc) * 1000) / 10 : 0}%`,
    },
    {
      id: 'deviation', link: '#deviation', label: '95%+ on deviations over 100 hands',
      met: dev.length >= 100 && acc(dev) >= 0.95,
      frac: Math.min(1, dev.length / 100) * Math.min(1, acc(dev) / 0.95),
      detail: `${dev.length < 100 ? `${dev.length} of 100 hands` : 'Last 100 hands'} · ${dev.length ? Math.round(acc(dev) * 1000) / 10 : 0}%`,
    },
  ];
  return { items, ready: items.every((i) => i.met), done: items.filter((i) => i.met).length };
}
