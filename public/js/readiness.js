// "Ready to play" gates, computed from drill history.

const acc = (runs) => (runs.length ? runs.filter((r) => r.ok).length / runs.length : 0);

export function readiness(stats) {
  // Countdown runs: right count at full-deck-in-30s pace (≈0.58s per card). Older full-deck runs have no n.
  const cd = stats.countdown.runs;
  const fast = (r) => r.ok && r.ms / (r.n || 52) <= 30000 / 52;
  let streak = 0;
  for (let i = cd.length - 1; i >= 0 && fast(cd[i]); i--) streak++;

  const basic = stats.basic.runs.slice(-200);
  const dev = stats.deviation.runs.slice(-100);

  const items = [
    {
      id: 'countdown', link: '#countdown', label: '5 countdowns in a row with the right count, at deck pace (≤ 0.58s per card — a full deck in under 30s)',
      met: streak >= 5, frac: Math.min(1, streak / 5), detail: `Current streak: ${Math.min(streak, 5)} of 5`,
    },
    {
      id: 'basic', link: '#basic', label: '98%+ on basic strategy over 200 hands',
      met: basic.length >= 200 && acc(basic) >= 0.98,
      frac: Math.min(1, basic.length / 200) * Math.min(1, acc(basic) / 0.98),
      detail: `${basic.length < 200 ? `${basic.length} of 200 hands` : 'Last 200 hands'} · ${basic.length ? Math.round(acc(basic) * 1000) / 10 : 0}%`,
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
