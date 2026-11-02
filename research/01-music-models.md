# 音乐生成模型是怎么做的

调研时间：2026-10。目标是回答一个问题：**这些模型里有没有能直接搬过来用的部分？**

---

## 0. 先分清三条技术路线

所有"文生音乐"系统，本质都在解决同一件事：**如何从"没有声音"生成"几十秒到几分钟的波形"**。目前只有三种主流做法。

### 路线 A：码本语言模型（Codec LM / Token LM）

```
音频 ──神经音频编解码器(EnCodec/DAC/SoundStream)──▶ 离散 token 序列
                                                        │
                                           transformer 自回归预测
                                                        ▼
                                                  token → 解码器 → 波形
```

思路与 GPT 完全一致：只要把音频压成"词表"，音乐生成就变成了"续写文本"。

- 代表：**MusicGen**（Meta）、**AudioGen**、**MusicLM/AudioLM**（Google）、**Suno / Udio**（闭源，普遍推测是这条路 + 人声专项模型）
- 优点：长程结构好、能接旋律/和弦条件、可流式续写
- 缺点：token 序列极长（30 秒 ≈ 数千 token），推理慢；音质上限被编解码器卡住

### 路线 B：潜空间扩散（Latent Diffusion）

```
波形 ──自编码器──▶ latent（低帧率）──DiT 扩散去噪──▶ latent ──解码器──▶ 波形
                                    ▲
                              文本/音频条件 (T5 / CLAP)
```

把"图像扩散"搬到音频 latent 上。

- 代表：**Stable Audio (Open / 2.0)**、**AudioLDM / AudioLDM2**、**Riffusion**（直接在频谱图上扩散）
- 优点：音质好、并行生成、训练相对稳
- 缺点：结构控制弱（容易"好听但没发展"）、时长受 latent 长度限制

### 路线 C：分层 / 多阶段

先出"骨架"，再出"声音"：

1. 结构层：段落标签、和弦、鼓谱、BPM（符号域，或另一个小模型）
2. 渲染层：把骨架变成音频（扩散 / 声码器）
3. 混音层：分轨、人声分离、母带

- 代表：**MusicLM**（语义 token → 声学 token）、**Suno/Udio**（歌词生成 → 人声 → 编曲 → 混音，产品化流水线）
- 这其实是**最接近我们项目**的思路——只不过我们的"骨架层"是手写规则，它们的是模型。

---

## 1. 具体系统对照表

| 系统 | 年份 | 架构 | 时长 | 采样率 | 条件输入 | 开源/许可 |
|---|---|---|---|---|---|---|
| **MusicGen** (Meta) | 2023 | 单阶段 transformer LM + EnCodec，4 码本用"延迟交错"并行预测 | 30 s（可续写） | 32 kHz 单声道 | 文本 / 旋律 | 代码 MIT，**权重 CC-BY-NC 4.0** |
| **MusicLM** (Google) | 2023 | 分层 seq2seq：w2v-BERT 语义 token → SoundStream 声学 token | 数分钟 | 24 kHz | 文本 / 哼唱 | **未开源** |
| **AudioLDM 2** | 2023 | 潜扩散 + CLAP 文本 + 音频条件 | 10 s | 16 kHz | 文本 / 音频 | 代码 MIT，权重 CC-BY-NC-SA |
| **Riffusion** | 2022 | 在梅尔频谱图上跑 Stable Diffusion 1.5 | 5 s 循环 | 44.1 kHz | 文本 | 代码 MIT，权重 OpenRAIL-M |
| **Stable Audio Open** | 2024 | 自编码器(156M) + T5(109M) + DiT(1057M) | 47 s | 44.1 kHz **立体声** | 文本 | 代码 MIT，**权重 Stability 社区许可**（商用需申请） |
| **Stable Audio 2.0** | 2024 | 同上，规模更大 | 最长 3 min | 44.1 kHz | 文本 / 音频转音频 | 闭源服务 |
| **ACE-Step** | 2025 | 扩散 + 轻量 transformer，专为"整首歌（含人声）"设计 | 约 4 min | 44.1 kHz | 文本 / 歌词 | **Apache-2.0**（少数可商用的开源整歌模型） |
| **YuE** | 2025 | 歌词→人声 token→伴奏，全曲生成 | 数分钟 | 44.1 kHz | 歌词 + 风格 | 代码开源，**权重许可需自行核对** |
| **Suno / Udio** | 2023– | 未公开（业界推测：码本 LM + 人声模型 + 混音流水线） | 2–4 min | 44.1 kHz | 文本 / 歌词 / 参考曲 | 闭源商业服务 |
| **Magenta** (Google) | 2016– | 符号域：MusicVAE（latent）、Performance RNN（演奏表情）、MusicRNN（续写）、Coconet（巴赫众赞歌补全） | 小节级 | MIDI | MIDI / latent | **Apache-2.0**（可跑在浏览器） |

---

## 2. 它们共同做对的几件事（可以借思想，不必借代码）

1. **分层：先结构，后音色。** 直接生成波形很难控制"第 32 小节该转调"，所以工业系统都是先定骨架。我们的 `mapping.js → score.js` 就是这一层，只是用规则代替了模型。
2. **条件化（conditioning）比"自由生成"重要。** 所有系统都强调"给什么条件"。我们给的条件是**图像特征**，这比文本更客观、更可复现。
3. **重复 + 变化是"像音乐"的关键。** MusicGen 的失败案例几乎都是"氛围音铺 30 秒没有发展"。我们的 `xform()`（动机变形）正好补这个洞。
4. **人声要单独建模。** Suno/Udio 的人声质量高，是因为人声有独立模型、独立混音位。我们的 `voxV()` 是同一思路的极简版。

## 3. 它们做不好、而规则引擎有优势的事

| 维度 | 模型 | 我们的规则引擎 |
|---|---|---|
| 可复现 | ✗（采样随机，同输入不同输出） | ✓ 同图同声 |
| 可解释 | ✗（为什么这里转调？不知道） | ✓ 每条参数都能追溯到图像特征 |
| 冷启动成本 | 需要 GPU / 数十秒推理 | 0（浏览器里毫秒级生成事件） |
| 结构控制 | 弱（靠 prompt 祈祷） | 强（曲式是显式写死的） |
| 音色真实度 | 强 | 弱（这是我们的短板） |

**结论：不要用模型替换 `score.js`；要用模型/合成器替换 `audio.js` 的音色。**

---

## 4. 如果真的想接模型，怎么接才不破坏现有架构

保持"事件列表"作为唯一接口（现在 `playEvent()` 吃的东西）：

```
图像 → 特征 → 参数 → 事件列表 ─┬─▶ Web Audio 合成（现在）
                              └─▶ MIDI 文件 → 外部模型渲染（将来）
```

- 事件列表导出成 `.mid`，交给 ACE-Step / 本地音源渲染，是**零侵入**的扩展。
- 反向不行：让模型直接出波形，就没法保证"同图同声"，也没法解释。
- 浏览器内的极限大概到 `transformers.js` + 小型 ONNX 模型（几十 MB），MusicGen-small 仍偏大且慢，实用价值低。

---

## 5. 参考来源

- MusicGen 论文：<https://arxiv.org/abs/2306.05284>
- MusicLM 论文：<https://arxiv.org/abs/2301.11325>
- Stable Audio Open 论文：<https://arxiv.org/abs/2407.14358>
- AudioLDM 2：<https://arxiv.org/abs/2308.05734>
- Riffusion：<https://www.riffusion.com/about>
- ACE-Step：<https://github.com/ace-step/ACE-Step>
- Magenta / Magenta.js：<https://magenta.tensorflow.org/> · <https://magenta.github.io/magenta-js/music/>
- AudioCraft（MusicGen/AudioGen 官方实现）：<https://github.com/facebookresearch/audiocraft>
- stable-audio-tools：<https://github.com/Stability-AI/stable-audio-tools>