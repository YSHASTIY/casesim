// CRATE service layer — drop selection (Phase 3 core).
// Extends the EXISTING weighted roll (js/roulette.js rollItem) with:
//   * per-skin weight overrides (via pricing.chances)
//   * profit-cap enforcement: if the naturally-rolled item would push the player's
//     balance above their daily cap, re-roll among only the affordable items;
//     if none fit, fall back to the cheapest item. Every capped decision is logged.
// Dual-target (browser window.CrateDrop + Node module.exports).
(function (root, factory) {
  var Pricing = (typeof require !== 'undefined') ? require('./pricing.js') : root.CratePricing;
  var Profit = (typeof require !== 'undefined') ? require('./profit.js') : root.CrateProfit;
  var api = factory(Pricing, Profit);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrateDrop = api;
})(typeof self !== 'undefined' ? self : this, function (Pricing, Profit) {
  'use strict';

  // Weighted pick over rows [{item, weight/chance}]. rng defaults to Math.random.
  function pickWeighted(rows, rng) {
    rng = rng || Math.random;
    var total = rows.reduce(function (a, r) { return a + (r.weight != null ? r.weight : r.chance) || 0; }, 0);
    if (total <= 0) return rows.length ? rows[0] : null;
    var r = rng() * total;
    for (var i = 0; i < rows.length; i++) {
      r -= (rows[i].weight != null ? rows[i].weight : rows[i].chance);
      if (r <= 0) return rows[i];
    }
    return rows[rows.length - 1];
  }

  // Roll a drop for one opening, honoring the profit cap.
  // ctx: { items, userId, currentBalance, casePrice, settings, date, rng, log }
  // Returns { item, chance, reason }  reason ∈ natural|cap-applied|cap-cheapest-fallback|no-cap
  function rollDrop(ctx) {
    var rows = Pricing.chances(ctx.items);
    if (!rows.length) return null;
    var rng = ctx.rng || Math.random;
    var settings = ctx.settings || (Profit && Profit.getSettings());
    var doLog = ctx.log !== false;

    var natural = pickWeighted(rows, rng);

    // Capping only when an engine + non-off mode is present.
    if (!Profit || !settings || settings.mode === 'off') {
      return { item: natural.item, chance: natural.chance, reason: 'no-cap' };
    }

    var cap = Profit.balanceCap(ctx.userId, ctx.currentBalance, settings, ctx.date);
    // Balance right after paying for the case, before the reward is credited.
    var balanceBeforeReward = Number(ctx.currentBalance) - Number(ctx.casePrice || 0);
    var maxReward = cap - balanceBeforeReward; // most valuable item we may award

    var naturalPrice = Pricing.itemPrice(natural.item);
    if (naturalPrice <= maxReward) {
      return { item: natural.item, chance: natural.chance, reason: 'natural', cap: cap };
    }

    // Natural pick breaches the cap → re-roll among affordable items only.
    var affordable = rows.filter(function (r) { return Pricing.itemPrice(r.item) <= maxReward; });
    var decision;
    if (affordable.length) {
      var picked = pickWeighted(affordable, rng);
      decision = { item: picked.item, chance: picked.chance, reason: 'cap-applied', cap: cap };
    } else {
      // Even the cheapest item breaches the cap → award the cheapest available.
      var cheapest = rows.reduce(function (a, b) {
        return Pricing.itemPrice(b.item) < Pricing.itemPrice(a.item) ? b : a;
      });
      decision = { item: cheapest.item, chance: cheapest.chance, reason: 'cap-cheapest-fallback', cap: cap };
    }

    if (doLog && Profit.log) {
      Profit.log({
        userId: ctx.userId,
        reason: decision.reason,
        mode: settings.mode,
        allowed: Profit.isAllowedToProfit(ctx.userId, settings, ctx.date),
        cap: Math.round(cap),
        balanceBeforeReward: Math.round(balanceBeforeReward),
        naturalItem: natural.item.name,
        naturalPrice: Math.round(naturalPrice),
        awardedItem: decision.item.name,
        awardedPrice: Math.round(Pricing.itemPrice(decision.item))
      });
    }
    return decision;
  }

  return { pickWeighted: pickWeighted, rollDrop: rollDrop };
});
