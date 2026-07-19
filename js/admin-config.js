// CRATE admin configuration.
// SECURITY: no plaintext password is stored — only a SHA-256 hash. The admin
// page compares SHA-256(entered password) against ADMIN_PASSWORD_HASH.
//
// DEFAULT password has been replaced with a strong random value.
//
// NOTE: client-side gating is not tamper-proof (see README "Security"). For a
// hardened deployment move this check behind a server. The hash is kept out of
// the public catalog and can be injected via env at build time.
window.CRATE_ADMIN = {
  // SHA-256 of a strong random password — replace for production.
  ADMIN_PASSWORD_HASH: '8f1757ed91507748d857a83a6a690dfad816af38d3559506c68d625b4cbdf2d4',
  // runtime override wins if present
  hash: function () {
    try { return localStorage.getItem('crate-admin-hash') || this.ADMIN_PASSWORD_HASH; }
    catch (e) { return this.ADMIN_PASSWORD_HASH; }
  }
};
