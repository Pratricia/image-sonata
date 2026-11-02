/* 测人声的音高轨迹，找“短促的音高事件”（夹在两个稳定音之间的一小段偏离）。
   用法：node tools/svs/f0_blips.js <wav> [minSemis=0.8] [maxMs=160] */
const fs = require('fs');

function readWav(path) {
  const b = fs.readFileSync(path);
  let off = 12, fmt = null, data = null;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + sz); break; }
    off += 8 + sz + (sz & 1);
  }
  const n = data.length / (fmt.bits / 8) / fmt.ch;
  const x = new Float32Array(n);
  if (fmt.bits === 16) for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  else for (let i = 0; i < n; i++) x[i] = data.readFloatLE(i * 4 * fmt.ch);
  return { x, sr: fmt.sr };
}

const path = process.argv[2];
const MIN_SEMI = +(process.argv[3] || 0.8);
const MAX_MS = +(process.argv[4] || 160);
const { x, sr } = readWav(path);

const WIN = Math.round(sr * 0.040);
const HOP = Math.round(sr * 0.005);
const FMIN = 70, FMAX = 900;
const lagMin = Math.floor(sr / FMAX), lagMax = Math.ceil(sr / FMIN);
const frames = Math.floor((x.length - WIN) / HOP);

const f0 = new Float32Array(frames);
const rms = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  const o = f * HOP;
  let e = 0;
  for (let i = 0; i < WIN; i++) e += x[o + i] * x[o + i];
  rms[f] = Math.sqrt(e / WIN);
  if (rms[f] < 0.006) { f0[f] = 0; continue; }
  let best = 0, bestLag = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < WIN - lag; i++) { s += x[o + i] * x[o + i + lag]; e1 += x[o + i] * x[o + i]; e2 += x[o + i + lag] * x[o + i + lag]; }
    const r = s / Math.sqrt(e1 * e2 + 1e-12);
    if (r > best) { best = r; bestLag = lag; }
  }
  f0[f] = best > 0.55 ? sr / bestLag : 0;
}

const semi = new Float32Array(frames);
for (let f = 0; f < frames; f++) semi[f] = f0[f] > 0 ? 12 * Math.log2(f0[f] / 55) : NaN;

function med(a, b) {
  const v = [];
  for (let f = Math.max(0, a); f < Math.min(frames, b); f++) if (!isNaN(semi[f])) v.push(semi[f]);
  if (!v.length) return NaN;
  v.sort((p, q) => p - q);
  return v[Math.floor(v.length / 2)];
}

// 以 ±120ms 的中位数为“该处的正常音高”，找持续不到 MAX_MS 的偏离段
const R = 24;
const dev = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  if (isNaN(semi[f])) continue;
  const m = med(f - R, f + R);
  dev[f] = isNaN(m) ? 0 : semi[f] - m;
}

const hits = [];
let run = null;
for (let f = 0; f < frames; f++) {
  const bad = !isNaN(semi[f]) && Math.abs(dev[f]) > MIN_SEMI;
  if (bad && !run) run = { a: f, peak: dev[f], sign: Math.sign(dev[f]) };
  else if (bad && run) { if (Math.abs(dev[f]) > Math.abs(run.peak)) { run.peak = dev[f]; run.sign = Math.sign(dev[f]); } }
  else if (!bad && run) { run.b = f; run.ms = (run.b - run.a) * 5; if (run.ms <= MAX_MS && run.ms >= 25) hits.push(run); run = null; }
}

console.log(path.split(/[\\/]/).pop() + '  ' + (x.length / sr).toFixed(1) + 's');
let voiced = 0; for (let f = 0; f < frames; f++) if (!isNaN(semi[f])) voiced++;
console.log('有声帧 ' + (voiced / frames * 100).toFixed(0) + '%   短促音高事件 ' + hits.length + ' 处（偏离>' + MIN_SEMI + '半音, ≤' + MAX_MS + 'ms）');
for (const h of hits) {
  const t = (h.a * 5 / 1000);
  console.log('  ' + t.toFixed(2).padStart(7) + 's  ' + String(h.ms).padStart(3) + 'ms  ' + (h.peak > 0 ? '+' : '') + h.peak.toFixed(2) + ' 半音');
}
