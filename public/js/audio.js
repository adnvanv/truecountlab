// Synthesized casino ambience for Distraction mode — no audio files needed.
import { randInt, pick } from './cards.js';

const CHATTER_SPEECH = [
  'Twenty one!', 'Come on, five!', 'Dealer has seventeen', 'Hit me', 'Seven', 'Thirteen', 'No more bets',
  'Nineteen pays', 'Another round?', 'Eight', 'Two', 'Insurance, anyone?', 'Fourteen', 'Shuffle after this one',
];

export function createAmbience({ volume = 0.5, voice = true } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return { stop() {}, setVolume() {} };
  const ac = new Ctx();
  const master = ac.createGain();
  master.gain.value = volume;
  master.connect(ac.destination);
  const timers = [];

  // Crowd murmur: brown noise, low-passed, slowly modulated.
  const len = ac.sampleRate * 4;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 650;
  const murmur = ac.createGain();
  murmur.gain.value = 0.35;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.23;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 0.15;
  lfo.connect(lfoGain).connect(murmur.gain);
  noise.connect(lp).connect(murmur).connect(master);
  noise.start();
  lfo.start();

  function chipClicks() {
    const n = 2 + randInt(4);
    for (let i = 0; i < n; i++) {
      const t = ac.currentTime + i * (0.04 + Math.random() * 0.05);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200 + Math.random() * 1800;
      bp.Q.value = 6;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1.2, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(bp).connect(g).connect(master);
      src.start(t, Math.random() * 3, 0.06);
    }
  }

  function slotChime() {
    const base = pick([523.25, 587.33, 659.25, 783.99]);
    [1, 1.25, 1.5, 2].forEach((m, i) => {
      const t = ac.currentTime + i * 0.09;
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * m;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.55);
    });
  }

  function say() {
    if (!voice || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(pick(CHATTER_SPEECH));
    u.volume = Math.min(1, master.gain.value * 1.4);
    u.rate = 0.9 + Math.random() * 0.4;
    u.pitch = 0.7 + Math.random() * 0.8;
    speechSynthesis.speak(u);
  }

  const loop = (fn, min, max) => {
    const go = () => { fn(); timers.push(setTimeout(go, min + Math.random() * (max - min))); };
    timers.push(setTimeout(go, min + Math.random() * (max - min)));
  };
  loop(chipClicks, 700, 2600);
  loop(slotChime, 3500, 9000);
  loop(say, 2500, 6000);

  return {
    setVolume(v) { master.gain.value = v; },
    stop() {
      timers.forEach(clearTimeout);
      if (window.speechSynthesis) speechSynthesis.cancel();
      ac.close();
    },
  };
}
