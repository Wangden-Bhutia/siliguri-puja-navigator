/* Runs in <head> before first paint so the resolved theme never flashes the wrong background on load/back.
   spn.theme: 'light' | 'dark' = manual override; missing/'auto'/anything else = follow the phone (prefers-color-scheme). */
(function () {
  var m = 'auto', t = 'light';
  try { var s = localStorage.getItem('spn.theme'); if (s === 'dark' || s === 'light') m = s; } catch (e) {}
  if (m === 'auto') { try { t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) {} }
  else t = m;
  var d = document.documentElement;
  d.setAttribute('data-theme', t);
  d.setAttribute('data-theme-mode', m);
  try { var mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.setAttribute('content', t === 'dark' ? '#24060c' : '#5a0f1e'); } catch (e) {}
})();
