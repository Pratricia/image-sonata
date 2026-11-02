/* 打印某时间段的逐帧音量与音高，用来看"短音"的形状。
   用法：node tools/svs/probe_range.js <wav> <startSec> <endSec> [hopMs] */
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

const [, , path, aS, bS, hopS] = process.argv;
const A = +aS, B = +bS, HOPMS = +(hopS || 20);
const { x, sr } = readWav(path);
const WIN = Math.round(sr * 0.03);
const HOP = Math.round(sr * HOPMS / 1000);
const FMIN = 70, FMAX = 800;
const lagMin = Math.floor(sr / FMAX), lagMax = Math.ceil(sr / FMIN);

function f0At(o) {
  let e = 0;
  for (let i = 0; i < WIN; i++) e += x[o + i] * x[o + i];
  const rms = Math.sqrt(e / WIN);
  if (rms < 0.005) return { rms, f: 0, r: 0 };
  let best = 0, bestLag = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < WIN - lag; i++) { s += x[o + i] * x[o + i + lag]; e1 += x[o + i] * x[o + i]; e2 += x[o + i + lag] * x[o + i + lag]; }
    const r = s / Math.sqrt(e1 * e2 + 1e-12);
    if (r > best) { best = r; bestLag = lag; }
  }
  return { rms, f: sr / bestLag, r: best };
}

const rows = [];
for (let t = A; t < B; t += HOPMS / 1000) {
  const o = Math.round(t * sr);
  if (o + WIN >= x.length) break;
  const v = f0At(o);
  rows.push({ t, ...v });
}

// 以窗口内 40% 分位数当基准，算半音偏移，方便看"偏离"
const fs2 = rows.filter(r => r.f > 0).map(r => 12 * Math.log2(r.f / 55)).sort((p, q) => p - q);
const base = fs2.length ? fs2[Math.floor(fs2.length * 0.4)] : 0;

console.log('=== ' + path.split(/[\\/]/).pop() + '  ' + A + '–' + B + 's  基准半音=' + base.toFixed(2) + ' ===');
console.log(' 时间   音量   音高Hz  偏差半音  周期度');
for (const r of rows) {
  const semis = r.f > 0 ? 12 * Math.log2(r.f / 55) - base : NaN;
  const bar = isNaN(semis) ? '' : (semis > 0 ? '+' : '-').repeat(Math.min(20, Math.round(Math.abs(semis) * 8)));
  console.log(
    r.t.toFixed(3).padStart(6) + ' ' +
    (r.rms * 100).toFixed(1).padStart(5) + ' ' +
    (r.f > 0 ? r.f.toFixed(1) : '  --  ').padStart(7) + ' ' +
    (isNaN(semis) ? '   --  ' : (semis >= 0 ? '+' : '') + semis.toFixed(2)).padStart(8) + '  ' +
    (r.f > 0 ? r.r.toFixed(2) : '0.00').padStart(5) + '  ' + bar
  );
}
