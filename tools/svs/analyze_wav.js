/* 客观检查导出的 WAV 里人声有没有毛病 —— 不靠耳朵，靠数字。
   用法：node tools/svs/analyze_wav.js <某个.wav>

   看三件事：
   1. 频谱平坦度（0 = 纯谐波，1 = 白噪声）。人声正常应 < 0.05；
      高于 0.2 说明真有噪声（静电声、粒与粒露缝那种）。
   2. 发声段/电平塌陷：把包络按 10ms 切，看发声帧里最低的那 5% 相对中位是多少。
      低于 0.4 说明句子中间"瘪"了一下（交叉淡化没接好、或音量跟着音高跑）。
   3. 爆点：|Δx| 远大于邻域中位数 → 缓冲边界没接好。

   背景：第三轮修订就是靠这个查出"段内电平随音高变 5–6 dB"和
   "交叉淡化一边长一边短"的（见 research/05-vocal-synthesis-options.md）。 */
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('用法: node tools/svs/analyze_wav.js <file.wav>'); process.exit(1); }

const buf = fs.readFileSync(file);
const ch = buf.readUInt16LE(22), sr = buf.readUInt32LE(24), bps = buf.readUInt16LE(34);
const n = (buf.length - 44) / (bps / 8) / ch;
const x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(44 + i * bps / 8 * ch) / 32768;
console.log(file, ' sr', sr, ' 时长', (n / sr).toFixed(2) + 's');

/* ---- 1. 频谱平坦度（只测 200–8000Hz，直接 DFT，慢但不用引依赖） ---- */
const N = 2048;
function flatness(fromSec) {
  const s = Math.round(fromSec * sr);
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = (x[s + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const lo = Math.round(200 * N / sr), hi = Math.round(8000 * N / sr);
  const logs = [];
  for (let k = lo; k < hi; k++) {
    let a = 0, b = 0;
    const om = -2 * Math.PI * k / N;
    for (let i = 0; i < N; i++) { a += w[i] * Math.cos(om * i); b += w[i] * Math.sin(om * i); }
    logs.push(Math.log(a * a + b * b + 1e-12));
  }
  const mean = logs.reduce((p, v) => p + v, 0) / logs.length;
  return Math.exp(mean) / (logs.reduce((p, v) => p + Math.exp(v), 0) / logs.length);
}

/* ---- 2. 包络 ---- */
const win = Math.round(0.01 * sr);
const env = [];
for (let s = 0; s + win < n; s += win) {
  let q = 0;
  for (let i = s; i < s + win; i++) q += x[i] * x[i];
  env.push(Math.sqrt(q / win));
}
const sortedEnv = [...env].sort((a, b) => a - b);
const med = sortedEnv[Math.floor(sortedEnv.length / 2)];
const act = env.filter(v => v > med * 0.35).sort((a, b) => a - b);

console.log('频谱平坦度（1s 起，每 0.5s）:',
  [0, 1, 2, 3, 4].map(k => flatness(Math.min(n / sr - 0.06, 1 + k * 0.5)).toFixed(4)).join(' '));
console.log('发声帧', act.length + '/' + env.length,
  ' 电平 5%分位/中位 =', (act[Math.floor(act.length * 0.05)] / med).toFixed(2),
  ' 最低/中位 =', (act[0] / med).toFixed(2));

/* ---- 3. 爆点 ---- */
const W = 128;
let hits = 0;
for (let i = W; i < n - W; i++) {
  const d = Math.abs(x[i] - x[i - 1]);
  if (d < 0.08) continue;
  const meds = new Float32Array(2 * W);
  for (let k = -W; k < W; k++) meds[k + W] = Math.abs(x[i + k] - x[i + k - 1]);
  meds.sort();
  if (d > Math.max(0.08, meds[W] * 9)) hits++;
}
console.log('爆点（|Δx| > 9×邻域中位）=', hits);