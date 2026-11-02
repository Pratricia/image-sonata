/* 离线渲染与 WAV 编码/导出。依赖 audio.js。
   文件：src/js/export.js */
'use strict';

/* ============================================================
   7. 导出 WAV
   ============================================================ */
function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const bytes = 44 + len * ch * 2;
  const ab = new ArrayBuffer(bytes);
  const dv = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * ch * 2, true); dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, len * ch * 2, true);

  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = clamp(chans[c][i], -1, 1);
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

async function renderOffline(spec, score, loops) {
  const spb = 60 / spec.bpm;
  const dur = spec.totalBeats * spb * (loops || 1) + 4.5;
  const rate = 44100;
  const off = new OfflineAudioContext(2, Math.ceil(dur * rate), rate);
  const inst = buildGraph(off, spec, false);
  for (let L = 0; L < (loops || 1); L++) {
    for (const e of score) playEvent(off, inst, e, (L * spec.totalBeats + e.t) * spb + 0.05, spb);
  }
  return off.startRendering();
}

async function exportWav() {
  if (!A.spec) return;
  const btn = document.getElementById('export');
  btn.disabled = true;
  btn.textContent = '渲染中…';
  try {
    const buf = await renderOffline(A.spec, A.score, 1);
    const blob = encodeWav(buf);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'image-sonata-' + A.spec.seed.toString(16) + '.wav';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    btn.textContent = '已导出 ✓';
    setTimeout(() => { btn.textContent = '导出 WAV'; }, 2600);
  } catch (err) {
    console.error(err);
    alert('渲染失败：' + err.message);
    btn.textContent = '导出 WAV';
  }
  btn.disabled = false;
}
