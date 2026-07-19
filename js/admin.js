// CRATE — admin panel controller. Wires auth gate + all panes.
(function () {
  'use strict';
  var Pricing = window.CratePricing, Profit = window.CrateProfit, Catalog = window.CrateCatalog;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = window.money || function (n) { return Number(n || 0).toLocaleString('ru-RU') + ' ₽'; };
  var BASE = window.CRATE_DATA || { cases: [], drops: [] };
  var data = Catalog.merge(BASE);
  var editing = null; // case object currently in modal

  // ---------- skin pool (Phase 2) ----------
  // The full CS2 catalog ships as data/skins-pool.js -> window.CRATE_SKIN_POOL and
  // is read DIRECTLY by Catalog.allSkins (it is ~10MB — copying it into
  // localStorage would blow the quota). So there is nothing to "load": the whole
  // catalog is available on page load. The button below simply re-renders and
  // reports counts. Manual JSON imports (Tools tab) still go to localStorage.
  function loadPoolGlobal(silent) {
    var shipped = window.CRATE_SKIN_POOL;
    if (!Array.isArray(shipped) || !shipped.length) {
      if (!silent) toast('Файл пула скинов не найден (data/skins-pool.js)');
      return 0;
    }
    if (!silent) toast('Каталог загружен: ' + shipped.length + ' предметов');
    return shipped.length;
  }
  function ensurePool() { /* shipped catalog is read directly by Catalog.allSkins */ }
  function poolStatus() {
    var el = $('[data-pool-status]'); if (!el) return;
    var shipped = (window.CRATE_SKIN_POOL || []).length;
    var imported = Catalog.getPool().length;
    el.textContent = 'В каталоге: ' + Catalog.allSkins(BASE).length + ' предметов' +
      ' (в файле пула: ' + shipped + (imported ? ', импортировано вручную: ' + imported : '') + ')';
  }

  // ---------- auth ----------
  var gate = $('#loginGate'), shell = $('#adminShell');
  function showPanel() {
    gate.style.display = 'none'; shell.hidden = false;
    $('#logoutBtn').style.display = '';
    $('[data-admin-user]').textContent = 'admin';
    ensurePool();
    renderAll();
    poolStatus();
  }
  if (window.CrateAuth.isAuthed()) showPanel();
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    window.CrateAuth.login($('#adminPass').value).then(function (ok) {
      if (ok) showPanel();
      else { $('#loginError').textContent = 'Неверный пароль'; }
    }).catch(function (err) { $('#loginError').textContent = String(err.message || err); });
  });
  $('#logoutBtn').addEventListener('click', function () { window.CrateAuth.logout(); location.reload(); });

  // ---------- tabs ----------
  $$('.admin-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.admin-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      $$('.admin-pane').forEach(function (p) { p.hidden = p.dataset.pane !== tab.dataset.tab; });
    });
  });

  function refresh() { data = Catalog.merge(BASE); renderAll(); }
  function renderAll() {
    renderDashboard(); renderCases(); renderSkins(); renderProfit(); renderAudit();
  }

  // ---------- dashboard ----------
  function renderDashboard() {
    var users = Object.keys(Profit.getAudit(500).reduce(function (m, e) { m[e.userId] = 1; return m; }, {}));
    var balance = Number((window.store && window.store.lsGet('crate-balance', '5000')) || 5000);
    var openingsToday = countOpeningsToday();
    var avgRtp = data.cases.length
      ? data.cases.reduce(function (a, c) { return a + (c.metrics.rtp || 0); }, 0) / data.cases.length : 0;
    var stats = [
      ['Кейсов', data.cases.length, 'fa-box-open'],
      ['Скинов в каталоге', Catalog.allSkins(BASE).length, 'fa-gun'],
      ['Открытий сегодня', openingsToday, 'fa-dice'],
      ['Баланс (этот браузер)', money(balance), 'fa-wallet'],
      ['Средний RTP', (avgRtp * 100).toFixed(1) + '%', 'fa-percent'],
      ['Записей аудита', Profit.getAudit(9999).length, 'fa-clipboard-list']
    ];
    $('[data-dashboard-stats]').innerHTML = stats.map(function (s) {
      return '<div class="stat-card"><i class="fa-solid ' + s[2] + '"></i>' +
        '<div><b>' + s[1] + '</b><small>' + s[0] + '</small></div></div>';
    }).join('');
    var max = Math.max.apply(null, data.cases.map(function (c) { return c.metrics.rtp || 0; }).concat([0.01]));
    $('[data-rtp-chart]').innerHTML = data.cases.map(function (c) {
      var pct = (c.metrics.rtp || 0);
      return '<div class="bar-row"><span>' + c.name + '</span>' +
        '<div class="bar"><i style="width:' + Math.round(pct / max * 100) + '%;background:' + c.color + '"></i></div>' +
        '<b>' + (pct * 100).toFixed(0) + '%</b></div>';
    }).join('');
  }
  function countOpeningsToday() {
    var day = new Date().toISOString().slice(0, 10);
    var hist = JSON.parse((window.store && window.store.lsGet('crate-open-history', '[]')) || '[]');
    return hist.filter(function (h) { return (h.at || '').slice(0, 10) === day; }).length;
  }

  // ---------- cases ----------
  function renderCases() {
    $('[data-case-list]').innerHTML = data.cases.map(function (c) {
      var pub = c.published !== false;
      return '<div class="case-admin-card" style="--case-color:' + c.color + '">' +
        '<div class="case-admin-icon"><i class="fa-solid ' + (c.icon || 'fa-box') + '"></i></div>' +
        '<div class="case-admin-main"><b>' + c.name + '</b>' +
        '<small>' + (c.items ? c.items.length : 0) + ' скинов · ' + money(c.priceRub) +
        (c.priceOverride != null ? ' · ручная' : '') + ' · RTP ' + ((c.metrics.rtp || 0) * 100).toFixed(0) + '%</small></div>' +
        '<span class="badge ' + (pub ? 'on' : 'off') + '">' + (pub ? 'Опубликован' : 'Черновик') + '</span>' +
        '<div class="case-admin-actions">' +
        '<button class="button ghost" data-edit-case="' + c.id + '"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="button ghost danger" data-del-case="' + c.id + '"><i class="fa-solid fa-trash"></i></button>' +
        '</div></div>';
    }).join('') || '<p class="muted">Кейсов пока нет.</p>';

    $$('[data-edit-case]').forEach(function (b) {
      b.onclick = function () { openCaseModal(data.cases.find(function (c) { return c.id === b.dataset.editCase; })); };
    });
    $$('[data-del-case]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Удалить кейс ' + b.dataset.delCase + '?')) return;
        Catalog.deleteCase(BASE, b.dataset.delCase); toast('Кейс удалён'); refresh();
      };
    });
  }
  $('#newCaseBtn').onclick = function () {
    openCaseModal({ id: 'case-' + Math.random().toString(16).slice(2, 8), name: 'Новый кейс',
      icon: 'fa-box', color: '#f5c156', description: '', published: false, items: [] });
  };

  // ---------- case editor modal ----------
  function openCaseModal(c) {
    editing = JSON.parse(JSON.stringify(c));
    editing.items = editing.items || [];
    $('#cId').value = editing.id;
    $('#cName').value = editing.name || '';
    $('#cIcon').value = editing.icon || '';
    $('#cColor').value = /^#/.test(editing.color) ? editing.color.slice(0, 7) : '#f5c156';
    $('#cDesc').value = editing.description || '';
    $('#cPublished').checked = editing.published !== false;
    $('#cManualPrice').checked = editing.priceOverride != null;
    $('#cPrice').value = editing.priceOverride != null ? editing.priceOverride : '';
    renderCaseItems();
    $('#caseModal').hidden = false;
  }
  function closeCaseModal() { $('#caseModal').hidden = true; editing = null; }
  $('#caseModalClose').onclick = closeCaseModal;
  $('#cancelCaseBtn').onclick = closeCaseModal;

  function renderCaseItems() {
    var rows = Pricing.chances(editing.items);
    var chanceById = {};
    rows.forEach(function (r) { chanceById[r.item.id || r.item.name] = r.chance; });
    var sum = rows.reduce(function (a, r) { return a + r.chance; }, 0);
    $('[data-norm-note]').textContent = editing.items.length
      ? 'Нормализованная сумма шансов: ' + (sum * 100).toFixed(2) + '% (по активным скинам)'
      : 'Добавьте скины в кейс.';

    var tbl = $('[data-case-items]');
    tbl.innerHTML = '<tr><th>Скин</th><th>Тир</th><th>Цена ₽</th><th>Вес</th><th>Шанс</th><th>Актив.</th><th></th></tr>' +
      editing.items.map(function (s, i) {
        var ch = chanceById[s.id || s.name] || 0;
        return '<tr>' +
          '<td class="skin-cell"><img src="' + (s.image || '') + '" onerror="this.style.visibility=\'hidden\'">' + s.name + '</td>' +
          '<td><span class="tier-dot" style="background:' + (Pricing.TIER_COLOR[s.tier] || '#888') + '"></span>' + s.tier + '</td>' +
          '<td>' + Pricing.itemPrice(s).toFixed(0) + '</td>' +
          '<td><input class="mini" type="number" step="0.0001" min="0" value="' + (s.weight != null ? s.weight : '') +
              '" placeholder="auto" data-w="' + i + '"></td>' +
          '<td><b>' + (ch * 100).toFixed(2) + '%</b></td>' +
          '<td><input type="checkbox" data-act="' + i + '" ' + (s.active !== false ? 'checked' : '') + '></td>' +
          '<td><button class="button ghost danger mini" data-rm="' + i + '"><i class="fa-solid fa-xmark"></i></button></td>' +
          '</tr>';
      }).join('');

    $$('[data-w]', tbl).forEach(function (inp) {
      inp.onchange = function () {
        var v = inp.value.trim();
        editing.items[+inp.dataset.w].weight = v === '' ? undefined : Number(v);
        renderCaseItems(); recalcModalPrice();
      };
    });
    $$('[data-act]', tbl).forEach(function (inp) {
      inp.onchange = function () { editing.items[+inp.dataset.act].active = inp.checked; renderCaseItems(); recalcModalPrice(); };
    });
    $$('[data-rm]', tbl).forEach(function (b) {
      b.onclick = function () { editing.items.splice(+b.dataset.rm, 1); renderCaseItems(); recalcModalPrice(); };
    });
    recalcModalPrice();
  }
  function recalcModalPrice() {
    var manual = $('#cManualPrice').checked;
    var override = manual ? Number($('#cPrice').value) : null;
    var m = Pricing.metrics(editing.items, override);
    $('[data-calc-price]').textContent = money(manual ? override || 0 : Pricing.casePrice(editing.items));
    $('[data-calc-ev]').textContent = money(m.ev);
    $('[data-calc-rtp]').textContent = (m.rtp * 100).toFixed(1) + '%';
  }
  $('#cManualPrice').onchange = recalcModalPrice;
  $('#cPrice').oninput = recalcModalPrice;

  $('#autoAddBtn').onclick = function () {
    editing.items = Catalog.autoBuildItems(BASE, null, editing.id + Date.now());
    toast('Собран сбалансированный набор из ' + editing.items.length + ' скинов');
    renderCaseItems();
  };
  $('#saveCaseBtn').onclick = function () {
    editing.id = $('#cId').value.trim() || editing.id;
    editing.name = $('#cName').value.trim() || editing.id;
    editing.icon = $('#cIcon').value.trim() || 'fa-box';
    editing.color = $('#cColor').value;
    editing.description = $('#cDesc').value.trim();
    editing.published = $('#cPublished').checked;
    editing.priceOverride = $('#cManualPrice').checked ? Number($('#cPrice').value) || 0 : undefined;
    if (!editing.items.length) { toast('Добавьте хотя бы один скин'); return; }
    var bad = editing.items.some(function (s) { return s.weight != null && !(Number(s.weight) > 0); });
    if (bad) { toast('Веса должны быть > 0'); return; }
    Catalog.upsertCase(BASE, editing);
    toast('Кейс сохранён'); closeCaseModal(); refresh();
  };

  // ---------- skin picker (with CS:GO-market-style filter panel) ----------
  // Filters combine like the CS:GO market: checkboxes WITHIN a facet are OR'd,
  // facets are AND'd together, and everything is AND'd with the free-text search.
  var CATEGORY_LABELS = {
    weapon: 'Оружие', knife: 'Ножи', gloves: 'Перчатки', sticker: 'Наклейки',
    charm: 'Брелоки', patch: 'Нашивки', pin: 'Значки', case: 'Кейсы'
  };
  var TIER_LABELS = {
    milspec: 'Армейское', restricted: 'Запрещённое', classified: 'Засекреченное',
    covert: 'Тайное', rare: 'Ножи/Перчатки (редкое)'
  };
  var CATEGORY_ORDER = ['weapon', 'knife', 'gloves', 'sticker', 'charm', 'patch', 'pin', 'case'];
  var TIER_ORDER = ['milspec', 'restricted', 'classified', 'covert', 'rare'];
  var pickerFilters = { category: {}, tier: {}, weapon: {}, stattrak: {} };

  $('#addSkinToCaseBtn').onclick = function () { openPicker(); };
  function openPicker() {
    $('#skinPicker').hidden = false;
    $('#pickerSearch').value = '';
    pickerFilters = { category: {}, tier: {}, weapon: {}, stattrak: {} };
    buildPickerFilters();
    renderPicker();
    $('#pickerSearch').oninput = function () { renderPicker(); };
  }
  $('#skinPickerClose').onclick = function () { $('#skinPicker').hidden = true; };
  $('#pickerReset').onclick = function () {
    pickerFilters = { category: {}, tier: {}, weapon: {}, stattrak: {} };
    $('#pickerSearch').value = '';
    $$('[data-facet]', $('[data-picker-filters]')).forEach(function (cb) { cb.checked = false; });
    renderPicker();
  };

  function anyChecked(map) { return Object.keys(map).some(function (k) { return map[k]; }); }

  // Build the facet checkboxes from the full catalog (weapons list is dynamic).
  function buildPickerFilters() {
    var all = Catalog.allSkins(BASE);
    var weapons = {};
    all.forEach(function (s) { if (s.weapon) weapons[s.weapon] = 1; });
    var weaponList = Object.keys(weapons).sort();

    function group(title, facet, entries) {
      return '<div class="filter-group"><h4>' + title + '</h4>' +
        '<div class="filter-opts' + (facet === 'weapon' ? ' scroll' : '') + '">' +
        entries.map(function (e) {
          return '<label class="filter-opt"><input type="checkbox" data-facet="' + facet +
            '" value="' + e.val + '">' + e.label + '</label>';
        }).join('') + '</div></div>';
    }

    var html = '';
    html += group('Категория', 'category', CATEGORY_ORDER.map(function (c) {
      return { val: c, label: CATEGORY_LABELS[c] || c };
    }));
    html += group('Редкость', 'tier', TIER_ORDER.map(function (t) {
      return { val: t, label: TIER_LABELS[t] || t };
    }));
    html += group('StatTrak™', 'stattrak', [
      { val: 'yes', label: 'StatTrak™' }, { val: 'no', label: 'Без StatTrak' }
    ]);
    html += group('Оружие (базовый предмет)', 'weapon', weaponList.map(function (w) {
      return { val: w, label: w };
    }));

    var box = $('[data-picker-filters]');
    box.innerHTML = html;
    $$('[data-facet]', box).forEach(function (cb) {
      cb.onchange = function () {
        pickerFilters[cb.dataset.facet][cb.value] = cb.checked;
        renderPicker();
      };
    });
  }

  function matchesFilters(s, q) {
    if (q && s.name.toLowerCase().indexOf(q) < 0) return false;
    var f = pickerFilters;
    if (anyChecked(f.category) && !f.category[s.category]) return false;
    if (anyChecked(f.tier) && !f.tier[s.tier]) return false;
    if (anyChecked(f.weapon) && !f.weapon[s.weapon]) return false;
    if (anyChecked(f.stattrak)) {
      var key = s.statTrak ? 'yes' : 'no';
      if (!f.stattrak[key]) return false;
    }
    return true;
  }

  function renderPicker() {
    var q = ($('#pickerSearch').value || '').toLowerCase();
    var matched = Catalog.allSkins(BASE).filter(function (s) { return matchesFilters(s, q); });
    var all = matched.slice(0, 300);
    $('[data-picker-count]').textContent = 'Найдено: ' + matched.length +
      (matched.length > all.length ? ' (показаны первые ' + all.length + ')' : '');
    $('[data-picker-list]').innerHTML = all.map(function (s, i) {
      var badge = s.statTrak ? '<span class="st-badge">ST</span>' : '';
      return '<div class="picker-item" data-pick="' + i + '"><img src="' + (s.image || '') + '" onerror="this.style.visibility=\'hidden\'">' +
        '<div><b>' + badge + s.name + '</b><small>' + (CATEGORY_LABELS[s.category] || s.category) +
        ' · ' + s.tier + ' · ' + money(Pricing.itemPrice(s)) + '</small></div>' +
        '<i class="fa-solid fa-plus"></i></div>';
    }).join('') || '<p class="muted">Ничего не найдено.</p>';
    $$('[data-pick]').forEach(function (el) {
      el.onclick = function () {
        var s = all[+el.dataset.pick];
        var exists = editing.items.some(function (x) { return x.name === s.name && !!x.statTrak === !!s.statTrak; });
        if (exists) { toast('Уже в кейсе'); return; }
        editing.items.push(JSON.parse(JSON.stringify(s)));
        renderCaseItems(); toast('Добавлен: ' + s.name);
      };
    });
  }

  // ---------- skins pane ----------
  function renderSkins(q) {
    q = ($('#skinSearch') && $('#skinSearch').value || '').toLowerCase();
    var all = Catalog.allSkins(BASE);
    $('[data-skin-count]').textContent = '(' + all.length + ')';
    poolStatus();
    var rows = all.filter(function (s) { return s.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 400);
    $('[data-skin-table]').innerHTML = '<tr><th>Скин</th><th>Тир</th><th>Редкость</th><th>Цена ₽</th><th>Износ</th></tr>' +
      rows.map(function (s) {
        return '<tr><td class="skin-cell"><img src="' + (s.image || '') + '" onerror="this.style.visibility=\'hidden\'">' + s.name + '</td>' +
          '<td><span class="tier-dot" style="background:' + (Pricing.TIER_COLOR[s.tier] || '#888') + '"></span>' + s.tier + '</td>' +
          '<td>' + (s.rarityName || '') + '</td><td>' + Pricing.itemPrice(s).toFixed(0) + '</td>' +
          '<td>' + ((s.dropVariant && s.dropVariant.wear) || '') + '</td></tr>';
      }).join('');
  }
  if ($('#skinSearch')) $('#skinSearch').oninput = function () { renderSkins(); };
  if ($('#reloadPoolBtn')) $('#reloadPoolBtn').onclick = function () {
    var added = loadPoolGlobal(false);
    renderSkins(); renderDashboard();
    if (added >= 0) toast('Пул обновлён');
  };

  // ---------- profit pane ----------
  function renderProfit() {
    var s = Profit.getSettings();
    $('#pfMode').value = s.mode;
    $('#pfPercent').value = s.dailyAllowProfitPercent;
    $('#pfRatio').value = s.maxProfitRatio;
    $('#pfAmount').value = s.maxProfitAmount;
    $('#pfDailyCap').value = s.perPlayerDailyCap;
    $('[data-my-uid]').textContent = Profit.getUserId();
    $('#manualCard').style.display = s.mode === 'manual' ? '' : 'none';
    explainProfit(s);
    renderManualList(s);
  }
  function explainProfit(s) {
    var t = '';
    if (s.mode === 'off') t = 'Контроль выключен — честные шансы, кап не применяется.';
    else if (s.mode === 'manual') t = 'Ручной режим: игрок уходит в плюс только если явно помечен «можно». Кап для остальных = стартовый баланс дня.';
    else t = s.dailyAllowProfitPercent + '% игроков (детерминированно по id+дате) могут расти до ' +
      (s.maxProfitAmount > 0 ? 'старт + ' + money(s.maxProfitAmount) : '×' + s.maxProfitRatio + ' от старта') +
      '. Остальные не могут превысить стартовый баланс дня.';
    $('[data-pf-explain]').textContent = t;
  }
  $('#pfMode').onchange = function () { explainProfit(Object.assign(Profit.getSettings(), { mode: this.value })); $('#manualCard').style.display = this.value === 'manual' ? '' : 'none'; };
  $('#pfSave').onclick = function () {
    var pct = Math.max(0, Math.min(100, Number($('#pfPercent').value)));
    Profit.setSettings({
      mode: $('#pfMode').value,
      dailyAllowProfitPercent: pct,
      maxProfitRatio: Math.max(1, Number($('#pfRatio').value) || 1),
      maxProfitAmount: Math.max(0, Number($('#pfAmount').value) || 0),
      perPlayerDailyCap: Math.max(0, Number($('#pfDailyCap').value) || 0)
    });
    toast('Настройки контроля сохранены'); renderProfit(); renderDashboard();
  };
  function renderManualList(s) {
    var m = s.manualAllow || {};
    $('[data-manual-list]').innerHTML = Object.keys(m).map(function (uid) {
      return '<div class="manual-row"><code>' + uid + '</code>' +
        '<span class="badge ' + (m[uid] ? 'on' : 'off') + '">' + (m[uid] ? 'можно' : 'нельзя') + '</span>' +
        '<button class="button ghost danger mini" data-mrm="' + uid + '"><i class="fa-solid fa-xmark"></i></button></div>';
    }).join('') || '<p class="muted">Нет флагов.</p>';
    $$('[data-mrm]').forEach(function (b) {
      b.onclick = function () { var st = Profit.getSettings(); delete st.manualAllow[b.dataset.mrm]; Profit.setSettings({ manualAllow: st.manualAllow }); renderProfit(); };
    });
  }
  $('#manualAddBtn').onclick = function () {
    var uid = $('#manualUid').value.trim(); if (!uid) return;
    var st = Profit.getSettings(); st.manualAllow = st.manualAllow || {};
    st.manualAllow[uid] = $('#manualAllow').value === 'true';
    Profit.setSettings({ manualAllow: st.manualAllow }); $('#manualUid').value = ''; renderProfit();
  };

  // ---------- audit pane ----------
  function renderAudit() {
    var rows = Profit.getAudit(200);
    $('[data-audit-table]').innerHTML = '<tr><th>Время</th><th>Игрок</th><th>Режим</th><th>Решение</th><th>Кап ₽</th><th>Естеств.→выдано</th></tr>' +
      rows.map(function (e) {
        return '<tr><td>' + (window.crateFmtDate ? window.crateFmtDate(e.at) : e.at) + '</td>' +
          '<td><code>' + (e.userId || '').slice(0, 12) + '</code></td>' +
          '<td>' + e.mode + (e.allowed ? ' ✓' : ' ✕') + '</td>' +
          '<td><span class="reason ' + e.reason + '">' + e.reason + '</span></td>' +
          '<td>' + (e.cap != null ? money(e.cap) : '—') + '</td>' +
          '<td>' + e.naturalItem + ' (' + money(e.naturalPrice) + ') → ' + e.awardedItem + ' (' + money(e.awardedPrice) + ')</td></tr>';
      }).join('') || '<tr><td colspan="6" class="muted">Записей нет.</td></tr>';
  }
  $('#clearAuditBtn').onclick = function () { Profit.clearAudit(); renderAudit(); renderDashboard(); toast('Аудит очищен'); };

  // ---------- tools ----------
  $('#importSkinsBtn').onclick = function () {
    try {
      var list = JSON.parse($('#importSkinsText').value);
      if (!Array.isArray(list)) throw new Error('Ожидается JSON-массив');
      var n = Catalog.importSkins(list);
      $('[data-import-result]').textContent = 'Импортировано новых скинов: ' + n;
      toast('Импортировано: ' + n); renderSkins();
    } catch (e) { $('[data-import-result]').textContent = 'Ошибка: ' + e.message; }
  };
  $('#exportBtn').onclick = function () {
    var blob = new Blob([Catalog.exportOverlay()], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'crate-config.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  $('#importConfigBtn').onclick = function () {
    try { Catalog.importOverlay($('#configText').value); toast('Конфигурация импортирована'); refresh(); }
    catch (e) { toast('Ошибка импорта: ' + e.message); }
  };
  $('#resetOverlayBtn').onclick = function () {
    if (!confirm('Сбросить все правки кейсов? Импортированные скины останутся.')) return;
    Catalog.resetOverlay(); toast('Правки сброшены'); refresh();
  };
})();
