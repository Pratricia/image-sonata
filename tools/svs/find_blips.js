/* 在 WAV 里找"一闪而过的短音"：能量包络上的短促突起。
   用法：node tools/svs/find_blips.js <wav> [rel=1.6] [maxms=140] */
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
const REL = +(process.argv[3] || 1.6);
const MAXMS = +(process.argv[4] || 140);
const { x, sr } = readWav(path);

const HOP = Math.round(sr * 0.005);            // 5ms 帧
const frames = Math.floor(x.length / HOP);
const rms = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  let s = 0;
  for (let i = 0; i < HOP; i++) { const v = x[f * HOP + i]; s += v * v; }
  rms[f] = Math.sqrt(s / HOP);
}

// 局部背景：前后 120ms 里较小的那部分（用分位数近似）
const R = 24;
const bg = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  const a = Math.max(0, f - R), b = Math.min(frames, f + R);
  const arr = Array.from(rms.slice(a, b)).sort((p, q) => p - q);
  bg[f] = arr[Math.floor(arr.length * 0.25)] || 1e-6;
}

const hits = [];
let run = null;
for (let f = 0; f < frames; f++) {
  const loud = rms[f] > bg[f] * REL && rms[f] > 0.004;
  if (loud && !run) run = { a: f, peak: rms[f] };
  else if (loud && run) run.peak = Math.max(run.peak, rms[f]);
  else if (!loud && run) { run.b = f; run.ms = (run.b - run.a) * 5; if (run.ms <= MAXMS) hits.push(run); run = null; }
}
if (run) { run.b = frames; run.ms = (run.b - run.a) * 5; if (run.ms <= MAXMS) hits.push(run); }

console.log(path.split(/[\\/]/).pop() + '  ' + (x.length / sr).toFixed(1) + 's  sr=' + sr);
console.log('短促突起 ' + hits.length + ' 处（阈值 ' + REL + '×局部背景, ≤' + MAXMS + 'ms）');
const groups = {};
for (const h of hits) {
  const t = (h.a * 5 / 1000);
  const ratio = h.peak / bg[h.a];
  console.log('  ' + t.toFixed(2).padStart(6) + 's  ' + String(h.ms).padStart(3) + 'ms  ×' + ratio.toFixed(1));
}
