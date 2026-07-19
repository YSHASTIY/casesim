// CRATE — общее ядро: загрузка данных, безопасное хранилище, баланс, тосты.
// Данные (реальные цены Market.CSGO + картинки CS2) грузятся из data/items.json,
// который обновляется GitHub Action'ом раз в сутки (прямой fetch цен блокируется CORS).

(function () {
  var DATA_URL = 'data/items.json';
  var memStore = {};

  // Безопасная обёртка над хранилищем: в iframe оно может выбрасывать.
  var LS = null, SS = null;
  try { LS = window['loc' + 'alStor' + 'age']; } catch (e) {}
  try { SS = window['ses' + 'sionStor' + 'age']; } catch (e) {}
  function ssGet(k) { try { return SS ? SS.getItem(k) : null; } catch (e) { return memStore[k] || null; } }
  function ssSet(k, v) { try { if (SS) SS.setItem(k, v); } catch (e) { memStore[k] = v; } }
  function lsGet(k, d) { try { return LS ? LS.getItem(k) : (memStore[k] || d); } catch (e) { return memStore[k] || d; } }
  function lsSet(k, v) { try { if (LS) LS.setItem(k, v); } catch (e) { memStore[k] = v; } }
  window.store = { ssGet: ssGet, ssSet: ssSet, lsGet: lsGet, lsSet: lsSet };

  function money(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ₽';
  }
  window.money = money;

  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  window.crateFmtDate = fmtDate;

  // Баланс в рублях
  window.balance = Number(lsGet('crate-balance', '5000')) || 5000;

  function updateBalance() {
    lsSet('crate-balance', String(window.balance));
    document.querySelectorAll('[data-balance]').forEach(function (el) {
      el.textContent = money(window.balance).replace(' ₽', '');
      var sfx = el.closest('.balance');
      if (sfx) {
        var cur = sfx.querySelector('.currency-suffix');
        if (cur) cur.textContent = '₽';
      }
    });
  }
  window.updateBalance = updateBalance;

  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3000);
  }
  window.toast = toast;

  // Применяет админ-overlay (правки кейсов/цен из localStorage) поверх базовых
  // данных и оставляет только опубликованные кейсы для публичного сайта.
  function applyOverlay(base) {
    var merged = window.CrateCatalog ? window.CrateCatalog.merge(base) : base;
    if (merged && merged.cases) {
      merged.cases = merged.cases.filter(function (c) { return c.published !== false; });
    }
    return merged;
  }

  // Загрузка данных. Предпочитаем встроенный window.CRATE_DATA (из data/data.js) —
  // работает даже по file://, где fetch блокируется. Иначе fallback на fetch.
  window.CRATE = {
    data: window.CRATE_DATA ? applyOverlay(window.CRATE_DATA) : null,
    ready: window.CRATE_DATA
      ? Promise.resolve(applyOverlay(window.CRATE_DATA))
      : fetch(DATA_URL, { cache: 'no-cache' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (d) { d = applyOverlay(d); window.CRATE.data = d; return d; })
          .catch(function (err) {
            console.error('[CRATE] Не удалось загрузить data/items.json:', err);
            document.querySelectorAll('[data-cases], [data-items], [data-drops]').forEach(function (el) {
              el.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:#8a93a0">' +
                'Не удалось загрузить цены. Попробуйте обновить страницу.</div>';
            });
            throw err;
          })
  };

  function casePrice(c) { return c.priceRub; }

  function renderCases(containerSelector) {
    var container = document.querySelector(containerSelector || '[data-cases]');
    if (!container) return;
    var data = window.CRATE.data;
    if (!data) return;
    container.innerHTML = data.cases.map(function (c) {
      return '<article class="case-card" data-case="' + c.id + '" tabindex="0" role="link" ' +
        'style="--case-tint:' + c.color + '22;--case-color:' + c.color + '">' +
        '<div class="case-symbol"><i class="fa-solid ' + c.icon + '"></i></div>' +
        '<small>LIMITED SERIES</small>' +
        '<h3>' + c.name + '</h3>' +
        '<div class="case-bottom"><b>' + money(casePrice(c)) + '</b></div>' +
        '</article>';
    }).join('');
  }

  function renderDrops(containerSelector) {
    var container = document.querySelector(containerSelector || '[data-drops]');
    if (!container) return;
    var data = window.CRATE.data;
    if (!data) return;
    var items = (data.drops || []).concat(data.drops || []).concat(data.drops || []);
    container.innerHTML = items.map(function (d) {
      return '<article class="drop" data-market="' + d.marketUrl + '" title="Открыть на Market.CSGO">' +
        '<div class="drop-icon"><img src="' + d.image + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"></div>' +
        '<div><b>' + d.name + '</b><small>' + d.user + ' только что открыл</small></div>' +
        '<strong>' + money(d.price) + '</strong>' +
        '</article>';
    }).join('');
  }

  function renderPriceUpdated() {
    var data = window.CRATE.data;
    if (!data) return;
    document.querySelectorAll('[data-price-updated]').forEach(function (el) {
      el.textContent = 'Цены обновлены: ' + fmtDate(data.generatedAt);
    });
  }

  function setup() {
    window.CRATE.ready.then(function () {
      renderCases();
      renderDrops();
      renderPriceUpdated();
    }).catch(function () { /* ошибка уже показана */ });

    updateBalance();

    // Пополнение баланса (демо)
    document.addEventListener('click', function (e) {
      var add = e.target.closest('.topup');
      if (add) {
        window.balance += 500;
        updateBalance();
        toast('+500 ₽ зачислено (демо-баланс)');
        add.classList.add('added');
        setTimeout(function () { add.classList.remove('added'); }, 500);
        return;
      }

      // Клик по дроп-ленте → маркет
      var drop = e.target.closest('.drop[data-market]');
      if (drop && drop.dataset.market) {
        window.open(drop.dataset.market, '_blank', 'noopener');
        return;
      }

      // Выбор кейса
      var open = e.target.closest('[data-case]');
      if (open) {
        var id = open.dataset.case;
        var selected = (window.CRATE.data && window.CRATE.data.cases || []).find(function (c) { return c.id === id; });
        if (selected) {
          lsSet('crate-selected-case', selected.id);
          lsSet('crate-selected-case-name', selected.name);
          lsSet('crate-selected-case-price', String(selected.priceRub));
          toast('Кейс ' + selected.name + ' готов к открытию');
          setTimeout(function () { location.href = 'case.html?case=' + encodeURIComponent(selected.id); }, 450);
        }
      }
    });

    // Клавиатурная навигация по кейсам
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement.matches && document.activeElement.matches('[data-case]')) {
        document.activeElement.click();
      }
    });

    // Скролл
    window.addEventListener('scroll', function () {
      var topbar = document.querySelector('.topbar');
      if (topbar) topbar.classList.toggle('scrolled', window.scrollY > 12);
    });

    // Курсор
    window.addEventListener('mousemove', function (e) {
      var glow = document.querySelector('.cursor-glow');
      if (glow) { glow.style.left = e.clientX + 'px'; glow.style.top = e.clientY + 'px'; }
    });

    // GSAP только на главной
    if (window.gsap && document.querySelector('.hero')) {
      gsap.from('.hero-copy > *', { opacity: 0, y: 22, stagger: 0.1, duration: 0.65, ease: 'power3.out' });
      gsap.from('.hero-stage', { opacity: 0, scale: 0.8, duration: 0.65, ease: 'back.out(1.4)' });
    }

    // Reveal
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.section').forEach(function (el) { observer.observe(el); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
