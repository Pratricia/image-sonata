/* 自检：?selftest=1 渲染全部示例并输出客观指标（峰值/RMS/NaN/WAV 头）。
   文件：src/js/selftest.js */
'use strict';

/* ---- 自检模式：?selftest=1 ---- */
async function runSelfTest() {
  const pre = document.createElement('pre');
  pre.id = 'selftest';
  pre.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;color:#7dffb0;font:11px/1.6 monospace;overflow:auto;padding:14px;white-space:pre-wrap';
  document.body.appendChild(pre);
  const out = [];
  const render = () => {
    pre.innerHTML = out.map(l => `<div style="white-space:pre-wrap">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('');
  };
  let lastBuf = null;
  const btns = Array.from(document.querySelectorAll('#samples button'));
  const limit = Math.max(1, Math.min(btns.length, Number(new URLSearchParams(location.search).get('n')) || btns.length));
  const from = Math.max(0, Math.min(btns.length - 1, Number(new URLSearchParams(location.search).get('from')) || 0));
  const short = location.search.indexOf('short') >= 0;
  if (new URLSearchParams(location.search).get('voc') === '0') vocalOn = false;
  for (const b of btns.slice(from, from + limit)) {
    b.click();
    await new Promise(r => setTimeout(r, 220));
    if (!A.spec) { out.push(b.textContent + ' :: NO SPEC'); continue; }
    const spec = A.spec, f = spec.features;
    const t0 = performance.now();
    const sc = short ? A.score.filter(e => e.t < 32) : A.score;
    const sp = short ? Object.assign({}, spec, { totalBeats: 32 }) : spec;
    const buf = await renderOffline(sp, sc, 1);
    lastBuf = buf;
    const ms = Math.round(performance.now() - t0);
    let peak = 0, sum = 0, nan = false;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        if (Number.isNaN(v)) nan = true;
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sum += v * v;
      }
    }
    const rms = Math.sqrt(sum / (buf.length * buf.numberOfChannels));
    out.push(
      b.textContent.padEnd(6, ' ') +
      ' root=' + PC_NAMES[spec.rootPc] + ' ' + spec.scaleName +
      ' bpm=' + spec.bpm + ' bars=' + spec.bars +
      ' dur=' + mmss(spec.totalBeats * 60 / spec.bpm) +
      ' style=' + spec.styleKey + '/' + spec.drumStyle + ' meter=' + spec.meterName +
      ' form=' + spec.sections.map(s => s.name + s.len).join('+') +
      ' prog=' + spec.prog.join(',') + '/' + spec.progB.join(',') +
      ' ch=' + spec.chordSize + ' arp=' + (spec.arp ? 1 : 0) +
      ' L=' + f.meanL.toFixed(2) + ' S=' + f.meanS.toFixed(2) + ' C=' + f.contrast.toFixed(2) +
      ' E=' + f.edgeDensity.toFixed(3) + ' H=' + f.entropy.toFixed(2) +
      ' sym=' + f.symmetry.toFixed(2) +
      ' ev=' + A.score.length + ' vox=' + A.score.filter(e => e.k === 'vox').length +
      ' mood=' + spec.voxMood.degree + '/' + spec.voxMood.nature + '/' + spec.voxMood.desire +
      (() => {
        /* 量"真正唱了多长"（到下一个音节的间隔），不是音节自己的 d ——
           并音只延长前一个音的 d，被并掉的音 d 不动，拿 d 统计会低估。 */
        const spb = 60 / spec.bpm;
        let orn = 0, gl = 0;
        const vd = A.score.filter(e => e.k === 'vox').flatMap(e => {
          const s = e.syl || [];
          return s.map((x, i) => {
            if (x.orn) { orn++; return -1; }
            if (x.glide) { gl++; return -1; }
            return (i < s.length - 1 ? s[i + 1].u : e.dur * spb - x.u);
          });
        }).filter(v => v > 0.001).sort((a, b) => a - b);
        if (!vd.length) return '';
        return ' sylN=' + vd.length + ' syl=' + vd[0].toFixed(2) + '/' + vd[Math.floor(vd.length / 2)].toFixed(2) + '/' + vd[vd.length - 1].toFixed(2) + 's' +
          ' orn=' + orn + ' gl=' + gl;
      })() +
      ' peak=' + peak.toFixed(3) + ' rms=' + rms.toFixed(4) +
      ' nan=' + (nan ? 1 : 0) + ' render=' + ms + 'ms'
    );
    if (location.search.indexOf('voxonly') >= 0 && !window.__voxDone &&
        (btns.indexOf(b) === (Number(new URLSearchParams(location.search).get('voxi')) || 0))) {
      window.__voxDone = 1;
      const vs = await renderOffline(sp, A.score.filter(e => e.k === 'vox'), 1);
      let vp = 0, vsum = 0;
      for (let c = 0; c < vs.numberOfChannels; c++) {
        const d = vs.getChannelData(c);
        for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > vp) vp = a; vsum += d[i] * d[i]; }
      }
      out.push('voxonly peak=' + vp.toFixed(3) + ' rms=' + Math.sqrt(vsum / (vs.length * vs.numberOfChannels)).toFixed(4));
    }
    render();
    if (location.search.indexOf('stats') >= 0) {
      const lead = A.score.filter(e => e.k === 'lead').sort((a, b) => a.t - b.t);
      const per = {};
      lead.forEach(e => { const b = Math.floor(e.t / spec.bpb); (per[b] = per[b] || []).push(e.midi); });
      out.push('lead-per-bar ' + Object.keys(per).map(b => b + ':' + per[b].length).join(' '));
      let big = 0, uni = 0, cross = 0, near = 0;
      for (let i = 1; i < lead.length; i++) {
        const d = Math.abs(lead[i].midi - lead[i - 1].midi);
        if (d > 7) big++;
        if (d === 0) uni++;
        if (Math.floor(lead[i].t / spec.bpb) !== Math.floor(lead[i - 1].t / spec.bpb)) {
          cross++;
          if (d <= 2) near++;
        }
      }
      out.push('lead n=' + lead.length + ' bigLeap=' + big + ' unison=' + uni +
        ' crossBar=' + cross + ' stepIntoBar=' + near);
      out.push('midi ' + Object.keys(per).slice(0, 6).map(b => b + ':' + per[b].join(',')).join(' | '));
    }
  }
  if (lastBuf) {
    const blob = encodeWav(lastBuf);
    const ab = await blob.arrayBuffer();
    const dv = new DataView(ab);
    const tag = s => String.fromCharCode(...[0,1,2,3].map(i => dv.getUint8(s + i)));
    const dataLen = dv.getUint32(40, true);
    out.push('WAV ' + tag(0) + '/' + tag(8) + ' fmt=' + tag(12) +
      ' bytes=' + ab.byteLength + ' data=' + dataLen +
      ' ok=' + (tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && dataLen === ab.byteLength - 44));
  }
  render();
}
