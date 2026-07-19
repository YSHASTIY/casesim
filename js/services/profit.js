// CRATE service layer — profit / winnings control engine (Phase 3).
// Decides, per player per day, whether an opening result must be capped so the
// player can't run "bigly positive" beyond an admin-configured limit.
//
// Modes:
//   off    — no capping, pure odds.
//   manual — admin flags specific users as allowed / disallowed to profit.
//   auto   — each user is deterministically bucketed into can-win / no-win for the
//            day (seed = userId + date), so the same player isn't re-rolled per case.
//
// The cap is a real limit on the player's balance for the day, derived from the
// balance they had at their first opening of the day (startBalance):
//   allowed-to-profit  → cap = startBalance * maxProfitRatio (or +maxProfitAmount)
//   not-allowed        → cap = startBalance (can drift down, not up)
// plus an absolute perPlayerDailyCap ceiling if set.
//
// Dual-target (browser window.CrateProfit + Node module.exports). Storage is
// injected so tests can run without a DOM (falls back to localStorage / memory).
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrateProfit = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SETTINGS_KEY = 'crate-profit-settings';
  var STATE_KEY = 'crate-profit-state';     // per-user daily state
  var AUDIT_KEY = 'crate-profit-audit';     // decision log
  var USER_KEY = 'crate-user-id';
  var AUDIT_LIMIT = 500;

  var DEFAULTS = {
    mode: 'off',                 // off | manual | auto
    dailyAllowProfitPercent: 30, // % of players who may go positive today (auto mode)
    maxProfitRatio: 1.2,         // cap = startBalance * ratio (e.g. 50000 → 60000)
    maxProfitAmount: 0,          // if > 0, cap = startBalance + amount (overrides ratio)
    perPlayerDailyCap: 0,        // absolute ceiling on balance, 0 = disabled
    manualAllow: {},             // { userId: true|false } for manual mode
    updatedAt: null
  };

  // ---- storage adapter -----------------------------------------------------
  var mem = {};
  function store() {
    try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch (e) {}
    return { getItem: function (k) { return k in mem ? mem[k] : null; },
             setItem: function (k, v) { mem[k] = String(v); } };
  }
  function readJSON(k, d) { try { var v = store().getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function writeJSON(k, v) { try { store().setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---- deterministic seeded RNG (xmur3 + mulberry32) -----------------------
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }
  // Stable float in [0,1) from an arbitrary string seed.
  function seededUnit(seed) { return xmur3(String(seed))() / 4294967296; }

  // ---- settings ------------------------------------------------------------
  function getSettings() {
    var s = readJSON(SETTINGS_KEY, null);
    if (!s) return Object.assign({}, DEFAULTS);
    return Object.assign({}, DEFAULTS, s);
  }
  function setSettings(patch) {
    var next = Object.assign(getSettings(), patch || {}, { updatedAt: new Date().toISOString() });
    writeJSON(SETTINGS_KEY, next);
    return next;
  }

  // ---- identity & day ------------------------------------------------------
  function todayKey(date) { return (date ? new Date(date) : new Date()).toISOString().slice(0, 10); }
  function getUserId() {
    var id = null;
    try { id = store().getItem(USER_KEY); } catch (e) {}
    if (!id) {
      id = 'u-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { store().setItem(USER_KEY, id); } catch (e) {}
    }
    return id;
  }

  // Whether this user is allowed to profit today.
  function isAllowedToProfit(userId, settings, date) {
    settings = settings || getSettings();
    if (settings.mode === 'off') return true;
    if (settings.mode === 'manual') {
      var m = settings.manualAllow || {};
      return userId in m ? !!m[userId] : false; // default: not allowed unless flagged
    }
    // auto: deterministic bucket by (userId + day)
    var u = seededUnit(userId + '::' + todayKey(date));
    return u < (Number(settings.dailyAllowProfitPercent) || 0) / 100;
  }

  // ---- per-user daily state ------------------------------------------------
  // Records the balance at first opening of the day → basis for the cap.
  function getDailyState(userId, currentBalance, date) {
    var all = readJSON(STATE_KEY, {});
    var day = todayKey(date);
    var st = all[userId];
    if (!st || st.day !== day) {
      st = { day: day, startBalance: Number(currentBalance) || 0, openings: 0, profitApplied: 0 };
      all[userId] = st;
      writeJSON(STATE_KEY, all);
    }
    return st;
  }
  function bumpDailyState(userId, patch, date) {
    var all = readJSON(STATE_KEY, {});
    var day = todayKey(date);
    var st = all[userId] || { day: day, startBalance: 0, openings: 0, profitApplied: 0 };
    Object.assign(st, patch, { day: day });
    all[userId] = st;
    writeJSON(STATE_KEY, all);
    return st;
  }

  // Absolute balance ceiling this player must not exceed today.
  function balanceCap(userId, currentBalance, settings, date) {
    settings = settings || getSettings();
    if (settings.mode === 'off') return Infinity;
    var st = getDailyState(userId, currentBalance, date);
    var start = st.startBalance;
    var allowed = isAllowedToProfit(userId, settings, date);
    var cap;
    if (!allowed) {
      cap = start; // no-win group: cannot end the day above where they started
    } else if (Number(settings.maxProfitAmount) > 0) {
      cap = start + Number(settings.maxProfitAmount);
    } else {
      cap = start * (Number(settings.maxProfitRatio) || 1);
    }
    if (Number(settings.perPlayerDailyCap) > 0) cap = Math.min(cap, Number(settings.perPlayerDailyCap));
    return cap;
  }

  // ---- audit log -----------------------------------------------------------
  function log(entry) {
    var arr = readJSON(AUDIT_KEY, []);
    arr.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    if (arr.length > AUDIT_LIMIT) arr.length = AUDIT_LIMIT;
    writeJSON(AUDIT_KEY, arr);
  }
  function getAudit(limit) { var a = readJSON(AUDIT_KEY, []); return limit ? a.slice(0, limit) : a; }
  function clearAudit() { writeJSON(AUDIT_KEY, []); }

  return {
    SETTINGS_KEY: SETTINGS_KEY, DEFAULTS: DEFAULTS,
    getSettings: getSettings, setSettings: setSettings,
    getUserId: getUserId, todayKey: todayKey,
    isAllowedToProfit: isAllowedToProfit,
    getDailyState: getDailyState, bumpDailyState: bumpDailyState,
    balanceCap: balanceCap,
    seededUnit: seededUnit,
    log: log, getAudit: getAudit, clearAudit: clearAudit,
    _setStore: function (s) { mem = {}; store = function () { return s; }; } // test hook
  };
});
