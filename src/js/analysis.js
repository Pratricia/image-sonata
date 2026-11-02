/* 图像分析：把图片画进 canvas，提取亮度/对比/饱和/边缘/纹理/对称等全局特征。依赖 util.js。
   文件：src/js/analysis.js */
'use strict';

/* ============================================================
   1. 图像分析
   ============================================================ */
function analyzeImage(img) {
  const N = 160;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, N, N);
  const data = g.getImageData(0, 0, N, N).data;

  const n = N * N;
  const L = new Float32Array(n);
  let sumL = 0, sumL2 = 0, sumS = 0, sumR = 0, sumB = 0;
  let hx = 0, hy = 0, hw = 0;
  const hueHist = new Float32Array(12);
  const hist32 = new Float32Array(32);

  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255, gg = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    L[i] = l;
    sumL += l; sumL2 += l * l; sumR += r; sumB += b;
    hist32[Math.min(31, (l * 32) | 0)]++;

    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
    const s = mx <= 0 ? 0 : d / mx;
    sumS += s;

    let h = 0;
    if (d > 1e-6) {
      if (mx === r) h = ((gg - b) / d) % 6;
      else if (mx === gg) h = (b - r) / d + 2;
      else h = (r - gg) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const w = s * s * Math.max(l, 0.06);
    hx += Math.cos(h * Math.PI / 180) * w;
    hy += Math.sin(h * Math.PI / 180) * w;
    hw += w;
    hueHist[Math.floor(h / 30) % 12] += w;
  }

  const meanL = sumL / n;
  const contrast = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));
  const meanS = sumS / n;

  // 色相圆周统计
  const res = hw > 1e-6 ? Math.hypot(hx, hy) / hw : 0;
  let hueMean = hw > 1e-6 ? Math.atan2(hy, hx) * 180 / Math.PI : 0;
  if (hueMean < 0) hueMean += 360;
  const hueDisp = clamp(1 - res, 0, 1);

  // Sobel 边缘强度
  let edgeSum = 0;
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      const gx = -L[i - N - 1] - 2 * L[i - 1] - L[i + N - 1] + L[i - N + 1] + 2 * L[i + 1] + L[i + N + 1];
      const gy = -L[i - N - 1] - 2 * L[i - N] - L[i - N + 1] + L[i + N - 1] + 2 * L[i + N] + L[i + N + 1];
      edgeSum += Math.hypot(gx, gy);
    }
  }
  const edgeDensity = clamp(edgeSum / (n * 1.55), 0, 1);

  // 直方图熵
  let H = 0;
  for (let i = 0; i < 32; i++) {
    const p = hist32[i] / n;
    if (p > 0) H -= p * Math.log2(p);
  }
  const entropy = clamp(H / 5, 0, 1);

  // 左右镜像相似度
  let symDiff = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N / 2; x++) {
      symDiff += Math.abs(L[y * N + x] - L[y * N + (N - 1 - x)]);
    }
  }
  const symmetry = clamp(1 - symDiff / (n / 2) * 2, 0, 1);

  // 亮度质心（纵向 0 顶部 → 1 底部）
  let wy = 0, wsum = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const l = L[y * N + x];
      wy += l * y; wsum += l;
    }
  }
  const centroidY = wsum > 1e-6 ? (wy / wsum) / (N - 1) : 0.5;

  // 冷暖
  const temperature = clamp(((sumR - sumB) / n + 1) / 2, 0, 1);

  // 主色板
  const bins = Array.from(hueHist, (v, i) => ({ i, v }));
  bins.sort((a, b) => b.v - a.v);
  const palette = bins.filter(b => b.v > 0).slice(0, 4).map(b => {
    const h = b.i * 30 + 15;
    return { h, css: `hsl(${h}, 72%, 56%)`, w: b.v / (hw || 1) };
  });

  return {
    N, meanL, contrast, meanS, hueMean, hueDisp,
    edgeDensity, entropy, symmetry, centroidY, temperature,
    palette, seed: hashBytes(data),
    aspect: img.naturalWidth / img.naturalHeight
  };
}
