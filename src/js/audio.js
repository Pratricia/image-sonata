/* 音频引擎：Web Audio 图（总线/混响/延迟/压缩）、各音色合成、人声共振峰合成、事件分发 → playEvent。
   文件：src/js/audio.js */
'use strict';

/* ============================================================
   4. 音频引擎
   ============================================================ */
const noiseCache = new WeakMap();
function noiseBuffer(ctx, seed) {
  if (noiseCache.has(ctx)) return noiseCache.get(ctx);
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rng = mulberry32(seed ^ 0x1234567);
  for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

function impulse(ctx, seed, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  const rng = mulberry32(seed ^ 0xabcdef);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (rng() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function buildGraph(ctx, spec, withAnalyser) {
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 22; comp.ratio.value = 4;
  comp.attack.value = 0.004; comp.release.value = 0.25;

  // 软限幅：保证任何照片都不会把输出推过 1.0（导出 16bit 时不削波）
  const shaper = ctx.createWaveShaper();
  const limCurve = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) {
    const x = i / 1023.5 - 1;
    const a = Math.abs(x);
    limCurve[i] = Math.sign(x) * (a < 0.72 ? a : 0.72 + (1 - Math.exp(-(a - 0.72) * 5)) * 0.26);
  }
  shaper.curve = limCurve;

  if (withAnalyser) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    master.connect(comp); comp.connect(shaper); shaper.connect(analyser); analyser.connect(ctx.destination);
    var an = analyser;
  } else {
    master.connect(comp); comp.connect(shaper); shaper.connect(ctx.destination);
  }

  const bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(master);

  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, spec.seed, spec.reverbSec, 2.8);
  const revRet = ctx.createGain(); revRet.gain.value = spec.reverbWet;
  conv.connect(revRet); revRet.connect(master);

  const delay = ctx.createDelay(1.2);
  delay.delayTime.value = spec.delayTime;
  const fb = ctx.createGain(); fb.gain.value = spec.delayFb;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
  delay.connect(lp); lp.connect(fb); fb.connect(delay);
  const dlyRet = ctx.createGain(); dlyRet.gain.value = spec.delayWet;
  lp.connect(dlyRet); dlyRet.connect(master);

  let stopLoop = null;
  if (spec.vinylBed) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, spec.seed);
    src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 5200;
    const g = ctx.createGain(); g.gain.value = 0.016;
    src.connect(hp); hp.connect(lp2); lp2.connect(g); g.connect(bus);
    src.start(0);
    stopLoop = () => { try { src.stop(); } catch (e) {} };
  }

  return { master, bus, conv, delay, analyser: an, spec, stopLoop };
}

function outNode(ctx, inst, revAmt, dlyAmt, pan) {
  const g = ctx.createGain(); g.gain.value = 1;
  if (pan) {
    // 给声部一点左右位置，中间留给主旋律和人声
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p); p.connect(inst.bus);
  } else {
    g.connect(inst.bus);
  }
  if (revAmt > 0) { const s = ctx.createGain(); s.gain.value = revAmt; g.connect(s); s.connect(inst.conv); }
  if (dlyAmt > 0) { const s = ctx.createGain(); s.gain.value = dlyAmt; g.connect(s); s.connect(inst.delay); }
  return g;
}

function kick(ctx, t, out, vel) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(155, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.4);
}
function snare(ctx, t, out, vel, seed) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seed);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.55, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  src.connect(bp); bp.connect(g); g.connect(out);
  src.start(t); src.stop(t + 0.2);

  const o = ctx.createOscillator(), og = ctx.createGain();
  o.type = 'triangle'; o.frequency.value = 190;
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(vel * 0.32, t + 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(og); og.connect(out);
  o.start(t); o.stop(t + 0.1);
}
function hat(ctx, t, out, vel, seed, open) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seed);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7600;
  const g = ctx.createGain();
  const d = open ? 0.16 : 0.05;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.5, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(hp); hp.connect(g); g.connect(out);
  src.start(t); src.stop(t + d + 0.02);
}
function bassV(ctx, t, out, midi, dur, vel, cutoff) {
  const f = midiFreq(midi);
  const o = ctx.createOscillator(), sub = ctx.createOscillator();
  o.type = 'sawtooth'; o.frequency.value = f;
  sub.type = 'sine'; sub.frequency.value = f;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
  lp.frequency.setValueAtTime(cutoff * 1.8, t);
  lp.frequency.exponentialRampToValueAtTime(cutoff * 0.6, t + Math.max(0.08, dur * 0.8));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.42, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); sub.connect(lp); lp.connect(g); g.connect(out);
  o.start(t); sub.start(t);
  o.stop(t + dur + 0.05); sub.stop(t + dur + 0.05);
}
function padV(ctx, t, out, midi, dur, vel, cutoff) {
  const f = midiFreq(midi);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel * 0.30, t + 0.35);
  g.gain.linearRampToValueAtTime(vel * 0.24, t + dur * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
  lp.connect(g); g.connect(out);
  for (let i = 0; i < 2; i++) {
    const o = ctx.createOscillator();
    o.type = i === 0 ? 'triangle' : 'sawtooth';
    o.frequency.value = f;
    o.detune.value = (i === 0 ? -5 : 6);
    const og = ctx.createGain(); og.gain.value = i === 0 ? 0.8 : 0.32;
    o.connect(og); og.connect(lp);
    o.start(t); o.stop(t + dur + 0.55);
  }
}
function leadV(ctx, t, out, midi, dur, vel, cutoff) {
  const f = midiFreq(midi);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel * 0.34, t + 0.02);
  g.gain.exponentialRampToValueAtTime(vel * 0.12, t + Math.max(0.08, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
  lp.connect(g); g.connect(out);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
  const og2 = ctx.createGain(); og2.gain.value = 0.18;
  o.connect(lp); o2.connect(og2); og2.connect(lp);
  o.start(t); o2.start(t); o.stop(t + dur + 0.15); o2.stop(t + dur + 0.15);
}
function pluckV(ctx, t, out, midi, dur, vel) {
  const f = midiFreq(midi);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.5, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.18);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.2);
}

/* ---- 音色库：不同风格换不同的合成方式 ---- */
function epianoV(ctx, t, out, midi, dur, vel) {
  const f = midiFreq(midi);
  const car = ctx.createOscillator(), mod = ctx.createOscillator();
  car.type = 'sine'; car.frequency.value = f;
  mod.type = 'sine'; mod.frequency.value = f * 2.01;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(Math.min(900, f * 1.4 * vel), t);
  mg.gain.exponentialRampToValueAtTime(1, t + 0.3);
  mod.connect(mg); mg.connect(car.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.34, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.4, dur + 0.45));
  car.connect(g); g.connect(out);
  car.start(t); mod.start(t); car.stop(t + dur + 0.5); mod.stop(t + dur + 0.5);
}

function bellV(ctx, t, out, midi, dur, vel) {
  const f = midiFreq(midi);
  const dec = Math.min(1.2, Math.max(0.3, dur * 1.5 + 0.3));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.28, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  g.connect(out);
  [[1, 1], [2.76, 0.34], [5.4, 0.12]].forEach(([r, a]) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * r;
    const og = ctx.createGain(); og.gain.value = a;
    o.connect(og); og.connect(g);
    o.start(t); o.stop(t + dec + 0.05);
  });
}

function pianoV(ctx, t, out, midi, dur, vel) {
  const f = midiFreq(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.3, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.5, dur + 0.55));
  g.connect(out);
  [[1, 1], [2.01, 0.4], [3.02, 0.18], [4.03, 0.07]].forEach(([r, a]) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * r;
    const og = ctx.createGain(); og.gain.value = a;
    o.connect(og); og.connect(g);
    o.start(t); o.stop(t + dur + 0.6);
  });
}

function stringsV(ctx, t, out, midi, dur, vel, cutoff) {
  const f = midiFreq(midi);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
  lp.frequency.value = Math.min(cutoff * 1.1, 3400);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel * 0.24, t + 0.55);
  g.gain.linearRampToValueAtTime(vel * 0.19, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.7);
  lp.connect(g); g.connect(out);
  [-7, 0, 7].forEach((cents, i) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    o.detune.value = cents;
    const og = ctx.createGain(); og.gain.value = [0.4, 0.34, 0.3][i];
    o.connect(og); og.connect(lp);
    o.start(t); o.stop(t + dur + 0.75);
  });
}

function warmPadV(ctx, t, out, midi, dur, vel, cutoff) {
  const f = midiFreq(midi);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
  lp.frequency.value = Math.min(cutoff * 0.8, 2400);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel * 0.28, t + 0.3);
  g.gain.linearRampToValueAtTime(vel * 0.2, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.45);
  lp.connect(g); g.connect(out);
  [[0, 'triangle', 0.9], [-6, 'sawtooth', 0.22]].forEach(([cents, type, amp]) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    o.detune.value = cents;
    const og = ctx.createGain(); og.gain.value = amp;
    o.connect(og); og.connect(lp);
    o.start(t); o.stop(t + dur + 0.5);
  });
}

function organV(ctx, t, out, midi, dur, vel, cutoff) {
  const f = midiFreq(midi);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(cutoff, 4200);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel * 0.2, t + 0.05);
  g.gain.setValueAtTime(vel * 0.2, t + Math.max(0.06, dur * 0.85));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
  lp.connect(g); g.connect(out);
  [[1, 1], [2, 0.5], [3, 0.26], [4, 0.12]].forEach(([r, a]) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * r;
    const og = ctx.createGain(); og.gain.value = a;
    o.connect(og); og.connect(lp);
    o.start(t); o.stop(t + dur + 0.3);
  });
}

function choirV(ctx, t, out, midi, dur, vel, cutoff) {
  const f = midiFreq(midi);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(cutoff, 2600);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel * 0.22, t + 0.5);
  g.gain.linearRampToValueAtTime(vel * 0.17, t + dur * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
  lp.connect(g); g.connect(out);
  [0, 1].forEach(i => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    o.detune.value = i ? 6 : -6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.4 + i * 0.7;
    const lg = ctx.createGain(); lg.gain.value = 5;
    lfo.connect(lg); lg.connect(o.detune);
    o.connect(lp);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.65); lfo.stop(t + dur + 0.65);
  });
}

function sawLeadV(ctx, t, out, midi, dur, vel, cutoff) {
  const f = midiFreq(midi);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
  lp.frequency.setValueAtTime(cutoff * 1.2, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(320, cutoff * 0.5), t + Math.max(0.1, dur * 0.7));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.24, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
  lp.connect(g); g.connect(out);
  [0, 1].forEach(i => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    o.detune.value = i ? 9 : -9;
    const og = ctx.createGain(); og.gain.value = 0.5;
    o.connect(og); og.connect(lp);
    o.start(t); o.stop(t + dur + 0.15);
  });
}

function subBassV(ctx, t, out, midi, dur, vel) {
  const f = midiFreq(midi);
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f;
  const og2 = ctx.createGain(); og2.gain.value = 0.22;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.4, t + 0.02);
  g.gain.setValueAtTime(vel * 0.4, t + Math.max(0.05, dur * 0.8));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.18);
  o.connect(g); o2.connect(og2); og2.connect(g); g.connect(out);
  o.start(t); o2.start(t); o.stop(t + dur + 0.2); o2.stop(t + dur + 0.2);
}

function uprightBassV(ctx, t, out, midi, dur, vel) {
  const f = midiFreq(midi);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.46, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.3, dur * 0.9));
  o.connect(g); o2.connect(g); g.connect(out);
  o.start(t); o2.start(t); o.stop(t + dur + 0.2); o2.stop(t + dur + 0.2);
}

function distBassV(ctx, t, out, midi, dur, vel, cutoff) {
  const f = midiFreq(midi);
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
  const ws = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 4); }
  ws.curve = curve; ws.oversample = '2x';
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(cutoff, 1100);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.2, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(ws); ws.connect(lp); lp.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}

/* ---- 打击乐：军鼓之外的音色 ---- */
function clapV(ctx, t, out, vel, seed) {
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.011;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, seed);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, tt);
    g.gain.exponentialRampToValueAtTime(vel * (i === 2 ? 0.5 : 0.28), tt + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, tt + (i === 2 ? 0.15 : 0.03));
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(tt); src.stop(tt + 0.2);
  }
}
function rimV(ctx, t, out, vel, seed) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, seed);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2300; bp.Q.value = 2.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.4, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
  src.connect(bp); bp.connect(g); g.connect(out);
  src.start(t); src.stop(t + 0.06);
}
function shakerV(ctx, t, out, vel, seed) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, seed);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.5, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(hp); hp.connect(g); g.connect(out);
  src.start(t); src.stop(t + 0.09);
}
function tomV(ctx, t, out, vel) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(110, t + 0.18);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.7, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.35);
}
function crashV(ctx, t, out, vel, seed) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, seed);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel * 0.3, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  src.connect(hp); hp.connect(g); g.connect(out);
  src.start(t); src.stop(t + 1.2);
}

/* ---- 人声：按元音直接构造周期性波表，一个振荡器就能唱出共振峰 ----
   旧做法用 3 个 bandpass 并联“雕刻”锯齿波，一个音节要 6 个滤波器。
   一首 48 小节的曲子有 200 多个音节，离线渲染会被滤波器拖到 3 分钟。
   把共振峰算进谐波幅度里之后，每个音节只剩 1 个振荡器 + 1 个包络。
*/
const waveCache = new WeakMap();
function vowelWave(ctx, vowel, f) {
  let m = waveCache.get(ctx);
  if (!m) { m = new Map(); waveCache.set(ctx, m); }
  const key = (vowel || 'a') + ':' + Math.round(f * 4);
  const hit = m.get(key);
  if (hit) return hit;

  const F = VOWEL_F[vowel] || VOWEL_F.a;
  const N = Math.max(6, Math.min(56, Math.round(6000 / f)));
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    const fn = n * f;
    let a = 0;
    for (const [fr, g, q] of F) {
      const bw = fr / q;                     // 共振峰带宽
      const d = (fn - fr) / bw;
      a += g / (1 + d * d);                  // 共振峰响应
    }
    a += 0.35 / (1 + Math.pow((fn - 2900) / 520, 2));   // 歌手共振峰：人声能“钻出来”靠它
    a *= 1 / (1 + Math.pow(n / 9, 1.15));               // 高频滚降
    imag[n] = a;
  }
  const w = ctx.createPeriodicWave(real, imag);
  m.set(key, w);
  return w;
}

/* 辅音规格。之前每个辅音都只有 ~40ms、又比元音低 14 dB，
   混在一起听不出区别（用户反馈"辅音我认不出来"）。现在按发音方式分开做：
   · plos 爆破音：先闭气 40ms，再来一个 18ms 的爆点（t/k 的区别在爆点的频段）
   · fric 擦音：一段持续气流，长度和频段就是它的辨识度
   · appr 近音/鼻音：最轻最短，只是"轻轻起一下"
   g 是相对 vel 的峰值，实际播放时元音峰约 0.52*vel，所以这些值意味着"比元音低几 dB"。 */
/* 人声总音量。第十三轮之后音节变长、几乎不留缝，同样的包络下 RMS 比旧版高约 2 dB
   （人声独奏只比整混音低 0.7 dB，而目标是 1.5–5 dB），所以整体收 2 dB。
   第十六轮用户再提"人声是不是太大了"：从 0.75 收到 0.60（−1.9 dB），
   人声独奏落到整混音 −3.5 dB 附近 —— 目标区间的中间。
   注意 voxPsola 会把每段归一化到固定 RMS，改 peak/vel 是没用的，只能改这里。 */
const VOX_LEVEL = 0.60;
const CONS_SPEC = {
  l:  { kind: 'appr', type: 'lowpass',  f: 900,  g: 0.42, len: 0.065 },
  n:  { kind: 'appr', type: 'lowpass',  f: 700,  g: 0.40, len: 0.070 },
  m:  { kind: 'appr', type: 'lowpass',  f: 600,  g: 0.40, len: 0.070 },
  w:  { kind: 'appr', type: 'lowpass',  f: 500,  g: 0.34, len: 0.060 },
  v:  { kind: 'appr', type: 'bandpass', f: 900,  q: 1.0, g: 0.37, len: 0.065 },
  r:  { kind: 'appr', type: 'bandpass', f: 1400, q: 1.1, g: 0.37, len: 0.060 },
  y:  { kind: 'appr', type: 'bandpass', f: 2300, q: 1.0, g: 0.31, len: 0.055 },
  p:  { kind: 'plos', type: 'lowpass',  f: 800,  q: 0.8, g: 0.55 },
  t:  { kind: 'plos', type: 'bandpass', f: 3200, q: 1.4, g: 0.60 },
  k:  { kind: 'plos', type: 'bandpass', f: 1700, q: 1.6, g: 0.58 },
  b:  { kind: 'plos', type: 'lowpass',  f: 600,  q: 0.8, g: 0.50 },
  d:  { kind: 'plos', type: 'bandpass', f: 2200, q: 1.3, g: 0.55 },
  g:  { kind: 'plos', type: 'bandpass', f: 1300, q: 1.5, g: 0.52 },
  /* 擦音的 f / q / lp 是按 PJS 里真人辅音实测的能量分布定的
     （见 tools/svs 的分析：s 5.8–15.6kHz、sh 3.8–12.7kHz、h 188–4700Hz 中位仅 398Hz）。
     关键是 **lp**：白噪声本来一直到 22kHz，多出来的高频就是"沙沙"的来源。 */
  s:  { kind: 'fric', type: 'highpass', f: 5500, lp: 13000, g: 0.36, len: 0.085 },
  sh: { kind: 'fric', type: 'bandpass', f: 3400, q: 1.0, lp: 10500, g: 0.38, len: 0.095 },
  f:  { kind: 'fric', type: 'highpass', f: 1200, lp: 6500,  g: 0.30, len: 0.080 },
  th: { kind: 'fric', type: 'highpass', f: 1600, lp: 7000,  g: 0.26, len: 0.075 },
  h:  { kind: 'fric', type: 'bandpass', f: 900,  q: 0.7, lp: 4200, g: 0.32, len: 0.095 },
  z:  { kind: 'fric', type: 'highpass', f: 4000, lp: 11000, g: 0.30, len: 0.080 },
  j:  { kind: 'fric', type: 'bandpass', f: 3200, q: 1.0, lp: 9500,  g: 0.34, len: 0.085 },
  ch: { kind: 'fric', type: 'bandpass', f: 2600, q: 1.1, lp: 9000,  g: 0.36, len: 0.085 }
};

/* 一个音符 = 一个"词"。词里的音节按元音切段：
   同一个元音的音节连成一段、共用一个声音，音高在段内滑过去，不重新起音；
   换元音时做 90–220ms 等功率交叉淡化（这就是真人唱"a→i"时口型变过去的过程）。
   每段只在段首进气/段尾收气，所以听上去是一条音线，而不是"啊、啊、啊"。
*/
function voxV(ctx, t, out, midi, dur, vel, vowel, cons, seed, syls, legato, holdEnd, opt) {
  opt = opt || {};
  const layerCents = opt.cents || 0;   // 多轨叠录的音准差（音分）
  const layerGain = opt.gain == null ? 1 : opt.gain;   // 这一轨的音量
  const noCons = !!opt.noCons;         // 副轨不咬字：一次咬字由主轨负责，否则 N 轨叠起来是"打嗝"
  // 没有音节表时退化成"一个音节 = 这个音"
  const list = (syls && syls.length) ? syls : [{ u: 0, d: dur, m: midi, cons, v: vowel }];
  const endT = t + dur;
  // 整条音线都是"满"的，所以峰值压得比旧版低 3 dB（用户反馈人声偏大）
  // 注意：voxPsola 会把每段归一化到固定 RMS，这个 peak 只影响包络形状、不影响响度；
  // 真正的音量在下面的 voxToAudioBuffer(…, gain)。
  const peak = vel * 0.52 * layerGain;
  // 词首带辅音时，元音要马上接上（25ms），否则擦音和嗓音之间会空一段，听成"悬空的沙沙声"
  const headCons = !!(list[0] && list[0].cons);
  // 按元音分段：同一元音的音节连成一段，共用一个振荡器
  const segs = [];
  for (const s of list) {
    const v = s.v || vowel;
    const cur = segs[segs.length - 1];
    if (cur && cur.v === v) cur.syl.push(s);
    else segs.push({ v, syl: [s] });
  }
  for (let i = 0; i < segs.length; i++) {
    const lastSyl = segs[i].syl[segs[i].syl.length - 1];
    segs[i].a = segs[i].syl[0].u;
    // 段尾接到下一段的段首，中间的缝也补上（连唱），最后一段才真的收
    segs[i].b = segs[i + 1] ? segs[i + 1].syl[0].u : lastSyl.u + lastSyl.d;
  }

  /* 交叉淡化的时长必须按"边界"算、两边用同一个值。
     以前每段按自己的段长算，淡入比淡出长，中间就塌下去一块 —— 听感是"音不全"。
     现在的音节只有 0.2 秒，淡化超过 45ms 就等于"两句同时在唱"，
     所以上限压到 55ms、比例也从 0.35 收到 0.22。 */
  const xfAt = [];
  for (let i = 0; i < segs.length - 1; i++) {
    const la = Math.max(0.02, segs[i].b - segs[i].a);
    const lb = Math.max(0.02, segs[i + 1].b - segs[i + 1].a);
    xfAt[i] = Math.min(0.055, Math.max(0.020, Math.min(la, lb) * 0.22));
  }

  for (let i = 0; i < segs.length; i++) {
    const sg = segs[i];
    const sa = t + sg.a, sb = t + sg.b;
    const isFirst = i === 0, isLast = i === segs.length - 1;
    const xfIn = i > 0 ? xfAt[i - 1] : 0;              // 和上一段的交叉淡化
    const xfOut = isLast ? 0 : xfAt[i];                // 和下一段的交叉淡化

    /* ---- 采样路径：有音库就用真人嗓子（PSOLA 变调），没有就退回波表 ---- */
    if (voxBankAvailable()) {
      const sr = ctx.sampleRate;
      /* 交叉淡化区**只跨在边界前**：上一段在 [sb-xf, sb] 淡完，这一段在 [sa-xf, sa] 淡满。
         旧版淡出一直拖到 sb+xf —— 新音已经唱出来，旧音还在响，听感就是
         "一个音的结尾和下一个音的开头重合了"。 */
      const segStartAbs = isFirst ? (legato ? sa - 0.035 : sa) : sa - xfIn;
      /* 连到下一个词（holdEnd）：这一句收到交界为止，下一句从交界前 35ms 淡进来，
         两边同宽、互补，不会"重合"也不会"瘪"一下。 */
      const tail = isLast ? (holdEnd ? 0 : 0.18) : 0.02;
      const relStart = isLast
        ? (holdEnd ? sb - 0.035 : (legato ? sb - 0.05 : sb - 0.10))
        : (sb - xfOut);
      const relEnd = isLast
        ? (holdEnd ? sb : (legato ? sb + 0.04 : sb + 0.08))
        : sb;
      const segDur = (relEnd - segStartAbs) + tail;
      const bp = [[0, midiFreq(sg.syl[0].m)]];
      for (let k = 1; k < sg.syl.length; k++) {
        const at = Math.max(0.02, sg.syl[k].u - sg.a);
        const prevAt = Math.max(0, sg.syl[k - 1].u - sg.a);
        /* 滑音时长按**音程**给，不按"这个音有多长"给：
           1 个半音 19ms，2 个 38ms，3 个 57ms，5 个 75ms（上限）。
           以前是按间隔的 0.32 给，五声音阶里"上一级"就是 3 个半音，
           而间隔只有 80ms —— 滑音只有 26ms，等于直接跳过去。 */
        const dSemi = Math.abs(sg.syl[k].m - sg.syl[k - 1].m);
        const gap = Math.max(0.02, at - prevAt);
        const glide = Math.min(
          Math.min(0.075, gap * 0.85),          // 不能长过一个音的间隔，否则折点会倒序
          Math.max(0.018, dSemi * 0.019)        // 按音程给：1 半音 19ms、3 半音 57ms
        );
        bp.push([Math.max(0, at - glide), midiFreq(sg.syl[k - 1].m)]);
        bp.push([at, midiFreq(sg.syl[k].m)]);
      }
      const vibMax = dur >= 0.5 ? 30 : dur >= 0.3 ? 18 : 8;         // 音分
      const vibIn = Math.min(0.55, Math.max(0.18, dur * 0.5));
      /* 每个词一个自己的颤动速率和一点点音准偏差。
         整首歌都用同一个 5.3 Hz 颤音 + 完全准的音高，就是"电音/合成器"味的来源。 */
      const h = Math.abs(Math.sin(midi * 12.9898 + t * 78.233) * 43758.5453) % 1;
      const vibHz = 5.0 + h * 1.6;                  // 5.0–6.6 Hz（文献给的真声区间是 5–8 Hz）
      const detune = (h - 0.5) * 10;                // ±5 音分
      /* 每个音的"落点"和"冲过头量"。
         歌声知觉研究把"像不像唱歌"的 F0 特征按重要性排过序：
         冲过头（overshoot）> 颤音 > 预备 > 微细抖动。
         冲过头 = 真人起音会先略微超过目标音高（几十音分），再用约 85ms 落回来。
         少了它，每个音都是"啪"地对准，就是合成器味。短音不做（会被抹平）。 */
      const ovT = [], ovC = [];
      for (let k = 0; k < sg.syl.length; k++) {
        const a0 = Math.max(0, sg.syl[k].u - sg.a);
        const len = (k + 1 < sg.syl.length)
          ? Math.max(0, sg.syl[k + 1].u - sg.syl[k].u)
          : Math.max(0, sg.b - sg.syl[k].u);
        ovT.push(a0);
        // 第一个音已经有一条 14 音分的"找音高"上滑，冲过头减半，免得叠成一个大弯
        ovC.push(len >= 0.24 ? (k === 0 ? 20 : 26 + (h * 1000 + k * 37) % 18) : 0);
      }
      const bpOff = sa - segStartAbs;   // bp 的时间是相对 sa 的，而 sec 是相对 segStartAbs 的
      const f0At = (sec) => {
        const at = sec - bpOff;
        /* 颤音/漂移用"相对整个词起点"的时间：跨段连续。
           以前按段内时间算，两段一重叠，两条颤音相位不同就会互相拍 —— 也是"重合"感的一部分。 */
        const atW = at + sg.a;
        let f = bp[0][1];
        for (let k = 1; k < bp.length; k++) {
          if (at <= bp[k][0]) break;
          const t0 = bp[k - 1][0], f0 = bp[k - 1][1];
          const t1 = bp[k][0], f1 = bp[k][1];
          const u = t1 > t0 ? Math.min(1, (at - t0) / (t1 - t0)) : 1;
          f = f0 * Math.pow(f1 / f0, u);
        }
        if (isFirst) f *= 0.986 + 0.014 * Math.min(1, Math.max(0, atW) / 0.06);   // 找音高时轻微上滑
        // 冲过头：每个落点先高一点，再指数沉回来
        let ov = 0;
        for (let k = 0; k < ovT.length; k++) {
          const d2 = at - ovT[k];
          if (d2 >= 0 && d2 < 0.32 && ovC[k] > 0) {
            const v2 = ovC[k] * Math.exp(-d2 / 0.085);
            if (v2 > ov) ov = v2;
          }
        }
        const vd = Math.min(1, Math.max(0, (atW - 0.10) / vibIn)) * vibMax;
        /* 微细抖动：真人的音高一直在 ±3 音分里不规则地动，这一项和颤音无关，
           短音上也存在 —— 它是"气息"的证据，不是"技术"。 */
        let cents = detune + Math.sin(2 * Math.PI * 0.71 * atW + h * 6.283) * 6
                  + Math.sin(2 * Math.PI * 7.7 * atW + h * 11.0) * 2.4
                  + Math.sin(2 * Math.PI * 12.3 * atW + h * 5.1) * 1.4
                  + ov;
        // 颤音速率也缓慢地晃一点（真人的颤音不是节拍器），相位加一条慢调制
        if (vd > 0) cents += Math.sin(2 * Math.PI * vibHz * atW + 0.6 * Math.sin(2 * Math.PI * 0.37 * atW)) * vd;
        f *= Math.pow(2, (cents + layerCents) / 1200);
        return f;
      };
      const atkLen = isFirst ? (legato ? 0.035 : (headCons ? 0.025 : 0.05)) : xfIn;
      const atkFrom = 0;
      /* 韵尾要在元音上"切一刀"。真人唱 CVC 时，元音在最后 60–80ms 内收掉，
         位置让给鼻音/擦音/塞音的闭塞 —— 这才是"关音节"的听感来源。
         不切这一刀、只在元音后面加一段噪声，耳朵会把它算成下一个字的声母。 */
      const codCuts = [];
      for (const s of sg.syl) {
        if (!s.cod) continue;
        const st = s.u + s.d - sg.a;
        const cs0 = CONS_SPEC[s.cod] || CONS_SPEC.n;
        const len = cs0.kind === 'plos' ? 0.055 : 0.075;
        codCuts.push([st - len, st]);
      }
      const ampAt = (sec) => {
        const abs = segStartAbs + sec;
        let a = peak;
        if (abs < segStartAbs + atkLen) {
          const u = Math.min(1, (abs - segStartAbs) / atkLen);
          // 连唱/换口型用等功率（sqrt）：两条不同的声音叠在一起，线性淡化会掉 3 dB，听起来"瘪"一下
          a = atkFrom + (peak - atkFrom) * ((isFirst && !legato) ? u : Math.sqrt(u));
        }
        if (abs >= relStart) {
          const u = Math.min(1, (abs - relStart) / Math.max(0.001, relEnd - relStart));
          a *= (isLast && !holdEnd) ? (1 - u) : Math.sqrt(Math.max(0, 1 - u));
        }
        // 韵尾处把元音收掉（见上面的 codCuts）
        for (let ci = 0; ci < codCuts.length; ci++) {
          const c0 = codCuts[ci][0], c1 = codCuts[ci][1];
          if (sec > c0 && sec < c1 + 0.022) {
            if (sec <= c1) {
              a *= 1 - 0.72 * Math.min(1, (sec - c0) / Math.max(0.01, c1 - c0));
            } else {
              a *= 0.28 + 0.72 * Math.min(1, (sec - c1) / 0.022);
            }
          }
        }
        return a;
      };

      const pcm = voxRenderSegment(sg.v, sg.syl[0].m, segDur, sr, f0At, ampAt);
      if (pcm) {
        const src = ctx.createBufferSource();
        src.buffer = voxToAudioBuffer(ctx, pcm, layerGain * VOX_LEVEL);
        src.connect(out);
        const st = Math.max(0, segStartAbs);
        src.start(st, st - segStartAbs);
        continue;
      }
    }

    const o = ctx.createOscillator();
    if (layerCents) o.detune.value = layerCents;
    o.setPeriodicWave(vowelWave(ctx, sg.v, midiFreq(sg.syl[0].m)));

    // 起音时轻微上滑（真人找音高），后段直接接上
    o.frequency.setValueAtTime(midiFreq(sg.syl[0].m) * (isFirst ? 0.986 : 1), sa);
    if (isFirst) o.frequency.linearRampToValueAtTime(midiFreq(sg.syl[0].m), sa + 0.06);

    // 段内换音高：40ms 滑过去，不"跳"
    let prevM = sg.syl[0].m;
    for (let k = 1; k < sg.syl.length; k++) {
      const at = t + sg.syl[k].u;
      const from = Math.max(sa + 0.02, at - 0.045);
      o.frequency.setValueAtTime(midiFreq(prevM), from);
      o.frequency.linearRampToValueAtTime(midiFreq(sg.syl[k].m), Math.max(from + 0.01, at));
      prevM = sg.syl[k].m;
    }

    // 颤音：一段共用一条 LFO，晚一点进来（真人也是先直后抖）
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.3;
    const lg = ctx.createGain();
    const vib = dur >= 0.5 ? 30 : dur >= 0.3 ? 18 : 8;
    lg.gain.setValueAtTime(0, sa);
    lg.gain.linearRampToValueAtTime(vib, sa + Math.min(0.55, Math.max(0.18, dur * 0.5)));
    lfo.connect(lg); lg.connect(o.detune);

    const g = ctx.createGain();
    /* 波表路径的包络必须采样路径同宽，否则有音库/没音库听起来不一样 */
    const fStartAbs = isFirst ? (legato ? sa - 0.035 : sa) : sa - xfIn;
    if (isFirst) {
      // 连唱时也从 0 起，和上一句的淡出交叉（旧版从 55% 起，交界会顶一下）
      g.gain.setValueAtTime(0.0001, fStartAbs);
      g.gain.linearRampToValueAtTime(peak, legato ? sa : sa + (headCons ? 0.025 : 0.05));
    } else {
      g.gain.setValueAtTime(0.0001, sa - xfIn);
      g.gain.linearRampToValueAtTime(peak, sa);
    }
    if (isLast) {
      const relS = holdEnd ? sb - 0.035 : (legato ? sb - 0.05 : sb - 0.10);
      g.gain.setValueAtTime(Math.max(0.0001, peak * 0.95), Math.max(sa + 0.01, relS));
      g.gain.linearRampToValueAtTime(0.0001, holdEnd ? sb : (legato ? sb + 0.04 : sb + 0.08));
    } else {
      g.gain.setValueAtTime(peak, sb - xfOut);
      g.gain.linearRampToValueAtTime(0.0001, sb);
    }
    o.connect(g); g.connect(out);

    const stop = sb + 0.24;
    o.start(Math.max(0, fStartAbs)); o.stop(stop);
    lfo.start(Math.max(0, fStartAbs)); lfo.stop(stop);
  }

  // 气声：只给稍长的词，短词加噪声反而脏
  if (dur >= 0.35) {
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx, seed); nz.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
    const ng = ctx.createGain(); ng.gain.value = vel * 0.04;
    nz.connect(hp); hp.connect(ng); ng.connect(out);
    nz.start(t); nz.stop(endT + 0.2);
  }

  // 辅音：每个音节的"字头"。按发音方式分三种包络，短促的爆音 / 持续的气流 / 轻轻一起。
  for (const s of (noCons ? [] : list)) {
    if (!s.cons) continue;
    const csp = CONS_SPEC[s.cons] || CONS_SPEC.l;
    const kind = csp.kind || 'fric';
    const cs = ctx.createBufferSource();
    cs.buffer = noiseBuffer(ctx, seed); cs.loop = true;
    const cf = ctx.createBiquadFilter();
    cf.type = csp.type; cf.frequency.value = csp.f;
    if (csp.q) cf.Q.value = csp.q;
    const cg = ctx.createGain();
    /* 第二级低通：白噪声本来一直到 22kHz，多出来的那截高频就是"沙沙"。
       真人的 s/sh 到 10–15k 就掉下去了，这里照着切。 */
    if (csp.lp) {
      const clp = ctx.createBiquadFilter();
      clp.type = 'lowpass'; clp.frequency.value = csp.lp; clp.Q.value = 0.7;
      cs.connect(cf); cf.connect(clp); clp.connect(cg);
    } else {
      cs.connect(cf); cf.connect(cg);
    }
    cg.connect(out);
    const end = t + s.u;                       // 元音从这个点开始

    if (kind === 'plos') {
      // 爆破：元音前 42ms 闭气（这一段是静音），然后 18ms 爆点
      const t0 = Math.max(0, end - 0.042);
      const t1 = Math.max(t0 + 0.006, end - 0.008);
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * csp.g * 0.75), t1);
      cg.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.022);
      cs.start(t0); cs.stop(t1 + 0.05);
    } else if (kind === 'appr') {
      const t0 = Math.max(0, end - csp.len);
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.linearRampToValueAtTime(Math.max(0.0002, vel * csp.g * 0.85), t0 + csp.len * 0.55);
      cg.gain.linearRampToValueAtTime(0.0001, t0 + csp.len);
      cs.start(t0); cs.stop(t0 + csp.len + 0.02);
    } else {
      /* 擦音：尾端故意压到元音起音**之后** 28ms。
         以前擦音在元音起点就结束、元音再从零爬 50ms，两段之间是空的，
         听起来就是"一段悬空的沙沙声"。现在两者重叠，气流直接转成嗓音。 */
      const t1 = end + 0.028;
      const t0 = Math.max(0, t1 - csp.len);
      const lv = Math.max(0.0002, vel * csp.g * 0.78);
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.linearRampToValueAtTime(lv, t0 + Math.min(0.020, csp.len * 0.3));
      cg.gain.setValueAtTime(lv, t0 + csp.len * 0.62);
      cg.gain.linearRampToValueAtTime(0.0001, t1);
      cs.start(t0); cs.stop(t1 + 0.02);
    }
  }

  /* ---- 韵尾 ----
     一个音节收在辅音上（-n / -l / -r / -s / -t / -k）。没有韵尾，整首歌只剩元音，
     听感就是"a o e y w u 连成一条"—— 用户说"不像一种语言"，直接原因就在这里。
     韵尾比字头轻（×0.5）、短（×0.8），而且**压在元音尾巴上**：
     元音在最后 75ms 已经收到 28%（见上面的 codCuts），噪声填进这个缺口，
     耳朵听到的是"元音 + 鼻音/擦音"，而不是"元音，然后另一段沙沙"。 */
  for (const s of (noCons ? [] : list)) {
    if (!s.cod) continue;
    const csp = CONS_SPEC[s.cod] || CONS_SPEC.n;
    const cs = ctx.createBufferSource();
    cs.buffer = noiseBuffer(ctx, seed + 7); cs.loop = true;
    const cf = ctx.createBiquadFilter();
    cf.type = csp.type; cf.frequency.value = csp.f;
    if (csp.q) cf.Q.value = csp.q;
    const cg = ctx.createGain();
    if (csp.lp) {
      const clp = ctx.createBiquadFilter();
      clp.type = 'lowpass'; clp.frequency.value = csp.lp; clp.Q.value = 0.7;
      cs.connect(cf); cf.connect(clp); clp.connect(cg);
    } else {
      cs.connect(cf); cf.connect(cg);
    }
    cg.connect(out);
    const endC = t + s.u + s.d;
    const len = Math.max(0.040, (csp.len || 0.07) * 0.8);
    const t0 = Math.max(0, endC - len);
    const lv = Math.max(0.0002, vel * csp.g * 0.5);
    if (csp.kind === 'plos') {
      /* 塞音韵尾：先闭气（这一段是静的），最后 10ms 一个很轻的除阻。
         闭气本身就是信息 —— 汉语入声、日语促音靠的都是它。 */
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.setValueAtTime(0.0001, Math.max(t0, endC - 0.012));
      cg.gain.linearRampToValueAtTime(lv, endC - 0.005);
      cg.gain.linearRampToValueAtTime(0.0001, endC + 0.008);
    } else {
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.linearRampToValueAtTime(lv, t0 + len * 0.5);
      cg.gain.linearRampToValueAtTime(0.0001, endC + 0.008);
    }
    cs.start(t0); cs.stop(endC + 0.04);
  }
}

const VOICE_FN = {
  epiano: epianoV, bell: bellV, piano: pianoV, strings: stringsV, warm: warmPadV,
  organ: organV, choir: choirV, saw: sawLeadV, pluck: pluckV,
  sub: subBassV, upright: uprightBassV, dist: distBassV, sawbass: bassV
};

let vocalOn = true;   // 人声开关（播放与导出都读它）
function playEvent(ctx, inst, e, time, spb) {
  const spec = inst.spec;
  const V = VOICE_FN;
  switch (e.k) {
    case 'vox': {
      if (!vocalOn) break;
      /* 人声比别的声部更湿、延迟更短：塔语歌曲的人声是"在大厅里唱"，
         而不是带一串回声。 */
      const out = outNode(ctx, inst, 0.48, 0.16);
      /* 每句的重音（强拍略出来、弱位收一点，见 score.js 的 voxGain） */
      const g = e.voxGain == null ? 1 : e.voxGain;
      /* 多重录音（多重コーラス）。土屋暁 自己说过：单轨"合唱"音色怎么叠都不够厚，
         最后叠了 A–F 六个声部才有那份庄严。真人叠录永远是差几音分、晚几十毫秒的，
         完全齐反而像合成器 —— 所以副轨故意偏 7/9 音分、晚 21/38ms，并且不咬字
         （咬字只由主轨负责，否则几轨一叠就成了"打嗝"）。 */
      /* 三条是同一个人的"多重录音"，听感上会融合成一条，所以总量要压回单轨水平。
         实测三轨齐响比单轨高 4.4 dB；这里整体乘 0.60 把它压回"人声比伴奏低 1 dB"附近
         （PSOLA 会把每段归一化，vel 到不了这一层，所以音量只能靠 gain 给）。 */
      voxV(ctx, time, out, e.midi, e.dur * spb, e.vel, e.v, e.cons, spec.seed, e.syl, e.legato, e.holdEnd, { gain: 0.60 * g });
      voxV(ctx, time + 0.021, out, e.midi, e.dur * spb, e.vel, e.v, null, spec.seed, e.syl, e.legato, e.holdEnd, { gain: 0.29 * g, cents: 7, noCons: true });
      // 第三条只在长音上给：短音叠三条既听不出厚度，又要把渲染时间翻三倍
      if (e.dur * spb >= 0.5) {
        voxV(ctx, time + 0.038, out, e.midi, e.dur * spb, e.vel, e.v, null, spec.seed, e.syl, e.legato, e.holdEnd, { gain: 0.17 * g, cents: -9, noCons: true });
      }
      if (e.harm) for (const m of e.harm) {
        const iv = m - e.midi;
        const hs = e.syl ? e.syl.map(s => ({ u: s.u, d: s.d, m: s.m + iv, cons: null })) : null;
        voxV(ctx, time, out, m, e.dur * spb, e.vel, e.v, null, spec.seed, hs, e.legato, e.holdEnd, { gain: 0.36 * g });
      }
      break;
    }
    case 'kick': kick(ctx, time, outNode(ctx, inst, 0.04, 0), e.vel); break;
    case 'snare': snare(ctx, time, outNode(ctx, inst, 0.16, 0), e.vel, spec.seed); break;
    case 'clap': clapV(ctx, time, outNode(ctx, inst, 0.18, 0), e.vel, spec.seed); break;
    case 'rim': rimV(ctx, time, outNode(ctx, inst, 0.10, 0), e.vel, spec.seed); break;
    case 'shaker': shakerV(ctx, time, outNode(ctx, inst, 0.05, 0), e.vel, spec.seed); break;
    case 'tom': tomV(ctx, time, outNode(ctx, inst, 0.12, 0), e.vel); break;
    case 'crash': crashV(ctx, time, outNode(ctx, inst, 0.20, 0), e.vel, spec.seed); break;
    case 'hat': hat(ctx, time, outNode(ctx, inst, 0.06, 0), e.vel, spec.seed, !!e.open); break;
    case 'bass': V[spec.voices.bass](ctx, time, outNode(ctx, inst, 0.03, 0), e.midi, e.dur * spb, e.vel, spec.cutoff); break;
    case 'pad': {
      const out = outNode(ctx, inst, 0.5, 0.08, -0.28);
      const fn = V[spec.voices.pad] || padV;
      // 有唱词时铺底让一点位置：人声要能"站"在铺底前面，不用靠堆音量
      const pv = e.vel * (vocalOn && spec.vocalLevel ? 0.8 : 1);
      for (const m of e.midi) fn(ctx, time, out, m, e.dur * spb, pv, spec.cutoff);
      break;
    }
    case 'lead': V[spec.voices.lead](ctx, time, outNode(ctx, inst, 0.3, 0.32), e.midi, e.dur * spb, e.vel * (vocalOn && spec.vocalLevel ? 0.55 : 1), spec.cutoff * 1.4); break;
    case 'arp': V[spec.voices.arp](ctx, time, outNode(ctx, inst, 0.28, 0.22, 0.32), e.midi, e.dur * spb, e.vel * (vocalOn ? 0.85 : 1), spec.cutoff); break;
  }
}
