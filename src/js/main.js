/* 入口装配：按 URL 参数触发自检或布局调试徽标。
   文件：src/js/main.js */
'use strict';

if (location.search.indexOf('selftest') >= 0) {
  setTimeout(runSelfTest, 300);
}

/* ---- 布局调试：?debug=1 ---- */
if (location.search.indexOf('debug') >= 0) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:99999;font:11px/1.4 monospace;color:#6f6;background:#000d;padding:4px 7px;border-radius:5px';
  const upd = () => {
    const main = document.querySelector('main');
    const rc = document.querySelector('.col.right');
    const sp = A.spec ? `${A.spec.bars}bar/${A.spec.totalBeats}bt/ev${A.score ? A.score.length : 0}/mood:${A.spec.voxMood.degree}.${A.spec.voxMood.nature}.${A.spec.voxMood.desire}` : 'nospec';
    d.textContent = `vw ${innerWidth}x${innerHeight} @${devicePixelRatio} | main ${main.clientHeight} | colR ${rc.clientHeight}/${rc.scrollHeight} | ${sp} | P${document.getElementById('params').textContent.length} W${document.getElementById('why').textContent.length}`;
  };
  upd(); setInterval(upd, 400);
  document.body.appendChild(d);
  window.addEventListener('error', e => { d.style.color = '#f66'; d.textContent = 'ERR ' + e.message + ' @' + e.lineno; });
  window.addEventListener('unhandledrejection', e => {
    d.style.color = '#f66';
    d.textContent = 'REJ ' + ((e.reason && (e.reason.message || e.reason)) || 'unknown');
  });
}
