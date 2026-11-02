/* 可视化：canvas 频谱 + 播放头。依赖 player.js 的 A 状态。
   文件：src/js/viz.js */
'use strict';

/* ============================================================
   6. 可视化
   ============================================================ */
const viz = document.getElementById('viz');
const vctx = viz.getContext('2d');
function fitViz() {
  const r = viz.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  viz.width = Math.max(1, Math.round(r.width * dpr));
  viz.height = Math.max(1, Math.round(r.height * dpr));
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', fitViz);

function drawLoop() {
  const w = viz.clientWidth, h = viz.clientHeight;
  vctx.clearRect(0, 0, w, h);

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

  // 背景细网格
  vctx.strokeStyle = 'rgba(130,180,255,.055)';
  vctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = Math.round(h * i / 4) + .5;
    vctx.beginPath(); vctx.moveTo(0, y); vctx.lineTo(w, y); vctx.stroke();
  }

  const bars = 64;
  const bw = w / bars;
  const pad = 12;
  const usable = h - pad;

  const grad = vctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, 'rgba(255,255,255,.35)');

  if (A.playing && A.inst && A.inst.analyser) {
    const data = new Uint8Array(A.inst.analyser.frequencyBinCount);
    A.inst.analyser.getByteFrequencyData(data);
    vctx.fillStyle = grad;
    for (let i = 0; i < bars; i++) {
      const idx = Math.floor(Math.pow(i / bars, 1.5) * 340);
      const v = data[idx] / 255;
      const bh = 3 + v * usable * 0.92;
      vctx.globalAlpha = 0.30 + v * 0.70;
      vctx.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh);
    }
    vctx.globalAlpha = 1;
  } else {
    vctx.fillStyle = 'rgba(130,180,255,.14)';
    for (let i = 0; i < bars; i++) {
      const bh = 3 + (Math.sin(i * 0.55 + performance.now() / 1100) * 0.5 + 0.5) * 4;
      vctx.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh);
    }
  }

  // 播放头
  if (A.playing && A.ctx) {
    const spb = 60 / A.spec.bpm;
    const beat = (A.ctx.currentTime - A.t0) / spb;
    if (beat > 0) {
      const p = clamp(beat / (A.totalBeats || 1), 0, 1);
      const x = p * w;
      const g2 = vctx.createLinearGradient(x - 14, 0, x + 2, 0);
      g2.addColorStop(0, 'rgba(255,255,255,0)');
      g2.addColorStop(1, accent);
      vctx.globalAlpha = 0.5;
      vctx.fillStyle = g2;
      vctx.fillRect(x - 14, 0, 16, h);
      vctx.globalAlpha = 1;
      vctx.fillStyle = 'rgba(255,255,255,.9)';
      vctx.fillRect(x - 1, 0, 1.5, h);
    }
  }

  A.raf = requestAnimationFrame(drawLoop);
}
