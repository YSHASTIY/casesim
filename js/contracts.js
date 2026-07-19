// CRATE — контракты. Отдаваемые и получаемые предметы — реальные скины
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

    // Пул возможных наград контракта: все уникальные скины из всех кейсов.
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

    // Ближайший по цене реальный скин к целевой стоимости контракта.
    function findClosestByPrice(targetPrice) {
      if (!catalog.length) return null;
      var best = catalog[0];
      var bestDiff = Math.abs(catalog[0].price - targetPrice);
      for (var i = 1; i < catalog.length; i++) {
        var diff = Math.abs(catalog[i].price - targetPrice);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = catalog[i];
        }
      }
      return best;
    }

    function inv() {
      return JSON.parse(window.store.ssGet('crate-inventory') || '[]');
    }

    function saveInv(items) {
      window.store.ssSet('crate-inventory', JSON.stringify(items));
    }

    var money = window.money || function (n) { return Number(n || 0).toLocaleString('ru-RU') + ' ₽'; };
    // Для result-value в модалке ₽ уже стоит в разметке рядом со span — числу
    // без суффикса, иначе получится «2 500 ₽ ₽».
    function plainNumber(n) {
      return Number(n || 0).toLocaleString('ru-RU');
    }

    var container = document.querySelector('[data-contract-inventory]');
    var selectedContainer = document.querySelector('[data-selected-items]');
    var button = document.querySelector('.create-contract');
    var modal = document.querySelector('.contract-modal');
    var resultImage = modal ? modal.querySelector('.result-image') : null;
    var resultWear = modal ? modal.querySelector('.result-wear') : null;
    var resultName = modal ? modal.querySelector('.result-name') : null;
    var resultValue = modal ? modal.querySelector('.result-value') : null;
    var closeModal = modal ? modal.querySelector('.close-modal') : null;

    var selected = [];

    function renderInventory() {
      var items = inv();
      if (!container) return;
      if (items.length === 0) {
        container.innerHTML = '<div class="empty-inventory">' +
          '<i class="fa-solid fa-box-open"></i>' +
          '<h2>Инвентарь пуст</h2>' +
          '<p>Откройте кейсы, чтобы получить предметы для контракта.</p>' +
          '</div>';
        return;
      }
      container.innerHTML = items.map(function (item, idx) {
        var selectedClass = selected.indexOf(idx) !== -1 ? 'selected' : '';
        return '<div class="contract-item ' + selectedClass + '" data-index="' + idx + '" style="border-color:' + (item.rarityColor || '#5e98d9') + '">' +
          '<img src="' + (item.image || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
          '<span>' + item.name + '</span>' +
          '<small class="wear">' + (item.wearRu || item.wear || '') + '</small>' +
          '<b>' + money(item.price) + '</b>' +
          '</div>';
      }).join('');
      updateSelectedUI();
    }

    function updateSelectedUI() {
      if (!selectedContainer) return;
      var items = inv();
      var sel = selected.map(function (i) { return items[i]; }).filter(Boolean);
      if (sel.length) {
        selectedContainer.innerHTML = sel.map(function (item) {
          return '<span>' + item.name + ' (' + money(item.price) + ')</span>';
        }).join(' + ');
      } else {
        selectedContainer.innerHTML = '<span class="placeholder">Выберите минимум 3 предмета</span>';
      }
      button.disabled = selected.length < 3;
    }

    container.addEventListener('click', function (e) {
      var card = e.target.closest('.contract-item');
      if (!card) return;
      var idx = Number(card.dataset.index);
      var pos = selected.indexOf(idx);
      if (pos !== -1) {
        selected.splice(pos, 1);
      } else {
        if (selected.length >= 5) {
          toast('Можно выбрать не более 5 предметов');
          return;
        }
        selected.push(idx);
      }
      renderInventory();
    });

    button.addEventListener('click', function () {
      if (selected.length < 3) return;
      var items = inv();
      var chosen = selected.map(function (i) { return items[i]; });
      var totalValue = chosen.reduce(function (sum, item) {
        return sum + Number(item.price);
      }, 0);
      var targetValue = Math.ceil(totalValue / 2);

      var remaining = items.filter(function (_, i) {
        return selected.indexOf(i) === -1;
      });
      selected = [];

      var won = findClosestByPrice(targetValue);
      if (!won) {
        toast('Не удалось подобрать предмет для контракта');
        saveInv(remaining);
        renderInventory();
        updateSelectedUI();
        return;
      }

      var newItem = {
        id: Date.now().toString() + Math.random().toString(),
        name: won.name,
        image: won.image,
        tier: won.tier,
        rarityColor: won.rarityColor,
        rarityName: won.rarityName,
        wear: won.wear,
        wearRu: won.wearRu,
        marketHashName: won.marketHashName,
        price: won.price,
        marketUrl: won.marketUrl
      };
      remaining.push(newItem);
      saveInv(remaining);

      if (modal) {
        if (resultImage) resultImage.src = newItem.image || '';
        if (resultWear) resultWear.textContent = newItem.wearRu || '';
        resultName.textContent = newItem.name;
        resultValue.textContent = plainNumber(newItem.price);
        modal.classList.add('show');
      } else {
        toast('Контракт выполнен! Получен ' + newItem.name + ' (' + money(newItem.price) + ')');
      }

      renderInventory();
      updateSelectedUI();
    });

    if (closeModal) {
      closeModal.addEventListener('click', function () {
        modal.classList.remove('show');
      });
    }

    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) modal.classList.remove('show');
      });
    }

    renderInventory();
    updateSelectedUI();

  }).catch(function () { /* ошибка уже показана в app.js */ });
});