// CRATE service layer — pricing.
// Ports the EXISTING case-price formula from scripts/generate_data.py:
//   EV   = Σ p_item * dropVariant.price,  p_item = tier_weight / (# items of tier)
//   price = round(EV * 1.18 / 10) * 10, min 50
// Per-skin `weight` overrides (set in admin) take precedence over tier weight.
// Dual-target: attaches to window.CratePricing (browser) and module.exports (Node).
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CratePricing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Tier weights — identical to generate_data.py TIERS and roulette.js TIER_WEIGHT.
  var TIER_WEIGHT = {
    milspec: 0.7992, restricted: 0.1598, classified: 0.0320,
    covert: 0.0064, rare: 0.0026
  };
  var TIER_COLOR = {
    milspec: '#4b69ff', restricted: '#8847ff', classified: '#d32ce6',
    covert: '#eb4b4b', rare: '#e4ae39'
  };
  var HOUSE_EDGE_MULT = 1.18; // price = EV * 1.18  → house edge ≈ 15.3%

  function itemPrice(item) {
    if (item && item.dropVariant && item.dropVariant.price != null) return Number(item.dropVariant.price);
    return Number((item && (item.price || item.minPrice)) || 0);
  }

  // Raw (un-normalized) selection weight for one item.
  // Explicit per-skin weight (> 0) wins; else tier_weight / (#items of that tier).
  function rawWeight(item, tierCounts) {
    if (item && item.weight != null && Number(item.weight) > 0) return Number(item.weight);
    var w = TIER_WEIGHT[item && item.tier] || 0;
    var c = (tierCounts && tierCounts[item && item.tier]) || 1;
    return w / c;
  }

  function tierCounts(items) {
    var c = {};
    (items || []).forEach(function (s) { if (s.active !== false) c[s.tier] = (c[s.tier] || 0) + 1; });
    return c;
  }

  // Returns [{item, weight, chance}] with chance normalized to sum 1 over ACTIVE items.
  function chances(items) {
    var active = (items || []).filter(function (s) { return s.active !== false; });
    var counts = tierCounts(active);
    var rows = active.map(function (s) { return { item: s, weight: rawWeight(s, counts) }; });
    var total = rows.reduce(function (a, r) { return a + r.weight; }, 0) || 1;
    rows.forEach(function (r) { r.chance = r.weight / total; });
    return rows;
  }

  // Expected value of one opening (weighted by normalized chance).
  function expectedValue(items) {
    return chances(items).reduce(function (a, r) { return a + r.chance * itemPrice(r.item); }, 0);
  }

  // Case price from EV using the existing formula.
  function casePrice(items, mult) {
    var ev = expectedValue(items);
    var p = Math.round(ev * (mult || HOUSE_EDGE_MULT) / 10) * 10;
    return Math.max(p, 50);
  }

  // Full metrics block, mirroring generate_data.py build_case().
  function metrics(items, priceOverride, mult) {
    var rows = chances(items);
    var ev = rows.reduce(function (a, r) { return a + r.chance * itemPrice(r.item); }, 0);
    var price = priceOverride != null ? Number(priceOverride) : casePrice(items, mult);
    var prices = rows.map(function (r) { return itemPrice(r.item); }).sort(function (a, b) { return a - b; });
    var pLoss = rows.reduce(function (a, r) { return a + (itemPrice(r.item) < price ? r.chance : 0); }, 0);
    var pWin = rows.reduce(function (a, r) { return a + (itemPrice(r.item) >= price ? r.chance : 0); }, 0);
    return {
      ev: round2(ev),
      price: price,
      houseEdge: price ? round4(1 - ev / price) : 0,
      rtp: price ? round4(ev / price) : 0,
      pLoss: round4(pLoss),
      pWin: round4(pWin),
      medianOutcome: prices.length ? prices[Math.floor(prices.length / 2)] : 0,
      maxOutcome: prices.length ? prices[prices.length - 1] : 0,
      itemsCount: rows.length
    };
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function round4(n) { return Math.round(n * 10000) / 10000; }

  return {
    TIER_WEIGHT: TIER_WEIGHT, TIER_COLOR: TIER_COLOR, HOUSE_EDGE_MULT: HOUSE_EDGE_MULT,
    itemPrice: itemPrice, rawWeight: rawWeight, tierCounts: tierCounts,
    chances: chances, expectedValue: expectedValue, casePrice: casePrice, metrics: metrics
  };
});
