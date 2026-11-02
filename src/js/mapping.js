/* 特征 → 音乐参数：风格、调式、BPM、拍号、和声进行、音色、曲式。依赖 util.js。
   文件：src/js/mapping.js */
'use strict';

/* ============================================================
   2. 特征 → 音乐参数
   ============================================================ */
function deriveSpec(f) {
  // 主音：色相环每 30° 一个半音
  const rootPc = Math.round(f.hueMean / 30) % 12;

  // 边缘强度归一化（实测照片的 Sobel 均值集中在 0.03~0.18）
  const e = clamp((f.edgeDensity - 0.03) / 0.15, 0, 1);

  // 调式：亮度定明暗，色散定复杂度
  let scaleKey;
  if (f.meanS < 0.10) scaleKey = 'minor';               // 近黑白
  else if (f.meanL > 0.45) scaleKey = f.hueDisp < 0.45 ? 'major' : 'mixolydian';
  else if (f.meanL > 0.32) scaleKey = f.hueDisp < 0.5 ? 'dorian' : 'minor';
  else scaleKey = f.hueDisp < 0.4 ? 'penta' : 'minor';

  const scale = SCALES[scaleKey];
  const fam = scaleKey === 'major' || scaleKey === 'mixolydian' ? 'major'
            : scaleKey === 'penta' ? 'penta' : 'minor';
  const progList = PROGS[fam];
  const progAIdx = Math.floor((f.symmetry * 2.3 + f.entropy * 1.7) * progList.length) % progList.length;
  const prog = progList[progAIdx];
  // B 段换一套进行，保证是同一调内的“另一种走法”，而不是变调
  const progB = progList.length > 1 ? progList[(progAIdx + 1) % progList.length] : prog;

  const bpm = Math.round(Math.min(148, 62 + Math.pow(e, 0.85) * 86));
  const chordSize = f.meanS > 0.70 ? 5 : f.meanS > 0.45 ? 4 : 3;

  /* ---- 风格：从画面特征分档，决定了音色、鼓型与混音 ---- */
  let styleKey, styleWhy;
  if (f.meanS < 0.12) {
    styleKey = 'lofi'; styleWhy = '饱和度低、接近黑白';
  } else if (f.edgeDensity > 0.12) {
    styleKey = 'electro'; styleWhy = '边缘密度高、细节碎';
  } else if (f.entropy > 0.82) {
    styleKey = 'cinema'; styleWhy = '纹理熵高、空间杂乱';
  } else if (f.symmetry > 0.93) {
    styleKey = 'minimal'; styleWhy = '左右几乎对称';
  } else if (f.contrast > 0.52 && f.meanS > 0.6) {
    styleKey = 'tense'; styleWhy = '高对比、高饱和';
  } else if (f.meanL > 0.44) {
    styleKey = 'musicbox'; styleWhy = '整体明亮';
  } else {
    styleKey = 'folk'; styleWhy = '细节中等、色调自然';
  }
  const st = STYLES[styleKey];

  /* ---- 拍号：按风格换节奏语法 ---- */
  const meterName = styleKey === 'folk' ? '6/8' : (styleKey === 'minimal' || styleKey === 'musicbox') ? '3/4' : '4/4';
  const bpb = meterName === '4/4' ? 4 : 3;      // 每小节拍数（3/4 与 6/8 都按 3 拍算）
  const sub = meterName === '4/4' ? 4 : 2;      // 每拍网格数
  const stepBeats = 1 / sub;
  const stepsPerBar = bpb * sub;

  /* ---- 曲式：让整首落在 78~84 秒 ---- */
  const barSec = bpb * 60 / bpm;
  const wantBars = clamp(Math.round(96 / barSec / 8) * 8, 24, 48);
  const FORMS = {
    24: [['前奏', 4], ['A', 8], ['B', 8], ['尾声', 4]],
    32: [['前奏', 4], ['A', 8], ['B', 8], ['A′', 8], ['尾声', 4]],
    40: [['前奏', 4], ['A', 8], ['A′', 8], ['B', 8], ['A″', 8], ['尾声', 4]],
    48: [['前奏', 4], ['A', 8], ['A′', 8], ['B', 8], ['B′', 8], ['A″', 8], ['尾声', 4]]
  };
  const form = FORMS[wantBars] || FORMS[32];
  let cursor = 0;
  const sections = form.map(([name, len]) => {
    const s = { name, start: cursor, len };
    cursor += len;
    return s;
  });
  const bars = cursor;

  /* 每小节一个和弦级数：前奏铺垫、B 段换进行、尾声收主和弦 */
  const barDeg = [];
  for (const s of sections) {
    for (let i = 0; i < s.len; i++) {
      let d;
      if (s.name === '前奏') d = i < 2 ? 0 : 4;
      else if (s.name === '尾声') d = i === s.len - 1 ? 0 : (i === s.len - 2 ? 4 : 0);
      else d = (s.name[0] === 'B' ? progB : prog)[i % prog.length];
      barDeg.push(d);
    }
  }

  return {
    seed: f.seed,
    rootPc, scaleKey, scale: scale.steps, scaleName: scale.name,
    prog, progB, bpm, chordSize,
    bars, sections, barDeg, totalBeats: bars * bpb,
    styleKey, styleName: st.name, styleWhy,
    meterName, bpb, sub, stepBeats, stepsPerBar,
    voices: { lead: st.lead, pad: st.pad, bass: st.bass, arp: st.arp },
    drumStyle: st.drums, vinylBed: st.vinyl,
    melOct: f.meanL > 0.62 ? 5 : f.meanL > 0.4 ? 4 : 4,
    padOct: 3, bassOct: 2,
    cutoff: 620 + f.meanS * 3600,
    density: e,
    swing: 0.04 + (1 - f.symmetry) * 0.07 + st.swingAdd,
    reverbSec: 1.5 + f.entropy * 2.4,
    reverbWet: (0.10 + f.entropy * 0.32) * st.revMul,
    delayTime: 60 / bpm / 2,
    delayFb: 0.10 + f.contrast * 0.34,
    delayWet: (0.07 + f.contrast * 0.18) * st.dlyMul,
    arp: f.meanS > 0.42 || styleKey === 'minimal' || styleKey === 'musicbox',
    vocalLevel: ({ cinema: 1.0, lofi: 0.95, electro: 0.95, minimal: 0.95, folk: 1.0, musicbox: 1.0, tense: 0.9 })[styleKey] || 0.95,
    voxMood: deriveVoxMood(f, styleKey),
    melodyStart: 2,
    swingOn: f.symmetry < 0.86 || st.swingAdd > 0,
    features: f
  };
}

/* 音阶度数 → MIDI */
/* 想音：把"这一段该用什么情绪唱"翻成塔语的三词前缀（程度 / 情绪 / 愿望）。
   目的不是装得像塔语，而是给"人声怎么唱"一个可解释、可复现的离散来源：
   程度 → 用力；情绪 → 口型与辅音软硬；愿望 → 句尾收住还是悬着。
   规则与 research/03-hymmnos.md 的映射表一一对应，界面上也照这个顺序解释。 */
function deriveVoxMood(f, styleKey) {
  // 程度 ← 对比度：画面反差越大，唱得越投入（实测 6 张示例的对比度在 0.06–0.24）
  const degree = f.contrast > 0.20 ? 'Was'
    : f.contrast > 0.15 ? 'Wee'
    : f.contrast > 0.10 ? 'Fou' : 'Ma';

  // 情绪 ← 风格 + 饱和度/明度/边缘：决定口型、辅音软硬、句尾走向
  let nature;
  if (styleKey === 'tense') nature = f.meanS > 0.72 ? 'guwo' : 'yant';
  else if (f.meanS < 0.18) nature = 'au';                          // 近黑白：克制、悲伤
  else if (f.edgeDensity > 0.12) nature = f.contrast > 0.15 ? 'paks' : 'ki';  // 细节碎：兴奋 / 专注
  else if (f.meanL < 0.26) nature = 'jyel';                        // 暗：孤独
  else if (f.meanL > 0.45 && f.meanS > 0.35) nature = 'apea';      // 明亮且有颜色：被幸福笼罩
  else if (f.meanL > 0.40) nature = 'yea';                         // 明亮：喜悦
  else if (f.entropy > 0.82) nature = 'touwaka';                   // 纹理杂乱：开阔、怀抱希望
  else nature = 'zweie';                                           // 其余：坚定

  // 愿望 ← 熵/对称/对比：决定这句"要不要落地"
  const desire = f.entropy > 0.80 ? 'erra'      // 杂乱 → 希望它永远继续（悬着）
    : f.symmetry > 0.96 ? 'ra'                  // 规整 → 希望它继续
    : f.contrast > 0.20 ? 'ga'                  // 反差强 → 希望它停下（收短、下行）
    : 'wa';                                     // 其余 → 都可以

  return { degree, nature, desire };
}

/* 音阶度数 → MIDI */
function degToMidi(scale, rootPc, deg, oct) {
  const len = scale.length;
  const wrapped = ((deg % len) + len) % len;
  const octShift = Math.floor(deg / len);
  return 12 * (oct + 1) + rootPc + scale[wrapped] + 12 * octShift;
}
function chordMidi(scale, rootPc, degree, oct, size) {
  const len = scale.length;
  /* 级数先折回音阶内：五声音阶只有 0–4 级，传 5 就等于"高一个八度的 0"。
     以前不折，进行里一出现 5/6 低音就整段翻上去（实测夜之城 38 次八度跳）。 */
  const rootDeg = ((degree % len) + len) % len;
  const base = 12 * (oct + 1) + rootPc + scale[rootDeg];
  /* 叠太厚就是糊：宽带四度叠置跨两个八度，低音区一个临界带宽就接近一个八度
     （见 research/06-music-theory.md 第 4 节），所以限制音数。 */
  const n = Math.min(size, Math.ceil(len / 2) + 1);
  const out = [];
  for (let k = 0; k < n; k++) {
    const idx = rootDeg + 2 * k;
    const wrapped = ((idx % len) + len) % len;
    out.push(base + scale[wrapped] - scale[rootDeg] + 12 * Math.floor(idx / len));
  }
  return out;
}
