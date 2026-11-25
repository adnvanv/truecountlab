// Synthesized table sounds — cards, shuffles, chips, results. No audio files.
// Browsers only allow audio after a user gesture; every sound here is triggered by one
// (or by game flow that a gesture started), and the context is resumed on demand.

let ac = null;
let master = null;
let noiseBuf = null;
let cfg = { on: true, volume: 0.6 };

export function configure(c) {
  cfg = c;
  if (master) master.gain.value = c.on ? c.volume : 0;
}

function ctx() {
  if (!cfg.on) return null;
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = new C();
    master = ac.createGain();
    master.gain.value = cfg.volume;
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

const rand = (a, b) => a + Math.random() * (b - a);

function env(g, t0, attack, dur, peak) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

function noise(a, { t = 0, dur = 0.08, type = 'bandpass', f = 3000, f2 = null, q = 1, gain = 0.4, attack = 0.003 }) {
  const t0 = a.currentTime + t;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const flt = a.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t0);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = a.createGain();
  env(g, t0, attack, dur, gain);
  src.connect(flt).connect(g).connect(master);
  src.start(t0, rand(0, 0.8), dur + 0.05);
}

function tone(a, { t = 0, f = 440, f2 = null, dur = 0.15, type = 'sine', gain = 0.15, attack = 0.005 }) {
  const t0 = a.currentTime + t;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = a.createGain();
  env(g, t0, attack, dur, gain);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function chips(a, n, t = 0) {
  for (let i = 0; i < n; i++) {
    const ti = t + i * rand(0.045, 0.07);
    tone(a, { t: ti, f: rand(2500, 3400), dur: 0.07, type: 'triangle', gain: 0.07 });
    tone(a, { t: ti, f: rand(5200, 6400), dur: 0.035, type: 'sine', gain: 0.04 });
    noise(a, { t: ti, dur: 0.03, type: 'bandpass', f: rand(3800, 5200), q: 4, gain: 0.45, attack: 0.001 });
  }
}

// ---- recorded samples ------------------------------------------------------
// public/sounds/manifest.json maps a sound name to one or more files, e.g.
// { "deal": ["sounds/card-slide-1.ogg", "sounds/card-slide-2.ogg"], "chip": [...] }.
// When a name has samples, a random one plays; otherwise the synth version does.
const samples = {}; // name -> [AudioBuffer]
let manifest = null;
let loading = null;

export function loadSamples(url = 'sounds/manifest.json') {
  if (!loading) {
    loading = fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { manifest = m; })
      .catch(() => { manifest = null; });
  }
  return loading;
}

// Decoding needs an AudioContext, which browsers only allow after a gesture, so
// buffers are decoded the first time sound actually plays.
let decoding = null;
function decodeAll(a) {
  if (decoding || !manifest) return;
  decoding = Promise.all(Object.entries(manifest).map(async ([name, files]) => {
    const bufs = await Promise.all([].concat(files).map(async (f) => {
      try { return await a.decodeAudioData(await (await fetch(f)).arrayBuffer()); } catch { return null; }
    }));
    const ok = bufs.filter(Boolean);
    if (ok.length) samples[name] = ok;
  }));
}

function playSample(a, name, { t = 0, gain = 1, rate = 1 } = {}) {
  const list = samples[name];
  if (!list) return false;
  const src = a.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = rate * rand(0.96, 1.04);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start(a.currentTime + t);
  return true;
}

const play = (fn, name) => (...args) => {
  const a = ctx();
  if (!a) return;
  decodeAll(a);
  if (name && playSample(a, name)) return;
  fn(a, ...args);
};

// Chips: recorded clacks when available, synth otherwise.
function chipSound(a, n, t = 0) {
  if (samples.chip) {
    for (let i = 0; i < Math.min(n, 4); i++) playSample(a, 'chip', { t: t + i * 0.07, gain: 0.9 });
  } else {
    chips(a, n, t);
  }
}

export const sfx = {
  // Card slides out of the shoe and lands.
  deal: play((a) => {
    noise(a, { dur: 0.12, type: 'bandpass', f: 1600, f2: 5200, q: 0.7, gain: 0.32 });
    noise(a, { t: 0.1, dur: 0.035, type: 'highpass', f: 3000, gain: 0.25, attack: 0.001 });
  }, 'deal'),
  // Hole card turned over.
  flip: play((a) => {
    noise(a, { dur: 0.06, type: 'highpass', f: 2200, gain: 0.35, attack: 0.001 });
    noise(a, { t: 0.05, dur: 0.04, type: 'bandpass', f: 1100, q: 1.5, gain: 0.25 });
  }, 'flip'),
  // Lighter flip used by the countdown drills.
  tick: play((a) => noise(a, { dur: 0.035, type: 'highpass', f: 3500, gain: 0.18, attack: 0.001 }), 'tick'),
  // Riffle, bridge, riffle.
  shuffle: play((a) => {
    for (const start of [0.05, 0.85]) {
      for (let i = 0; i < 30; i++) {
        const t = start + i * (0.024 - i * 0.0003) + rand(0, 0.006);
        noise(a, { t, dur: 0.018, type: 'bandpass', f: rand(2200, 4800), q: 2.2, gain: 0.28, attack: 0.001 });
      }
      noise(a, { t: start + 0.62, dur: 0.22, type: 'lowpass', f: 2400, f2: 500, gain: 0.18, attack: 0.04 });
    }
  }, 'shuffle'),
  chip: play((a, n = 2) => chipSound(a, n)),
  win: play((a) => {
    [523.25, 659.25, 783.99].forEach((f, i) => tone(a, { t: i * 0.08, f, dur: 0.28, type: 'triangle', gain: 0.09 }));
    chipSound(a, 3, 0.18);
  }, 'win'),
  blackjack: play((a) => {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(a, { t: i * 0.07, f, dur: 0.35, type: 'triangle', gain: 0.09 }));
    chipSound(a, 4, 0.3);
  }, 'blackjack'),
  push: play((a) => tone(a, { f: 523.25, dur: 0.16, type: 'sine', gain: 0.07 }), 'push'),
  lose: play((a) => {
    tone(a, { f: 247, f2: 165, dur: 0.32, type: 'sine', gain: 0.1 });
    noise(a, { dur: 0.06, type: 'lowpass', f: 600, gain: 0.25 });
  }, 'lose'),
  bust: play((a) => {
    tone(a, { f: 330, dur: 0.12, type: 'square', gain: 0.04 });
    tone(a, { t: 0.13, f: 220, f2: 180, dur: 0.22, type: 'square', gain: 0.04 });
  }, 'bust'),
  right: play((a) => { tone(a, { f: 880, dur: 0.09, gain: 0.06 }); tone(a, { t: 0.07, f: 1318.5, dur: 0.14, gain: 0.06 }); }, 'right'),
  wrong: play((a) => tone(a, { f: 196, f2: 165, dur: 0.18, type: 'sawtooth', gain: 0.035 }), 'wrong'),
  click: play((a) => noise(a, { dur: 0.02, type: 'highpass', f: 4000, gain: 0.12, attack: 0.001 }), 'click'),
};
