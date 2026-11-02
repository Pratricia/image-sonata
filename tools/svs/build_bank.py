# -*- coding: utf-8 -*-
"""从 PJS 语料（CC BY-SA 4.0）切出一个元音音库，输出 assets/voicebank.js。

PJS: Koguchi & Takamichi, "PJS: phoneme-balanced Japanese singing voice corpus",
     CC BY-SA 4.0.  见 research/05-vocal-synthesis-options.md

做法：
  1. 读每首歌的 .lab（音素级对齐），挑出 a/i/u/e/o 的长音段；
  2. 用自相关测基频，只保留音高稳定（无强颤音）的段；
  3. 取段中间 0.9s，归一到统一响度，降到 22050Hz；
  4. 每个元音按音高挑几档，写成 base64(int16) 的 JS 文件。

运行：python tools/svs/build_bank.py
"""
import base64, json, os, sys, zipfile, io
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
PJS = os.path.join(DATA, "pjs")
OUT = os.path.abspath(os.path.join(ROOT, "..", "..", "assets", "voicebank.js"))

SR_OUT = 22050
VOWELS = ["a", "i", "u", "e", "o"]
MIN_SEG = 0.55          # 只挑这个时长的元音段
CUT = 0.90              # 每条样本取多长
PER_VOWEL = 4           # 每个元音留几档音高


def read_wav(path):
    from scipy.io import wavfile
    sr, x = wavfile.read(path)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if x.dtype == np.int16:
        x = x / 32768.0
    elif x.dtype == np.int32:
        x = x / 2147483648.0
    return sr, x.astype(np.float64)


def parse_lab(path):
    """返回 [(start_sec, end_sec, phoneme)]。兼容 HTK(100ns) 和秒两种写法。"""
    out = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            p = line.split()
            if len(p) < 3:
                continue
            try:
                a, b = float(p[0]), float(p[1])
            except ValueError:
                continue
            out.append((a, b, p[2]))
    if out and max(o[1] for o in out) > 1e5:   # HTK 100ns 单位
        out = [(a / 1e7, b / 1e7, ph) for a, b, ph in out]
    return out


def f0_track(x, sr, fmin=70.0, fmax=800.0, frame=0.040, hop=0.010):
    n = int(frame * sr)
    h = int(hop * sr)
    res = []
    lo, hi = int(sr / fmax), int(sr / fmin)
    for s in range(0, len(x) - n, h):
        seg = x[s:s + n]
        seg = seg - seg.mean()
        e = np.dot(seg, seg)
        if e < 1e-4:
            res.append(0.0)
            continue
        ac = np.correlate(seg, seg, mode="full")[n - 1:]
        ac = ac / (ac[0] + 1e-12)
        hi2 = min(hi, len(ac) - 1)
        if hi2 <= lo:
            res.append(0.0)
            continue
        lag = lo + int(np.argmax(ac[lo:hi2]))
        if ac[lag] < 0.35:              # 不像周期信号（辅音/静音）
            res.append(0.0)
            continue
        # 抛物线插值，精确一点
        if 0 < lag < len(ac) - 1:
            a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
            d = (a - c) / (2 * (a - 2 * b + c) + 1e-12)
            lag = lag + d
        res.append(sr / lag)
    return np.array(res)


def rms(x):
    return float(np.sqrt(np.mean(x ** 2) + 1e-12))


def main():
    if not os.path.isdir(PJS):
        zpath = os.path.join(DATA, "pjs.zip")
        if not os.path.exists(zpath):
            sys.exit("找不到 %s，先下载 PJS 语料" % zpath)
        print("解压", zpath)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(PJS)

    cands = {v: [] for v in VOWELS}
    songs = []
    for dirpath, _, files in os.walk(PJS):
        for f in files:
            if f.endswith("_song.wav"):
                songs.append(os.path.join(dirpath, f))
    songs.sort()
    print("歌曲数", len(songs))
    for wav in songs:
        base = wav[:-len("_song.wav")]
        lab = base + ".lab"
        if not os.path.exists(lab):
            continue
        stem = os.path.basename(base)
        try:
            sr, x = read_wav(wav)
        except Exception as e:
            print("跳过", wav, e)
            continue
        labels = parse_lab(lab)
        for (a, b, ph) in labels:
            ph2 = ph.strip().lower()
            if ph2 not in VOWELS:
                continue
            if (b - a) < MIN_SEG:
                continue
            s, e = int(a * sr), int(b * sr)
            if e <= s + 100:
                continue
            seg = x[s:e]
            ft = f0_track(seg, sr)
            voiced = ft[ft > 0]
            if len(voiced) < 8:
                continue
            med = float(np.median(voiced))
            # 只用中间 60% 判断稳定度（头尾可能带滑音）
            n = len(ft)
            mid = ft[int(n * 0.2):int(n * 0.8)]
            mid = mid[mid > 0]
            if len(mid) < 5:
                continue
            cv = float(np.std(mid) / (np.mean(mid) + 1e-9))
            if cv > 0.020:             # 颤音/滑音太重，不要
                continue
            # 取中间 CUT 秒
            need = int(CUT * sr)
            if len(seg) < need:
                need = len(seg)
            c0 = (len(seg) - need) // 2
            piece = seg[c0:c0 + need]
            cands[ph2].append({"sr": sr, "x": piece, "f0": med, "cv": cv, "src": stem})

    print("候选数:", {v: len(cands[v]) for v in VOWELS})

    notes = []
    for v in VOWELS:
        lst = cands[v]
        if not lst:
            print("!! %s 没有可用样本" % v)
            continue
        lst.sort(key=lambda d: d["f0"])
        # 按音高排序后均匀取 PER_VOWEL 档，同一档里挑 cv 最小的
        picks = []
        for i in range(PER_VOWEL):
            lo = int(i * len(lst) / PER_VOWEL)
            hi = max(lo + 1, int((i + 1) * len(lst) / PER_VOWEL))
            chunk = lst[lo:hi]
            if not chunk:
                continue
            best = min(chunk, key=lambda d: d["cv"])
            # 和上一档太近（<1 半音）就跳过
            if picks and abs(12 * np.log2(best["f0"] / picks[-1]["f0"])) < 1.0:
                continue
            picks.append(best)
        for c in picks:
            from scipy.signal import resample_poly
            up, down = SR_OUT, c["sr"]
            g = np.gcd(up, down)
            y = resample_poly(c["x"], up // g, down // g)
            y = y - y.mean()
            # 两端 15ms 淡入淡出（切点不一定在过零）
            f = int(0.015 * SR_OUT)
            y[:f] *= np.linspace(0, 1, f)
            y[-f:] *= np.linspace(1, 0, f)
            # 归一到 -18 dBFS RMS
            y = y * (0.1256 / max(1e-6, rms(y)))
            peak = float(np.max(np.abs(y)))
            if peak > 0.99:
                y = y * (0.99 / peak)
            pcm = (np.clip(y, -1, 1) * 32767).astype(np.int16)
            midi = int(round(69 + 12 * np.log2(c["f0"] / 440.0)))
            notes.append({
                "v": v,
                "midi": midi,
                "f0": round(float(c["f0"]), 2),
                "cv": round(float(c["cv"]), 4),
                "src": c["src"],
                "pcm": base64.b64encode(pcm.tobytes()).decode("ascii"),
            })
            print("  %s midi=%d f0=%.1f cv=%.3f %s" % (v, midi, c["f0"], c["cv"], c["src"]))

    bank = {
        "sr": SR_OUT,
        "license": "PJS corpus (Koguchi & Takamichi, 2020), CC BY-SA 4.0",
        "url": "https://sites.google.com/site/shinnosuketakamichi/research-topics/pjs_corpus",
        "notes": notes,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* 自动生成，勿手改。来源：PJS 语料（CC BY-SA 4.0）\n")
        f.write("   https://sites.google.com/site/shinnosuketakamichi/research-topics/pjs_corpus\n")
        f.write("   修改音库请跑 tools/svs/build_bank.py */\n")
        f.write("window.VOX_BANK = ")
        json.dump(bank, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("写出", OUT, "%.2f MB" % (os.path.getsize(OUT) / 1048576.0), "样本", len(notes))


if __name__ == "__main__":
    main()