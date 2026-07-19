// CRATE — открытие кейса: рулетка, взвешенный ролл по редкости, результат с реальной ценой.
// Предметы и цены берутся из data/items.json (window.CRATE.data).

document.addEventListener('DOMContentLoaded', function () {
  var store = window.store;
  var money = window.money || function (n) { return Number(n).toLocaleString('ru-RU') + ' ₽'; };

  var WEAR_RU = {
    'Factory New': 'Прямо с завода',
    'Minimal Wear': 'Немного поношенное',
    'Field-Tested': 'После полевых испытаний',
    'Well-Worn': 'Поношенное',
    'Battle-Scarred': 'Закалённое в боях'
  };
  // Игровые веса по редкости (как в настоящих кейсах CS2)
  var TIER_WEIGHT = {
    milspec: 0.7992, restricted: 0.1598, classified: 0.0320,
    covert: 0.0064, rare: 0.0026
  };

  function tierColor(tier) {
    return { milspec: '#4b69ff', restricted: '#8847ff', classified: '#d32ce6',
      covert: '#eb4b4b', rare: '#e4ae39' }[tier] || '#5e98d9';
  }

  // История открытий (для дашборда «открытий сегодня» и RTP-метрик).
  function recordOpening(userId, caseObj, item) {
    try {
      var hist = JSON.parse(store.lsGet('crate-open-history', '[]') || '[]');
      hist.unshift({
        at: new Date().toISOString(), userId: userId, caseId: caseObj.id,
        casePrice: caseObj.priceRub, itemName: item.name,
        itemPrice: Number(item.dropVariant.price), tier: item.tier
      });
      if (hist.length > 1000) hist.length = 1000;
      store.lsSet('crate-open-history', JSON.stringify(hist));
    } catch (e) {}
  }

  function init() {
    var data = window.CRATE.data;
    if (!data || !data.cases || !data.cases.length) return;

    var caseId = (new URLSearchParams(location.search).get('case')) || store.lsGet('crate-selected-case', 'pulse');
    var selected = data.cases.find(function (c) { return c.id === caseId; }) || data.cases[0];
    var price = selected.priceRub;
    var skins = (selected.items || []).filter(function (s) { return s.active !== false; });

    var Pricing = window.CratePricing, Drop = window.CrateDrop, Profit = window.CrateProfit;

    // Нормализованные шансы (учитывают per-skin weight из админки). Сервисный
    // слой — единый источник истины и для сайта, и для тестов.
    if (Pricing) {
      var chanceMap = {};
      Pricing.chances(skins).forEach(function (r) { chanceMap[r.item.id || r.item.name] = r.chance; });
      skins.forEach(function (s) { s._chance = chanceMap[s.id || s.name] || 0; });
    } else {
      var tierCount = {};
      skins.forEach(function (s) { tierCount[s.tier] = (tierCount[s.tier] || 0) + 1; });
      skins.forEach(function (s) { s._chance = (TIER_WEIGHT[s.tier] || 0) / (tierCount[s.tier] || 1); });
    }

    var caseNameDisplay = selected.name.charAt(0) + selected.name.slice(1).toLowerCase();
    document.querySelector('[data-case-name]').textContent = caseNameDisplay;
    document.querySelector('[data-case-title]').textContent = caseNameDisplay;
    document.querySelector('[data-case-name-btn]').textContent = caseNameDisplay;
    document.querySelector('[data-case-price]').textContent = Number(price).toLocaleString('ru-RU');
    document.title = 'Crate — ' + caseNameDisplay;

    var countButtons = document.querySelectorAll('.count-btn');
    var currentCount = 1;
    var totalPriceEl = document.querySelector('[data-total-price]');

    function refreshTotalPrice() {
      if (totalPriceEl) totalPriceEl.textContent = Number(currentCount * price).toLocaleString('ru-RU');
    }
    refreshTotalPrice();

    countButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        countButtons.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        currentCount = parseInt(this.dataset.count);
        refreshTotalPrice();
        initRoulettes(currentCount);
      });
    });

    var spinBtn = document.querySelector('.spin');
    var fastOpenBtn = document.getElementById('fastOpenBtn');
    var isFastOpen = false;
    if (spinBtn) spinBtn.innerHTML = '<i class="fa-solid fa-play"></i> Открыть ' + caseNameDisplay;
    if (fastOpenBtn) {
      fastOpenBtn.addEventListener('click', function () {
        isFastOpen = true;
        fastOpenBtn.classList.add('is-active');
        var wrapper = fastOpenBtn.closest('.fast-open-wrapper');
        if (wrapper) wrapper.classList.add('is-active');
        if (spinBtn) {
          spinBtn.classList.add('fast-open');
          spinBtn.innerHTML = '<i class="fa-solid fa-play"></i> Быстрое открытие';
          spinBtn.click();
        }
      });
    }

    var roulettesContainer = document.querySelector('[data-roulettes]');
    var itemsContainer = document.querySelector('[data-items]');

    var ITEM_WIDTH = 130;
    var ITEM_GAP = 10;
    var CYCLES = 8;
    var LAND_CYCLE_START = 5;
    var STRIP_LENGTH = skins.length * (CYCLES + LAND_CYCLE_START + 4);

    function itemTile(s) {
      return '<img src="' + s.image + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        '<small>' + s.name + '</small>';
    }

    function buildLane(index) {
      var lane = document.createElement('div');
      lane.className = 'roulette-lane';
      if (currentCount > 1) {
        lane.innerHTML = '<span class="lane-badge">Кейс ' + (index + 1) + '</span>';
      }
      var strip = document.createElement('div');
      strip.className = 'roulette';
      strip.dataset.index = index;
      var col = tierColor;
      for (var i = 0; i < STRIP_LENGTH; i++) {
        var s = skins[i % skins.length];
        var item = document.createElement('article');
        item.className = 'roulette-item';
        item.style.borderColor = col(s.tier);
        item.style.boxShadow = 'inset 0 3px 0 ' + col(s.tier);
        item.innerHTML = itemTile(s);
        strip.appendChild(item);
      }
      lane.appendChild(strip);
      return lane;
    }

    function initRoulettes(count) {
      roulettesContainer.innerHTML = '';
      roulettesContainer.classList.toggle('multi', count > 1);
      for (var i = 0; i < count; i++) roulettesContainer.appendChild(buildLane(i));
    }
    initRoulettes(currentCount);

    // Список предметов (прозрачные шансы) — кликабельны, ведут на маркет
    itemsContainer.innerHTML = '';
    var sorted = skins.slice().sort(function (a, b) {
      return (TIER_WEIGHT[b.tier] || 0) - (TIER_WEIGHT[a.tier] || 0);
    });
    sorted.forEach(function (s) {
      var pct = (s._chance * 100);
      var pctStr = pct >= 1 ? pct.toFixed(1) + '%' : pct.toFixed(2) + '%';
      var card = document.createElement('article');
      card.className = 'item';
      card.style.borderColor = tierColor(s.tier);
      card.style.boxShadow = 'inset 0 3px 0 ' + tierColor(s.tier);
      card.dataset.market = s.marketUrl;
      card.title = 'Открыть на Market.CSGO';
      card.innerHTML = '<img src="' + s.image + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        '<b>' + s.name + '</b>' +
        '<small>' + pctStr + ' · от ' + money(s.minPrice).replace(' ₽', '') + ' ₽</small>';
      itemsContainer.appendChild(card);
    });
    itemsContainer.addEventListener('click', function (e) {
      var card = e.target.closest('[data-market]');
      if (card && card.dataset.market) window.open(card.dataset.market, '_blank', 'noopener');
    });

    function confettiBurst(container) {
      var colors = ['#f5c156', '#58e2ff', '#8b5cf6', '#ff4d5b', '#fff'];
      for (var i = 0; i < 26; i++) {
        var p = document.createElement('span');
        p.className = 'confetti-bit';
        p.style.setProperty('--x', (Math.random() * 2 - 1).toFixed(2));
        p.style.setProperty('--r', (Math.random() * 720 - 360).toFixed(0) + 'deg');
        p.style.setProperty('--d', (0.7 + Math.random() * 0.7).toFixed(2) + 's');
        p.style.background = colors[i % colors.length];
        p.style.left = (45 + Math.random() * 10) + '%';
        container.appendChild(p);
        (function (el) { setTimeout(function () { el.remove(); }, 1500); })(p);
      }
    }

    // Взвешенный выбор предмета по редкости (вес тира / кол-во предметов тира)
    function rollItem() {
      var total = 0;
      skins.forEach(function (s) { total += (s._chance || 0); });
      var r = Math.random() * total;
      for (var i = 0; i < skins.length; i++) {
        r -= (skins[i]._chance || 0);
        if (r <= 0) return i;
      }
      return skins.length - 1;
    }

    if (spinBtn) {
      spinBtn.addEventListener('click', function (e) {
        var btn = e.currentTarget;
        if (btn.disabled) return;

        var totalPrice = currentCount * price;
        if (window.balance < totalPrice) {
          toast('Недостаточно средств на балансе');
          return;
        }

        isFastOpen = !!(fastOpenBtn && fastOpenBtn.classList.contains('is-active'));

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner ' + (isFastOpen ? '' : 'fa-spin') + '"></i> ' + (isFastOpen ? 'Выдаем...' : 'Открываем...');
        btn.classList.toggle('is-fast', isFastOpen);

        // Прячем название/описание кейса, пока идёт открытие — ленты рулетки
        // растягиваются на всю ширину полотна.
        var openingSection = document.querySelector('.opening');
        if (openingSection) openingSection.classList.add('is-spinning');

        // Профиль игрока и стартовый баланс дня фиксируются ДО списания,
        // чтобы кап считался от реального баланса на начало дня.
        var userId = Profit ? Profit.getUserId() : 'anon';
        if (Profit) Profit.getDailyState(userId, window.balance);

        window.balance -= totalPrice;
        window.updateBalance();

        var chosenIndices = [];
        var results = [];
        var runningBalance = window.balance + totalPrice; // баланс до открытия текущего кейса
        var settings = Profit ? Profit.getSettings() : null;
        for (var i = 0; i < currentCount; i++) {
          var winIndex;
          if (Drop && Pricing) {
            var decision = Drop.rollDrop({
              items: skins, userId: userId, currentBalance: runningBalance,
              casePrice: price, settings: settings
            });
            winIndex = skins.indexOf(decision.item);
            if (winIndex < 0) winIndex = 0;
          } else {
            winIndex = rollItem();
          }
          chosenIndices.push(winIndex);
          results.push(skins[winIndex]);
          runningBalance = runningBalance - price + Number(skins[winIndex].dropVariant.price);
          recordOpening(userId, selected, skins[winIndex]);
        }
        if (Profit) Profit.bumpDailyState(userId, { openings: (Profit.getDailyState(userId, runningBalance).openings || 0) + currentCount });

        // Инвентарь (сессия)
        var inventory = JSON.parse(store.ssGet('crate-inventory') || '[]');
        var sessionIds = results.map(function (win) {
          var id = Date.now().toString() + Math.random().toString();
          inventory.push({
            id: id,
            name: win.name,
            image: win.image,
            tier: win.tier,
            rarityColor: win.rarityColor,
            rarityName: win.rarityName,
            wear: win.dropVariant.wear,
            wearRu: WEAR_RU[win.dropVariant.wear] || win.dropVariant.wear,
            marketHashName: win.dropVariant.marketHashName,
            price: win.dropVariant.price,
            marketUrl: win.marketUrl
          });
          return id;
        });
        store.ssSet('crate-inventory', JSON.stringify(inventory));

        var currentUnsold = results.map(function (r, i) {
          return {
            name: r.name, image: r.image, tier: r.tier, rarityColor: r.rarityColor,
            wear: r.dropVariant.wear, wearRu: WEAR_RU[r.dropVariant.wear] || r.dropVariant.wear,
            marketHashName: r.dropVariant.marketHashName, price: r.dropVariant.price,
            marketUrl: r.marketUrl, id: sessionIds[i], sold: false
          };
        });

        function getLandingOffset(index) {
          var lane = roulettesContainer.querySelectorAll('.roulette')[index];
          var laneWidth = lane && lane.parentElement ? lane.parentElement.clientWidth : 760;
          var landingIndex = (CYCLES + LAND_CYCLE_START + 1) * skins.length + (chosenIndices[index] || 0);
          var base = landingIndex * (ITEM_WIDTH + ITEM_GAP);
          return base - (laneWidth / 2 - ITEM_WIDTH / 2) + 10;
        }

        function renderResults() {
          spinBtn.style.display = 'none';
          roulettesContainer.innerHTML = '';
          var grid = document.createElement('div');
          grid.className = 'results-grid';

          var totalSellValue = 0;
          var unsoldCnt = 0;

          currentUnsold.forEach(function (win) {
            if (win.sold) return;
            totalSellValue += Number(win.price);
            unsoldCnt++;
            var resDiv = document.createElement('div');
            resDiv.className = 'result-item-card';
            resDiv.style.borderColor = win.rarityColor || tierColor(win.tier);
            resDiv.style.boxShadow = 'inset 0 3px 0 ' + (win.rarityColor || tierColor(win.tier));
            resDiv.innerHTML =
              '<img src="' + win.image + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
              '<h4>' + win.name + '</h4>' +
              '<small class="wear">' + (win.wearRu || win.wear) + '</small>' +
              '<p><b>' + money(win.price) + '</b></p>' +
              '<a class="button ghost market-link" href="' + win.marketUrl + '" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> На Market.CSGO</a>' +
              '<button class="button ghost sell-single" data-id="' + win.id + '">Продать</button>';
            grid.appendChild(resDiv);
          });

          if (unsoldCnt > 0) {
            roulettesContainer.appendChild(grid);
            var actionsDiv = document.createElement('div');
            actionsDiv.className = 'results-actions';
            actionsDiv.innerHTML = '<button class="button primary sell-all">Продать все за ' + money(totalSellValue) + '</button>' +
              '<button class="button ghost keep-all">Забрать</button>' +
              '<button class="button primary spin-again"><i class="fa-solid fa-rotate-right"></i> Открыть еще раз</button>';
            roulettesContainer.appendChild(actionsDiv);

            actionsDiv.querySelector('.sell-all').addEventListener('click', function () {
              var soldIds = [];
              var soldTotal = 0;
              currentUnsold.forEach(function (u) {
                if (!u.sold) { u.sold = true; soldIds.push(u.id); soldTotal += Number(u.price); }
              });
              if (soldIds.length) {
                window.balance += soldTotal;
                window.updateBalance();
                var inv = JSON.parse(store.ssGet('crate-inventory') || '[]');
                inv = inv.filter(function (item) { return soldIds.indexOf(item.id) === -1; });
                store.ssSet('crate-inventory', JSON.stringify(inv));
                toast('Продано за ' + money(soldTotal));
              }
              resetToNormal();
            });
            actionsDiv.querySelector('.keep-all').addEventListener('click', resetToNormal);
            actionsDiv.querySelector('.spin-again').addEventListener('click', function () {
              resetToNormal();
              spinBtn.click();
            });
            grid.querySelectorAll('.sell-single').forEach(function (button) {
              button.addEventListener('click', function () {
                var target = currentUnsold.find(function (item) { return item.id == this.dataset.id; }.bind(this));
                if (!target || target.sold) return;
                target.sold = true;
                sellItem(target.id, target.price);
                resetToNormal();
              }.bind(button));
            });
          } else {
            resetToNormal();
          }
        }

        function sellItem(id, val) {
          window.balance += Number(val);
          window.updateBalance();
          var inv = JSON.parse(store.ssGet('crate-inventory') || '[]');
          inv = inv.filter(function (item) { return item.id != id; });
          store.ssSet('crate-inventory', JSON.stringify(inv));
          var soldItem = currentUnsold.find(function (item) { return item.id == id; });
          if (soldItem) soldItem.sold = true;
          toast('Продано за ' + money(val));
        }

        function resetToNormal() {
          spinBtn.style.display = '';
          spinBtn.disabled = false;
          spinBtn.classList.remove('is-fast');
          spinBtn.classList.remove('fast-open');
          spinBtn.innerHTML = '<i class="fa-solid fa-play"></i> Открыть ' + caseNameDisplay;
          if (fastOpenBtn) {
            fastOpenBtn.classList.remove('is-active');
            fastOpenBtn.closest('.fast-open-wrapper').classList.remove('is-active');
          }
          isFastOpen = false;
          if (openingSection) openingSection.classList.remove('is-spinning');
          initRoulettes(currentCount);
        }

        if (isFastOpen) {
          renderResults();
          if (results.some(function (w) { return w.tier === 'rare' || w.tier === 'covert'; })) confettiBurst(roulettesContainer);
        } else {
          initRoulettes(currentCount);
          var strips = roulettesContainer.querySelectorAll('.roulette');
          strips.forEach(function (strip, index) {
            var targetOffset = getLandingOffset(index);
            strip.style.transition = 'none';
            strip.style.transform = 'translateX(0)';
            requestAnimationFrame(function () {
              strip.style.transition = 'transform 5.2s cubic-bezier(0.2, 0, 0.3, 1)';
              strip.style.transform = 'translateX(-' + Math.max(0, targetOffset) + 'px)';
            });
          });
          setTimeout(function () {
            renderResults();
            if (results.some(function (w) { return w.tier === 'rare' || w.tier === 'covert'; })) confettiBurst(roulettesContainer);
          }, 5200);
        }
      });
    }
  }

  window.CRATE.ready.then(init).catch(function () { /* ошибка показана в app.js */ });
});