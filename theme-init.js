/* Runs in <head> before first paint so a saved night theme never flashes the light background on load/back. */
(function () {
  try {
    var t = localStorage.getItem('spn.theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
