// CRATE smoke tests — pricing, drop-weighting, profit-cap. Zero deps: `node tests/run.js`.
'use strict';
var Pricing = require('../js/services/pricing.js');
var Profit = require('../js/services/profit.js');
var Drop = require('../js/services/drop.js');
var Catalog = require('../js/services/catalog.js');

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.error('  ✗ ' + name); } }
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function section(t) { console.log('\n' + t); }

// in-memory stores so tests never touch a real localStorage
function memStore() { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }

function skin(name, tier, price, extra) {
  return Object.assign({ id: name, name: name, tier: tier, dropVariant: { wear: 'FT', price: price } }, extra || {});
}

// ---------------- PRICING ----------------
section('pricing');
(function () {
  // One item per tier → chance == tier weight; EV == Σ w*price.
  var items = [skin('m', 'milspec', 100), skin('r', 'restricted', 1000), skin('c', 'classified', 5000),
               skin('cov', 'covert', 20000), skin('k', 'rare', 100000)];
  var ch = Pricing.chances(items);
  var sum = ch.reduce(function (a, r) { return a + r.chance; }, 0);
  ok('chances normalize to 1', approx(sum, 1));
  ok('milspec chance == tier weight', approx(ch[0].chance, 0.7992, 1e-4));

  var ev = Pricing.expectedValue(items);
  var manualEv = 0.7992 * 100 + 0.1598 * 1000 + 0.032 * 5000 + 0.0064 * 20000 + 0.0026 * 100000;
  ok('EV matches manual Σ w*price', approx(ev, manualEv, 1e-3));

  // Price formula: round(EV*1.18/10)*10, min 50 — matches generate_data.py.
  ok('casePrice = round(EV*1.18/10)*10', Pricing.casePrice(items) === Math.max(Math.round(ev * 1.18 / 10) * 10, 50));
  ok('min price floor 50', Pricing.casePrice([skin('cheap', 'milspec', 1)]) === 50);

  // Two items same tier split that tier's weight evenly.
  var two = [skin('a', 'covert', 1), skin('b', 'covert', 1)];
  ok('same-tier weight splits evenly', approx(Pricing.chances(two)[0].chance, 0.5));

  // Per-skin weight override wins over tier weight.
  var wOverride = [skin('a', 'milspec', 1, { weight: 3 }), skin('b', 'milspec', 1, { weight: 1 })];
  ok('explicit weight override respected', approx(Pricing.chances(wOverride)[0].chance, 0.75));

  // Inactive skins excluded.
  var withInactive = [skin('a', 'covert', 1), skin('b', 'covert', 1, { active: false })];
  ok('inactive skins excluded from chances', Pricing.chances(withInactive).length === 1);

  // metrics.rtp = ev/price.
  var m = Pricing.metrics(items);
  ok('metrics rtp == ev/price', approx(m.rtp, m.ev / m.price, 1e-3));
})();

// ---------------- DROP WEIGHTING ----------------
section('drop-weighting (statistical)');
(function () {
  var items = [skin('common', 'milspec', 10), skin('rare', 'rare', 10000)];
  // deterministic rng cycling values
  var N = 20000, counts = { common: 0, rare: 0 };
  var seedv = 12345;
  function rng() { seedv = (seedv * 1103515245 + 12345) & 0x7fffffff; return seedv / 0x7fffffff; }
  for (var i = 0; i < N; i++) {
    var d = Drop.rollDrop({ items: items, settings: { mode: 'off' }, rng: rng });
    counts[d.item.name]++;
  }
  var expectedCommon = Pricing.chances(items)[0].chance; // ~0.7992/(0.7992) since only 2 tiers present → renormalized
  var gotCommon = counts.common / N;
  ok('weighted roll ~ matches normalized chance (±3%)', Math.abs(gotCommon - expectedCommon) < 0.03);
  ok('both outcomes occur', counts.common > 0 && counts.rare > 0);
})();

// ---------------- PROFIT CAP ----------------
section('profit-cap');
(function () {
  Profit._setStore(memStore());
  // auto mode, ratio 1.2: a not-allowed player must not be awarded an item that
  // pushes balance above startBalance.
  Profit.setSettings({ mode: 'auto', dailyAllowProfitPercent: 0, maxProfitRatio: 1.2 });
  var items = [skin('cheap', 'milspec', 5), skin('jackpot', 'rare', 100000)];
  var uid = 'user-nowin';
  var start = 50000;
  Profit.getDailyState(uid, start); // fix startBalance = 50000
  // 0% allowed → this user is in no-win group → cap == start (50000).
  ok('no-win user cap == startBalance', Profit.balanceCap(uid, start, Profit.getSettings()) === start);

  // Force natural pick to be the jackpot by rng≈1, ensure cap replaces it.
  var d = Drop.rollDrop({ items: items, userId: uid, currentBalance: start, casePrice: 100,
    settings: Profit.getSettings(), rng: function () { return 0.999999; } });
  var balanceAfter = start - 100 + Pricing.itemPrice(d.item);
  ok('capped drop keeps balance <= cap', balanceAfter <= Profit.balanceCap(uid, start, Profit.getSettings()));
  ok('capped decision is logged with reason', ['cap-applied', 'cap-cheapest-fallback', 'natural'].indexOf(d.reason) >= 0);
  ok('jackpot suppressed for no-win user', d.item.name === 'cheap');

  // allowed player (100%) can receive jackpot up to ratio cap.
  Profit.setSettings({ mode: 'auto', dailyAllowProfitPercent: 100, maxProfitRatio: 5 });
  var uid2 = 'user-canwin';
  Profit.getDailyState(uid2, 1000);
  ok('can-win cap == start*ratio', Profit.balanceCap(uid2, 1000, Profit.getSettings()) === 5000);

  // deterministic bucketing: same user+day → stable decision.
  Profit.setSettings({ mode: 'auto', dailyAllowProfitPercent: 50 });
  var a1 = Profit.isAllowedToProfit('stable-user', Profit.getSettings(), '2026-07-19');
  var a2 = Profit.isAllowedToProfit('stable-user', Profit.getSettings(), '2026-07-19');
  ok('auto bucketing is deterministic per day', a1 === a2);

  // manual mode honors flags.
  Profit.setSettings({ mode: 'manual', manualAllow: { yes: true, no: false } });
  ok('manual allow=true', Profit.isAllowedToProfit('yes', Profit.getSettings()) === true);
  ok('manual allow=false', Profit.isAllowedToProfit('no', Profit.getSettings()) === false);
  ok('manual default (unlisted) = false', Profit.isAllowedToProfit('unknown', Profit.getSettings()) === false);

  // fallback: every item breaches cap → cheapest awarded.
  Profit.setSettings({ mode: 'auto', dailyAllowProfitPercent: 0, maxProfitRatio: 1 });
  var uid3 = 'poor';
  Profit.getDailyState(uid3, 0); // start 0, cap 0
  var d3 = Drop.rollDrop({ items: [skin('a', 'milspec', 50), skin('b', 'covert', 9000)],
    userId: uid3, currentBalance: 0, casePrice: 0, settings: Profit.getSettings(), rng: function () { return 0.999; } });
  ok('cheapest fallback when all breach cap', d3.item.name === 'a' && d3.reason === 'cap-cheapest-fallback');
})();

// ---------------- CATALOG ----------------
section('catalog');
(function () {
  Catalog._setStore(memStore());
  var base = { cases: [{ id: 'x', name: 'X', color: '#fff', published: true,
    items: [skin('a', 'milspec', 100), skin('b', 'covert', 9000)] }], drops: [] };
  var merged = Catalog.merge(base);
  ok('merge recalculates price', merged.cases[0].priceRub === Pricing.casePrice(base.cases[0].items));

  Catalog.upsertCase(base, { id: 'x', priceOverride: 777 });
  ok('manual price override applied', Catalog.merge(base).cases[0].priceRub === 777);

  var added = Catalog.importSkins([{ name: 'AK-47 | Test', tier: 'classified', price: 1200 }]);
  ok('importSkins adds new skin', added === 1);
  ok('imported skin appears in allSkins', Catalog.allSkins(base).some(function (s) { return s.name === 'AK-47 | Test'; }));

  Catalog.deleteCase(base, 'x');
  ok('deleteCase removes case', Catalog.merge(base).cases.length === 0);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
