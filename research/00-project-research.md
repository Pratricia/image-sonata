# 图片 → 音乐：先行研究记录

> 目的：在动手前摸清「图像特征 → 音乐参数 → 程序化生成」这条路上已有的工作，
> 记录它们的技术方法与实际听感，避免做出一个劣化版。
> 调研时间：2026-10-30

---

## 0. 结论先行

公开可查的方案分四类，各自的天花板很不一样：

| 类别 | 代表 | 确定性 | 音乐性 | 差异化程度 |
| --- | --- | --- | --- | --- |
| A. AI 语义生成（图 → 文字 → 音乐） | ImageToMusicAI、HF Space、Melfusion | ✗ 每次不同 | ★★★★ | ★★ 容易塌缩成通用 BGM |
| B. 像素声化（图 = 频谱） | Photosounder、Virtual ANS | ✓ 完全确定 | ★ 音景/噪音 | ★★★★★ 每张图天差地别 |
| C. 参数化音乐生成（图 → 乐理参数 → 作曲） | **几乎没人做成可用产品** | ✓ 可确定 | ★★★★ | ★★★★ |
| D. 艺术装置（人工策展 + ML） | Play a Kandinsky | 半确定 | ★★★★★ | ★★★ |

**空白点**：把「确定性映射」用在**乐理宏观参数**（调式、和声进行、节奏型、曲式）而不是逐像素音高上的公开项目，基本没有。这正是我们要占的位置。
下面分别记录，重点在第 2 节的映射方法论——那是可以直接抄的作业。

---

## 1. A 类：AI 语义生成

### 1.1 通用流水线
```
图片 → BLIP-2 描述 / CLIP 嵌入 → 文本提示 → MusicGen / Suno 类模型 → 10~30s 音频
```

| 项目 | 方法 | 实际效果 / 问题 |
| --- | --- | --- |
| [Image to Music v2（HF Space, fffiloni）](https://huggingface.co/spaces/fffiloni/image-to-music-v2) | 同上，免费 | 能用，但同一张图每次结果不同；免费 Space 常挂 |
| [ImageToMusicAI](https://imagetomusicai.com) | 商业版，图 + 文本双输入 | 出片可用，但风格偏"电影感 BGM" |
| **Melfusion**（CVPR 2024，*Synthesizing Music from Image and Language Cues using Diffusion Models*） | 图像 + 语言双条件，扩散模型直接生成 | 学术 SOTA，图-音一致性最好；需 GPU |
| [Image2Music（arXiv 2509.22378）](https://arxiv.org/abs/2509.22378) · [代码](https://github.com/RS2002/Image2Music) | VLM 理解图像 → **RAG 检索符号音乐库** → 评估器迭代精修 | 可解释性好（注意力热图）；**本质含检索环节**，不完全满足"非预存"要求 |
| [Images that Sound（arXiv 2405.12221）](https://arxiv.org/abs/2405.12221) | 把图像与频谱放进同一扩散隐空间联合生成 | 视觉上极惊艳；声音偏实验 |

**关键结论**：
1. 这条路的"图片信息"被压缩成一句 caption，信息量损失极大 → 不同图片容易生成相似音乐。**这正是用户不想要的。**
2. 生成模型是随机采样，**同一张图不可复现**。
3. 想离线跑：MusicGen-small ≈ 2GB 权重 + PyTorch，首次加载几十秒，CPU 生成 10s 音频要 1~2 分钟。

> 结论：AI 路线不是我们要走的，但它的"音乐性"是我们的及格线。

---

## 2. B 类：像素声化 —— 最值得抄的是"映射方法论"

### 2.1 工具

| 工具 | 原理 | 听感 |
| --- | --- | --- |
| [Photosounder](https://photosounder.com) | 图像 = 频谱图；横轴时间、纵轴频率、亮度能量；噪声合成 | 照片 → 嗡鸣、金属、风声；抽象音景，不像"歌" |
| [Virtual ANS](http://warmplace.ru/soft/ans) | 苏联 ANS 合成器模拟，每个像素 = 一个正弦振荡器 | 微音阶、深邃氛围，塔可夫斯基电影音色 |
| MetaSynth / Coagula / AudioSculpt | 同类，图形化频谱编辑 | 同上，偏声音设计 |

**共同缺陷**：没有任何"乐理"。像素落在哪个频率就是哪个频率，不量化到音阶、不构成和声，所以出不来"曲子"。

### 2.2 [Hearing Images](https://maryganey.github.io/ImageToSound)（DSP 教学项目，最接近我们的思路）

一个学生的 DSP 期末项目，但映射设计得非常干净，且**明确声明"无随机、无 ML、同图同声"**：

| 视觉特征 | 声学参数 |
| --- | --- |
| 亮度 | 振幅 |
| 色相（RGB 主通道） | 奇/偶谐波：红→奇次，蓝→偶次，绿→两者 |
| 饱和度 | 谐波数量（灰阶 1 个 → 全饱和 8 个） |
| 行位置 | 频率，200Hz ~ 2000Hz 对数分布 |
| 列位置 | 时间 |
| 量化级数 | 振幅精度（lo-fi / 平滑） |

**可借鉴**：色相→谐波结构、饱和度→音色丰富度、行列→时间频率。**要改进**：它仍是逐像素扫描，出不来节奏与和声。

---

## 3. C 类：参数映射的实证依据（重点）

### 3.1 大规模综述：大家都在映射什么

**Dubus & Bresin (2013), *A Systematic Review of Mapping Strategies for the Sonification of Physical Quantities*, PLOS ONE** — 统计了 60 个声化项目：

| 听觉维度 | 被使用比例 |
| --- | --- |
| 音高 Pitch | 86.7% |
| 响度 Loudness | 73.3% |
| 空间位置 Spatialization | 51.7% |
| 时值 Duration | 40.0% |
| 音色亮度 Brightness | 23.3% |
| 音色 Timbre | 20.0% |
| 速度 Tempo | 16.7% |

**含义**：音高/响度是"默认通道"，但**速度和音色几乎没人用**——而这两个恰恰是决定"像不像音乐"的关键。我们优先用它们。

### 3.2 视听通感的实证配对（可直接用于映射表）

**Audio Mostly 2025, *Two Empirical Studies on Audiovisual Semiotics of Uncertainty*** 给出的匹配准确率：

| 配对 | 准确率 |
| --- | --- |
| 响度 ↔ 饱和度 | 85.3% |
| 响度 ↔ 尺寸 | 85.3% |
| 音高 ↔ 亮度 | 84.8% |
| 音高 ↔ 饱和度 | 82.5% |
| 速度 ↔ 尺寸 | 78.8% |
| 速度 ↔ 亮度 | 75.1% |

**含义**：亮度→音高、饱和度→响度/音色是被反复验证的直觉配对；**速度与画面的配对最弱**，所以速度不能直接由亮度决定，更适合由"边缘密度/结构复杂度"这种运动感特征驱动。

### 3.3 高分辨率映射案例

**Quinn Ison (2010), *Auditory Presentation of Images for the Blind***：
- 颜色 → 9 种乐器
- 亮度 → 50 个音高
- 位置 → 声像 panning
- 合计 **57,600 个可区分事件**

**EdgeSonic (CMU, 2011), *Image Feature Sonification for the Visually Impaired***：
- Canny 边缘检测 → 距离变换 → 距离映射为脉冲频率（越靠近边缘，脉冲越密）

**NASA/Chandra 声化系列（SYSTEM Sounds, 2020-2024）**：
- 扫描方向决定时间（左→右 / 顺时针）
- 亮度 → 音量
- 距中心距离 → 音高
- 波段（X 射线 / 红外 / 可见光）→ 不同乐器
- 结果是一条"跟着扫描线走"的旋律，非常好听——**因为它有旋律线、有配器、有段落**。

**这三者给我们的启示**：
1. **扫描线 = 旋律线**，是最自然的"图像→时间"映射；
2. **分轨配器**（不同颜色/波段→不同乐器）能立刻提升"音乐感"；
3. 分辨率要高到能区分细节，但**必须量化到音阶**，否则只是噪音。

### 3.4 艺术装置：Google《Play a Kandinsky》(2021, Centre Pompidou)

- 方法：用 Google Magenta 的 **Music Transformer** 在康定斯基的音乐档案上生成，再由声音艺术家 **Antoine Bertin / NSDOS** 手工"code DJ"式挑选、拼贴
- 映射依据：康定斯基自己写的**颜色-乐器-情绪**对应表（黄=小号、红=小提琴、蓝=管风琴…）
- 效果：公认好听、有说服力
- **关键教训**：好听的部分不是模型给的，是**人给的**——乐理约束 + 配器 + 混音。
  所以我们的引擎必须内置**和声进行、voice leading、混音总线**，不能只做参数映射。

---

## 4. D 类：工程实现参考（避免踩坑）

| 项目 | 可借鉴点 |
| --- | --- |
| [kentog751/procedural-audio](https://github.com/kentog751/procedural-audio) | **前瞻调度器**（lookahead scheduler）对 `ctx.currentTime` 排程，不用 rAF；后台标签页回来后"跳到下一小节"而不是补发所有音符（否则机关枪）；声部预算 + 回收；事件闪避（ducking） |
| [liminal-hq/undertone](https://github.com/liminal-hq/undertone) | 模式化（pattern）作曲抽象；共享 reverb/delay 总线而非每声部一个 |
| [Tone.js](https://github.com/Tonejs/Tone.js) | Transport / 合成器 / 效果器参考；但我们坚持零依赖 |
| [Pixel Forge](https://github.com/CircusEarth/pixel-forge) / [Loopsmith](https://announcerua.itch.io/loopsmith-music-generator) | 浏览器内程序化 chiptune：随机调性 + 和弦进行 + 旋律级进 + 贝斯跟根音 + 琶音 —— **证明了纯 Web Audio 能做出"像歌"的东西**；Loopsmith 还做了**种子可复现** |

**要点**：真正的难点不是"映射"，是**让映射出来的参数变成一首能听 30 秒不腻的曲子**。这需要：
- 乐句结构（4/8 小节，AABA 或 verse-chorus）
- 和弦进行的张力曲线
- 旋律的级进 + 偶尔跳进 + 落回和弦音
- 鼓组的稳定脉冲
- 混音（压缩、混响、声像、侧链）

---

## 5. 现有方案的空白 = 我们的差异化

| 维度 | Photosounder | AI 生成 | **我们** |
| --- | --- | --- | --- |
| 同图同声 | ✓ | ✗ | ✓（图像哈希作种子） |
| 不同图差异大 | ✓✓✓ | ✗ | ✓✓✓ |
| 像"歌" | ✗ | ✓✓✓ | ✓✓✓ |
| 离线 / 零依赖 | ✓（桌面软件） | ✗ | ✓（单页 HTML） |
| 即时 | ✓ | ✗（10s~2min） | ✓（<100ms 出谱，边算边播） |
| 可解释 | ✓ | ✗ | ✓（界面显示"因为…所以…"） |
| 可导出 | ✓ | ✓ | ✓（OfflineAudioContext 渲染 WAV） |

**一句话定位**：*「把照片翻译成一首确定性的、能听的曲子，并且告诉你它为什么这么写。」*

---

## 6. 初步映射表（草案，待实现时细化）

> 原则：**宏观参数由图像整体统计量决定，微观旋律由局部结构决定**。
> 逐像素只用来生成"动机"，绝不直接决定音高。

### 6.1 全局特征 → 乐理

| 图像特征 | 提取方式 | 音乐参数 | 依据 |
| --- | --- | --- | --- |
| 主色相（圆形均值） | 色相直方图 + 圆周统计 | 主音（12 个调之一） | 通感配对 / 康定斯基色-音表 |
| 明度均值 | 亮度直方图均值 | 调式：亮→大调/Ionian，暗→小调/Aeolian | 亮度-音高/正负情绪 |
| 色相离散度（圆周方差） | 色相集中度 | 音阶复杂度：集中→五声，分散→Dorian/和声小调 | 视觉统一 ↔ 听觉统一 |
| 饱和度均值 | HSV 的 S 均值 | 音色明亮度（低通截止）、和声张力（加 7/9 音） | 饱和度 ↔ 响度/音色（85%） |
| 明度对比度（std） | 亮度标准差 | 力度动态范围、段落强弱差 | 对比 ↔ 动态 |
| **边缘密度** | Sobel / Canny 后取密度 | **BPM + 节奏密度**（16 分 vs 8 分） | 复杂度 ↔ 运动感 |
| 纹理熵 | 亮度直方图熵 | 混响空间、噪声层厚度 | 粗糙 ↔ 空间 |
| 对称性 / 自相似 | 左右翻转差、块匹配 | 乐句重复度、loop 长度（4/8 小节） | 对称 ↔ 重复 |
| 构图重心 | 亮度加权质心 | 声像（pan）、旋律整体走向（上行/下行） | 位置 ↔ 音高/空间 |
| 宽高比 | w/h | 曲式长度、拍号（4/4 vs 3/4） | 形式感 |
| 色彩温度（R−B） | 通道差 | 谐波奇偶（暖→奇次/模拟感，冷→偶次/数字感） | 音色冷暖 |

### 6.2 局部特征 → 动机

| 图像局部 | 音乐事件 |
| --- | --- |
| 显著色块（k-means 聚类） | 和弦根音进行（每个色块一个和弦级数） |
| 边缘走向（梯度方向直方图） | 旋律轮廓（上行/下行/锯齿） |
| 高光点（局部极大值） | 重音位置（强拍打击） |
| 暗部区域 | 低音持续音 / pad |

### 6.3 生成流程

```
图片
 ├─ 解码到 256×256，提取全局统计量（→ 种子 + 宏观参数）
 ├─ Sobel 边缘图（→ BPM、节奏型）
 ├─ 颜色聚类 3~5 个（→ 和弦进行）
 └─ 亮度梯度图（→ 旋律轮廓）
        ↓
   乐理层：定调 → 和弦进行 → 曲式（AABA / 8 小节 loop）
        ↓
   编曲层：鼓 + 贝斯 + 和弦 pad + 主旋律 + 琶音
        ↓
   调度层：lookahead scheduler（对 AudioContext 时钟）
        ↓
   Web Audio 合成（振荡器 + 滤波 + 包络 + 混响/延迟总线 + 压缩）
        ↓
   可视化：频谱 + 当前映射参数高亮
```

### 6.4 验收标准（防止"劣化版"）

1. **确定性**：同图两次渲染，WAV 逐采样一致（用固定种子 + OfflineAudioContext）
2. **可区分**：10 张风格迥异的图（海景/夜景/人像/森林/城市/纯色/黑白）→ 调性、BPM、配器至少 3 个维度不同
3. **像歌**：盲听 30s 内能听出"有节奏、有和声、有段落"，不刺耳
4. **可解释**：鼠标悬停每个参数能看到"你的图 X=0.72 → BPM=128"

---

## 7. 参考链接

- 声化综述：https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0082491
- 视听配对实证（2025）：https://dl.acm.org/doi/10.1145/3771594.3771604
- 图像声化分类讲义：https://www.mat.ucsb.edu/~g.legrady/academic/courses/25f200a/f/ruoxidu.pdf
- EdgeSonic：https://www.cs.cmu.edu/~kkitani/pdf/YKKBS-AH11.pdf
- Quinn Ison 2010：https://interactive-sonification.org/files/Quinn_ISon2010.pdf
- NASA/Chandra 声化：https://chandra.cfa.harvard.edu/photo/2024/sonify9/
- Hearing Images：https://maryganey.github.io/ImageToSound
- Photosounder：https://photosounder.com
- Virtual ANS：http://warmplace.ru/soft/ans
- Play a Kandinsky：https://artsandculture.google.com/experiment/play-a-kandinsky/sgF5ivv105ukhA
- Image2Music 论文：https://arxiv.org/abs/2509.22378
- Images that Sound：https://arxiv.org/abs/2405.12221
- MusicGen：https://huggingface.co/docs/transformers/model_doc/musicgen
- 程序化音频工程实践：https://github.com/kentog751/procedural-audio

---

## 8. 人声：无意义音节演唱

### 8.1 先例（都不是"某种外语"，而是没有语义的演唱语言）

| 名称 | 出处 | 关键点 |
|---|---|---|
| Hopelandic / Vonlenska | Sigur Rós《( )》整张专辑 | 没有词汇、语法、词义；乐队称它是"贴合音乐、像另一件乐器的胡话" |
| Kobaïan | Magma（Christian Vander） | 明确为"唱"而造，不用于日常交谈 |
| 自创语 / idioglossia | Lisa Gerrard（Dead Can Dance、《角斗士》） | 她称之为 "the language of the Heart"，拒绝翻译 |
| 相关传统 | scat singing、puirt à beul、glossolalia | 音节优先于语义 |

### 8.2 真实歌唱的统计（用来确定音节长度与换气）

| 指标 | 数值 | 来源 |
|---|---|---|
| 演唱音符时长中位数 | 0.62 s（均值 0.69 s） | Dai & Dixon 2019，4 万余个音符 |
| 短于 1 秒的音符占比 | 89.5% | 同上 |
| 音符起音 / 收尾瞬态 | 占时长的 15–20% / 10–20% | 同上 |
| 唱音节平均间隔（IOI） | ≈0.33 s（约 3 音节/秒） | SPR 2006，熟悉歌曲演唱 |
| 专业歌手一句平均时长 | 5.2 s（男 4.9 / 女 5.4） | NATS 呼吸管理研究 |
| 换气停顿 | 200–300 ms | 同上 |
| 颤音 | 5–7 Hz，±25–40 音分 | 声乐声学文献 |

结论：**一个音拖 2–3 秒是不成立的**。旋律音必须被切成一串 0.2–0.4 秒的音节，并且每 2–4 小节要换气。

### 8.3 实现要点

- **共振峰波表**：5 个元音（a/o/e/i/u）的 F1/F2/F3 不是用滤波器组做的，而是直接算进谐波幅度，用 `createPeriodicWave` 生成"元音波形"，一个振荡器就能唱。
  - 为什么不用三路并联 bandpass：每个音节要 6 个 biquad，200 多个音节会把离线渲染拖垮。实测同一条 1:42 的曲子（同一台机器）：关闭人声 36.1 s，用滤波器组人声 180.8 s，换成波表 54.7 s。
- **起音**：频率从 −1.4%（约 24 音分）滑到目标音高，模拟"找音高"。
- **颤音**：`detune` 的单位是音分（早期 bug：把 Hz 当音分用，颤音只有 ±2.6 音分）；短音节只给 ±10，长音 ±32，延迟进入。
- **歌手共振峰**：在 2.9 kHz 附近给谐波额外加权 —— 人声能否从伴奏里"钻出来"主要靠这一段。
- **气声**：只加在 ≥0.32 s 的音节上，短音节加噪声反而脏。
- **辅音**：`l/n/m` 低通噪声、`d` 带通爆破、`h` 高通气声；同一旋律音内的后续音节只用柔和的 `l/n/m`，避免机关枪感。
- **音节切分**：按 0.33 s 目标间隔把每个旋律音切成 1–5 个音节，音节占槽位 80%（留 20% 断句）。
- **换气**：每 2 小节句尾砍掉最后一个音节，留约 0.3 s 气口。
- **和声**：A′ 后半加低三度、A″ 加高三度，形成合唱感。
- **混音**：人声居中；pad 偏左 −0.28、arp 偏右 +0.32，把中间让出来；有人声时主奏降到 55%、arp 降到 85%。
- **电平目标**：人声独奏 RMS 约为整混音的 −3.5 ~ −5 dB（实测 0.068–0.077 vs 0.10–0.14）。
- **防削波**：总线末端加软限幅（0.72 以上开始压，渐近 0.98），实测最热的一首峰值 0.852。
- 界面提供「人声 · 开 / 关」，导出 WAV 也会按当前开关渲染。
