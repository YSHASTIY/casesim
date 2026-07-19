// CRATE admin — auth gate. SHA-256(password) compared to configured hash.
// Session is remembered in sessionStorage only (cleared on tab close).
(function () {
  'use strict';
  var SESSION_KEY = 'crate-admin-session';

  async function sha256Hex(str) {
    if (window.crypto && window.crypto.subtle) {
      var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    }
    throw new Error('WebCrypto unavailable (needs https or localhost)');
  }

  window.CrateAuth = {
    isAuthed: function () {
      try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return false; }
    },
    login: async function (password) {
      var cfg = window.CRATE_ADMIN;
      var want = cfg && cfg.hash();
      var got = await sha256Hex(String(password || ''));
      if (want && got === want) {
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
        return true;
      }
      return false;
    },
    logout: function () { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
  };
})();
