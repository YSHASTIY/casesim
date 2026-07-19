// CRATE service layer — catalog (Phase 1 & 2).
// The public site ships a generated catalog (window.CRATE_DATA / data/items.json).
// Admin edits are stored as an OVERLAY in localStorage and merged on top of the
// base catalog at load time, so we never mutate the generated file and stay
// backward-compatible. Also provides import/export and "auto-add random case".
// Dual-target (browser window.CrateCatalog + Node module.exports).
(function (root, factory) {
  var Pricing = (typeof require !== 'undefined') ? require('./pricing.js') : root.CratePricing;
  var api = factory(Pricing);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrateCatalog = api;
})(typeof self !== 'undefined' ? self : this, function (Pricing) {
  'use strict';

  var OVERLAY_KEY = 'crate-catalog-overlay';
  var POOL_KEY = 'crate-skin-pool'; // extra imported skins (Phase 2)

  var mem = {};
  function store() {
    try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch (e) {}
    return { getItem: function (k) { return k in mem ? mem[k] : null; },
             setItem: function (k, v) { mem[k] = String(v); },
             removeItem: function (k) { delete mem[k]; } };
  }
  function readJSON(k, d) { try { var v = store().getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function writeJSON(k, v) { try { store().setItem(k, JSON.stringify(v)); } catch (e) {} }

  function getOverlay() { return readJSON(OVERLAY_KEY, null); }
  function saveOverlay(o) { writeJSON(OVERLAY_KEY, o); }
  function resetOverlay() { try { store().removeItem(OVERLAY_KEY); } catch (e) {} }

  // Merge base catalog with overlay. Overlay may add/edit/hide cases & skins.
  function merge(base) {
    var overlay = getOverlay();
    var data = JSON.parse(JSON.stringify(base || { cases: [], drops: [] }));
    if (!overlay) return recalcAll(data);
    var byId = {};
    data.cases.forEach(function (c) { byId[c.id] = c; });
    (overlay.cases || []).forEach(function (oc) {
      if (oc._deleted) { delete byId[oc.id]; return; }
      var target = byId[oc.id];
      if (!target) { byId[oc.id] = oc; return; }
      // shallow-merge case fields, replace items if overlay provides them
      ['name', 'icon', 'color', 'description', 'published', 'priceOverride', 'items']
        .forEach(function (k) { if (oc[k] !== undefined) target[k] = oc[k]; });
    });
    data.cases = Object.keys(byId).map(function (k) { return byId[k]; });
    return recalcAll(data);
  }

  // Recompute price + metrics for every case (unless a manual override is set).
  function recalcCase(c) {
    var items = (c.items || []);
    c.metrics = Pricing.metrics(items, c.priceOverride, c.mult);
    c.priceRub = (c.priceOverride != null) ? Number(c.priceOverride) : Pricing.casePrice(items, c.mult);
    c.metrics.price = c.priceRub;
    return c;
  }
  function recalcAll(data) { (data.cases || []).forEach(recalcCase); return data; }

  // ---- CRUD helpers operating on an overlay-backed working copy -------------
  function upsertCase(base, caseObj) {
    var overlay = getOverlay() || { cases: [] };
    overlay.cases = overlay.cases || [];
    var i = overlay.cases.findIndex(function (c) { return c.id === caseObj.id; });
    if (i >= 0) overlay.cases[i] = caseObj; else overlay.cases.push(caseObj);
    saveOverlay(overlay);
    return merge(base);
  }
  function deleteCase(base, caseId) {
    var overlay = getOverlay() || { cases: [] };
    overlay.cases = overlay.cases || [];
    var i = overlay.cases.findIndex(function (c) { return c.id === caseId; });
    if (i >= 0) overlay.cases[i] = { id: caseId, _deleted: true };
    else overlay.cases.push({ id: caseId, _deleted: true });
    saveOverlay(overlay);
    return merge(base);
  }

  // ---- skin pool (Phase 2 extensible catalog) ------------------------------
  // Collect every skin known to the site: from base cases + imported pool.
  function allSkins(base) {
    var seen = {}, out = [];
    function add(s) { if (s && s.name && !seen[s.name]) { seen[s.name] = 1; out.push(s); } }
    (base && base.cases || []).forEach(function (c) { (c.items || []).forEach(add); });
    getPool().forEach(add);
    return out;
  }
  function getPool() { return readJSON(POOL_KEY, []); }
  function importSkins(list) {
    var pool = getPool();
    var seen = {};
    pool.forEach(function (s) { seen[s.name] = 1; });
    var added = 0;
    (list || []).forEach(function (s) {
      var norm = normalizeSkin(s);
      if (norm && !seen[norm.name]) { pool.push(norm); seen[norm.name] = 1; added++; }
    });
    writeJSON(POOL_KEY, pool);
    return added;
  }
  function normalizeSkin(s) {
    if (!s || !s.name) return null;
    var price = Number(s.price != null ? s.price : (s.dropVariant && s.dropVariant.price) || s.minPrice || 0);
    var tier = s.tier || 'milspec';
    return {
      id: s.id || ('skin-' + Math.random().toString(16).slice(2, 14)),
      name: s.name,
      image: s.image || '',
      tier: tier,
      rarityName: s.rarityName || '',
      rarityColor: s.rarityColor || (Pricing.TIER_COLOR[tier] || '#5e98d9'),
      minPrice: Number(s.minPrice != null ? s.minPrice : price),
      weight: s.weight != null ? Number(s.weight) : undefined,
      active: s.active !== false,
      dropVariant: s.dropVariant || { wear: s.wear || 'Field-Tested', marketHashName: s.name, price: price },
      marketUrl: s.marketUrl || ('https://market.csgo.com/en/?search=' + encodeURIComponent((s.name || '').split(' | ')[0]))
    };
  }

  // Auto-populate a case with a balanced random selection from the pool.
  // composition defaults to the classic CS2 mix.
  function autoBuildItems(base, composition, seed) {
    composition = composition || { milspec: 6, restricted: 3, classified: 2, covert: 1, rare: 1 };
    var pool = allSkins(base);
    var byTier = {};
    pool.forEach(function (s) { (byTier[s.tier] = byTier[s.tier] || []).push(s); });
    var rng = makeRng(seed || String(Date.now()));
    var out = [];
    Object.keys(composition).forEach(function (tier) {
      var group = (byTier[tier] || []).slice();
      shuffle(group, rng);
      out = out.concat(group.slice(0, composition[tier]));
    });
    return out;
  }
  function makeRng(seed) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h += 0x6D2B79F5; var t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ---- import / export whole catalog ---------------------------------------
  function exportOverlay() { return JSON.stringify({ overlay: getOverlay(), pool: getPool() }, null, 2); }
  function importOverlay(json) {
    var obj = typeof json === 'string' ? JSON.parse(json) : json;
    if (obj.overlay) saveOverlay(obj.overlay);
    if (obj.pool) writeJSON(POOL_KEY, obj.pool);
  }

  return {
    OVERLAY_KEY: OVERLAY_KEY, POOL_KEY: POOL_KEY,
    merge: merge, recalcCase: recalcCase, recalcAll: recalcAll,
    getOverlay: getOverlay, saveOverlay: saveOverlay, resetOverlay: resetOverlay,
    upsertCase: upsertCase, deleteCase: deleteCase,
    allSkins: allSkins, getPool: getPool, importSkins: importSkins, normalizeSkin: normalizeSkin,
    autoBuildItems: autoBuildItems,
    exportOverlay: exportOverlay, importOverlay: importOverlay,
    _setStore: function (s) { mem = {}; store = function () { return s; }; }
  };
});
