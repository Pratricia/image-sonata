/* 界面：特征条、参数卡、解释卡、示例图、拖拽/粘贴/选文件、事件绑定、启动。
   文件：src/js/ui.js */
'use strict';

/* ============================================================
   8. UI
   ============================================================ */
const frame = document.getElementById('frame');
const preview = document.getElementById('preview');
const paletteEl = document.getElementById('palette');
const featEl = document.getElementById('feat');
const paramsEl = document.getElementById('params');
const whyEl = document.getElementById('why');
const fileInput = document.getElementById('file');

function setPlayLabel(playing) {
  const b = document.getElementById('play');
  b.textContent = playing ? '❚❚ 暂停' : '▶ 播放';
  b.classList.toggle('primary', !playing);
}

function bar(label, v, text) {
  return `<div class="row"><span class="label">${label}</span>
    <span class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></span>
    <span class="val">${text}</span></div>`;
}

function renderFeatures(f) {
  featEl.innerHTML =
    bar('明度', f.meanL, f.meanL.toFixed(2)) +
    bar('对比', f.contrast * 1.6, (f.contrast * 1.6).toFixed(2)) +
    bar('饱和', f.meanS, f.meanS.toFixed(2)) +
    bar('边缘', f.edgeDensity, f.edgeDensity.toFixed(2)) +
    bar('纹理', f.entropy, f.entropy.toFixed(2)) +
    bar('对称', f.symmetry, f.symmetry.toFixed(2));
}

const VOICE_CN = {
  epiano: '电钢', bell: '铃', piano: '钢琴', strings: '弦乐', warm: '暖垫',
  organ: '管风琴', choir: '人声', saw: '锯齿主音', pluck: '拨弦',
  sub: '正弦贝斯', upright: '弹拨贝斯', dist: '失真贝斯', sawbass: '锯齿贝斯'
};

function renderParams(spec, f) {
  const rootName = PC_NAMES[spec.rootPc];
  const chordName = deg => PC_NAMES[(spec.rootPc + spec.scale[deg % spec.scale.length]) % 12];
  const progNames = spec.prog.map((d, i) => (i === 0 ? '<u>' : '') + chordName(d) + (i === 0 ? '</u>' : '')).join('–');
  paramsEl.innerHTML = `
    <div class="param"><div class="k">调性</div><div class="v">${rootName} <small>${spec.scaleName}</small></div></div>
    <div class="param"><div class="k">速度</div><div class="v">${spec.bpm}<small> BPM</small></div></div>
    <div class="param"><div class="k">和声</div><div class="v" style="font-size:15px;letter-spacing:.06em;white-space:nowrap">${progNames}</div></div>
  ` + `<div class="param-note">风格 <b>${spec.styleName}</b> · 拍号 <b>${spec.meterName}</b> · ${VOICE_CN[spec.voices.lead]}／${VOICE_CN[spec.voices.pad]}／${VOICE_CN[spec.voices.bass]} · 混响 ${spec.reverbSec.toFixed(1)}s</div>`;
}

function renderWhy(spec, f) {
  const rootName = PC_NAMES[spec.rootPc];
  const items = [];
  items.push(`主色相 <em>${Math.round(f.hueMean)}°</em> → 主音 <em>${rootName}</em>`);
  // 与 deriveSpec 的调式规则保持一致
  if (f.meanS < 0.10) {
    items.push(`近黑白画面（低饱和）→ 小调，克制、留白多`);
  } else if (f.meanL > 0.45) {
    items.push(`画面偏亮（<em>${f.meanL.toFixed(2)}</em>）→ ${spec.scaleName}，明亮`);
  } else if (f.meanL > 0.32) {
    items.push(`中等明度（<em>${f.meanL.toFixed(2)}</em>）→ ${spec.scaleName}，偏叙事`);
  } else {
    items.push(`画面偏暗（<em>${f.meanL.toFixed(2)}</em>）→ ${spec.scaleName}，安静内敛`);
  }
  items.push(`边缘密度 <em>${f.edgeDensity.toFixed(2)}</em> → ${spec.bpm} BPM，节奏${spec.density > 0.55 ? '紧凑' : spec.density > 0.3 ? '适中' : '舒缓'}`);
  items.push(`风格 → <em>${spec.styleName}</em>（${spec.styleWhy}），音色 ${VOICE_CN[spec.voices.lead]} + ${VOICE_CN[spec.voices.pad]} + ${VOICE_CN[spec.voices.bass]}`);
  const meterWhy = spec.meterName === '3/4' ? '三拍子，像圆舞曲一样转起来'
    : spec.meterName === '6/8' ? '两组三连，句子有起伏感'
    : '四拍子，句尾每 4 小节一次加花' + (spec.swingOn ? '，八分音符带摆动' : '');
  items.push(`节奏 → <em>${spec.meterName}</em>，4 小节一句（起承转合），${meterWhy}`);
  const md = spec.voxMood || { degree: 'Wee', nature: 'touwaka', desire: 'wa' };
  items.push(`人声 → 唱<em>无意义音节</em>（像 Sigur Rós 的 Hopelandic、Magma 的 Kobaïan），没有词义；这一首的"想音"是 <b>${md.degree} ${md.nature} ${md.desire}</b>（${MOOD_CN[md.degree]} · ${MOOD_CN[md.nature]} · ${MOOD_CN[md.desire]}），决定唱得多投入、用哪种口型、句尾收住还是悬着；约 0.3 秒一个音节、每 2 小节换气`);
  items.push(`饱和度 <em>${f.meanS.toFixed(2)}</em> → ${spec.chordSize} 音和弦，音色${f.meanS > 0.5 ? '明亮' : '柔和'}`);
  items.push(`纹理熵 <em>${f.entropy.toFixed(2)}</em> → 混响 <em>${spec.reverbSec.toFixed(1)}s</em>，空间${f.entropy > 0.6 ? '开阔' : '干净'}`);
  items.push(`左右对称 <em>${f.symmetry.toFixed(2)}</em> → 乐句${f.symmetry > 0.8 ? '规整重复' : '自由变化'}${spec.swingOn ? '，带轻微摆动' : ''}`);
  const total = mmss(spec.totalBeats * 60 / spec.bpm);
  items.push(`曲式 → ${spec.sections.map(s => `${s.name} ${s.len} 小节`).join(' / ')}，共 ${spec.bars} 小节 ≈ <em>${total}</em>`);
  whyEl.innerHTML = items.map(t => `<div class="item"><span>${t}</span></div>`).join('');
}

function applyImage(img) {
  preview.src = img.src;
  frame.classList.add('has');
  document.getElementById('emptyHint').style.display = 'none';

  const f = analyzeImage(img);
  const spec = deriveSpec(f);
  A.spec = spec;
  A.score = buildScore(spec);

  document.documentElement.style.setProperty('--accent', `hsl(${Math.round(f.hueMean)}, 88%, 66%)`);

  paletteEl.innerHTML = f.palette.map(p =>
    `<div class="swatch" style="background:${p.css}" title="${Math.round(p.h)}°"></div>`
  ).join('');

  renderFeatures(f);
  renderParams(spec, f);
  renderWhy(spec, f);

  const wasPlaying = A.playing;
  if (wasPlaying) { stopPlayback(true); A.pausedBeat = 0; startPlayback(); }
  else {
    A.totalBeats = spec.totalBeats;
    if (nowEl) nowEl.textContent = `${spec.sections[0].name} · 点「播放」`;
    if (clockEl) clockEl.textContent = '0:00 / ' + mmss(spec.totalBeats * 60 / spec.bpm);
  }
  document.getElementById('export').disabled = false;
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { applyImage(img); setTimeout(() => URL.revokeObjectURL(url), 2000); };
  img.src = url;
}

/* ---- 示例图（程序生成，无需外部资源） ---- */
function makeSamples() {
  const defs = [
    { name: '黎明海面', draw: (g, W, H, rng) => {
        const grd = g.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, '#1b2b5c'); grd.addColorStop(0.42, '#c2567a');
        grd.addColorStop(0.55, '#ffb46b'); grd.addColorStop(0.62, '#2a3358'); grd.addColorStop(1, '#070a16');
        g.fillStyle = grd; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(255,235,190,.9)'; g.beginPath(); g.arc(W*.62, H*.55, 26, 0, 7); g.fill();
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `rgba(255,190,140,${0.03 + rng()*.06})`;
          g.fillRect(0, H*.62 + i*3, W, 1.2);
        }
      } },
    { name: '夜之城', draw: (g, W, H, rng) => {
        g.fillStyle = '#05070f'; g.fillRect(0, 0, W, H);
        const grd = g.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, 'rgba(30,60,120,.9)'); grd.addColorStop(1, 'rgba(5,7,15,1)');
        g.fillStyle = grd; g.fillRect(0, 0, W, H);
        for (let x = 0; x < W; x += 26) {
          const bh = 90 + rng() * 190;
          g.fillStyle = '#0a0f1c'; g.fillRect(x, H - bh, 20, bh);
          for (let y = H - bh + 8; y < H - 8; y += 12) {
            for (let k = 0; k < 2; k++) {
              if (rng() < 0.42) {
                g.fillStyle = rng() < .5 ? 'rgba(255,210,120,.85)' : 'rgba(120,200,255,.7)';
                g.fillRect(x + 3 + k * 8, y, 5, 6);
              }
            }
          }
        }
      } },
    { name: '森林', draw: (g, W, H, rng) => {
        const grd = g.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, '#0c2417'); grd.addColorStop(.5, '#2e6b3d'); grd.addColorStop(1, '#0a1a10');
        g.fillStyle = grd; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 26; i++) {
          const x = rng() * W, w = 6 + rng() * 22;
          g.fillStyle = `rgba(${20 + rng()*30|0},${40 + rng()*40|0},${25 + rng()*20|0},.85)`;
          g.fillRect(x, 0, w, H);
        }
        for (let i = 0; i < 300; i++) {
          g.fillStyle = `rgba(200,255,190,${rng()*.10})`;
          g.beginPath(); g.arc(rng()*W, rng()*H, rng()*14, 0, 7); g.fill();
        }
      } },
    { name: '人像', draw: (g, W, H, rng) => {
        g.fillStyle = '#2b1a1f'; g.fillRect(0, 0, W, H);
        const gl = g.createRadialGradient(W*.5, H*.42, 20, W*.5, H*.5, W*.7);
        gl.addColorStop(0, '#f0b48a'); gl.addColorStop(.45, '#b06a5a'); gl.addColorStop(1, '#22141a');
        g.fillStyle = gl; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(245,200,170,.9)';
        g.beginPath(); g.ellipse(W*.5, H*.45, W*.16, H*.26, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(30,18,22,.9)';
        g.beginPath(); g.ellipse(W*.5, H*.30, W*.20, H*.14, 0, 0, 7); g.fill();
        for (let i = 0; i < 2; i++) {
          g.fillStyle = 'rgba(40,25,25,.85)';
          g.beginPath(); g.ellipse(W*(.44 + i*.12), H*.44, 8, 5, 0, 0, 7); g.fill();
        }
      } },
    { name: '黑白', draw: (g, W, H, rng) => {
        for (let y = 0; y < H; y += 4) {
          const v = Math.pow(y / H, .8);
          g.fillStyle = `rgb(${(v*230)|0},${(v*230)|0},${(v*235)|0})`;
          g.fillRect(0, y, W, 4);
        }
        for (let i = 0; i < 90; i++) {
          g.strokeStyle = `rgba(${rng()*255|0},${rng()*255|0},${rng()*255|0},.35)`;
          g.lineWidth = rng() * 3;
          g.beginPath();
          g.moveTo(rng()*W, rng()*H);
          g.lineTo(rng()*W, rng()*H);
          g.stroke();
        }
      } },
    { name: '抽象', draw: (g, W, H, rng) => {
        g.fillStyle = '#0b0a18'; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 22; i++) {
          const h = rng() * 360;
          g.fillStyle = `hsla(${h},90%,${45 + rng()*30}%,${.35 + rng()*.5})`;
          g.beginPath();
          const cx = rng()*W, cy = rng()*H, r = 20 + rng()*110;
          g.arc(cx, cy, r, 0, 7); g.fill();
        }
      } }
  ];

  const holder = document.getElementById('samples');
  defs.forEach((def, idx) => {
    const b = document.createElement('button');
    b.textContent = def.name;
    b.onclick = () => {
      const cv = document.createElement('canvas');
      cv.width = 480; cv.height = 360;
      const g = cv.getContext('2d');
      def.draw(g, cv.width, cv.height, mulberry32(1000 + idx * 77));
      const img = new Image();
      img.onload = () => applyImage(img);
      img.src = cv.toDataURL('image/jpeg', 0.9);
    };
    holder.appendChild(b);
  });
}

/* ---- 事件绑定 ---- */
document.getElementById('play').onclick = async () => {
  if (!A.spec) { alert('先放一张照片吧'); return; }
  if (A.playing) { stopPlayback(false); }
  else { await startPlayback(); }
};
document.getElementById('vocal').onclick = e => {
  vocalOn = !vocalOn;
  e.currentTarget.textContent = vocalOn ? '人声 · 开' : '人声 · 关';
  e.currentTarget.classList.toggle('on', vocalOn);
};
document.getElementById('export').onclick = exportWav;
document.getElementById('pick').onclick = () => fileInput.click();
frame.onclick = () => fileInput.click();
fileInput.onchange = e => loadFile(e.target.files[0]);

['dragenter', 'dragover'].forEach(t => window.addEventListener(t, e => {
  e.preventDefault(); frame.classList.add('drag');
}));
['dragleave', 'drop'].forEach(t => window.addEventListener(t, e => {
  e.preventDefault(); frame.classList.remove('drag');
}));
window.addEventListener('drop', e => {
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) loadFile(f);
});
window.addEventListener('paste', e => {
  const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

/* ---- 启动 ---- */
fitViz();
makeSamples();
drawLoop();
nowEl = document.getElementById('now');
nowEl.textContent = '选择一个示例，或拖入你的照片';
clockEl = document.getElementById('clock');

// 调试/测试入口（不参与界面）
window.__SONATA__ = { analyzeImage, deriveSpec, buildScore, renderOffline, A };
