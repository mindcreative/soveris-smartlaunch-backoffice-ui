(function () {
  'use strict';
  var configuration = window.__accountChallenge;
  delete window.__accountChallenge;
  var parentOrigin = configuration && configuration.parentOrigin;
  var nonce = null;
  var widget = null;
  var terminal = false;
  var disposed = false;
  var maximumTokenCharacters = 2048;
  var prefix = 'account-challenge:';
  var status = document.getElementById('status');

  function send(type, token) {
    if (!nonce || disposed || terminal || parent === window) {
      return;
    }

    var message = { type: prefix + type, nonce: nonce };

    if (type === 'success') {
      if (typeof token !== 'string' || token.length === 0 || token.length > maximumTokenCharacters) {
        return;
      }

      message.token = token;
    }

    if (type !== 'ready') {
      terminal = true;
    }

    parent.postMessage(message, parentOrigin);
    token = null;
    status.textContent = type === 'success' ? 'Security check complete.' : type === 'ready' ? 'Complete the security check.' : 'Security check unavailable. Use Retry on the account page.';
  }

  function initialize(event) {
    var message = event.data;

    if (disposed || nonce || parent === window || event.origin !== parentOrigin || event.source !== parent ||
      !message || typeof message !== 'object' || Array.isArray(message)) {
      return;
    }

    var keys = Object.keys(message).sort().join(',');
    var validNonce = typeof message.nonce === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(message.nonce);
    var validKey = typeof message.siteKey === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(message.siteKey);

    if (keys !== 'nonce,siteKey,type' || message.type !== prefix + 'init' || !validNonce || !validKey) {
      return;
    }

    nonce = message.nonce;
    var siteKey = message.siteKey;
    var script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onerror = function () { send('error'); };
    script.onload = function () {
      if (disposed || !window.turnstile) {
        send('error');

        return;
      }

      try {
        widget = window.turnstile.render('#widget', {
          sitekey: siteKey, action: 'account_signup', cData: nonce, size: 'compact',
          retry: 'never', 'refresh-expired': 'manual', 'refresh-timeout': 'manual', 'response-field': false,
          callback: function (token) { send('success', token); },
          'error-callback': function () { send('error'); },
          'expired-callback': function () { send('expired'); },
          'timeout-callback': function () { send('timeout'); }
        });
        send('ready');
      } catch (_) {
        send('error');
      }
    };
    document.head.appendChild(script);
  }

  window.addEventListener('message', initialize);
  window.addEventListener('pagehide', function () {
    disposed = true;
    window.removeEventListener('message', initialize);

    if (widget !== null && window.turnstile) {
      window.turnstile.remove(widget);
    }

    nonce = null;
  });
})();
