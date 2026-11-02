/* voxsample.js —— 采样人声：音库 + TD-PSOLA 变调
   依赖：util.js（midiFreq）、assets/voicebank.js（window.VOICE_BANK，可能不存在）

   为什么不用 playbackRate 变调：
     playbackRate 会把整条频谱一起缩放，升八度就变"花栗鼠"、降八度就变"大舌头"。
   TD-PSOLA 是把波形按"周期"复制/丢弃后再重排，共振峰（决定是 a 还是 i 的东西）
   留在原地不动，所以同一段"啊"可以唱到任意音高还是同一个人的嗓子。

   为什么人声要预渲染成 buffer 再播：
     原来每个音都要建振荡器 + 滤波器 + LFO 一堆节点，离线导出会慢到几分钟；
     现在一段 = 一个 AudioBufferSourceNode，播放和导出都只多一次 buffer copy。 */

const VOX_SR_MIN = 16000;   // 音库低于这个采样率就太闷了

/* 把 int16 基带 base64 解成 Float32（音库文件里存的是 int16，省一半体积） */
function voxDecodePCM(b64, sr, targetSr) {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const raw = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bin.charCodeAt(i * 2), hi = bin.charCodeAt(i * 2 + 1);
    let v = (hi << 8) | lo;
    if (v & 0x8000) v -= 0x10000;
    raw[i] = v;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i] / 32768;
  return targetSr && targetSr !== sr ? voxResample(out, sr, targetSr) : out;
}

/* 线性插值重采样。音库 22.05k / 导出 44.1k，差两倍，线性插值够用。 */
function voxResample(x, from, to) {
  if (from === to) return x;
  const n = Math.max(1, Math.round(x.length * to / from));
  const y = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * step, i0 = p | 0, f = p - i0;
    const a = x[i0] || 0, b = x[i0 + 1] || 0;
    y[i] = a + (b - a) * f;
  }
  return y;
}

/* 汉宁窗：粒与粒 50% 重叠相加时，窗函数和是常数，不会出现幅度起伏 */
function voxHann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n);
  return w;
}

/* 音库里挑一条样本：先挑元音，再挑音高最近的一条。
   超过 5 个半音就记一笔（变调太多会有"塑料味"，调用方可据此降 8 度加和声） */
function voxPick(vowel, midi) {
  const bank = window.VOX_BANK;
  if (!bank || !bank.notes || !bank.notes.length) return null;
  const v = ({ ae: 'a', ea: 'e', ie: 'i', ou: 'o', ai: 'a' })[vowel] || vowel;
  let best = null, bestD = 1e9;
  for (const n of bank.notes) {
    if (n.v !== v) continue;
    const d = Math.abs(n.midi - midi);
    if (d < bestD) { bestD = d; best = n; }
  }
  if (!best) {   // 这个元音没有样本（音库不全）→ 借一个最接近的
    for (const n of bank.notes) {
      const d = Math.abs(n.midi - midi) + 4;
      if (d < bestD) { bestD = d; best = n; }
    }
  }
  return best ? { note: best, shift: bestD } : null;
}

/* TD-PSOLA 主体
   x        : 源采样（已重采样到 sr）
   srcF0    : 源采样自身的基频（Hz），由建库时测出来
   durSec   : 目标时长
   f0At(t)  : 目标音高曲线（t 单位秒，相对段首）
   ampAt(t) : 幅度包络 0..1
   返回 Float32Array（单声道，长度 = durSec*sr） */
function voxPsola(x, srcF0, sr, durSec, f0At, ampAt) {
  const outLen = Math.max(1, Math.ceil(durSec * sr));
  const out = new Float32Array(outLen + 8192);   // 预留尾部，最后裁掉
  const sp = sr / srcF0;
  const grainBase = Math.max(8, Math.round(2 * sp));
  /* 音库的每条样本两端各有 15ms 淡入淡出（切点不一定在过零），
     循环时读到那一段音量会掉下去。留出 25ms 边距，循环点落在中间。 */
  const pad = Math.min(Math.round(0.025 * sr), Math.max(0, Math.floor((x.length - grainBase) * 0.25)));

  // 找一个"相位对齐点"：让取粒位置落在波形幅度大的地方，避免取在过零处
  let bestOff = 0, bestE = -1;
  const maxOff = Math.max(1, Math.floor(sp));
  for (let off = 0; off < maxOff; off++) {
    let e = 0, c = 0;
    for (let p = off; p + grainBase < x.length; p += Math.round(sp)) { e += Math.abs(x[p]); c++; }
    e = c ? e / c : 0;
    if (e > bestE) { bestE = e; bestOff = off; }
  }

  const nMarks = Math.max(1, Math.floor((x.length - pad - grainBase - bestOff) / sp));
  const naturalSec = nMarks / srcF0;          // 这条样本自然能唱多久
  const step = Math.min(2.5, Math.max(0.25, naturalSec / Math.max(0.02, durSec)));

  // 窗长随输出周期变，窗口函数按长度缓存（只有几十种长度）
  const winCache = new Map();
  const winOf = (g) => { let w = winCache.get(g); if (!w) { w = voxHann(g); winCache.set(g, w); } return w; };

  let pos = 0;        // 输出位置（采样点）
  let imark = 0;      // 源周期序号（**必须是整数**，见下）
  let acc = 0;        // 时间压缩的累积量
  let i = 0;
  /* 相位吸附的半径 = 半个源周期。音库的基频是建库时测的，实测偏差可达 ±11 音分，
     于是"每粒往后挪一个源周期"并不真的落在波形的同一相位上，误差粒粒累积；
     几十粒之后相位转过 180°，相邻的粒叠起来互相抵消 —— 听感就是音量"塌一块"，
     或者干脆掉成低八度/低三度的怪音（用户报的"两个正常音之间夹一个很短的音"）。
     每粒都往 ±半周期内的真正波峰吸一下，误差不累积，等于把取粒点钉在波形上。 */
  const snapR = Math.max(2, Math.round(sp * 0.5));
  while (pos < outLen) {
    const t = pos / sr;
    const f0 = Math.max(50, Math.min(1200, f0At(t)));
    const op = sr / f0;                        // 输出周期
    /* 窗长只跟**输出**周期走。
       以前的窗长是 2×max(源周期, 输出周期)：往上变调时窗比跳距还宽一倍多，
       汉宁窗的叠加和就不再是常数，而是按 源周期/输出周期 的节拍起伏 ——
       这个起伏的周期恰好是音高周期的几倍，听起来就是一个"多出来的低音"。
       窗长 = 2×跳距时叠加和恒等于 1，也就不再需要补增益。 */
    const g = Math.max(8, Math.round(2 * op));
    const half = g >> 1;
    const win = winOf(g);
    const gcomp = 1;
    const amp = ampAt(t);
    if (amp > 0.0005) {
      const base = bestOff + pad + imark * sp;
      let center = base, cAmp = -1e9;
      const lo = Math.max(1, Math.round(base) - snapR);
      const hi = Math.min(x.length - 2, Math.round(base) + snapR);
      for (let p = lo; p <= hi; p++) if (x[p] > cAmp) { cAmp = x[p]; center = p; }
      const start = Math.round(pos) - half;
      for (let j = 0; j < g; j++) {
        const o = start + j;
        if (o < 0) continue;
        if (o >= out.length) break;
        const s = center - half + j;
        const i0 = Math.floor(s);
        if (i0 < 0 || i0 + 1 >= x.length) continue;
        const fr = s - i0;
        const v = x[i0] + (x[i0 + 1] - x[i0]) * fr;   // 源周期不是整数个采样点，要插值
        out[o] += v * win[j] * amp * gcomp;
      }
    }
    pos += op;
    /* 源位置**只能整周期跳**。以前是 mark += 2.5 这种小数步进，
       相邻两粒落在相反的相位上，叠起来互相抵消 → 音色发毛、发"电"。
       现在用累积量决定这一粒跳 0/1/2 个周期，平均步长不变、相位始终对齐。 */
    acc += step;
    const adv = Math.floor(acc);
    acc -= adv;
    imark += adv;
    if (imark >= nMarks) imark -= nMarks;      // 样本不够长就循环（整周期回绕，相位不断）
    if (++i > 400000) break;                   // 保险
  }

  // 裁到目标长度，并做 3ms 尾部淡出，防止 buffer 末尾有台阶
  const y = out.subarray(0, outLen);
  const fade = Math.min(outLen, Math.round(0.003 * sr));
  for (let k = 0; k < fade; k++) y[outLen - 1 - k] *= k / fade;

  /* 归一化：按 **RMS** 而不是峰值。
     峰归一化会让"亮"的元音、高音比"暗"的元音、低音响好几 dB，
     一段接一段的时候音量忽大忽小，交叉淡化处还会塌一块。统一响度，再用峰值兜底防削顶。 */
  let peak = 0, sq = 0;
  for (let k = 0; k < outLen; k++) {
    const a = Math.abs(y[k]);
    if (a > peak) peak = a;
    sq += y[k] * y[k];
  }
  const rmsV = Math.sqrt(sq / outLen);
  let g = 0;
  if (rmsV > 1e-5) {
    g = 0.22 / rmsV;
    if (peak * g > 0.98) g = 0.98 / peak;
  }
  for (let k = 0; k < outLen; k++) y[k] *= g;
  return y;
}

/* 渲染一个"元音段"。音库缺样本时返回 null，调用方退回合成器。
   vowel  : a/i/u/e/o（其它复合口型在 voxPick 里折到基础元音）
   midi   : 段首音高
   durSec : 时长
   f0At/ampAt : 曲线回调 */
function voxRenderSegment(vowel, midi, durSec, sr, f0At, ampAt) {
  const pick = voxPick(vowel, midi);
  if (!pick) return null;
  const note = pick.note;
  /* 解码 base64 很贵（每段几万个字符），而一条样本会被反复用；
     按 (样本, 采样率) 缓存一份，导出能快好几倍。 */
  let x = null;
  const c = VOX_PCM_CACHE.get(note);
  if (c && c.sr === sr) x = c.x;
  else {
    x = voxDecodePCM(note.pcm, window.VOX_BANK.sr, sr);
    VOX_PCM_CACHE.set(note, { sr, x });
  }
  return voxPsola(x, note.f0, sr, durSec, f0At, ampAt);
}

const VOX_PCM_CACHE = new Map();

/* 把 Float32Array 塞进 AudioBuffer（播放与离线渲染共用）
   gain：每一"轨"的音量。PSOLA 会把每段归一化到固定 RMS（为了音色一致），
   所以 vel 到了音频层其实不再影响响度 —— 多轨叠录的相对音量必须在这里给。 */
function voxToAudioBuffer(ctx, data, gain) {
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  const out = buf.getChannelData(0);
  if (gain == null || gain === 1) {
    if (buf.copyToChannel) buf.copyToChannel(data, 0); else out.set(data);
  } else {
    for (let i = 0; i < data.length; i++) out[i] = data[i] * gain;
  }
  return buf;
}

function voxBankAvailable() {
  return !!(window.VOX_BANK && window.VOX_BANK.notes && window.VOX_BANK.notes.length);
}