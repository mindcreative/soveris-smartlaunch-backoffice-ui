/* Blocking, before styles/app: controlled values only. Contract tested against runtime. */
(function () {
  var preference = 'system';
  try {
    // Presentation hint only: reuse existing persisted session identity, never
    // create a last-user pointer or copy tokens into appearance storage.
    // Runtime auth remains authoritative; login must ignore every saved choice.
    // Match the router's per-segment decoding, keeping encoded slashes inside
    // their segment. Malformed paths keep their raw value, as the router does.
    var pathname = location.pathname;
    try { pathname = pathname.split('/').map(function (segment) { return decodeURIComponent(segment).replace(/\//g, '%2F'); }).join('/'); } catch (_) {}
    if (pathname.replace(/\/+$/, '').toLowerCase() !== '/login') {
      var session = JSON.parse(localStorage.getItem('backoffice-auth-persist') || 'null');
      var state = session && session.version === 0 && session.state;
      var userId = state && state.user && state.user.id;
      if (typeof userId === 'string' && userId && typeof state.accessToken === 'string' && state.accessToken) {
        var stored = localStorage.getItem('soveris-smartlaunch-appearance:user:' + encodeURIComponent(userId));
        if (stored === 'light' || stored === 'dark') preference = stored;
      }
    }
  } catch (_) { /* System remains usable when storage is unavailable. */ }
  var dark = false;
  try { dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (_) {}
  var mode = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
})();
