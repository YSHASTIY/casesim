// CRATE — инвентарь: реальные предметы, цены в рублях, ссылка на Market.CSGO.
document.addEventListener('DOMContentLoaded', function () {
  var grid = document.querySelector('[data-inventory]');
  if (!grid) return;

  var store = window.store;
  var money = window.money || function (n) { return Number(n).toLocaleString('ru-RU') + ' ₽'; };

  function read() {
    return JSON.parse(store.ssGet('crate-inventory') || '[]');
  }
  function save(items) {
    store.ssSet('crate-inventory', JSON.stringify(items));
  }

  function render() {
    var items = read();
    var total = items.reduce(function (sum, item) { return sum + Number(item.price); }, 0);

    var sellAllBtn = document.querySelector('.sell-all-inventory');
    if (sellAllBtn) {
      sellAllBtn.disabled = !items.length;
      sellAllBtn.classList.toggle('is-disabled', !items.length);
    }

    var countEl = document.querySelector('[data-inventory-count]');
    var valueEl = document.querySelector('[data-inventory-value]');
    if (countEl) countEl.textContent = items.length + ' ' + (items.length === 1 ? 'предмет' : 'предметов');
    if (valueEl) valueEl.textContent = Number(total).toLocaleString('ru-RU');

    if (!items.length) {
      grid.innerHTML = '<div class="empty-inventory">' +
        '<i class="fa-solid fa-box-open"></i>' +
        '<h2>Инвентарь пока пуст</h2>' +
        '<p>Открой кейс, чтобы первый скин появился здесь.</p>' +
        '<a class="button primary" href="cases.html">Перейти к кейсам</a>' +
        '</div>';
      return;
    }

    grid.innerHTML = items.map(function (item, index) {
      var col = item.rarityColor || '#5e98d9';
      return '<article class="inv-card" data-item="' + index + '" style="border-color:' + col + ';box-shadow:inset 0 3px 0 ' + col + '">' +
        '<img src="' + (item.image || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        '<small>' + (item.rarityName || item.tier || '') + '</small>' +
        '<h3>' + item.name + '</h3>' +
        '<small class="wear">' + (item.wearRu || item.wear || '') + '</small>' +
        '<div><b>' + money(Number(item.price)) + '</b>' +
        '<a class="market-link-inline" href="' + (item.marketUrl || '#') + '" target="_blank" rel="noopener" title="На Market.CSGO"><i class="fa-solid fa-up-right-from-square"></i></a>' +
        '<button class="sell-skin" data-index="' + index + '">Продать</button></div>' +
        '</article>';
    }).join('');
  }

  render();

  var sellAllBtn = document.querySelector('.sell-all-inventory');
  if (sellAllBtn) {
    sellAllBtn.addEventListener('click', function () {
      var items = read();
      if (!items.length) return;
      var total = items.reduce(function (sum, item) { return sum + Number(item.price); }, 0);
      window.balance += total;
      window.updateBalance();
      save([]);
      render();
      toast('Все предметы проданы за ' + money(total));
    });
  }

  grid.addEventListener('click', function (e) {
    var sell = e.target.closest('.sell-skin');
    if (!sell) return;
    var items = read();
    var index = Number(sell.dataset.index);
    var item = items[index];
    if (!item) return;
    window.balance += Number(item.price);
    window.updateBalance();
    items.splice(index, 1);
    save(items);
    var card = sell.closest('.inv-card');
    if (card) card.classList.add('sold');
    setTimeout(render, 260);
    toast('Предмет продан за ' + money(Number(item.price)));
  });
});
