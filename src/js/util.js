/* 基础工具：可复现随机数、音高/音阶换算、时间格式化。无依赖，被其它所有文件使用。
   文件：src/js/util.js */
'use strict';

/* ============================================================
   0. 工具
   ============================================================ */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const PC_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashBytes(data) {
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 97) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const midiFreq = m => 440 * Math.pow(2, (m - 69) / 12);

/* 音阶（半音偏移） */
const SCALES = {
  major:      { steps: [0,2,4,5,7,9,11], name: '大调' },
  mixolydian: { steps: [0,2,4,5,7,9,10], name: '混合利底亚' },
  dorian:     { steps: [0,2,3,5,7,9,10], name: '多利亚' },
  minor:      { steps: [0,2,3,5,7,8,10], name: '自然小调' },
  penta:      { steps: [0,3,5,7,10],     name: '小调五声' }
};

/* 无意义音节：像 Hopelandic / Kobaïan 那样，只有发音没有词义。
   元音用三个共振峰（F1/F2/F3）定义口型，辅音只是起音的气声/爆破。 */
const VOWEL_F = {
  a: [[780, 1.00, 6], [1160, 0.50, 8], [2850, 0.22, 11]],
  o: [[460, 1.00, 6], [840, 0.50, 8], [2800, 0.18, 11]],
  e: [[430, 1.00, 6], [1750, 0.48, 8], [2600, 0.22, 11]],
  i: [[300, 1.00, 6], [2250, 0.44, 8], [3000, 0.20, 11]],
  u: [[330, 1.00, 6], [720, 0.44, 8], [2500, 0.18, 11]],
  // 下面几个是"复合口型"：共振峰取两个元音之间，唱出来像滑过去的一半，用来凑塔语里的双元音
  ae: [[660, 1.00, 7], [1700, 0.45, 9], [2700, 0.20, 11]],
  ea: [[560, 1.00, 7], [1900, 0.42, 9], [2650, 0.20, 11]],
  ie: [[380, 1.00, 7], [2000, 0.42, 9], [2800, 0.20, 11]],
  ou: [[430, 1.00, 7], [800, 0.46, 9], [2650, 0.18, 11]],
  ai: [[700, 1.00, 7], [1500, 0.46, 9], [2750, 0.20, 11]]
};
const VOWEL_KEYS = ['a', 'o', 'e', 'i', 'u'];
const CONSONANTS = ['l', 'n', 'm', 'd', 'h'];

/* ---- 塔语（Hymmnos）风格的音节库 ----
   塔语是《アルトネリコ》的人工语言，音位上的特点是：开音节为主、辅音偏柔、
   词尾几乎总是开元音，所以每个"词"都能自然地拖长。我们只借这套音位规律，
   不使用它的任何歌词（歌词有版权）。详见 research/03-hymmnos.md */
const HYMN_ONSET = ['', 'l', 'n', 'm', 'r', 's', 'v', 'w', 'y', 'f', 'h', 'sh', 'th', 'k', 't', 'd', 'p', 'b', 'g', 'z', 'j', 'ch'];
/* 双元音（ae / ea / ie / ou / ai）保留在这张表里说明音位规律，但人声**不再选它们**：
   一个双元音要在 0.5 秒以上的长音上滑才好听，短音上就是一次"伊—瓦"的滑音。 */
const HYMN_NUCLEUS = ['a', 'a', 'a', 'e', 'e', 'i', 'o', 'o', 'u', 'ae', 'ea', 'ie', 'ou', 'ai'];
const HYMN_CODA = ['', '', '', '', '', 'n', 'm', 'l', 'r', 's'];

/* ---- 功能词的音节拆法：想音（Emotion Sound）与人称 ----
   用户反馈"听起来像纯 a o e y w u，不像一种语言"。查完塔语的语法就明白了：
   塔语的"语言感"有一半来自**功能词**——每个句子都以固定的三个词（想音）开头，
   人称用极短的词（mea / yor / hes）挂在句子里。这些词短、位置固定、反复出现，
   而且大多带韵尾（was / yor / hes）、有真辅音（rre / gagis）。
   我们之前只有 2–4 音节、全开音节、辅音还常被丢掉的"实词"，当然只剩元音。
   这里只借它的**音位与语序**，不引用任何一句歌词（歌词有版权）。
   详见 research/03-hymmnos.md 第 5 节。 */
const HYMN_SYL = {
  /* 想音 · 程度 */
  Rrha: [{ c: 'r', v: 'a' }, { c: 'r', v: 'a' }],
  Was:  [{ c: 'w', v: 'a', cod: 's' }],
  Wee:  [{ c: 'w', v: 'e' }],
  Fou:  [{ c: 'f', v: 'o' }, { c: null, v: 'u' }],
  Ma:   [{ c: 'm', v: 'a' }],
  Nn:   [{ c: 'n', v: 'a', cod: 'n' }],
  /* 想音 · 愿望（句末的那个词） */
  ra:    [{ c: 'r', v: 'a' }],
  ga:    [{ c: 'g', v: 'a' }],
  wa:    [{ c: 'w', v: 'a' }],
  erra:  [{ c: null, v: 'e', cod: 'r' }, { c: 'r', v: 'a' }],
  gaya:  [{ c: 'g', v: 'a' }, { c: 'y', v: 'a' }],
  gagis: [{ c: 'g', v: 'a' }, { c: 'g', v: 'i', cod: 's' }],
  /* 人称 / 主语标记：句尾挂"我的 / 你的 / 他的" */
  mea: [{ c: 'm', v: 'e' }, { c: null, v: 'a' }],
  yor: [{ c: 'y', v: 'o', cod: 'r' }],
  hes: [{ c: 'h', v: 'e', cod: 's' }],
  rre: [{ c: 'r', v: 'e' }]
};

/* ---- 想音（Emotion Sound）----
   塔语每句话必须以三个词开头：[程度] [情绪] [愿望]。
   我们把它当成"这一段怎么唱"：程度决定用力，情绪决定口型与辅音软硬，
   愿望决定句尾是"收住"还是"悬着"。这是一套现成的、可解释的情绪参数。 */
const MOOD_VOWEL = {
  yea: 'e', waa: 'a', apea: 'e', touwaka: 'a', wol: 'o', paks: 'a',
  ki: 'i', num: 'u', zweie: 'e', granme: 'o',
  au: 'o', jyel: 'u', yant: 'i', guwo: 'a', i: 'i'
};
const MOOD_VEL = { Rrha: 1.06, Was: 1.00, Wee: 0.96, Fou: 0.92, Ma: 0.89, Nn: 0.85 };
const MOOD_SOFT_CONS = ['l', 'n', 'm', 'v', 'w', 'y', 'r', 't', 'd', 'f'];   // 软情绪不用 /s/ /sh/：擦音在安静的段落里会被听成"沙沙"的杂音
const MOOD_HARD_CONS = ['k', 't', 'd', 'z', 'sh', 'ch', 's', 'r', 'p', 'b', 'g'];
const MOOD_HARD = { paks: 1, guwo: 1, yant: 1, i: 1, granme: 1 };
const MOOD_CN = {
  Rrha: '出神', Was: '非常', Wee: '适度', Fou: '一点点', Ma: '随意', Nn: '不情愿',
  yea: '喜悦', waa: '喜悦', apea: '被幸福笼罩', touwaka: '怀抱希望', wol: '炽烈',
  paks: '兴奋', ki: '专注', num: '平静', zweie: '坚定', granme: '想守护',
  au: '悲伤', jyel: '孤独', yant: '畏惧', guwo: '愤怒', i: '焦躁',
  ga: '希望它停下', ra: '希望它继续', erra: '希望它永远继续',
  wa: '可以接受', gaya: '不愿再发生', gagis: '无所谓'
};

/* 节奏词汇：按拍号 × 风格，单位是网格步（4/4 为十六分，3/4 与 6/8 为八分） */
const CELLS = {
  '4/4': {
    electro:  [[0,2,4,6,8,10,12,14], [0,3,6,8,11,14], [0,2,3,6,8,10,11,14], [0,4,6,8,12,14]],
    lofi:     [[0,2,4,7,8,10,12,15], [0,3,4,8,10,11,14], [0,2,6,8,12,14], [0,4,7,8,12,14]],
    cinema:   [[0,6,8,14], [0,4,8,12], [0,8,12], [0,6,10,14]],
    minimal:  [[0,4,8,12], [0,4,6,12], [0,8], [0,4,8,10,12]],
    folk:     [[0,2,4,6,8,10,12,14], [0,3,6,8,11,14], [0,2,4,8,10,12], [0,3,4,8,10,14]],
    musicbox: [[0,4,8,12], [0,2,4,8,10,12], [0,4,8,10], [0,2,8,10]],
    tense:    [[0,1,4,6,7,8,12,14], [0,3,4,7,8,12,15], [0,2,6,7,8,14], [0,1,2,4,8,14]],
    default:  [[0,4,6,8,12,14], [0,2,4,8,10,12]]
  },
  '3/4': {
    minimal:  [[0,2,4], [0,2,3,4], [0,4], [0,1,2,4]],
    musicbox: [[0,2,4], [0,1,3,4], [0,2,3,4], [0,2,5]],
    default:  [[0,2,4], [0,1,3,4], [0,2,5]]
  },
  '6/8': {
    folk:     [[0,2,4], [0,1,3,4], [0,2,3,5], [0,2,4,5]],
    default:  [[0,2,4], [0,1,3,4], [0,2,3,5]]
  }
};

/* 和弦进行模板（级数，0 起）。**级数必须落在音阶长度之内**：
   五声音阶只有 0–4 级，写 5 就等于"高一个八度的 0"，低音会整段翻上去。 */
const PROGS = {
  major: [[0,4,5,3], [0,5,3,4], [5,3,0,4], [0,3,5,4]],
  minor: [[0,5,2,6], [0,3,6,2], [0,6,5,6], [5,6,0,0]],
  penta: [[0,4,0,3], [0,2,4,0], [0,3,4,3]]
};

/* 风格模板：决定音色、鼓型、混音取向 */
const STYLES = {
  cinema:   { name: '电影氛围', lead: 'epiano', pad: 'strings', bass: 'sub',     arp: 'bell',   drums: 'sparse',  revMul: 1.30, dlyMul: 1.10, swingAdd: 0.00, vinyl: false },
  lofi:     { name: '低保真',   lead: 'epiano', pad: 'warm',    bass: 'upright', arp: 'epiano', drums: 'boombap', revMul: 0.85, dlyMul: 0.70, swingAdd: 0.06, vinyl: true },
  electro:  { name: '电子',     lead: 'saw',    pad: 'organ',   bass: 'sawbass', arp: 'pluck',  drums: 'four',    revMul: 0.65, dlyMul: 0.90, swingAdd: 0.00, vinyl: false },
  minimal:  { name: '极简',     lead: 'piano',  pad: 'strings', bass: 'sub',     arp: 'piano',  drums: 'none',    revMul: 1.15, dlyMul: 0.45, swingAdd: 0.00, vinyl: false },
  folk:     { name: '民谣',     lead: 'pluck',  pad: 'warm',    bass: 'upright', arp: 'pluck',  drums: 'brush',   revMul: 0.95, dlyMul: 0.55, swingAdd: 0.03, vinyl: false },
  musicbox: { name: '音乐盒',   lead: 'bell',   pad: 'choir',   bass: 'sub',     arp: 'bell',   drums: 'none',    revMul: 1.40, dlyMul: 0.65, swingAdd: 0.00, vinyl: false },
  tense:    { name: '紧张',     lead: 'saw',    pad: 'organ',   bass: 'dist',    arp: 'pluck',  drums: 'gate',    revMul: 0.55, dlyMul: 1.00, swingAdd: 0.00, vinyl: false }
};
