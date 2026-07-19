#!/usr/bin/env python3
import re, glob, os

files = glob.glob("*.html")

bal_re = re.compile(
    r'<button class="balance">\s*<i class="fa-solid fa-gem"></i>\s*<b data-balance>2 450</b>\s*</button>'
)
bal_new = '<button class="balance"><b data-balance>5 000</b> ₽</button>'

invval_re = re.compile(
    r'<b>\s*<i class="fa-solid fa-gem"></i>\s*<span data-inventory-value>0</span>\s*</b>'
)
invval_new = '<b><span data-inventory-value>0</span> ₽</b>'

for f in files:
    s = open(f, encoding="utf-8").read()
    orig = s
    s = bal_re.sub(bal_new, s)
    s = invval_re.sub(invval_new, s)
    s = s.replace('aria-label="Получить игровые кристаллы"', 'aria-label="Пополнить баланс"')
    # case.html: цены в рублях
    s = s.replace('<span data-case-price>99</span> кристаллов', '<span data-case-price>99</span> ₽')
    s = s.replace('<span data-total-price>99</span> кристаллов', '<span data-total-price>99</span> ₽')
    # contracts / leaderboard
    s = s.replace('<p>Стоимость: <span class="result-value">2500</span> кристаллов</p>',
                 '<p>Стоимость: <span class="result-value">2500</span> ₽</p>')
    s = s.replace('18 420 кристаллов', '18 420 ₽')
    s = s.replace('24 890 кристаллов', '24 890 ₽')
    s = s.replace('15 760 кристаллов', '15 760 ₽')
    # upgrade stake labels
    s = s.replace('<span>Сумма: <b data-stake-total>0</b> <i class="fa-solid fa-gem"></i></span>',
                 '<span>Сумма: <b data-stake-total>0 ₽</b></span>')
    s = s.replace('<span>Общая ставка: <b data-total-stake>0</b> <i class="fa-solid fa-gem"></i></span>',
                 '<span>Общая ставка: <b data-total-stake>0 ₽</b></span>')
    s = s.replace('Добавить кристаллы (для повышения шанса)', 'Добавить ставку (для повышения шанса)')
    # faq: валюта теперь рубли (демо-баланс)
    s = s.replace('<b>Что такое кристаллы?</b><small>Это бесплатная внутриигровая валюта Crate. Она не имеет денежной стоимости.</small>',
                 '<b>Что такое баланс?</b><small>Это демонстрационный баланс в рублях. Цены предметов — реальные, с Market.CSGO. Платежей и вывода нет.</small>')
    s = s.replace('<b>Как получить кристаллы?</b><small>Забирайте ежедневное начисление и выполняйте задания.</small>',
                 '<b>Как пополнить баланс?</b><small>Нажмите кнопку «Пополнить» в шапке — это демо-начисление.</small>')
    if s != orig:
        open(f, "w", encoding="utf-8").write(s)
        print("patched", f)

# Добавим «цены обновлены» на cases.html и case.html
def inject_cases():
    f = "cases.html"
    s = open(f, encoding="utf-8").read()
    needle = '<h1>Все кейсы</h1>'
    add = '<h1>Все кейсы</h1>\n    </div>\n      <div class="price-updated" data-price-updated>Цены обновляются…</div>'
    if 'data-price-updated' not in s:
        s = s.replace('<h1>Все кейсы</h1>\n    </div>', add, 1)
        open(f, "w", encoding="utf-8").write(s)
        print("injected price-updated into", f)

def inject_case():
    f = "case.html"
    s = open(f, encoding="utf-8").read()
    if 'data-price-updated' not in s:
        s = s.replace('<div class="price">\n          <i class="fa-solid fa-gem"></i>\n          <span data-case-price>99</span> ₽\n        </div>',
                     '<div class="price">\n          <i class="fa-solid fa-gem"></i>\n          <span data-case-price>99</span> ₽\n        </div>\n        <div class="price-updated" data-price-updated>Цены обновляются…</div>', 1)
        open(f, "w", encoding="utf-8").write(s)
        print("injected price-updated into", f)

inject_cases()
inject_case()
