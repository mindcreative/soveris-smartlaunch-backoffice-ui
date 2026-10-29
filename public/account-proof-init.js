/* Run before imports or optional requests: proof is a one-shot memory handoff. */
(function () {
  var captured = null;

  function capture(notify) {
    var pathname = location.pathname;

    try {
      pathname = pathname.split('/').map(function (segment) {
        return decodeURIComponent(segment).replace(/\//g, '%2F');
      }).join('/');
    } catch (_) {
      pathname = location.pathname;
    }

    var route = pathname.replace(/\/+$/, '').toLowerCase();
    var action = route === '/verify-email' || route === '/reset-password';
    var google = route === '/account/google/complete' || route === '/account/google/link';
    var misplacedProof = /(?:^#|&)proof(?:=|&|$)/i.test(location.hash) || /(?:^\?|&)proof(?:=|&|$)/i.test(location.search);

    if (action || google || misplacedProof) {
      captured = null;
      var match = /^#proof=([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/.exec(location.hash);

      if (action && !location.search && match) {
        captured = { kind: route === '/verify-email' ? 'verify' : 'reset', proof: match[1],
          expiresAt: Date.now() + (route === '/verify-email' ? 1800000 : 900000) };
      }

      history.replaceState(null, '', action || google ? route : location.pathname);
      match = null;
    }

    if (notify && (action || google || misplacedProof)) {
      window.dispatchEvent(new Event('account:proof-entry'));
    }
  }

  function captureNavigation() {
    // Popstate precedes hashchange and router listeners. Capture-phase handling
    // scrubs a reopened link before either can observe its fragment.
    if (location.hash || location.search) {
      capture(true);
    }
  }

  capture(false);
  window.addEventListener('popstate', captureNavigation, true);
  window.addEventListener('hashchange', captureNavigation, true);

  window.__takeAccountProof = function () {
    var result = captured;
    captured = null;

    return result;
  };

  window.addEventListener('pagehide', function () {
    captured = null;
  });
})();
