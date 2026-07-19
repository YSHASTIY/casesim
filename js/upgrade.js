// CRATE — апгрейд предметов. Цель апгрейда и инвентарь — реальные скины
// с картинками и ценами Market.CSGO (window.CRATE.data), без выдуманных предметов.

document.addEventListener('DOMContentLoaded', function () {
  window.CRATE.ready.then(function () {

    var WEAR_RU = {
      'Factory New': 'Прямо с завода',
      'Minimal Wear': 'Немного поношенное',
      'Field-Tested': 'После полевых испытаний',
      'Well-Worn': 'Поношенное',
      'Battle-Scarred': 'Закалённое в боях'
    };

    // Каталог целей апгрейда: все уникальные скины из всех кейсов, отсортированные по цене.
    function buildCatalog() {
      var data = window.CRATE.data;
      if (!data || !data.cases) return [];
      var seen = {};
      var list = [];
      data.cases.forEach(function (c) {
        c.items.forEach(function (it) {
          if (seen[it.name]) return;
          seen[it.name] = true;
          var dv = it.dropVariant || {};
          list.push({
            name: it.name,
            image: it.image,
            tier: it.tier,
            rarityName: it.rarityName,
            rarityColor: it.rarityColor,
            wear: dv.wear,
            wearRu: WEAR_RU[dv.wear] || dv.wear,
            marketHashName: dv.marketHashName,
            price: dv.price,
            marketUrl: it.marketUrl
          });
        });
      });
      list.sort(function (a, b) { return a.price - b.price; });
      return list;
    }

    var catalog = buildCatalog();

    var selectedItems = [];
    var extraStake = 0;
    var totalStake = 0;
    var target = null;
    var multiplier = 2;
    var locked = false;

    function inv() {
      return JSON.parse(window.store.ssGet('crate-inventory') || '[]');
    }

    function saveInv(items) {
      window.store.ssSet('crate-inventory', JSON.stringify(items));
    }

    function $(selector) {
      return document.querySelector(selector);
    }

    var money = window.money || function (n) { return Number(n || 0).toLocaleString('ru-RU') + ' ₽'; };

    // ---------- Инвентарь (большие плитки) ----------
    function renderInventoryPicker() {
      var items = inv();
      var container = $('[data-inventory-picker]');
      if (!container) return;
      if (items.length === 0) {
        container.innerHTML = '<div class="no-items-msg">Инвентарь пуст. Откройте кейсы!</div>';
        return;
      }
      container.innerHTML = items.map(function (item, idx) {
        var selectedClass = selectedItems.indexOf(idx) !== -1 ? 'selected' : '';
        return '<div class="upgrade-tile ' + selectedClass + '" data-item-index="' + idx + '" style="border-color:' + (item.rarityColor || '#5e98d9') + '">' +
          '<span class="tile-check"><i class="fa-solid fa-check"></i></span>' +
          '<img src="' + (item.image || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
          '<span>' + item.name + '</span>' +
          '<b>' + money(item.price) + '</b>' +
          '</div>';
      }).join('');

      container.querySelectorAll('.upgrade-tile').forEach(function (el) {
        el.addEventListener('click', function () {
          if (locked) return;
          var idx = Number(el.dataset.itemIndex);
          var pos = selectedItems.indexOf(idx);
          if (pos !== -1) {
            selectedItems.splice(pos, 1);
          } else {
            if (selectedItems.length >= 4) {
              toast('Можно выбрать не более 4 предметов');
              return;
            }
            selectedItems.push(idx);
          }
          updateTotalStake();
          renderInventoryPicker();
          renderSelectedSlots();
          autoSelectTarget();
          updateUI();
        });
      });
    }

    // ---------- Выбранные предметы (большие плитки сверху) ----------
    function renderSelectedSlots() {
      var container = $('[data-selected-slots]');
      if (!container) return;
      var items = inv();
      var selected = selectedItems.map(function (i) { return { i: i, item: items[i] }; }).filter(function (x) { return x.item; });
      if (selected.length) {
        container.className = 'selected-slots has-items';
        container.innerHTML = selected.map(function (x) {
          return '<div class="upgrade-tile big" data-remove-index="' + x.i + '" style="border-color:' + (x.item.rarityColor || '#5e98d9') + '">' +
            '<button class="tile-remove" data-remove-index="' + x.i + '"><i class="fa-solid fa-xmark"></i></button>' +
            '<img src="' + (x.item.image || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
            '<span>' + x.item.name + '</span>' +
            '<b>' + money(x.item.price) + '</b>' +
            '</div>';
        }).join('');
        container.querySelectorAll('.tile-remove').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (locked) return;
            var idx = Number(btn.dataset.removeIndex);
            var pos = selectedItems.indexOf(idx);
            if (pos !== -1) selectedItems.splice(pos, 1);
            updateTotalStake();
            renderInventoryPicker();
            renderSelectedSlots();
            autoSelectTarget();
            updateUI();
          });
        });
      } else {
        container.className = 'selected-slots';
        container.innerHTML = '<span class="empty-slots">Выберите предметы из инвентаря ниже</span>';
      }
    }

    function updateTotalStake() {
      var items = inv();
      var sumItems = selectedItems.reduce(function (sum, i) {
        return sum + Number(items[i].price);
      }, 0);
      totalStake = sumItems + extraStake;
      $('[data-stake-total]').textContent = money(sumItems);
      $('[data-items-count]').textContent = selectedItems.length;
      $('[data-total-stake]').textContent = money(totalStake);
      $('[data-extra-value]').textContent = money(extraStake);

      var maxExtra = Math.max(0, window.balance - sumItems);
      var range = $('[data-extra-range]');
      range.max = maxExtra;
      if (extraStake > maxExtra) {
        extraStake = maxExtra;
        range.value = extraStake;
        $('[data-extra-value]').textContent = money(extraStake);
        updateTotalStake();
      }
    }

    // ---------- Целевой предмет: большая плитка + список остальных ----------
    function renderTargetSelected() {
      var container = $('[data-target-selected]');
      if (!container) return;
      if (target === null) {
        container.className = 'target-selected';
        container.innerHTML = '<span class="empty-target">Выберите цель из списка ниже</span>';
        return;
      }
      var goal = catalog[target];
      container.className = 'target-selected has-target';
      container.innerHTML = '<div class="target-hero-tile" style="border-color:' + (goal.rarityColor || 'var(--gold)') + '">' +
        '<img src="' + (goal.image || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        '<h4>' + goal.name + '</h4>' +
        '<small>' + (goal.rarityName || '') + (goal.wearRu ? ' · ' + goal.wearRu : '') + '</small>' +
        '<b>' + money(goal.price) + '</b>' +
        '</div>';
    }

    function renderCatalog() {
      var container = $('[data-target-catalog]');
      var rows = catalog
        .map(function (item, i) { return { item: item, i: i }; })
        .filter(function (x) { return x.i !== target; });
      if (!rows.length) {
        container.innerHTML = '<div class="no-items-msg">Это все доступные предметы</div>';
        return;
      }
      container.innerHTML = rows.map(function (x) {
        // Визуально блокируем предметы, которые не подходят для апгрейда
        var invalid = x.item.price <= totalStake ? ' style="opacity:0.3; pointer-events:none;"' : '';
        return '<button class="upgrade-target-row" data-target="' + x.i + '"' + invalid + '>' +
          '<img src="' + (x.item.image || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
          '<span><b>' + x.item.name + '</b><small>' + (x.item.rarityName || '') + '</small></span>' +
          '<strong>' + money(x.item.price) + '</strong>' +
          '</button>';
      }).join('');
    }

    function calcChance() {
      if (target === null || totalStake <= 0) return 0;
      var price = catalog[target].price;
      // Формула с учетом 10% комиссии сайта.
      // Пример: ставка 500, цель 1000 -> (500 / 1000) * 90 = 45% шанс.
      var chance = (totalStake / price) * 90;
      // Лимит в 90%, чтобы 100% шанса не было никогда
      return Math.min(90, chance);
    }

    function updateUI() {
      var odds = calcChance();
      var targetPrice = target !== null ? catalog[target].price : 0;
      // Проверка: ставка больше или равна цене цели (запрет даунгрейда)
      var isInvalid = target !== null && totalStake >= targetPrice;

      $('[data-chance]').textContent = isInvalid ? 'MAX' : odds.toFixed(2) + '%';

      var circumference = 327;
      var offset = circumference - (circumference * odds / 100);
      var progress = document.querySelector('.chance-progress');
      if (progress) {
        progress.style.strokeDashoffset = isInvalid ? 0 : offset;
      }

      var action = $('.upgrade-action');
      action.disabled = locked || target === null || totalStake <= 0 || selectedItems.length === 0 || isInvalid;

      if (locked) {
        action.textContent = 'Идёт апгрейд…';
      } else if (target === null) {
        action.textContent = 'Выберите цель';
      } else if (selectedItems.length === 0) {
        action.textContent = 'Выберите предметы';
      } else if (isInvalid) {
        action.textContent = 'Цель должна быть дороже ставки';
      } else {
        action.textContent = 'Апгрейд за ' + money(totalStake);
      }

      $('[data-total-stake]').textContent = money(totalStake);
      $('[data-items-count]').textContent = selectedItems.length;
      var sumItems = selectedItems.reduce(function (s, i) {
        return s + Number(inv()[i].price);
      }, 0);
      $('[data-stake-total]').textContent = money(sumItems);
    }

    function autoSelectTarget() {
      if (totalStake <= 0) {
        target = null;
        renderCatalog();
        renderTargetSelected();
        updateUI();
        return;
      }
      var desired = totalStake * multiplier;
      var best = null;
      var bestDiff = Infinity;
      catalog.forEach(function (item, i) {
        // Игнорируем предметы, которые дешевле или равны ставке
        if (item.price <= totalStake) return;
        var diff = Math.abs(item.price - desired);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      });
      target = best;
      renderCatalog();
      renderTargetSelected();
      updateUI();
    }

    function resetState() {
      locked = false;
      selectedItems = [];
      extraStake = 0;
      $('[data-extra-range]').value = 0;
      // Сбрасываем анимацию стрелки и цвет
      var wheel = $('[data-wheel]');
      wheel.classList.remove('win', 'lose');
      var pointer = wheel.querySelector('.wheel-pointer');
      pointer.style.transition = 'none';
      pointer.style.transform = 'translate(-50%, -50%) rotate(0deg)';
      // Принудительный рефлоу
      void pointer.offsetHeight;
      pointer.style.transition = '';

      renderInventoryPicker();
      renderSelectedSlots();
      updateTotalStake();
      autoSelectTarget();
      updateUI();
    }

    // Extra ползунок
    var extraRange = $('[data-extra-range]');
    extraRange.addEventListener('input', function () {
      if (locked) return;
      extraStake = Number(this.value);
      $('[data-extra-value]').textContent = money(extraStake);
      updateTotalStake();
      autoSelectTarget();
      updateUI();
    });

    // Extra пресеты
    document.querySelectorAll('[data-extra]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (locked) return;
        var val = Number(this.dataset.extra);
        var maxExtra = Number($('[data-extra-range]').max);
        extraStake = Math.min(val, maxExtra);
        $('[data-extra-range]').value = extraStake;
        $('[data-extra-value]').textContent = money(extraStake);
        updateTotalStake();
        autoSelectTarget();
        updateUI();
      });
    });

    // Выбор цели (клик по строке в списке справа)
    document.addEventListener('click', function (e) {
      if (locked) return;

      var row = e.target.closest('[data-target]');
      if (row) {
        target = Number(row.dataset.target);
        renderCatalog();
        renderTargetSelected();

        var price = catalog[target].price;
        var items = inv();
        var sumItems = selectedItems.reduce(function (s, i) {
          return s + Number(items[i].price);
        }, 0);
        var maxExtra = Math.max(0, price - sumItems);
        if (extraStake > maxExtra) {
          extraStake = maxExtra;
          $('[data-extra-range]').value = extraStake;
          $('[data-extra-value]').textContent = money(extraStake);
          updateTotalStake();
        }
        updateUI();
      }

      var multi = e.target.closest('[data-multiplier]');
      if (multi) {
        multiplier = Number(multi.dataset.multiplier);
        document.querySelectorAll('[data-multiplier]').forEach(function (b) {
          b.classList.toggle('active', b === multi);
        });
        autoSelectTarget();
      }
    });

    // Основная кнопка – анимация стрелки честно соответствует результату
    $('.upgrade-action').addEventListener('click', function () {
      if (locked || target === null || selectedItems.length === 0 || totalStake <= 0) return;

      var odds = calcChance();
      if (extraStake > 0 && window.balance < extraStake) {
        toast('Недостаточно средств для добровольной ставки');
        return;
      }

      locked = true;
      updateUI();

      var wheel = $('[data-wheel]');
      var pointer = wheel.querySelector('.wheel-pointer');
      wheel.classList.remove('win', 'lose');

      // Определяем успех
      var success = Math.random() * 100 < odds;

      // Зелёная зона на кольце — это первые odds% окружности (по часовой стрелке от 0°),
      // ровно то же самое, что рисует .chance-progress. Стрелка ДОЛЖНА попасть
      // именно в эту зону при успехе и строго вне её при неудаче — иначе результат
      // выглядит нечестным.
      var zoneDeg = Math.max(0, Math.min(360, odds / 100 * 360));
      var margin = Math.min(5, zoneDeg * 0.12, (360 - zoneDeg) * 0.12);
      var landingDeg;
      if (success) {
        var loS = Math.min(margin, zoneDeg / 3);
        var hiS = Math.max(loS + 0.01, zoneDeg - loS);
        landingDeg = loS + Math.random() * (hiS - loS);
      } else {
        var loF = zoneDeg + Math.min(margin, (360 - zoneDeg) / 3);
        var hiF = 360 - Math.min(margin, (360 - zoneDeg) / 3);
        if (hiF <= loF) { loF = zoneDeg; hiF = 360; }
        landingDeg = loF + Math.random() * (hiF - loF);
      }

      var fullRotations = 4 + Math.floor(Math.random() * 2); // 4 или 5 полных оборотов
      var newAngle = fullRotations * 360 + landingDeg;

      pointer.style.transition = 'transform 2.5s cubic-bezier(0.13, 0.61, 0.16, 1)';
      pointer.style.transform = 'translate(-50%, -50%) rotate(' + newAngle + 'deg)';

      var onFinish = function () {
        pointer.removeEventListener('transitionend', onFinish);
        wheel.classList.add(success ? 'win' : 'lose');

        var items = inv();
        var sorted = selectedItems.slice().sort(function (a, b) { return b - a; });
        sorted.forEach(function (idx) {
          items.splice(idx, 1);
        });
        if (extraStake > 0) {
          window.balance -= extraStake;
          window.updateBalance();
        }
        saveInv(items);

        if (success) {
          var goal = catalog[target];
          items.push({
            id: Date.now().toString() + Math.random().toString(),
            name: goal.name,
            image: goal.image,
            tier: goal.tier,
            rarityColor: goal.rarityColor,
            rarityName: goal.rarityName,
            wear: goal.wear,
            wearRu: goal.wearRu,
            marketHashName: goal.marketHashName,
            price: goal.price,
            marketUrl: goal.marketUrl
          });
          saveInv(items);
          toast('Успех! ' + goal.name + ' добавлен в инвентарь');
        } else {
          toast('Апгрейд не удался. Ставка списана.');
        }

        locked = false;
        setTimeout(resetState, 900);
      };

      pointer.addEventListener('transitionend', onFinish);
    });

    // Инициализация
    renderCatalog();
    renderTargetSelected();
    renderInventoryPicker();
    renderSelectedSlots();
    resetState();

  }).catch(function () { /* ошибка уже показана в app.js */ });
});