/* 在 Node 里跑 voxsample.js，验证音库 + PSOLA 出来的东西对不对：
   基频是否落在目标音高上、有没有 NaN、电平是否合理。
   用法：node tools/svs/test_psola.js
   产物：tools/svs/out/test_vox.wav（可以直接听） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const sandbox = {
  console, Math, JSON, Date,
  Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['assets/voicebank.js', 'src/js/util.js', 'src/js/voxsample.js']) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) { console.error('缺文件', p); process.exit(1); }
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
}

const bank = sandbox.VOX_BANK;
console.log('音库采样率', bank.sr, '样本数', bank.notes.length,
  '许可', bank.license);
const byV = {};
for (const n of bank.notes) (byV[n.v] = byV[n.v] || []).push(n.midi);
for (const v of Object.keys(byV)) console.log('  ', v, byV[v].sort((a, b) => a - b).join(','));

const SR = 44100;
const out = [];
let nan = 0;

function addNote(vowel, midi, dur, vel) {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const pcm = sandbox.voxRenderSegment(vowel, midi, dur, SR,
    (t) => f0, (t) => Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.12) * vel);
  if (!pcm) { console.log('  没有样本:', vowel); return; }
  for (let i = 0; i < pcm.length; i++) if (!Number.isFinite(pcm[i])) nan++;
  out.push({ v: vowel, midi, f0, pcm });
}

const plan = [['a', 57], ['a', 64], ['i', 60], ['u', 55], ['e', 62], ['o', 59]];
for (const [v, m] of plan) addNote(v, m, 0.9, 0.8);

function measure(pcm, f0) {
  let peak = 0, sum = 0;
  for (const x of pcm) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
  // 归一化自相关测基频：取最短的那个达到 0.9*最大相关值的局部峰，
  // 否则很容易把"两个周期"当成一个周期（差八度）。
  const N = 8192;
  const seg = pcm.subarray(Math.min(4000, pcm.length - N - 1), Math.min(4000, pcm.length - N - 1) + N);
  const lo = Math.floor(SR / 800), hi = Math.floor(SR / 60);
  const r = new Float64Array(hi + 2);
  for (let lag = lo; lag < hi; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + lag < N; i++) { s += seg[i] * seg[i + lag]; e1 += seg[i] * seg[i]; e2 += seg[i + lag] * seg[i + lag]; }
    r[lag] = s / (Math.sqrt(e1 * e2) + 1e-12);
  }
  let rmax = 0;
  for (let lag = lo; lag < hi; lag++) rmax = Math.max(rmax, r[lag]);
  let bestLag = 0;
  for (let lag = lo + 1; lag < hi - 1; lag++) {
    if (r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] > 0.85 * rmax) { bestLag = lag; break; }
  }
  // 抛物线插值
  let lagF = bestLag;
  if (bestLag > 0) {
    const a = r[bestLag - 1], b = r[bestLag], c = r[bestLag + 1];
    lagF = bestLag + (a - c) / (2 * (a - 2 * b + c) + 1e-12);
  }
  return {
    peak: +peak.toFixed(3),
    rms: +Math.sqrt(sum / pcm.length).toFixed(4),
    measuredF0: lagF ? +(SR / lagF).toFixed(1) : 0,
    targetF0: +f0.toFixed(1),
  };
}

let ok = true;
for (const o of out) {
  const m = measure(o.pcm, o.f0);
  const cents = 1200 * Math.log2(m.measuredF0 / m.targetF0);
  const good = Math.abs(cents) < 60 && m.peak > 0.1;
  if (!good) ok = false;
  console.log(`${o.v} midi=${o.midi} target=${m.targetF0}Hz measured=${m.measuredF0}Hz (${cents.toFixed(0)}cent) peak=${m.peak} rms=${m.rms} ${good ? 'OK' : '!!'}`);
}

// 拼成一个 wav：每句之间留 0.15s
const total = out.reduce((a, o) => a + o.pcm.length + Math.round(0.15 * SR), 0);
const mix = new Float32Array(total);
let p = 0;
for (const o of out) { mix.set(o.pcm, p); p += o.pcm.length + Math.round(0.15 * SR); }

const dir = path.join(__dirname, 'out');
fs.mkdirSync(dir, { recursive: true });
writeWav(path.join(dir, 'test_vox.wav'), mix, SR);
console.log('nan =', nan, ' 写出', path.join('tools/svs/out/test_vox.wav'));
console.log(ok && nan === 0 ? 'PASS' : 'FAIL');

function writeWav(file, x, sr) {
  const n = x.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}