# AGENTS.md

给在此仓库中工作的 AI/协作者的最小说明。**先读这一页，再按需打开单个文件**，不要一次性通读整个项目。

## 项目是什么

单页、零依赖的「图片 → 音乐」Web 应用。图像特征经规则映射成音乐参数，再用 Web Audio 实时合成并导出 WAV。无构建步骤，`file://` 双击可用。

## 读文件的纪律

1. 先用本页或 `README.md` 的「修改指南」表定位到**一个**文件。
2. 只打开那个文件；需要跨文件时，先看它的头部注释（每个文件第一行写了职责与依赖）。
3. 大文件（`audio.js`、`score.js`）用 `grep` 找符号再局部读，不要整篇读。
4. 不要为了"了解上下文"去读 `index.html`（它只有 DOM 和 script 列表）。

## 文件职责（一行版）

| 文件 | 职责 |
|---|---|
| `index.html` | DOM 骨架 + 按依赖顺序加载脚本 |
| `src/css/app.css` | 全部样式 |
| `src/js/util.js` | 随机数、音高/音阶换算、时间格式 |
| `src/js/analysis.js` | 图像 → 全局特征 |
| `src/js/mapping.js` | 特征 → 风格/调式/BPM/拍号/和声/曲式 |
| `src/js/score.js` | 参数 → 事件列表（鼓/贝斯/铺底/琶音/旋律/人声） |
| `src/js/voxsample.js` | 人声采样引擎：TD-PSOLA 变调（音库在 `assets/voicebank.js`） |
| `assets/voicebank.js` | 自动生成的人声音库（PJS 语料，CC BY-SA 4.0）。**不要手改**，改 `tools/svs/build_bank.py` |
| `tools/svs/` | 离线工具（不参与运行）：从 PJS 切音库、Node 端 PSOLA 自检 |
| `src/js/audio.js` | 事件 → 声音（合成器、总线、`playEvent`） |
| `src/js/player.js` | 实时调度与播放状态 |
| `src/js/viz.js` | 频谱与播放头 |
| `src/js/export.js` | 离线渲染 + WAV |
| `src/js/ui.js` | 界面渲染、文件输入、事件绑定 |
| `src/js/selftest.js` | `?selftest=1` 客观自检 |
| `src/js/main.js` | 入口装配（URL 参数） |
| `research/` | 调研资料（不参与运行）：模型、轮子、塔语、无意义唱法 |

## 硬性约束

- **不引入依赖、不加构建**。所有代码是普通 `<script>`（非 ES module），共享全局词法作用域。
- **脚本顺序即依赖顺序**。新增文件必须插到使用它的文件之前，并在 `index.html` 中登记。
- **确定性**：随机只能来自 `mulberry32(seed)`，`seed` 只能由图像特征决定。
- **分层**：`audio.js` 不碰 DOM；`ui.js` 不直接创建音频节点；`score.js` 不发声。
- **注释用中文**，解释"为什么"而不是"是什么"。

## 改完怎么验

```bash
# 起本地服务（可选，file:// 也能跑）
python -m http.server 8000 --bind 127.0.0.1
```

然后打开：

- `http://127.0.0.1:8000/?selftest=1&short=1&n=3` — 看 `nan=0`、`peak<1.0`、`WAV ... ok=true`
- `?selftest=1&voxonly=1&n=2&voxi=1` — 人声独奏 RMS 应约为整混音的 −1.5 ~ −5 dB
- `?debug=1` — 检查布局溢出（`colR 高度/滚动高度` 应相等）

也可以直接双击 `index.html`，点示例图 → 播放，确认无控制台报错、时长正确。

## 常见改动入口

- 调"整首不好听" → 先读 `research/06-music-theory.md`（有实测体检表和指标）；改旋律去 `score.js` 的 `contour()` 与末尾的"旋律修整"（级进为主、音域一档、跳进后回补），改和声去 `util.js` 的 `PROGS`（**级数必须落在音阶长度内**）与 `mapping.js` 的 `chordMidi()`
- 调风格映射 → `mapping.js` 的 `STYLES` 与 `deriveSpec()`
- 调节奏/乐句 → `score.js` 的 `CELLS`、`contour()`、`makePhrase()`、`xform()`
- 调人声 → `score.js` 的人声事件段 + `audio.js` 的 `voxV()`
- 调人声连贯性 → `score.js` 的 `chainOk`（音节接在上一个事件上）、`VOX_MIN_SYL`（并音地板，0.22 s）与末尾的 `holdEnd` 后处理；`audio.js` 的 `xfAt`（口型过渡，按边界算且止于交界）、`CONS_SPEC`（字头频谱）；`voxsample.js` 的增益补偿与 RMS 归一
- 调人声"像不像在唱词" → `score.js` 里 `LEX`（词表：2–4 音节的词、词内元音和谐、词尾开口）与 `pickWord`（选词 + 30% 排比）。**词是跨音符的**：`voxWord`/`voxWordUsed` 游标让一个词的几个音节落在相邻几个音上（一个音节一个音）。口型换与不换、字头咬不咬在音节循环里（词首 0.85 / 词中 0.60）。口型全换、字头全咬，就退化成念经；都不换不咬，就退化成一条"呜"
- 调人声"像不像一首有歌词的歌" → `score.js` 的 `buildLine` / `CHORUS_LINES` / `VERSE_LINES`：**4 小节唱一行固定的词**，行内按序取，行长 4–5 词，行尾挑长词，第 3 词 45% 排比，副歌两行共用一个行首 hook。行号按"段内第几个乐句"取（`Math.floor(inSec / 4)`），所以 A 与 A′ 唱的是同一组行 —— 副歌原封不动地回来。想让同一句更少重复就加长行长、或把行号改成 `inSec / 8`
- 调人声"太密/太慢" → `score.js` 的 `VOX_MIN_NOTE`（一个音短于 0.24 s 就不另起字，直接把上一个音拖过去）。这是"像说话"和"像唱歌"之间唯一的那根弦：**唱歌是把元音拖长，不是把音节切碎**
- 调人声"音色亮/尖" → `score.js` 的 `VOX_OPEN`/`VOX_MONO` 元音池与 `LEX` 每个词的元音池 `pal`（`PAL_V`，不含 i）。`i` 在长音上会发尖，G4 以上直接换掉
- 调人声"像不像一种语言（而不是一串元音）" → `score.js` 的 `CODA_POOL`（韵尾：词中 40%、词尾 18%）与 `score.js` 人声段的咬字率（词首 0.93 / 词中 0.80）；`util.js` 的 `MOOD_SOFT_CONS` / `MOOD_HARD_CONS`（软情绪也要留阻塞音 `t d f`）；`audio.js` `voxV` 的 `codCuts`（元音在韵尾前收掉 72%）＋末尾的"韵尾"噪声段。**只加噪声不切元音是没用的**，会被听成下一个字的声母。句首想音与句尾人称见 `HYMN_SYL`
- 调人声"旋律好不好听" → `score.js` 末尾的 `VOX_SHAPES`/`VOX_SEQ`（4 条拱形动机轮换 + 模进）。**音高必须每个音节推进一次**（同音重复 = 念），且**必须在并音之后定**，否则被并掉的音节不发声、剩下的相邻两音会隔好几级，级进就没了
- 调人声"厚不厚" → `audio.js` `playEvent` 的 vox 分支（三轨叠录的 `gain`/`cents`/延迟）。注意 `voxPsola` 会把每段归一化到固定 RMS，`vel` 影响不到音量，只能用 `voxToAudioBuffer(…, gain)`
- 调人声情绪（想音）→ `mapping.js` 的 `deriveVoxMood()`；音节库在 `util.js` 的 `HYMN_*` / `MOOD_*`
- 调人声"突然跳音/尾巴往上扬" → `score.js` 后处理的转音 `shape`（**每一步只能走一级、最后必须落回 0**；五声音阶里"两级"就是 5 个半音）＋ `audio.js` `voxV` 的 `glide`（**按音程给**，1 半音 19 ms；按"这个音多长"给会把五声的 2–3 半音压进 26 ms，听起来就是跳过去）
- 调人声"两个正常音之间夹了一个很短的怪音" → 两处，别只改一处：
  ① `voxsample.js` 的 `voxPsola`：窗长必须 `2 × 输出周期`（`g`），跳距也是输出周期，两者相等叠加和才是常数；否则输出凭空多出一个 1/3、1/4 的低频成分。另外每粒要往 ±半周期内的**真实波峰**吸（`snapR`），因为音库标注的基频有 ±11 音分误差，不吸就会逐粒漂移、漂到反相时自我抵消。
  ② `score.js` 转音块：**每一步不能短于 0.20 s**（`tail` 上限 0.48、切两段）。0.085 s 低于人耳的音高分辨下限（50–100 ms），听不成一个音，只剩"抖一下"。
  排查工具：`node tools/svs/probe_range.js <wav> <起> <止>`（逐 20 ms 看音量/音高）、`f0_blips.js`（扫短促音高事件）、`find_blips.js`（扫短促能量突起）
- 调音色/混音 → `audio.js` 的 `*V()`、`buildGraph()`、`outNode()`

## 动人声之前先读

- `research/05-vocal-synthesis-options.md`：人声合成的三档方案（神经 SVS / 物理模型 / 采样拼接）+ 为什么最终选采样 + PJS 语料
- `research/03-hymmnos.md`：塔语音位表 + "想音三元组 → 音乐参数"的映射草案
- `research/04-conlang-singing.md`：各流派唱法差异（辅音密度、音节长度、音区）+ 风格预设表
- `research/02-reusable-wheels.md`：想换音源/人声合成器时，先看许可证（GPL/AGPL 会传染）