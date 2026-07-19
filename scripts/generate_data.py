#!/usr/bin/env python3
"""
Генератор data/items.json + data/skins-pool.json для статического сайта CRATE.

Источники:
  - Цены:  https://market.csgo.com/api/v2/prices/RUB.json  (без ключа, RUB)
  - Предметы: https://github.com/ByMykel/CSGO-API (en) — картинки, редкость,
    износы, категория. Тянем НЕ только оружейные скины, но ВЕСЬ каталог CS2:
    оружие, ножи, перчатки, наклейки, брелоки, нашивки, значки (пины) и кейсы.

Прямой браузерный fetch цен блокируется CORS, поэтому цены парсятся здесь
(в GitHub Action раз в сутки) и кладутся в data/*, которые сайт грузит как
обычные файлы (same-origin).

Только стандартная библиотека — работает локально и в CI.

Результат:
  - data/items.json / data.js       — 5 витринных кейсов (как раньше).
  - data/skins-pool.json / .js      — ПОЛНЫЙ каталог всех предметов CS2 для
    админки. Каждый предмет несёт метаданные для фильтрации: category
    (weapon|knife|gloves|sticker|charm|patch|pin|case), weapon (базовый предмет),
    tier/rarity, statTrak (для оружия/ножей генерируется отдельный ST-вариант),
    image, price, marketUrl.
"""
import json
import os
import random
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

PRICES_URL = "https://market.csgo.com/api/v2/prices/RUB.json"
API_BASE = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/"
SKINS_URL = API_BASE + "skins.json"
# Дополнительные каталоги CS2 для полного пула админки.
EXTRA_SOURCES = {
    "stickers":     API_BASE + "stickers.json",
    "keychains":    API_BASE + "keychains.json",   # брелоки / charms
    "patches":      API_BASE + "patches.json",     # нашивки
    "collectibles": API_BASE + "collectibles.json",  # значки (type == "Pin")
    "crates":       API_BASE + "crates.json",      # кейсы / капсулы
}
UA = "Mozilla/5.0 (CRATE-cases-generator)"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "items.json")

# Тиры и игровые веса (как в настоящих кейсах CS2)
TIERS = {
    "rare":       {"weight": 0.0026, "color": "#e4ae39"},  # ножи / перчатки
    "covert":     {"weight": 0.0064, "color": "#eb4b4b"},
    "classified": {"weight": 0.0320, "color": "#d32ce6"},
    "restricted": {"weight": 0.1598, "color": "#8847ff"},
    "milspec":    {"weight": 0.7992, "color": "#4b69ff"},
}
# Состав кейса: количество предметов каждого тира
COMPOSITION = [("milspec", 6), ("restricted", 3),
                ("classified", 2), ("covert", 1), ("rare", 1)]

# 5 тематических кейсов (оставляем дизайн сайта). color/icon — как в разметке.
CASES_META = [
    {"id": "pulse",  "name": "PULSE",  "icon": "fa-bolt",     "color": "#f5c156"},
    {"id": "aurora", "name": "AURORA", "icon": "fa-snowflake","color": "#58e2ff"},
    {"id": "ember",  "name": "EMBER",  "icon": "fa-fire",      "color": "#ff6670"},
    {"id": "void",   "name": "VOID",   "icon": "fa-meteor",   "color": "#79a5ff"},
    {"id": "apex",   "name": "APEX",   "icon": "fa-crown",    "color": "#c8adff"},
]
# Каждый кейс берёт предметы из своего ценового диапазона (доля от sorted-списка тира)
BANDS = [(0.00, 0.35), (0.20, 0.55), (0.40, 0.70), (0.60, 0.85), (0.75, 1.00)]

HOUSE_EDGE_MULT = 1.18  # цена кейса = EV * 1.18  → house edge ≈ 15.3%


def fetch_json(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def classify_tier(skin):
    name = skin.get("name", "")
    rar = (skin.get("rarity") or {}).get("name", "")
    if name.startswith("★"):           # ножи и перчатки
        return "rare"
    if rar == "Covert":
        return "covert"
    if rar == "Classified":
        return "classified"
    if rar == "Restricted":
        return "restricted"
    if rar == "Mil-Spec Grade":
        return "milspec"
    return None  # consumer/industrial — в кейсы не берём


def market_url(base_name):
    return "https://market.csgo.com/en/?search=" + urllib.parse.quote(base_name)


# --- Полный каталог: соответствие редкость→тир и определение категории --------
# Тир управляет весом ролла/ценой (в приложении всего 5 тиров). Отображаемые
# rarityName/rarityColor берём из источника как есть — они точнее.
# Ключ — базовый rarity id ByMykel (без суффиксов _weapon/_character).
RARITY_TO_TIER = {
    "rarity_default":    "milspec",
    "rarity_common":     "milspec",   # Consumer / Base Grade
    "rarity_uncommon":   "milspec",   # Industrial
    "rarity_rare":       "milspec",   # Mil-Spec / High Grade
    "rarity_mythical":   "restricted",  # Restricted / Remarkable
    "rarity_legendary":  "classified",  # Classified / Exotic
    "rarity_ancient":    "covert",    # Covert / Extraordinary
    "rarity_contraband": "rare",      # Contraband (gold)
    "rarity_immortal":   "rare",      # Exceedingly rare (gold, ножи)
}


def base_rarity_id(rar_id):
    rid = rar_id or ""
    for suf in ("_weapon", "_character"):
        if rid.endswith(suf):
            rid = rid[: -len(suf)]
    return rid


def tier_for(rar_id, category):
    if category in ("knife", "gloves"):
        return "rare"  # ножи/перчатки — золото, как ★ в исходном коде
    return RARITY_TO_TIER.get(base_rarity_id(rar_id), "milspec")


def skin_category(skin):
    cat = (skin.get("category") or {}).get("name", "")
    if cat == "Knives":
        return "knife"
    if cat == "Gloves":
        return "gloves"
    return "weapon"


def build_price_index(prices):
    """market_hash_name -> {price, volume} для всех ценовых вариантов (>0)."""
    idx = {}
    for it in prices.get("items", []):
        mh = it.get("market_hash_name", "")
        try:
            price = float(it.get("price", 0))
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        try:
            vol = int(it.get("volume", 0) or 0)
        except (TypeError, ValueError):
            vol = 0
        idx[mh] = {"price": price, "volume": vol}
    return idx


def _priced_variant(idx, market_hash):
    """Вернуть {price, volume} по market_hash_name или None."""
    return idx.get(market_hash)


def build_full_catalog(sources, idx):
    """Собрать ПОЛНЫЙ пул предметов CS2 для админки (все категории).

    Возвращает плоский список в формате пула админки. Для оружия/ножей с
    доступным StatTrak добавляется отдельный ST-вариант (как на маркете).
    """
    out = []
    seen = set()  # по (name, statTrak) чтобы не плодить дубликаты

    def push(item):
        key = (item["name"], item.get("statTrak", False))
        if key in seen:
            return
        seen.add(key)
        out.append(item)

    def make(name, image, rar, category, weapon="", stattrak_avail=False,
             st=False, wear=None, market_hash=None, base_search=None):
        tier = tier_for((rar or {}).get("id"), category)
        disp_name = ("StatTrak™ " + name) if st else name
        mh = market_hash or (disp_name + (" (" + wear + ")" if wear else ""))
        priced = _priced_variant(idx, mh)
        price = round(priced["price"], 2) if priced else 0.0
        vol = priced["volume"] if priced else 0
        return {
            "id": None,  # присвоим ниже детерминированно
            "name": disp_name,
            "image": image or "",
            "tier": tier,
            "rarityName": (rar or {}).get("name", ""),
            "rarityColor": (rar or {}).get("color", "") or TIERS.get(tier, {}).get("color", "#5e98d9"),
            "category": category,
            "weapon": weapon or "",
            "statTrak": bool(st),
            "stattrakAvailable": bool(stattrak_avail),
            "price": price,
            "minPrice": price,
            "wear": wear or "",
            "dropVariant": {"wear": wear or "", "marketHashName": mh, "price": price, "volume": vol},
            "marketUrl": market_url(base_search or name),
        }

    # ---- Оружие / ножи / перчатки (skins.json) ----
    for s in sources.get("skins", []):
        category = skin_category(s)
        base = s.get("name", "")
        if not base:
            continue
        weapon = (s.get("weapon") or {}).get("name", "")
        rar = s.get("rarity") or {}
        image = s.get("image")
        st_avail = bool(s.get("stattrak"))
        # Выбираем «износ для показа»: предпочитаем FT, иначе первый доступный.
        wears = [w.get("name") for w in (s.get("wears") or []) if w.get("name")]
        wear = None
        for pref in ("Field-Tested", "Minimal Wear", "Factory New", "Well-Worn", "Battle-Scarred"):
            if pref in wears:
                wear = pref
                break
        if wear is None and wears:
            wear = wears[0]
        push(make(base, image, rar, category, weapon=weapon,
                  stattrak_avail=st_avail, st=False, wear=wear, base_search=base))
        # Отдельный StatTrak-вариант (только оружие/ножи), как на маркете.
        if st_avail and category in ("weapon", "knife"):
            push(make(base, image, rar, category, weapon=weapon,
                      stattrak_avail=True, st=True, wear=wear, base_search=base))

    # ---- Наклейки ----
    for s in sources.get("stickers", []):
        name = s.get("name")
        if not name:
            continue
        push(make(name, s.get("image"), s.get("rarity") or {}, "sticker",
                  market_hash=s.get("market_hash_name") or name, base_search=name))

    # ---- Брелоки (charms) ----
    for s in sources.get("keychains", []):
        name = s.get("name")
        if not name:
            continue
        push(make(name, s.get("image"), s.get("rarity") or {}, "charm",
                  market_hash=s.get("market_hash_name") or name, base_search=name))

    # ---- Нашивки (patches) ----
    for s in sources.get("patches", []):
        name = s.get("name")
        if not name:
            continue
        push(make(name, s.get("image"), s.get("rarity") or {}, "patch",
                  market_hash=s.get("market_hash_name") or name, base_search=name))

    # ---- Значки / пины (collectibles, type == "Pin") ----
    for s in sources.get("collectibles", []):
        if s.get("type") != "Pin":
            continue
        name = s.get("name")
        if not name:
            continue
        push(make(name, s.get("image"), s.get("rarity") or {}, "pin",
                  market_hash=s.get("market_hash_name") or name, base_search=name))

    # ---- Кейсы / капсулы (crates) ----
    for s in sources.get("crates", []):
        name = s.get("name")
        if not name:
            continue
        push(make(name, s.get("image"), s.get("rarity") or {}, "case",
                  market_hash=s.get("market_hash_name") or name, base_search=name))

    # Детерминированные id (стабильны между прогонами при том же имени/варианте).
    import hashlib
    for it in out:
        h = hashlib.md5((it["name"] + ("|st" if it["statTrak"] else "")).encode("utf-8")).hexdigest()[:12]
        it["id"] = "item-" + h
    return out


def build_pool(skins, prices):
    """Скины с хотя бы одним plain (без StatTrak/Souvenir) ценовым вариантом."""
    idx = build_price_index(prices)

    pool = []  # list of items per tier
    for s in skins:
        tier = classify_tier(s)
        if not tier:
            continue
        base = s["name"]
        variants = []
        for w in s.get("wears", []):
            wear = w.get("name")
            mh = "{} ({})".format(base, wear)
            p = idx.get(mh)
            if p:
                variants.append({
                    "wear": wear,
                    "marketHashName": mh,
                    "price": p["price"],
                    "volume": p["volume"],
                })
        if not variants:
            continue
        plain = [v for v in variants]  # уже только plain (без префиксов)
        min_price = min(v["price"] for v in plain)
        # dropVariant — то, что реально выпадает и показывается. Считается одинаково
        # здесь и в EV: предпочитаем Field-Tested, иначе макс. объём, иначе самый дешёвый.
        drop = None
        for pref in ["Field-Tested", "Minimal Wear", "Factory New",
                     "Well-Worn", "Battle-Scarred"]:
            cands = [v for v in plain if v["wear"] == pref]
            if cands:
                drop = max(cands, key=lambda v: v["volume"])
                break
        if drop is None:
            drop = max(plain, key=lambda v: v["volume"])
        pool.append({
            "id": s.get("id"),
            "name": base,
            "image": s.get("image"),
            "tier": tier,
            "rarityName": (s.get("rarity") or {}).get("name", ""),
            "rarityColor": TIERS[tier]["color"],
            "stattrak": bool(s.get("stattrak")),
            "souvenir": bool(s.get("souvenir")),
            "minPrice": min_price,
            "dropVariant": drop,
            "marketUrl": market_url(base),
        })
    return pool


def pick_for_case(tier_pool, band, n, rng):
    """Выбрать n предметов тира из ценового band (доли от sorted-по-цене)."""
    if not tier_pool:
        return []
    ordered = sorted(tier_pool, key=lambda x: x["dropVariant"]["price"])
    lo = int(band[0] * len(ordered))
    hi = int(band[1] * len(ordered))
    hi = max(hi, lo + 1)
    window = ordered[lo:hi]
    if not window:
        window = ordered
    # детерминированный выбор внутри окна
    return rng.sample(window, min(n, len(window)))


def build_case(meta, band, pool_by_tier):
    rng = random.Random("crate::" + meta["id"])
    items = []
    for tier, n in COMPOSITION:
        items.extend(pick_for_case(pool_by_tier.get(tier, []), band, n, rng))

    # дедуп по имени (на случай пересечений)
    seen = set()
    uniq = []
    for it in items:
        if it["name"] in seen:
            continue
        seen.add(it["name"])
        uniq.append(it)
    items = uniq

    # вероятности и EV (как в клиенте: тир-вес, внутри тира равномерно)
    by_tier = {}
    for it in items:
        by_tier.setdefault(it["tier"], []).append(it)
    ev = 0.0
    outcomes = []  # (prob, price)
    for tier, group in by_tier.items():
        w = TIERS[tier]["weight"]
        p_item = w / len(group)
        for it in group:
            pr = it["dropVariant"]["price"]
            ev += p_item * pr
            outcomes.append((p_item, pr))
    price = int(round(ev * HOUSE_EDGE_MULT / 10.0) * 10)
    price = max(price, 50)

    p_loss = sum(p for p, pr in outcomes if pr < price)
    p_win = sum(p for p, pr in outcomes if pr >= price)
    all_prices = sorted(pr for _, pr in outcomes)
    n = len(all_prices)
    median = all_prices[n // 2] if n else 0
    metrics = {
        "ev": round(ev, 2),
        "price": price,
        "houseEdge": round(1 - ev / price, 4) if price else 0,
        "pLoss": round(p_loss, 4),
        "pWin": round(p_win, 4),
        "medianOutcome": median,
        "maxOutcome": max((pr for _, pr in outcomes), default=0),
        "itemsCount": len(items),
    }
    return {
        "id": meta["id"],
        "name": meta["name"],
        "icon": meta["icon"],
        "color": meta["color"],
        "priceRub": price,
        "metrics": metrics,
        "items": items,
    }


def build_drops(cases, rng):
    out = []
    users = ["NovaWolf", "Mika", "drev", "kay", "sly", "zero", "frost", "luna"]
    all_items = [it for c in cases for it in c["items"]]
    sample = rng.sample(all_items, min(10, len(all_items)))
    for it in sample:
        out.append({
            "user": rng.choice(users),
            "name": it["name"],
            "image": it["image"],
            "price": it["dropVariant"]["price"],
            "rarityColor": it["rarityColor"],
            "marketUrl": it["marketUrl"],
        })
    return out


def main():
    t0 = time.time()
    print("Fetching prices…", flush=True)
    prices = fetch_json(PRICES_URL)
    price_time = prices.get("time")
    print("  items:", len(prices.get("items", [])), "time:", price_time, flush=True)

    print("Fetching skins…", flush=True)
    skins = fetch_json(SKINS_URL)
    print("  skins:", len(skins), flush=True)

    # Полный каталог CS2 (все категории) — best-effort: если какой-то источник
    # недоступен, продолжаем с тем, что есть.
    sources = {"skins": skins}
    for key, url in EXTRA_SOURCES.items():
        try:
            sources[key] = fetch_json(url)
            print("  {}: {}".format(key, len(sources[key])), flush=True)
        except Exception as e:
            sources[key] = []
            print("  {} FAILED ({}) — пропускаем".format(key, e), file=sys.stderr, flush=True)

    pool = build_pool(skins, prices)
    by_tier = {}
    for it in pool:
        by_tier.setdefault(it["tier"], []).append(it)
    print("  priced pool by tier:", {t: len(v) for t, v in by_tier.items()}, flush=True)

    cases = []
    for meta, band in zip(CASES_META, BANDS):
        c = build_case(meta, band, by_tier)
        cases.append(c)
        m = c["metrics"]
        print("  case {:7s} price={:>5}₽ ev={:>8.1f} houseEdge={:.1%} pLoss={:.2f} pWin={:.4f} max={}".format(
            c["name"], m["price"], m["ev"], m["houseEdge"], m["pLoss"], m["pWin"], m["maxOutcome"]
        ), flush=True)

    rng = random.Random("crate::drops")
    data = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "priceTime": price_time,
        "currency": "RUB",
        "source": "market.csgo.com",
        "cases": cases,
        "drops": build_drops(cases, rng),
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUT)

    # data/data.js — то же самое, но как JS-переменная. Позволяет сайту работать
    # по двойному клику на index.html (file://), где fetch блокируется браузером.
    js_path = os.path.join(os.path.dirname(OUT), "data.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("// Автоматически сгенерировано scripts/generate_data.py. Не редактируйте вручную.\n")
        f.write("window.CRATE_DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    size_js = os.path.getsize(js_path)

    # Phase 2 — полный каталог CS2 для админки. data/skins-pool.json — плоский
    # массив ВСЕХ предметов (оружие, ножи, перчатки, наклейки, брелоки, нашивки,
    # значки, кейсы) с метаданными для фильтрации (category, weapon, statTrak,
    # tier/rarity). Цены проставлены там, где нашлись на market.csgo.com.
    idx = build_price_index(prices)
    pool_export = build_full_catalog(sources, idx)
    from collections import Counter
    print("  full catalog: {} items by category {}".format(
        len(pool_export), dict(Counter(i["category"] for i in pool_export))), flush=True)
    print("  priced items: {}".format(sum(1 for i in pool_export if i["price"] > 0)), flush=True)
    pool_path = os.path.join(os.path.dirname(OUT), "skins-pool.json")
    with open(pool_path, "w", encoding="utf-8") as f:
        json.dump(pool_export, f, ensure_ascii=False, separators=(",", ":"))
    # data/skins-pool.js — то же, что skins-pool.json, но как JS-переменная, чтобы
    # админка могла грузить полный пул скинов по script-тегу (работает и по file://).
    pool_js_path = os.path.join(os.path.dirname(OUT), "skins-pool.js")
    with open(pool_js_path, "w", encoding="utf-8") as f:
        f.write("// Автоматически сгенерировано scripts/generate_data.py. Не редактируйте вручную.\n")
        f.write("// Полный пул скинов для админки (Phase 2). window.CRATE_SKIN_POOL = [...]\n")
        f.write("window.CRATE_SKIN_POOL = ")
        json.dump(pool_export, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("Wrote {} ({:.1f} KB) + data.js ({:.1f} KB) + skins-pool.json/js ({} skins) in {:.1f}s".format(
        OUT, size / 1024, size_js / 1024, len(pool_export), time.time() - t0), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
