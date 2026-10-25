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
    var publicAccount = ['/login', '/signup', '/check-email', '/verify-email', '/forgot-password', '/reset-password']
      .indexOf(pathname.replace(/\/+$/, '').toLowerCase()) !== -1;
    if (!publicAccount) {
      var session = JSON.parse(localStorage.getItem('backoffice-auth-persist') || 'null');
      var state = session && session.version === 2 && session.state;
      var token = state && state.accessToken;
      var userId = null;
      // Bounded JWT subject is a preference lookup hint, never authentication.
      if (typeof token === 'string' && token.length <= 8192 && typeof state.refreshTokenValue === 'string' && state.refreshTokenValue &&
          localStorage.getItem('backoffice_access_token') === token && localStorage.getItem('backoffice_refresh_token') === state.refreshTokenValue) {
        var segments = token.split('.');
        if (segments.length === 3 && segments.every(function (p) { return p && /^[A-Za-z0-9_-]+$/.test(p); }) && segments[1].length <= 4096) {
          var payload = JSON.parse(atob(segments[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload && typeof payload.sub === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) &&
              typeof payload.exp === 'number' && Number.isSafeInteger(payload.exp) && payload.exp > Date.now()/1000) userId = payload.sub.toLowerCase();
        }
      }
      if (userId) {
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
