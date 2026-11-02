/* 谱面生成：节奏词汇、和声、旋律乐句（动机变形）、鼓组、人声音节，输出事件列表。依赖 util/mapping。
   文件：src/js/score.js */
'use strict';

/* ============================================================
   3. 谱面生成
   ============================================================ */
const BPB = 4; // 默认每小节 4 拍；实际以 spec.bpb 为准

function buildScore(spec) {
  const rng = mulberry32(spec.seed ^ 0x9e3779b9);
  const ev = [];
  const S = spec.scale, R = spec.rootPc;
  const bars = spec.bars, sections = spec.sections;
  const push = o => ev.push(o);
  const density = spec.density;
  const bpb = spec.bpb;
  const stepBeats = spec.stepBeats;
  const stepsPerBar = spec.stepsPerBar;
  const meter = spec.meterName;
  const ds = spec.drumStyle;
  const contourUp = spec.features.centroidY > 0.52;

  /* 音阶上走 n 级（只在音阶音之间走）。转音、和声层都靠它，
     所以放在最前面 —— 后面几个块都要用。 */
  const scalePcs = new Set(S.map(iv => (R + iv) % 12));
  const inScale = m => scalePcs.has(((m % 12) + 12) % 12);
  const scaleStep = (m, n) => {
    let c = m, k = 0;
    while (k < Math.abs(n)) {
      c += Math.sign(n);
      if (inScale(c)) k++;
    }
    return c;
  };
  /* 长音后段元音微变：志方あきこ 唱长音时口型会缓慢挪一点（a 带一点 o），
     这是"人声"和"采样器"之间最便宜的一道分界。只往开的方向走，不往 i 去。 */
  const VOX_GLIDE = { a: 'o', o: 'u', u: 'o', e: 'a', i: 'e' };

  /* ---------- 节奏词汇（由拍号 × 风格决定） ---------- */
  const table = CELLS[meter] || CELLS['4/4'];
  const vocab = table[spec.styleKey] || table.default;
  const pickCell = () => vocab[Math.floor(rng() * vocab.length)].slice();

  /* ---------- 乐句引擎：起 → 承 → 转 → 合 ---------- */
  /* 一句旋律最多跨 5 级（五声 ≈ 10 度，七声 ≈ 8 度）。乐理上"音域不超过十度"
     是对位法里最硬的一条，超过就开始"飘"。
     **级进为主、偶尔一次跳进、跳完必须反向级进补回来** —— 这三条是本轮重写
     contour() 的原因：以前每个音都加 ±0.8 级的**独立**随机抖动，五声里一格就是
     2–3 个半音，抖完变成随机游走（实测级进:跳进 = 0.35:1，音域 39 个半音）。 */
  const MEL_SPAN = 5;
  function contour(steps, startDeg, endDeg, span) {
    const n = steps.length, out = [];
    const lo = Math.round(Math.min(startDeg, endDeg)) - 1;
    const hi = Math.min(Math.round(Math.max(startDeg, endDeg)) + 2, lo + MEL_SPAN);
    const peak = Math.min(2, Math.max(1, span * 0.4));   // 弧顶只比端点高 1–2 级
    let prev = Math.round(startDeg), leapDir = 0;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0;
      const arc = Math.sin(u * Math.PI) * (contourUp ? 1 : -1) * peak;
      let d = Math.round(startDeg + (endDeg - startDeg) * u + arc);
      if (leapDir !== 0) {
        d = prev - leapDir;                 // 跳进之后反向级进补回来（leap recovery）
        leapDir = 0;
      } else if (Math.abs(d - prev) > 1) {
        if (rng() < 0.35) leapDir = Math.sign(d - prev) * (Math.abs(d - prev) > 2 ? 1 : 0);
        else d = prev + Math.sign(d - prev);
      }
      d = clamp(d, lo, hi);
      out.push({ step: steps[i], deg: d });
      prev = d;
    }
    if (n) { out[0].deg = startDeg; out[n - 1].deg = clamp(endDeg, lo, hi); }
    return out;
  }

  // 变形：重复 / 模进 / 减缩 / 截断 / 加花
  function xform(notes, kind) {
    if (kind === 'seq') return notes.map(n => ({ step: n.step, deg: n.deg + 1 }));
    if (kind === 'seq2') return notes.map(n => ({ step: n.step, deg: n.deg + 2 }));
    if (kind === 'dimin') {
      const seen = new Set(), out = [];
      notes.forEach(n => {
        const s = Math.round(n.step / 2);
        if (!seen.has(s)) { seen.add(s); out.push({ step: s, deg: n.deg }); }
      });
      return out.length >= 2 ? out : notes.slice();
    }
    if (kind === 'trunc') return notes.length > 3 ? notes.slice(0, notes.length - 2) : notes.slice();
    if (kind === 'orn') {
      let best = -1, gap = 0;
      for (let i = 0; i < notes.length - 1; i++) {
        const g = notes[i + 1].step - notes[i].step;
        if (g > gap) { gap = g; best = i; }
      }
      if (best < 0 || gap < 2) return notes.slice();
      const a = notes[best], b = notes[best + 1];
      const mid = {
        step: Math.round((a.step + b.step) / 2),
        deg: Math.round((a.deg + b.deg) / 2) + (rng() < 0.5 ? 1 : -1)
      };
      return [...notes.slice(0, best + 1), mid, ...notes.slice(best + 1)];
    }
    return notes.slice();
  }
  const XFORMS = ['repeat', 'seq', 'dimin', 'orn', 'trunc'];

  // 一句 4 小节：前两小节提问（开放），后两小节回答（resolve 时落主音）
  function makePhrase(prevDeg, isB, resolve) {
    const base = isB ? prevDeg - 2 : prevDeg;
    const c1 = pickCell(), c2 = pickCell();
    const openDeg = isB ? 2 : 4;

    const b1 = contour(c1, base, isB ? base - 1 : base + 1, isB ? 3 : 5);
    let b2 = xform(b1, XFORMS[Math.floor(rng() * XFORMS.length)]);
    if (b2.length) {
      b2[0].deg = b1[b1.length - 1].deg + (rng() < 0.6 ? 1 : -1);   // 承：接着上一小节尾音
      b2[b2.length - 1].deg = isB ? base + 1 : Math.max(1, b2[b2.length - 1].deg);
    }
    const from = b2.length ? b2[b2.length - 1].deg : base;
    const b3 = contour(c2, from + 1, openDeg, isB ? 4 : 5);
    let b4 = xform(b3, isB ? 'trunc' : ['seq', 'orn', 'repeat'][Math.floor(rng() * 3)]);
    if (b4.length) {
      b4[b4.length - 1].deg = resolve ? 0 : openDeg;                // 合：落主音或悬在半空
      if (resolve && b4.length > 2) {
        // 终止前用级进靠过去，避免从高处直接砸到主音
        const L = b4.length, prev = b4[L - 3].deg;
        const cands = [1, 2, 3];
        cands.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
        b4[L - 2].deg = cands[0];
      }
    }
    return [b1, b2, b3, b4];
  }

  /* ---------- 全曲旋律表：每个小节拿到一句里的一小节 ---------- */
  const melodyByBar = new Map();
  for (const sec of sections) {
    if (sec.name === '前奏' || sec.name === '尾声') continue;
    const isB = sec.name[0] === 'B';
    let carry = isB ? -1 : 0;
    const phraseCount = Math.max(1, Math.round(sec.len / 4));
    for (let p = 0; p < phraseCount; p++) {
      const phr = makePhrase(carry, isB, p === phraseCount - 1);
      if (p > 0 && phr[0].length > 2 && rng() < 0.7) phr[0] = xform(phr[0], 'orn');  // 后半段主题加花
      for (let i = 0; i < 4; i++) {
        const bar = sec.start + p * 4 + i;
        if (bar >= sec.start + sec.len) break;
        melodyByBar.set(bar, phr[i]);
        if (phr[i].length) carry = phr[i][phr[i].length - 1].deg;
      }
    }
  }

  const secInt = { '前奏': 0.62, 'A': 0.88, 'A′': 0.95, 'B': 0.8, 'B′': 0.88, 'A″': 1.05, '尾声': 0.6 };
  const secAt = bar => sections.find(s => bar >= s.start && bar < s.start + s.len);
  let lastLeadMidi = null;   // 用来把下一小节的首音接到上一小节的尾音
  let lastVoxEnd = -99;      // 上一句人声结束在哪一拍（判断要不要连唱）
  let lastVoxVowel = null;   // 上一个词的口型：默认沿用，只有换词/换乐句才换
  let voxChain = null;       // 正在连唱的那个 vox 事件（短音符接在它后面，不另起一个"啊"）
  /* 正在唱的那个"词"。**词是跨音符的**：一个词 2–4 个音节，一个音节一个音。
     以前是反过来的（一个音符上塞 2–4 个音节），那是"说话说得很快"。 */
  let voxWord = null, voxWordUsed = 0;

  /* --- 人声的情绪：塔语"想音"（程度 / 情绪 / 愿望），整首曲子的唱法由它决定 --- */
  const mood = spec.voxMood || { degree: 'Wee', nature: 'touwaka', desire: 'wa' };
  const moodVel = MOOD_VEL[mood.degree] || 1;                       // 程度 → 力度
  const moodVowel = MOOD_VOWEL[mood.nature] || 'a';                 // 情绪 → 基础口型
  // 换口型时优先用"想音"决定的那个元音，偶尔换个别的，免得整首只有一个音色
  /* 口型：以前是"每个字独立随机抽一个，且永远不等于上一个" —— 一句话能唱出 a-e-i-o-u，
     听起来就是一串音节，没有音韵。押韵学里这叫缺母音韻（assonance）：
     相邻的词重复同一个元音，耳朵才会觉得这几句是"一段话"。
     现在三层：
     · 68% 用**这一句的元音颜色**（每句只有一两个元音，换句才换色）；
     · 长音只用开元音 a/o/u/e（i 又亮又窄，拖 0.6 秒会发尖）；
     · 高音（G4 以上）必须换成 a/e/o —— 唱 i/u 时第一共振峰会掉到基频以下，
       物理上就是发不出来，真人这时候会自动张嘴。这也是"最高音落在 a/e/o 上
       最好听"的那条作词经验背后的原因。 */
  const VOX_OPEN = ['a', 'a', 'o', 'o', 'u', 'e', 'i'];
  const VOX_MONO = ['a', 'a', 'o', 'o', 'u', 'e', 'i'];
  /* 元音颜色：只用 a/o/e/u（不要 i）。一句里的字大半落在这两个元音上。 */
  const VOX_COLORS = [
    ['a', 'o'], ['a', 'e'], ['o', 'a'], ['e', 'a'],
    ['a', 'u'], ['o', 'e'], ['e', 'o'], ['o', 'u']
  ];
  /* A-A-B-A：第 1、2、4 句同色，第 3 句换色。这是最好上口的押韵构成 ——
     第 3 句变一次色，耳朵才知道"这是新的一句"，而不是从头到底一个味道。 */
  const COLOR_SCHEME = [0, 0, 1, 0];
  const colA = (() => {
    const ok = VOX_COLORS.filter(c => c.indexOf(moodVowel) >= 0);
    return ok.length ? ok[Math.floor(rng() * ok.length)] : ['a', 'o'];
  })();
  let colB = VOX_COLORS[Math.floor(rng() * VOX_COLORS.length)];
  if (colB[0] === colA[0] && colB[1] === colA[1]) colB = ['o', 'u'];
  let phraseVowel = colA;      // 当前这一句的元音颜色
  let phraseCons = [];         // 当前这一句的辅音色板（头韵）
  let phraseNo = 0;
  /* 一个"唱出来的字"至少要 1.3 拍（0.40–0.70 秒）。0.21 秒一个字是连珠炮，
     听感是"伊瓦伊艾伊"；而且词内音节是按时间切开的（+0.088 s 这种），
     落在拍与拍之间，节奏也是松的。 */
  const VOX_MIN_SYL = 0.22;
  /* 唱歌的生理门槛：一个元音短于 ~0.24 s 就拖不住，颤音（5–6 Hz）根本来不及出现。
     实测旧版音节中位 0.11 s —— 那是**说话的语速**，所以怎么调音色都不像唱。
     短于这个数的音不另起一个字，直接延长上一个正在唱的音（旋律照走、口型不动），
     真人处理快走句就是这么做的。 */
  const VOX_MIN_NOTE = 0.24;
  /* ---- 塔语词表（LEX）----
     用户反馈"听起来还是一串字母在唱"。根因不是音色：我们的每个"词"都是当场随机
     生成的 1 个音节，整首歌没有重复过任何东西，耳朵只能听到字母。
     真实的塔语歌是有词表的，而且大量排比（歌词里 "Faura yerwe … Faura sonwe …"）。
     这里按 research/03-hymmnos.md 记下的音位规律生成 14 个词：
       · 2–4 个音节；
       · **词中带韵尾**（-n / -l / -r / -s / -t / -k），词尾少一些 ——
         这是第十五轮补的：全开音节等于每两个辅音之间全是元音，
         听感就是"a o e y w u"连成一条，不像语言；
       · 词尾必须是开口大的元音 —— 它就是那个被拖长的音；
       · 词内相邻音节不重复声母（避免"哒哒哒"）；
       · **每个词自己的元音只取 1–2 个**：词内元音和谐。
         这样"一个词"听起来是一个整体，而不是几个音节拼起来。
     词表由 seed 决定，同一张图每次生成同一门"语言"。 */
  const PAL_V = ['a', 'o', 'e', 'u'];
  /* 韵尾：鼻音最多（n/l/r），擦音 s 次之，塞音 t/k 少 —— 语言里韵尾本来就是这套分布。
     塞音韵尾靠"元音被切断 + 一个很轻的除阻"来听，音频层见 audio.js 的 voxV。 */
  const CODA_POOL = ['n', 'n', 'l', 'l', 'r', 'r', 's', 'm', 't', 'k'];
  const LEX = [];
  for (let w = 0; w < 14; w++) {
    const n = 2 + Math.floor(rng() * 3);                 // 2–4 音节
    const pal = [PAL_V[Math.floor(rng() * PAL_V.length)],
                 PAL_V[Math.floor(rng() * PAL_V.length)]];
    const syl = [];
    let prevC = null;
    let prevCod = null;
    for (let k = 0; k < n; k++) {
      let c = null;
      for (let t2 = 0; t2 < 6; t2++) {
        const pool = (k === 0 && rng() < 0.3) ? MOOD_HARD_CONS : MOOD_SOFT_CONS;
        c = pool[Math.floor(rng() * pool.length)];
        if (c !== prevC) break;
      }
      prevC = c;
      /* 韵尾：词中 40%，词尾 18%（词尾已经要被拖长，再多就唱不开了）。
         不和后一个音节的声母撞（"n-n"连读会把两个音节并成一个）。 */
      let cod = null;
      if (rng() < (k === n - 1 ? 0.18 : 0.40)) {
        cod = CODA_POOL[Math.floor(rng() * CODA_POOL.length)];
        if (cod === prevCod) cod = null;
      }
      prevCod = cod;
      let v = pal[Math.floor(rng() * pal.length)];
      if (k === n - 1 && (v === 'i' || v === 'u')) {       // 词尾要能拖
        v = pal.find(x => x !== 'i' && x !== 'u') || 'a';
      }
      syl.push({ c, v, cod });
    }
    LEX.push({ syl, pal });
  }
  /* 选词：① 元音颜色对得上这一句（母音韻）；② 音节数接近这个音符装得下的；
     ③ 优先选"声母在这一句的辅音色板里"的词（头韵）；④ 三成直接重复上一个词（排比）。 */
  let lastWord = null;
  const pickWord = (want) => {
    if (lastWord && rng() < 0.3) return lastWord;
    let pool = LEX.filter(w => w.pal.some(v => phraseVowel.indexOf(v) >= 0));
    if (!pool.length) pool = LEX.slice();
    const sub = pool.filter(w => Math.abs(w.syl.length - want) <= 1);
    if (sub.length) pool = sub;
    const cs = pool.filter(w => phraseCons.indexOf(w.syl[0].c) >= 0);
    if (cs.length) pool = cs;
    return pool[Math.floor(rng() * pool.length)];
  };
  /* ---- 歌词：几条固定的"句子" ----
     用户反馈"得有点歌词的感觉"。歌词感不来自音节好听，而来自**同一串词反复出现**：
     主歌有主歌的词，副歌每次回来都是同样的那几个词、同样的顺序、落在同样的位置。
     以前每个音都当场抽词（只有 30% 重复上一个），整首歌没有一句是听过第二遍的
     —— 那是念咒，不是歌词。
     现在**一段（4 小节）唱一行**，A/A′/A″ 用同一组行（副歌），B/B′ 用另一组（主歌）。 */
  const buildLine = (col, nw) => {
    const pool0 = LEX.filter(w => w.pal.some(v => col.indexOf(v) >= 0));
    const pool = pool0.length >= 3 ? pool0 : LEX.slice();
    const longPool = pool.filter(w => w.syl.length >= 3);
    const line = [];
    for (let k = 0; k < nw; k++) {
      let w = pool[Math.floor(rng() * pool.length)];
      if (line.length && w === line[line.length - 1]) w = pool[(pool.indexOf(w) + 1) % pool.length];
      line.push(w);
    }
    /* 排比：第三个词重复第一个（"Faura yerwe … Faura sonwe"）。
       这是塔语歌词里最显眼的手法，也是"一句词"和"一堆词"的区别。 */
    if (line.length >= 3 && rng() < 0.45) line[2] = line[0];
    /* 词尾挑一个长词（3–4 音节）：它是这一句的"落点"，
       而且会落在句末的长音上 —— 长短相间才像一句词，全一样长就是节拍器。 */
    if (longPool.length && line.length >= 3) {
      let lw = longPool[Math.floor(rng() * longPool.length)];
      if (lw === line[line.length - 2]) lw = longPool[(longPool.indexOf(lw) + 1) % longPool.length];
      line[line.length - 1] = lw;
    }
    return line;
  };
  const CHORUS_LINES = [buildLine(colA, 4), buildLine(colA, 5)];
  const VERSE_LINES = [buildLine(colB, 4), buildLine(colB, 5)];
  /* 副歌两行用同一个开头词（hook），主歌两行用另一个 —— 这是"副歌"最硬的标志：
     同样的第一个词一出来，耳朵就知道"这一段是刚才那段"。 */
  CHORUS_LINES[1][0] = CHORUS_LINES[0][0];
  VERSE_LINES[1][0] = VERSE_LINES[0][0];
  /* ---- 想音与人称：句首、句尾的固定功能词 ----
     塔语每个句子都以固定的三个词（想音）开头，人称用极短的词挂在句子里。
     我们取两个位置：
       · 句首 —— 这一首的想音（程度 + 愿望），每次起句都唱它，像语法标记；
       · 句尾 —— 一个人称词（mea / yor / hes），按乐句轮换，同位置永远同一人称。
     它们短、带真辅音、大多带韵尾，正是补上"整首只剩元音"的那一半。 */
  const makeFn = (arr) => ({ syl: arr, pal: ['a', 'e', 'o', 'u'], fn: true });
  const FN_PRE = makeFn((HYMN_SYL[mood.degree] || HYMN_SYL.Wee)
    .concat(HYMN_SYL[mood.desire] || HYMN_SYL.ra));
  const FN_POSS = ['mea', 'yor', 'hes'].map(k => makeFn(HYMN_SYL[k]));
  let curLine = null, linePos = 0;
  const moodCons = MOOD_HARD[mood.nature] ? MOOD_HARD_CONS : MOOD_SOFT_CONS;  // 情绪 → 辅音软硬
  const tailStop = mood.desire === 'ga' || mood.desire === 'gaya';  // 愿望 → 句尾收短、下行
  const tailLong = mood.desire === 'erra';                          // 愿望 → 句尾拖长、悬着
  const tailSkip = mood.desire === 'gagis';                         // 愿望 → 无所谓，少唱一个

  for (let bar = 0; bar < bars; bar++) {
    const t = bar * bpb;
    const sec = secAt(bar);
    const inSec = bar - sec.start;
    const isIntro = sec.name === '前奏';
    const isOutro = sec.name === '尾声';
    const isB = sec.name[0] === 'B';
    const lastBar = bar === bars - 1;
    const deg = spec.barDeg[bar];
    const size = Math.min(5, spec.chordSize + (isB ? 1 : 0));
    const chord = chordMidi(S, R, deg, spec.padOct, size);
    const inten = secInt[sec.name] || 0.9;
    const phraseEnd = inSec % 4 === 3;

    /* 每 4 小节换一次"元音颜色"，并抽一次"辅音色板"。
       这一句的字反复用同一个元音（母音韻）、同一个辅音（头韵），
       换句时才换色 —— 对比是成组出现的，不是逐字乱跳的。 */
    if (inSec % 4 === 0) {
      const ph = Math.floor(inSec / 4);
      const lineSet = isB ? VERSE_LINES : CHORUS_LINES;
      const body = lineSet[ph % lineSet.length];
      /* 一行 = 想音（句首）+ 内容词 + 人称（句尾）。功能词每句都在，位置固定；
         内容词每句按顺序，副歌回来还是这一串。 */
      curLine = [FN_PRE].concat(body, [FN_POSS[ph % FN_POSS.length]]);
      linePos = 0;
      /* 颜色跟着"行"走：同一行永远是同一个元音色 —— 副歌回来才听得出是同一句。 */
      phraseVowel = COLOR_SCHEME[(ph + (isB ? 2 : 0)) % 4] === 0 ? colA : colB;
      phraseCons = [];
      for (let k = 0; k < 3; k++) {
        phraseCons.push(moodCons[Math.floor(rng() * moodCons.length)]);
      }
      phraseNo++;
    }

    /* --- pad --- */
    push({
      t, k: 'pad', midi: chord, dur: bpb * 0.99,
      vel: isIntro ? 0.24 + inSec * 0.04 : isOutro ? 0.32 : 0.42
    });

    /* --- bass：跟着乐句走，句尾用经过音接下一句 --- */
    const rootMidi = chordMidi(S, R, deg, spec.bassOct, 1)[0];
    if (isIntro) {
      if (inSec >= 2) push({ t, k: 'bass', midi: rootMidi, dur: bpb - 0.3, vel: 0.45 });
    } else if (isOutro) {
      push({ t, k: 'bass', midi: rootMidi, dur: bpb - 0.2, vel: 0.5 });
    } else if (isB) {
      push({ t, k: 'bass', midi: rootMidi, dur: bpb - 0.4, vel: 0.58 });
    } else if (density < 0.32) {
      push({ t, k: 'bass', midi: rootMidi, dur: bpb - 0.3, vel: 0.6 });
    } else if (density < 0.62) {
      push({ t, k: 'bass', midi: rootMidi, dur: bpb / 2 - 0.1, vel: 0.6 });
      push({ t: t + bpb / 2, k: 'bass', midi: rootMidi, dur: bpb / 2 - 0.1, vel: 0.52 });
    } else {
      for (let b = 0; b < bpb; b++) {
        const oct = (b === bpb - 1 && rng() < 0.4) ? 12 : 0;
        push({ t: t + b, k: 'bass', midi: rootMidi + oct, dur: 0.82, vel: b % 2 ? 0.4 : 0.58 });
      }
    }
    if (!isIntro && !isOutro && phraseEnd && !lastBar && rng() < 0.55) {
      const passDeg = deg + (rng() < 0.5 ? 1 : -1);
      push({ t: t + bpb - 1, k: 'bass', midi: chordMidi(S, R, passDeg, spec.bassOct, 1)[0], dur: 0.9, vel: 0.42 });
    }

    /* --- drums：拍号决定骨架，风格决定音色 --- */
    if (isIntro) {
      if (inSec === sec.len - 1 && ds !== 'none') push({ t, k: 'kick', vel: 0.5 });
    } else if (isOutro) {
      if (inSec === 0 && ds !== 'none') push({ t, k: 'kick', vel: 0.65 });
    } else if (ds !== 'none') {
      const lvl = sec.name === 'A' ? 0 : sec.name === 'A′' ? 1 : sec.name === 'A″' ? 2 : 1;
      const tag = ds === 'brush' ? 'rim' : 'snare';

      if (meter === '3/4') {
        // 圆舞曲：一打、二打、三打
        push({ t, k: 'kick', vel: 0.85 });
        push({ t: t + 1, k: ds === 'brush' ? 'rim' : 'clap', vel: 0.42 });
        push({ t: t + 2, k: ds === 'brush' ? 'shaker' : 'rim', vel: 0.36 });
        for (const s of [0.5, 1.5, 2.5]) push({ t: t + s, k: 'shaker', vel: 0.16 });
        if (lvl >= 2) push({ t: t + 2.5, k: 'tom', vel: 0.26 });
      } else if (meter === '6/8') {
        // 复合拍：两组三个八分，重音落在 1 和 4
        push({ t, k: 'kick', vel: 0.88 });
        push({ t: t + 1.5, k: 'snare', vel: 0.5 });
        for (const s of [0.5, 1, 2, 2.5]) push({ t: t + s, k: 'shaker', vel: 0.17 });
        if (lvl >= 1) push({ t: t + 2.5, k: 'rim', vel: 0.3 });
      } else if (isB) {
        push({ t, k: 'kick', vel: 0.88 });
        push({ t: t + 2.5, k: 'kick', vel: 0.48 });
        push({ t: t + 2, k: tag, vel: 0.55 });
        if (ds !== 'sparse') {
          for (let s = 0; s < 4; s++) if (s % 2 === 0 || rng() < 0.3) push({ t: t + s, k: 'hat', vel: s % 2 ? 0.14 : 0.22 });
        }
      } else if (ds === 'four') {
        for (let b = 0; b < 4; b++) push({ t: t + b, k: 'kick', vel: b === 0 ? 0.95 : 0.72 });
        push({ t: t + 1, k: 'clap', vel: 0.5 });
        push({ t: t + 3, k: 'clap', vel: 0.5 });
        for (let s = 0; s < 4; s++) push({ t: t + s + 0.5, k: 'hat', vel: 0.26 });
        if (lvl >= 2 && bar % 2 === 1) push({ t: t + 3.5, k: 'hat', vel: 0.32, open: 1 });
      } else if (ds === 'boombap') {
        push({ t, k: 'kick', vel: 0.9 });
        push({ t: t + 2.5, k: 'kick', vel: 0.6 });
        if (bar % 2 === 0) push({ t: t + 1.75, k: 'kick', vel: 0.38 });
        push({ t: t + 1, k: 'snare', vel: 0.5 });
        push({ t: t + 3, k: 'snare', vel: 0.5 });
        for (let s = 0; s < 4; s += 0.5) push({ t: t + s, k: 'hat', vel: s % 1 ? 0.14 : 0.24 });
      } else if (ds === 'brush') {
        push({ t, k: 'kick', vel: 0.68 });
        push({ t: t + 2, k: 'kick', vel: 0.58 });
        push({ t: t + 3, k: 'rim', vel: 0.42 });
        for (let s = 0; s < 4; s += 0.5) push({ t: t + s, k: 'shaker', vel: s % 1 ? 0.12 : 0.2 });
      } else if (ds === 'gate') {
        for (let b = 0; b < 4; b++) push({ t: t + b, k: 'kick', vel: 0.8 });
        push({ t: t + 1, k: 'rim', vel: 0.5 });
        push({ t: t + 3, k: 'rim', vel: 0.5 });
        if (lvl >= 1) for (let s = 0.5; s < 4; s += 1) push({ t: t + s, k: 'hat', vel: 0.16 });
      } else {
        // sparse：留白，靠段落推进加一点心跳
        push({ t, k: 'kick', vel: 0.72 });
        if (lvl >= 1) push({ t: t + 2, k: 'kick', vel: 0.44 });
        if (lvl >= 2) push({ t: t + 3.5, k: 'tom', vel: 0.28 });
      }

      // 每 4 小节句尾加花，把下一句顶出来
      if (phraseEnd && ds !== 'sparse' && meter === '4/4') {
        const fill = ds === 'brush' ? 'shaker' : 'snare';
        for (let s = 3.5; s < 4; s += 0.25) push({ t: t + s, k: fill, vel: 0.2 + (s - 3.5) * 0.16 });
      }
      if (inSec === 0 && (sec.name === 'A″' || sec.name === 'B′') && ds !== 'brush') {
        push({ t, k: 'crash', vel: 0.3 });
      }
    }

    /* --- arp：只在 A′ / A″；无鼓的风格放慢到八分 --- */
    if (spec.arp && (sec.name === 'A′' || sec.name === 'A″' || (sec.name === 'A' && inSec >= 4) || (sec.name === 'B′' && inSec >= 4))) {
      const notes = chordMidi(S, R, deg, spec.melOct - 1, spec.chordSize + 1);
      const pattern = [0, 1, 2, 3, 2, 1];
      const stepDiv = ds === 'none' ? 2 : 1;
      for (let s = 0; s < stepsPerBar; s += stepDiv) {
        if (s % 2 === 1 && rng() < 0.35) continue;
        const idx = pattern[s % pattern.length] % notes.length;
        push({
          t: t + s * stepBeats, k: 'arp', midi: notes[idx] + (s % 8 === 7 ? 12 : 0),
          dur: Math.max(0.18, stepBeats * 0.9), vel: 0.15 + density * 0.1
        });
      }
    }

    /* --- 旋律：从乐句表里取这一小节 --- */
    const mnotes = melodyByBar.get(bar);
    if (mnotes && mnotes.length && !lastBar) {
      const octUp = sec.name === 'A″' ? 1 : 0;
      const swell = [0.88, 0.96, 0.9, 1.0][inSec % 4] || 0.95;
      for (let i = 0; i < mnotes.length; i++) {
        const nt = mnotes[i];
        let degAbs = nt.deg;
        if (nt.step % (stepsPerBar / 2) === 0) {   // 强拍吸附到最近的和弦音（不破坏句子的走向）
          let best = degAbs, bestD = 99;
          for (const o of [0, 2, 4, 6]) {
            const d = deg + o, dd = Math.abs(d - degAbs);
            if (dd < bestD) { bestD = dd; best = d; }
          }
          if (bestD <= 2) degAbs = best;
        }
        const nextStep = i + 1 < mnotes.length ? mnotes[i + 1].step : stepsPerBar;
        const durBeats = Math.max(1, nextStep - nt.step) * stepBeats;
        let midi = degToMidi(S, R, degAbs, spec.melOct + octUp);
        // 首音离上一小节尾音太远时，用级进挪近，保证句子是连着的
        if (nt.step === 0 && lastLeadMidi != null) {
          const gap = midi - lastLeadMidi;
          if (Math.abs(gap) > 5) {
            const dir = gap > 0 ? -1 : 1;
            for (let k = 1; k <= 2; k++) {
              const cand = degToMidi(S, R, degAbs + dir * k, spec.melOct + octUp);
              if (Math.abs(cand - lastLeadMidi) < Math.abs(midi - lastLeadMidi)) midi = cand;
              if (Math.abs(midi - lastLeadMidi) <= 4) break;
            }
          }
        }
        lastLeadMidi = midi;
        const velN = (isB ? 0.24 : 0.3) * swell * inten;
        push({
          t: t + nt.step * stepBeats, k: 'lead',
          midi,
          d2: degAbs + octUp * S.length,      // 绝对音级（含段落升八度），给末尾的旋律修整用
          dur: Math.max(0.22, durBeats * 0.9),
          // 主奏在有人声时会被让出来（见 playEvent），关掉人声就恢复正常音量
          vel: velN
        });
        /* 人声：**一个"词" = 一段连续的唱**，可以跨好几个音符（见下面的 chainOk）。
           一个事件里带多个音节（syl），音频层用一条连续的声音唱完这个词：
           音高在音节之间滑过去、口型尽量不变，
           所以听上去是一条音线，而不是把旋律切成"啊、啊、啊"。 */
        if (spec.vocalLevel && rng() > 0.08) {
          const spbSec = 60 / spec.bpm;
          const breath = (inSec % 2 === 1) && i === mnotes.length - 1;
          const total = durBeats * spbSec;
          const startBeats = t + nt.step * stepBeats;
          /* ---- 短音不唱，接着上一个音拖 ----
             一个元音短于 VOX_MIN_NOTE 就拖不住（颤音还没起来，音就完了）。
             这里不另起一个字，直接把上一个正在唱的音延长过去：旋律照走、口型不动 ——
             真人处理快走句就是这样，一个长音吃掉一串短音。 */
          if (total < VOX_MIN_NOTE && voxChain && !breath
              && startBeats - (voxChain.t + voxChain.dur) < 0.30) {
            const ls0 = voxChain.syl[voxChain.syl.length - 1];
            ls0.d += total;
            voxChain.dur = Math.max(voxChain.dur, (startBeats - voxChain.t) + ls0.u + total);
            lastVoxEnd = voxChain.t + voxChain.dur;
            continue;
          }
          /* ---- 词跨音符：**一个音节一个音** ----
             词表里的词是 2–4 个音节，游标跨音符推进，词尾自然落在下一个音上。
             这样"一个词"仍是一段听得出的整体（同口型、声母轮着来），
             而每个音节又有整个音的时值去拖住元音 —— 这才是唱。
             上一版是反过来的：一个音符上塞 2–4 个音节、每个 0.1 s，
             那是"说话说得很快"，怎么调音色都不像唱。 */
          if (!voxWord || voxWordUsed >= voxWord.syl.length) {
            /* 词从**这一行的词表**里按顺序取：副歌第二遍回来，唱的还是这几个词。 */
            if (curLine && curLine.length) {
              voxWord = curLine[linePos % curLine.length];
              linePos++;
            } else {
              voxWord = pickWord(2);
            }
            lastWord = voxWord;
            voxWordUsed = 0;
          }
          const ws = voxWord.syl[voxWordUsed++];
          const isWordStart = voxWordUsed === 1;
          const isWordEnd = voxWordUsed >= voxWord.syl.length;

          let c = ws.c, v = ws.v;
          /* 字头：词首几乎都咬（0.93），词中八成 —— 全丢就是一条"呜"，
             这是第十五轮从 0.85 / 0.60 提上来的：辅音太少，整首就只剩元音。 */
          if (rng() >= (isWordStart ? 0.93 : 0.80)) c = null;
          /* 高音上不能唱 i/u：基频会超过第一共振峰，物理上就是发不出来。 */
          if (midi >= 67 && (v === 'i' || v === 'u')) {
            v = voxWord.pal.find(x => x !== 'i' && x !== 'u') || 'a';
          }
          /* 一个音节吃掉整条音，只留 3% 给气口。 */
          let sDur = total * (breath ? 0.72 : 0.97);
          if (isWordEnd && tailLong) sDur *= 1.04;      // erra：再拖一点
          if (isWordEnd && tailStop) sDur *= 0.85;      // gis：收住
          if (isWordEnd && tailSkip) sDur *= 0.88;      // gagis：少唱一点
          sDur = Math.min(sDur, total * 1.05);
          /* 人声音高**不在这里定**。旋律必须落在"真正唱出来的两个音"之间，
             而哪些音会唱出来要等并音之后才知道（太密的音节会被并进前一个音）。
             这里先占位，函数末尾的"人声旋律"会统一改写。 */
          const vMidi = midi;
          /* 连唱：直接接在上一个音的尾巴上，不再另起一个事件。
             注意这是**事件**层面的合并（省调度、省包络），音节本身还是分开的。 */
          const chainOk = !!voxChain
            && !breath
            && startBeats - (voxChain.t + voxChain.dur) < 0.55   // 中间的小休止也唱过去（换气才断）
            && voxChain.dur < 4.5        // 一个音最多 4.5 拍，再长就该换气了
            && voxChain.syl.length + 1 <= 10;

          const syl = [];
          syl.push({ u: 0, d: sDur, m: midi, cons: c, v, cod: ws.cod, w0: isWordStart, mid: !isWordStart });
          if (!syl.length) { voxChain = null; continue; }

          if (chainOk) {
            // 接在正在唱的那个词后面：音节整体平移。
            /* 字头要保留。以前这里一律 cons:null（"词中间不咬字"），
               结果一条两秒的连唱从头到尾没有一个辅音 —— 这正是"听不出在唱词"的主因。 */
            const baseSec = (startBeats - voxChain.t) * spbSec;
            for (const s of syl) {
              voxChain.syl.push({ u: baseSec + s.u, d: s.d, m: s.m, cons: s.cons, v: s.v, cod: s.cod,
                                  orn: s.orn, glide: s.glide, w0: s.w0, mid: s.mid });
            }
            const lastS = syl[syl.length - 1];
            voxChain.dur = Math.max(voxChain.dur, (startBeats - voxChain.t) + (lastS.u + lastS.d) / spbSec);
            voxChain.v = voxChain.syl[voxChain.syl.length - 1].v;
            lastVoxVowel = voxChain.v;
            lastVoxEnd = voxChain.t + voxChain.dur;
            continue;
          }

          const endSec = syl[syl.length - 1].u + syl[syl.length - 1].d;
          const legato = startBeats - lastVoxEnd < 0.1;   // 上一句还没断 → 连唱
          /* 和声层：塔语歌曲最标志性的东西是"多重コーラス"——
             志方あきこ自己给自己叠三度/五度/八度，人声当弦乐铺底。
             这里只在高潮段给一个三度（A″ 在上、A′ 后半点在下），
             音高同样等旋律定完再算（见函数末尾）。 */
          const harmKind = sec.name === 'A″' ? 'up'
            : (sec.name === 'A′' && inSec >= 4) ? 'down' : null;
          const wordVowel = syl[syl.length - 1].v;   // 词的"落点"元音，看板上显示它
          lastVoxVowel = wordVowel;
          const voxEv = {
            t: startBeats, k: 'vox', midi: vMidi,
            dur: endSec / spbSec,
            vel: velN * spec.vocalLevel * moodVel,
            v: wordVowel, syl, harm: [], harmKind, legato
          };
          push(voxEv);
          voxChain = voxEv;
          lastVoxEnd = startBeats + endSec / spbSec;
        }
      }
    }

    /* --- 终止：最后一小节给长主和弦 --- */
    if (lastBar) {
      push({ t, k: 'pad', midi: chordMidi(S, R, 0, spec.padOct, Math.min(5, spec.chordSize + 1)), dur: bpb + 2.5, vel: 0.4 });
      push({ t, k: 'bass', midi: chordMidi(S, R, 0, spec.bassOct, 1)[0], dur: bpb + 2.5, vel: 0.55 });
      push({ t, k: 'lead', midi: degToMidi(S, R, 0, spec.melOct), d2: 0, dur: 3, vel: 0.26 });
    }
  }

  // 摆动（只挪八分位置）
  if (spec.swingOn) {
    for (const e of ev) {
      const frac = e.t % 1;
      if (Math.abs(frac - 0.5) < 1e-6) e.t += spec.swing;
    }
  }

  ev.sort((a, b) => a.t - b.t);

  const voxList = ev.filter(e => e.k === 'vox');

  /* 太密的音节直接并进前一个音：前一个音继续拖、口型不变 ——
     真人唱快活时就是这么把一个走句唱成一个长音的。阈值见 VOX_MIN_SYL。 */
  const MIN_SYL = VOX_MIN_SYL;

  /* ---------- 人声旋律：在"并音"之后定音高 ----------
     这是这一版最重要的改动。旋律的"级进"必须发生在**真正唱出来的两个音**之间；
     在并音之前算，被并掉的音节不会发声，剩下的相邻两音就隔了好几级。
     （上一版就是在音符层算的，测出来仍有 30% 是七度以上大跳。）
     规则：一个 6 音的动机（爬上去、落一步、再上），每重复一遍整体上移一级（模进），
     装不下了就往回退两度；强拍再吸附到当前和弦音。 */
  const VOX_SHAPE = [0, 1, 2, 3, 2, 1];   // 一个 6 音的拱形动机
  /* 几条动机轮着来：单一形状重复太多遍，耳朵先听出"这是循环"。 */
  const VOX_SHAPES = [
    [0, 1, 2, 3, 2, 1],    // 拱上去再回来
    [0, -1, 0, 1, 2, 1],   // 先落一步再上
    [0, 2, 1, 3, 2, 1],    // 更跳一点
    [0, 1, 2, 1, 0, -1]    // 先上后落
  ];
  const VOX_SEQ = [0, 1, 2, 3];            // 每重复一遍整体上一级（模进）
  const spbSec = 60 / spec.bpm;
  /* 人声音域固定在 C4–C5 附近，跟 spec.melOct 无关 ——
     音库是女声，被 PSOLA 拉到高音区会变形。 */
  let voxOct = spec.melOct;
  while (degToMidi(S, R, 0, voxOct) < 57) voxOct++;
  while (degToMidi(S, R, 0, voxOct) > 63) voxOct--;
  const voxDegToMidi = d => degToMidi(S, R, d, voxOct);
  const pads = ev.filter(e => e.k === 'pad');
  const chordAt = t => {
    let c = null;
    for (const p of pads) { if (p.t <= t + 1e-6) c = p.midi; else break; }
    return c;
  };

  let lastV = null;
  let voxDeg = 1, voxSeq = 0, voxNoteIdx = 0, voxDegCur = 1;
  let lastMainMidi = null;
  /* 副歌要"回来"：A 段一开始就把人声动机归零。
     词是同一串、旋律也从同一个动机头起步，耳朵才认得出"这是刚才那一句"。 */
  const secIdxOf = (bar) => {
    let acc = 0;
    for (let i = 0; i < sections.length; i++) { acc += sections[i].len; if (bar < acc) return i; }
    return sections.length - 1;
  };
  let curVoxSec = -1;
  for (const e of voxList) {
    const vi = secIdxOf(Math.floor(e.t / bpb));
    if (vi !== curVoxSec) {
      curVoxSec = vi;
      if (sections[vi] && sections[vi].name[0] === 'A') {
        voxDeg = 1; voxSeq = 0; voxNoteIdx = 0; voxDegCur = 1;
      }
    }
    const syl = e.syl;
    if (syl && syl.length >= 2) {
      const end = syl[syl.length - 1].u + syl[syl.length - 1].d;
      const keep = [syl[0]];
      /* 词头被并掉就要**整个词**一起丢掉：否则词里剩下的音节会挂到上一个词
         的尾巴上，一个"词"就变成 7 个音节的大杂烩（森林那首实测出现过）。 */
      let dropWord = false;
      for (let i = 1; i < syl.length; i++) {
        const s = syl[i], prev = keep[keep.length - 1];
        if (s.w0) dropWord = false;
        /* 转音和元音微变是"一个字的内部"，必须留着，不能被并音吃掉。
           mid 是"词内的音节"：一个词是一个整体，并音只能并**整个词**，
           不能把词拆成一片片假名 —— 那正是"一串字母"的来源。 */
        if (!s.orn && !s.glide && !s.mid && s.u - prev.u < MIN_SYL) {
          if (i === syl.length - 1) prev.d = end - prev.u;   // 收尾交给前一个音
          if (s.w0) dropWord = true;
          continue;
        }
        if (dropWord) continue;
        keep.push(s);
      }
      const last = keep[keep.length - 1];
      last.d = Math.max(last.d, end - last.u);
      e.syl = keep;
    }
    const ks = e.syl;
    if (!ks || !ks.length) continue;
    for (let k = 0; k < ks.length; k++) {
      /* 口型是在"合并"之前分配的，被并掉的音节会让留下来的相邻两个撞成同一个口型
         —— 又变回"一条长音在拖"。这里按合并后的顺序补一遍去重（跨词也算）。
         转音必须和主音同口型（否则会重新咬字），微变本来就是故意换个口型。 */
      const pv = k > 0 ? ks[k - 1].v : lastV;
      /* 并音之后补一遍去重：被并掉的音节会让相邻两个撞成同一个口型。
         但**只有"没有字头"的那一对必须换** —— 有字头时同口型是正常的复沓（la-la），
         没有字头还同口型才退化成"一条长音在拖"。 */
      if (!ks[k].orn && !ks[k].glide && pv && ks[k].v === pv && !ks[k].cons) {
        const alt = VOX_MONO.filter(x => x !== pv
          && !(ks[k].m >= 67 && (x === 'i' || x === 'u')));
        ks[k].v = alt[Math.floor(rng() * alt.length)] || 'a';
      }

      /* 转音/微变的音高从主音推，不参与动机的步进 —— 它们不是旋律的音，
         是一个音上的装饰。 */
      if (ks[k].orn && lastMainMidi != null) {
        ks[k].m = scaleStep(lastMainMidi, ks[k].ornOff == null ? 1 : ks[k].ornOff);
        continue;
      }
      if (ks[k].glide && lastMainMidi != null) {
        ks[k].m = lastMainMidi;
        continue;
      }

      /* 音高**每个音节推进一次**：一个音节一个音，旋律才跟着字走。
         （上一版只在词首推进、词内音节同高 —— 那是"念"，不是唱。）
         动机是几条拱形轮着来，每轮一遍整体上移一级（模进）。 */
      {
        const mPos = voxNoteIdx % VOX_SHAPE.length;
        if (mPos === 0 && voxNoteIdx > 0) {
          voxSeq = VOX_SEQ[(VOX_SEQ.indexOf(voxSeq) + 1) % VOX_SEQ.length];
        }
        const shape = VOX_SHAPES[voxSeq % VOX_SHAPES.length];
        let d = voxDeg + shape[mPos] + voxSeq;
        if (d > 6) { voxDeg -= 2; d = voxDeg + shape[mPos] + voxSeq; }
        else if (d < 0) { voxDeg += 2; d = voxDeg + shape[mPos] + voxSeq; }
        voxNoteIdx++;
        voxDegCur = d;
      }
      let vm = voxDegToMidi(voxDegCur);
      /* 强拍落回和弦音：只挪 1 个半音以内，不破坏动机的形状 */
      const beat = e.t + ks[k].u / spbSec;
      const inBar = ((beat % bpb) + bpb) % bpb;
      if (inBar < 0.08 || Math.abs(inBar - bpb / 2) < 0.08) {
        const ch = chordAt(beat);
        if (ch) for (const cm of ch) for (const o of [0, 12, -12]) {
          if (vm !== cm + o && Math.abs(cm + o - vm) <= 1) vm = cm + o;
        }
      }
      ks[k].m = vm;
      lastMainMidi = vm;
    }

    /* ---------- 转音 / 元音微变 ----------
       必须在并音之后：只有"真正唱出来的音"才知道自己有多长。
       转音 = 同一个字里连着唱好几个音（同口型、无字头）——音频层把它们当成
       同一条音线做音高滑移，所以听上去是"尾巴上转了一下"，不是"又唱了一个字"。
       这是"灵动"的第一来源；上一轮为了去掉"伊瓦伊艾"把短音全并掉了，
       顺手也把这点活气删干净了。 */
    for (let k = 0; k < ks.length; k++) {
      const s = ks[k];
      if (s.orn || s.glide) continue;
      const eff = (k + 1 < ks.length ? ks[k + 1].u : s.u + s.d) - s.u;
      /* 门槛跟着"音节变长"一起抬。以前音节只有 0.1 s，0.55 s 的音几乎不存在，
         所以 45% 都能加转音；现在一个音节就是 0.4–0.6 s，再按 0.55 s 算，
         每个字都要绕一下 —— 那是花腔，不是唱歌。只在真正长的音上做。 */
      if (eff < 0.80) continue;
      const r = rng();
      /* 转音只在长音上做，而且**每一步不能短于 0.20 s**。
         人耳要把一段声音听成"一个音高"大约需要 50–100 ms；0.085 s 的台阶低于这个下限，
         听不出是音，只剩下"抖了一下" —— 用户报的"两个正常音之间夹了个很短的怪音"就是它。
         现在尾巴最长 0.48 s、切成两段，每段 0.20–0.24 s，才够长成一个"音"。
         四音绕圈需要 4×0.20 = 0.8 s 的尾巴，做不到，整类取消。
         概率也从 32% 收到 15%：转音是装饰，不该每句都出现。 */
      const tail = Math.min(0.48, eff * 0.42);
      if (r < 0.15 && tail >= 0.40) {
        const shape = rng() < 0.62 ? [1, 0] : [-1, 0];   // 只保留两音回音（上/下）
        const stepT = tail / shape.length;
        s.d = eff - tail;
        for (let o = 0; o < shape.length; o++) {
          ks.splice(k + 1 + o, 0, {
            u: s.u + eff - tail + stepT * o, d: stepT,
            m: scaleStep(s.m, shape[o]),
            cons: null, v: s.v, orn: o + 1, ornOff: shape[o]
          });
        }
        k += shape.length;
      } else if (r < 0.72 && eff >= 1.00) {
        // 没有转音的长音：后 28% 让口型挪一点（a → 略带 o）
        const tail = eff * 0.28;
        s.d = eff - tail;
        ks.splice(k + 1, 0, {
          u: s.u + eff - tail, d: tail, m: s.m,
          cons: null, v: VOX_GLIDE[s.v] || 'o', glide: true
        });
        k += 1;
      }
    }
    lastV = ks[ks.length - 1].v;
    e.v = lastV;         // 看板显示与波表回退都用这个"落点元音"
    /* 词首音高 = 事件的音高（playEvent 与看板都读它）；
       和声层在这里才定，跟着最终旋律走一个三度。 */
    e.midi = ks[0].m;
    if (e.harmKind === 'up') e.harm = [scaleStep(e.midi, 2)];
    else if (e.harmKind === 'down') e.harm = [scaleStep(e.midi, -2)];
  }

  /* 抢拍（anticipation）：真唱是从拍子**前面**起音的 —— 辅音先到、元音落在拍上。
     我们的字以前都是"拍点起、先咬 60ms 再出声"，所以每个字都晚一步，听着就沉。
     只在前面确实有空隙时才抢，抢的量也小（最多 60ms），不会和上一句叠在一起。 */
  let prevEnd = -1;
  for (const e of voxList) {
    const gapSec = (e.t - prevEnd) * spbSec;
    if (prevEnd >= 0 && gapSec > 0.12) {
      const leadSec = Math.min(0.06, gapSec * 0.45);
      e.t = Math.max(0, e.t - leadSec / spbSec);
      e.lead = leadSec;
    }
    prevEnd = e.t + e.dur;
  }

  /* 重音：强拍的字稍微出来一点，弱位收一点。整句完全一样响，就是机器人在念。 */
  for (const e of voxList) {
    const inBar = ((e.t % bpb) + bpb) % bpb;
    const strong = inBar < 0.2 || Math.abs(inBar - bpb / 2) < 0.2;
    e.voxGain = strong ? 1.07 : 0.94;
  }

  /* 连唱的两个词之间不留缝：前一个不收音、后一个不从零起。
     否则每个词的交界都会"瘪"一下，听起来就是断开的"啊、啊、啊"。 */
  for (let i = 0; i < voxList.length - 1; i++) {
    const a = voxList[i], b = voxList[i + 1];
    if (b.t - (a.t + a.dur) < 0.12) { a.holdEnd = true; b.legato = true; }
  }

  /* ---- 旋律修整（整条主旋律跑一遍）----
     模进、句尾强制落音、段落升八度这三步都会在句子中间造出大跳。
     乐理上的硬指标（research/06-music-theory.md 第 1 节）：
     级进为主、音域不超过十度、跳进之后必须反向级进。
     做法：**按段落**各给一个音域窗口（段落之间换音区是刻意的，段内必须收窄），
     段内相邻最多两级，两级跳进之后回补一级。 */
  {
    const ls = ev.filter(e => e.k === 'lead' && e.d2 != null).sort((a, b) => a.t - b.t);
    if (ls.length > 1) {
      const bounds = [];
      let acc2 = 0;
      for (const s of sections) { bounds.push([acc2, acc2 + s.len]); acc2 += s.len; }
      const secIdx = bar => {
        for (let i = 0; i < bounds.length; i++) if (bar >= bounds[i][0] && bar < bounds[i][1]) return i;
        return bounds.length - 1;
      };
      let curSec = -1, prev = null, leap = 0, loD = 0, hiD = 0, justChanged = false;
      for (let li = 0; li < ls.length; li++) {
        const e = ls[li];
        const si = secIdx(Math.floor(e.t / bpb));
        if (si !== curSec) {
          curSec = si; leap = 0; justChanged = prev != null;
          const ds = ls.filter(x => secIdx(Math.floor(x.t / bpb)) === si)
                       .map(x => x.d2).sort((a, b) => a - b);
          const med = ds[Math.floor(ds.length / 2)];
          loD = med - Math.floor(S.length / 2) - 1;   // 一个八度上下各留一级
          hiD = med + Math.ceil(S.length / 2);
        }
        let d = clamp(e.d2, loD, hiD);
        if (prev != null) {
          if (li === ls.length - 1) {
            /* 收尾那个长主音是"回家"，不能被级进规则拽走：
               只把它折到离前一个音最近的那个八度（音级不变，还是主音）。 */
            while (d - prev > S.length) d -= S.length;
            while (prev - d > S.length) d += S.length;
          } else {
            // 段落交界允许抬一个八度（A″ 的"提"，是刻意的），段内最多两级
            const maxGap = justChanged ? S.length : 2;
            if (leap !== 0 && !justChanged) { d = prev - leap; leap = 0; }   // 跳进后反向级进补回
            /* 注意这里**不再二次夹音域**：夹回去会把刚拉近的音又甩出去
               （实测会出现 22 个半音的"跳"）。离开音域时让它每音走两级慢慢回来。 */
            else if (Math.abs(d - prev) > maxGap) d = prev + Math.sign(d - prev) * maxGap;
            if (Math.abs(d - prev) === 2) leap = Math.sign(d - prev);
          }
          justChanged = false;
        }
        e.d2 = d;
        e.midi = degToMidi(S, R, d, spec.melOct);
        prev = d;
      }
    }
  }

  /* ---- 低音收拢 ----
     和弦根音在级数上跳（i → VII 就是 10 个半音），低音跟着跳听感像"抽筋"。
     惯例是**就近取八度**：能往下走就不往上走。 */
  {
    const bs = ev.filter(e => e.k === 'bass').sort((a, b) => a.t - b.t);
    let prev = null;
    for (const e of bs) {
      if (prev != null) {
        while (e.midi - prev > 7) e.midi -= 12;
        while (prev - e.midi > 7) e.midi += 12;
      }
      e.midi = clamp(e.midi, 33, 57);
      prev = e.midi;
    }
  }

  return ev;
}
