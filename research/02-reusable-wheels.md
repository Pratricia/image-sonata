# 可以直接复用的轮子

筛选标准只有三条：**能不能 `file://` 跑**、**许可证能不能接受**、**体积值不值**。

> 体积为压缩后粗略值，接入前请以实际文件为准。

---

## 0. 总表

| 组件 | 用途 | 许可 | 体积 | file:// | 对本项目价值 |
|---|---|---|---|---|---|
| **Tonal.js** | 音阶/和弦/级数/转调 | MIT | ~60 KB | ✓ UMD 单文件 | ★★★★ 可替换手写乐理 |
| **Tone.js** | 调度、合成器、效果器 | MIT | ~200 KB | ✓ UMD | ★★★ 可替换 `player.js` 的 lookahead |
| **smplr / soundfont-player** | 加载 SoundFont 采样音源 | MIT | ~20 KB + 采样 | ✓（需本地音色文件） | ★★★ 立刻改善"电子味" |
| **@tonejs/midi** | MIDI 读写 | MIT | ~30 KB | ✓ | ★★ 导出 MIDI 给外部模型 |
| **Pink Trombone** | 声道（共振峰）物理模型 | 原版未明确 / fork 多为 **GPL-3.0** | ~30 KB | ✓ | ★★★★ 人声像"嗓子"的关键，但许可要处理 |
| **eSpeak-NG (wasm)** | 共振峰语音合成 | **GPL-3.0** | ~2 MB | ✓ | ★★ 可改造为唱歌，传染性许可 |
| **WORLD (pyworld/wasm)** | 音高+包络分析/再合成 | BSD/MIT | 中等 | 需 wasm 编译 | ★★★ 人声变形、音色迁移 |
| **NNSVS** | 神经歌唱合成（Python） | MIT | 模型级 | ✗ | ★★ 离线训练，不能进浏览器 |
| **DiffSinger / OpenUtau** | 扩散歌声合成 / 编辑器 | Apache-2.0 / MIT | 模型级 | ✗ | ★★ 同上 |
| **Magenta.js** | 浏览器内 MusicRNN / MusicVAE | Apache-2.0 | ~1 MB + tfjs 2 MB | ✗（模型需网络） | ★ 破坏零依赖，不建议 |
| **transformers.js** | 浏览器内跑 ONNX 模型 | Apache-2.0 | ~1 MB + 模型 | ✗ | ★ 模型太大 |
| **Meyda** | 实时音频特征 | MIT | ~40 KB | ✓ | ★ 我们只需要 AnalyserNode |
| **Essentia.js** | 音频分析（BPM/调性/和弦） | **AGPL-3.0** | ~1.5 MB | ✓ | ★ 许可劝退 |
| **wavesurfer.js** | 波形显示 | BSD-3 | ~50 KB | ✓ | ★★ 比自绘频谱好看 |
| **abcjs / VexFlow** | 五线谱渲染 | MIT | ~200 KB | ✓ | ★ 我们不需要谱面 |

---

## 1. 乐理层：Tonal.js

我们 `util.js` 里手写了 `SCALES`、`degToMidi()`、`chordMidi()`、音级名。这些 Tonal.js 全有，而且更全（和声小调、各种五声、和弦转位、罗马数字级数）。

```html
<script src="vendor/tonal.min.js"></script>
<script>
  Tonal.Note.midi('C4');            // 60
  Tonal.Scale.get('D dorian').notes;
  Tonal.Chord.get('Cmaj7').notes;
  Tonal.RomanChord.get('IV', 'C major').chord;
</script>
```

- 好处：省掉一堆边界情况（比如 `B#`、等音、和弦转位）。
- 代价：多 60 KB，且要改 `util.js` 的调用点。
- 建议：**先不动**。我们现在的映射逻辑是"按音级取音"，Tonal 的收益主要在复杂和声，暂时用不上。等要做"转调 / 副属和弦"时再换。

## 2. 调度层：Tone.js

`player.js` 现在是自己写的 lookahead 调度（`setInterval` + `ctx.currentTime` 预排 0.15 秒）。Tone.js 的 `Transport` 做的是同一件事，但更稳（标签、循环、BPM 变更、与 `OfflineAudioContext` 的对应）。

- 代价：Tone.js 会接管 AudioContext 的创建，`export.js` 的离线渲染要改成 `Tone.Offline`，改动量中等。
- 建议：**暂不换**。现有调度没有 bug，换框架是净风险。

## 3. 音源层：SoundFont（最划算的一步）

现在的音色全是振荡器 + 滤波器，所以"电子味"重。SoundFont 是采样音源，一个 `.sf2` 里包含钢琴/弦乐/长笛等真实乐器采样。

- `smplr`（MIT，~20KB）：`new SoundfontLoader()` 直接加载 `.sf2`，按 MIDI 音符触发。
- 代价：每个音色几百 KB 到几 MB；`file://` 下 `fetch` 本地文件会受 CORS 限制，**需要用 `XMLHttpRequest` 或让用户通过 `<input type=file>` 选**，或者干脆内嵌 base64（体积爆炸）。
- 现实结论：**`file://` 与本地方案天然冲突**。如果愿意接受"起个本地服务器"，这是提升听感性价比最高的一步。

## 4. 人声层：三个可选方案

### 4.1 Pink Trombone（声道物理模型）

Neil Thapen 的浏览器版"粉红长号"：用一个 44 段的声道管道 + 声门脉冲，实时合成元音和辅音。它的元音比"滤波器组"真实得多，因为模拟了声道形状。

- 优点：纯 JS、~30KB、可实时改舌位/唇形 → 能做出真正的"元音过渡"（我们现在的波表是静态元音）。
- 缺点：**许可证是坑**。原版页面没有明确授权声明，主流可编程 fork（`zakaton/Pink-Trombone`）是 **GPL-3.0**，闭源分发/商用会传染。
- 建议：可以**读它的实现思路**（声道分段 + 反射系数），自己重写一个 MIT 版本；不要直接拷 GPL 代码进项目。

### 4.2 eSpeak-NG（共振峰 TTS）

Klatt 式共振峰合成器，能输出音素级参数。社区有人拿它"唱"歌（把音素时长对齐到音符）。

- 同样是 **GPL-3.0**，且体积 ~2MB（wasm + 语音数据）。
- 音质偏"机器人朗读"，不适合我们要的"咏唱"。

### 4.3 WORLD 声码器（改造现有录音）

如果能拿到一段人声录音，WORLD 可以拆成 **F0 曲线 + 频谱包络 + 非周期成分**，改 F0 就能改旋律，改包络就能改音色。

- 这是"假唱"路线：录一段"啊——"，按谱面改音高。
- 缺点：需要音频素材（版权）、需要 wasm 编译、`file://` 加载二进制麻烦。
- 建议：**如果将来允许联网/起服务，这是最像人的方案**。

## 5. 可视化层

`viz.js` 现在是手绘 `AnalyserNode` 频谱 + 播放头，够用。`wavesurfer.js`（BSD-3）能画出真实波形和区域标记，好看但多 50KB，且与现有 canvas 布局冲突。**不建议换。**

## 6. 明确不要碰的

| 东西 | 原因 |
|---|---|
| Magenta.js / transformers.js | 需要下载模型（几十 MB～GB），破坏 `file://` 与"秒开" |
| Essentia.js | AGPL-3.0，且我们要的特征用 canvas 自己算更快 |
| 任何 `npm install` 后需要打包的库 | 破坏"双击即用、零构建" |
| MusicGen / Stable Audio 权重 | CC-BY-NC / 社区许可，不能商用；且要 GPU |

---

## 7. 如果只做一件事

**把人声从"静态元音波表"升级成"带元音过渡的波表"**——不需要任何外部库：

1. 一个音节内部，前 30% 用上一个音节的元音，后 70% 滑到目标元音；
2. 用两个 `PeriodicWave` 交替 + 交叉淡化，或者直接在每个音节重新生成波表时按时间插值谐波幅度；
3. 成本：仍是 1–2 个振荡器，渲染时间不变。

这条比引入 Pink Trombone 便宜得多，而且效果方向是对的（真人唱歌时元音是连续变化的，不是一个字一个固定音色）。

---

## 8. 参考来源

- Tonal.js：<https://github.com/tonaljs/tonal>
- Tone.js：<https://tonejs.github.io/>
- smplr：<https://github.com/danigb/smplr>
- @tonejs/midi：<https://github.com/Tonejs/Midi>
- Pink Trombone（可编程 fork）：<https://github.com/zakaton/Pink-Trombone>
- 原版：<https://dood.al/pinktrombone/>
- eSpeak-NG：<https://github.com/espeak-ng/espeak-ng>
- WORLD：<https://github.com/JeremyCCHsu/Python-Wrapper-for-World-Vocoder>
- NNSVS：<https://github.com/nnsvs/nnsvs>
- DiffSinger：<https://github.com/MoonInTheRiver/DiffSinger>
- OpenUtau：<https://github.com/stakira/OpenUtau>
- wavesurfer.js：<https://wavesurfer.xyz/>