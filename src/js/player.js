/* 播放调度：lookahead 调度器、播放/暂停/续播/停止、进度与时钟。依赖 audio.js。
   文件：src/js/player.js */
'use strict';

/* ============================================================
   5. 播放调度
   ============================================================ */
const A = {
  ctx: null, inst: null, score: null, spec: null, totalBeats: 0,
  playing: false, t0: 0, lastBeat: 0, timer: null, raf: 0
};

function mmss(sec) {
  const s = Math.max(0, Math.round(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function stopPlayback(close) {
  A.playing = false;
  clearInterval(A.timer);
  cancelAnimationFrame(A.raf);
  if (A.ctx && A.spec) {
    A.pausedBeat = Math.max(0, (A.ctx.currentTime - A.t0) / (60 / A.spec.bpm));
    if (close) { A.ctx.close(); A.ctx = null; }
    else A.ctx.suspend();
  }
  setPlayLabel(false);
}

// 整首放完：停住，等用户再点播放
function finishPlayback() {
  A.playing = false;
  A.pausedBeat = 0;
  clearInterval(A.timer);
  if (A.ctx) A.ctx.suspend();
  setPlayLabel(false);
  if (nowEl) nowEl.innerHTML = '已结束 · 点「播放」从头再来';
  if (clockEl) clockEl.textContent = mmss(A.totalBeats * 60 / A.spec.bpm) + ' / ' + mmss(A.totalBeats * 60 / A.spec.bpm);
}

async function startPlayback() {
  if (!A.spec) return;
  if (!A.ctx) {
    A.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  await A.ctx.resume();
  if (A.inst) {
    try { A.inst.master.disconnect(); } catch (e) {}
    if (A.inst.stopLoop) A.inst.stopLoop();
  }
  A.inst = buildGraph(A.ctx, A.spec, true);

  const spb = 60 / A.spec.bpm;
  A.totalBeats = A.spec.totalBeats;
  const from = Math.min(A.pausedBeat || 0, A.totalBeats - 0.5);
  A.pausedBeat = 0;
  A.t0 = A.ctx.currentTime + 0.12 - from * spb;
  A.lastBeat = from;
  A.playing = true;
  setPlayLabel(true);
  clearInterval(A.timer);
  A.timer = setInterval(tick, 25);
  tick();
  drawLoop();
}

function tick() {
  if (!A.playing || !A.ctx) return;
  const spb = 60 / A.spec.bpm;
  const now = (A.ctx.currentTime - A.t0) / spb;
  if (now < 0) return;

  if (now > A.totalBeats + 1.4) { finishPlayback(); return; }

  let from = A.lastBeat;
  let to = Math.min(now + 0.55, A.totalBeats + 0.02);
  // 后台切回来时不要补发一堆音符：直接跳到下一小节
  const barBeats = A.spec.bpb || BPB;
  if (to - from > barBeats * 2) {
    from = Math.ceil(now / barBeats) * barBeats;
  }
  if (from < now - 0.05) from = now;

  if (from < to) {
    for (const e of A.score) {
      if (e.t >= from && e.t < to) {
        playEvent(A.ctx, A.inst, e, A.t0 + e.t * spb, spb);
      }
    }
  }
  A.lastBeat = to;
  updateNow(now);
}

let nowEl, clockEl, ui = {};
function updateNow(beat) {
  const b = clamp(Math.floor(beat / (A.spec.bpb || BPB)), 0, A.spec.bars - 1);
  const sec = A.spec.sections.find(s => b >= s.start && b < s.start + s.len) || A.spec.sections[0];
  const deg = A.spec.barDeg[b];
  const rootName = PC_NAMES[(A.spec.rootPc + A.spec.scale[deg % A.spec.scale.length]) % 12];
  const quality = A.spec.chordSize >= 4 ? '7' : '';
  if (nowEl) nowEl.innerHTML = `第 <b>${b + 1}</b>/${A.spec.bars} 小节 · ${sec.name} · <b>${rootName}${quality}</b>`;
  if (clockEl) clockEl.textContent = mmss(Math.min(beat, A.totalBeats) * 60 / A.spec.bpm) + ' / ' + mmss(A.totalBeats * 60 / A.spec.bpm);
}
