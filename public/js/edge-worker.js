// Simulates a strategy's edge off the main thread for the strategy editor. Sends a running
// estimate after every batch; a newer request replaces the one in progress.
import { simulate, edgeOf } from './sim.js';

const BATCH = 400_000;
const TOTAL = 8_000_000;
let latest = 0;

onmessage = async (/** @type {MessageEvent} */ e) => {
  const { id, strategy, surrender } = e.data;
  latest = id;
  let sum = null;
  let state;
  for (let done = 0; done < TOTAL; done += BATCH) {
    if (latest !== id) return; // a newer strategy came in
    const r = simulate(strategy, { rounds: BATCH, surrender, state });
    state = r.state;
    sum = sum ? { ...sum, rounds: sum.rounds + r.rounds, flatWin: sum.flatWin + r.flatWin, flatSq: sum.flatSq + r.flatSq, rampWin: sum.rampWin + r.rampWin, rampSq: sum.rampSq + r.rampSq, rampBet: sum.rampBet + r.rampBet } : r;
    postMessage({ id, ...edgeOf(sum), done: done + BATCH >= TOTAL });
    await new Promise((res) => setTimeout(res, 0)); // let a newer request in
  }
};
