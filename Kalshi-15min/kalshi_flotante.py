"""
Ventana flotante con los contratos cripto de 15 minutos de Kalshi.

Muestra, con el mismo look de Kalshi:
    Target · 5:45pm   |  Now ↑ $20.03
    $80,850.66        |  $80,870.69
    [ Up · 70% ]        [ Down · 30% ]
        1.38x               3.18x
    cuenta regresiva + selector de moneda

Uso:
    doble clic en  abrir_kalshi_flotante.bat
    o bien         python kalshi_flotante.py [--coin ETH] [--pos X Y]

Arrastra la ventana desde cualquier punto. Clic derecho: menu.

SOLO LECTURA. Reutiliza el candado de server.py: no hay API key, no se tocan
ordenes ni portafolio. Los botones Up/Down son indicadores, NO compran nada.

Sobre "Now": sale del mismo endpoint que usa la pagina de Kalshi para su "Now"
(el indice con el que liquida), tanto en cripto como en materias primas. Es
publico pero no esta documentado; si dejara de responder, cripto cae a Coinbase
(aproximado, lo avisa el pie en ambar) y materias primas a "no disponible".
"""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import queue
import re
import sys
import threading
import time
import traceback
import urllib.error
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import tkinter as tk
from tkinter import font as tkfont

HERE = Path(__file__).parent
CFG = HERE / "kalshi_flotante.json"
LOG = HERE / "kalshi_flotante.log"


def log(msg: str) -> None:
    """Con pythonw no hay consola: los errores van a un archivo junto al script."""
    try:
        if LOG.exists() and LOG.stat().st_size > 512_000:
            LOG.unlink()
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}\n")
    except OSError:
        pass


try:
    import server  # fetch_json con candado de solo lectura
except Exception:
    # Pasa si se copia este .py (o el .bat) a otra carpeta sin server.py e
    # indicators.py. Con pythonw seria un fallo mudo: se avisa en pantalla.
    log("No se pudo importar server.py:\n" + traceback.format_exc())
    try:
        from tkinter import messagebox
        _r = tk.Tk()
        _r.withdraw()
        messagebox.showerror(
            "Kalshi flotante",
            "Faltan server.py o indicators.py junto a kalshi_flotante.py.\n"
            "Los tres archivos deben estar en la misma carpeta.",
        )
    finally:
        sys.exit(1)

POLL_SECONDS = 0.7    # + ~0.2 s de red por ciclo = ~1 actualizacion por segundo
NET_TIMEOUT = 5.0    # s por peticion; el default de server.py (20 s) congela la ventana demasiado
STALE_SECONDS = 6.0   # a partir de aqui el dato se pinta apagado y con aviso

# Comision taker de Kalshi por contrato: 0.07 * multiplicador_de_la_serie * P * (1 - P).
# Los "1.38x" que muestra Kalshi son el pago NETO de esa comision, no 1/precio.
KALSHI_FEE = 0.07

# Orden de las fichas: primero las grandes, el resto alfabetico
PREFERRED = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]
FALLBACK = PREFERRED + ["HYPE", "NEAR", "ZEC"]

# Materias primas de 15 min (categoria "Commodities" en Kalshi, no "Crypto").
COMMODITIES = ["GOLD", "SILVER", "NATGAS", "WTI", "COPPER", "PLATINUM", "PALLADIUM"]
LABELS = {"PLATINUM": "PLAT", "PALLADIUM": "PALL"}  # para que quepan en la ficha
_commodities: set[str] = set(COMMODITIES)

# "Now" sale del mismo endpoint que usa la pagina de Kalshi para pintar SU "Now":
#     GET <server.KALSHI_LIVE>/<SIMBOLO>/1s?last_sec=10
# Es el indice con el que liquida (oro responde literalmente 'Metal.Index.1OZGOLD/USD').
# Comprobado en los 16 activos: dato de < 1 s, y el signo de Now - Target coincide
# con el lado que favorece el mercado en 16 de 16.
# Cripto usa el nombre pelado (BTC, ETH...); las materias primas, estos simbolos:
LIVE_SYMBOL = {
    "GOLD": "PYTH:GOLD", "SILVER": "PYTH:SILVER", "NATGAS": "PYTH:NATGAS", "WTI": "PYTH:PYTHOIL",
    "COPPER": "PYTH:COPPER", "PLATINUM": "PYTH:XPT", "PALLADIUM": "PYTH:XPD",
}
# OJO: el endpoint es publico pero NO esta documentado. Si Kalshi lo cambia:
#   - cripto cae a Coinbase (aproximado: difiere unos dolares del indice BRTI)
#   - materias primas quedan en "no disponible". No hay sustituto publico: los futuros
#     de oro van ~$36 desviados y el gas natural de Yahoo un 4.7 % (es otro contrato),
#     y en contratos de 15 min eso pondria la flecha al reves.
_live_dead: dict[str, float] = {}  # simbolo -> hasta cuando no reintentar (400 = no existe)

SERIES_RE = re.compile(r"^KX([A-Z0-9]+)15M$")
COIN_RE = re.compile(r"^[A-Z0-9]{2,10}$")
NOT_COINS = {"CRYPTOCOMP", "CRYPTOLEAD"}  # series de 15m que no son "precio sube/baja"

# Paleta tomada de la interfaz de Kalshi
KEY = "#010203"      # color transparente de la ventana (esquinas redondeadas)
BG = "#0b0b0c"
BORDER = "#26262a"
LINE = "#2a2a2e"
DIM = "#8e8e93"
FADED = "#5a5a5f"
VALUE = "#d2d2d7"
WHITE = "#f2f2f7"
GREEN = "#00d991"
RED = "#ff5a5f"
AMBER = "#f0b429"
INK = "#08130e"      # texto sobre las pastillas
CHIP = "#17171a"
CHIP_ON = "#2c2c31"


# ------------------------------------------------------------------ datos


def fnum(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def us_eastern(dt_utc: datetime) -> datetime:
    """
    Hora del Este de EE.UU., que es la que muestra Kalshi ("5:45pm").

    Se calcula a mano porque zoneinfo no trae base de datos en Windows.
    Horario de verano: del 2o domingo de marzo al 1er domingo de noviembre,
    con el cambio a las 2:00 locales (07:00 / 06:00 UTC).
    """
    def nth_sunday(month: int, n: int) -> int:
        first_weekday = datetime(dt_utc.year, month, 1).weekday()  # lunes = 0
        return 1 + (6 - first_weekday) % 7 + 7 * (n - 1)

    start = datetime(dt_utc.year, 3, nth_sunday(3, 2), 7, tzinfo=timezone.utc)
    end = datetime(dt_utc.year, 11, nth_sunday(11, 1), 6, tzinfo=timezone.utc)
    return dt_utc + timedelta(hours=-4 if start <= dt_utc < end else -5)


def series_url(coin: str) -> str:
    return server.esc(f"KX{coin}15M")


def has_markets(coin: str) -> bool:
    """Hay series de 15 min registradas que nunca han tenido contratos (ADA, BCH, TON)."""
    url = f"{server.KALSHI}/markets?series_ticker={series_url(coin)}&limit=1"
    return bool(server.fetch_json(url, ttl=3600.0, timeout=10.0).get("markets"))


def is_commodity(asset: str) -> bool:
    return asset in _commodities


def series_in(category: str) -> set[str]:
    """Activos con serie de 15 min 'precio sube/baja' y con contratos, en una categoria de Kalshi."""
    data = server.fetch_json(f"{server.KALSHI}/series?category={server.esc(category)}",
                             ttl=3600.0, timeout=15.0)
    found = set()
    for s in data.get("series", []):
        if s.get("frequency") != "fifteen_min":
            continue
        m = SERIES_RE.match(s.get("ticker", ""))
        if m and m.group(1) not in NOT_COINS:
            found.add(m.group(1))

    alive = set()
    for asset in found:
        try:
            if has_markets(asset):
                alive.add(asset)
        except Exception:
            alive.add(asset)  # ante la duda se deja la ficha
    return alive


def ordered(assets: set[str], first: list[str]) -> list[str]:
    return [a for a in first if a in assets] + sorted(a for a in assets if a not in first)


def discover_assets() -> list[list[str]]:
    """Dos grupos de fichas, leidos de la API: cripto y materias primas."""
    global _commodities
    crypto = series_in("Crypto")
    commodities = series_in("Commodities")
    if commodities:
        _commodities = set(COMMODITIES) | commodities  # spot() consulta esto para no pedir a Coinbase
    return [ordered(crypto, PREFERRED) or list(FALLBACK),
            ordered(commodities, COMMODITIES) or list(COMMODITIES)]


_fee_cache: dict[str, tuple[float, float]] = {}


def fee_multiplier(coin: str) -> float:
    """
    Multiplicador de comision que publica la serie (fee_type 'quadratic').
    Se guarda una hora; si la consulta falla se asume 1 y se reintenta al minuto,
    para no frenar el sondeo de precios con la red caida.
    """
    hit = _fee_cache.get(coin)
    now = time.monotonic()
    if hit and now < hit[1]:
        return hit[0]
    try:
        s = server.fetch_json(f"{server.KALSHI}/series/{series_url(coin)}",
                              ttl=3600.0, timeout=NET_TIMEOUT).get("series") or {}
        value = fnum(s.get("fee_multiplier")) if str(s.get("fee_type", "")).startswith("quadratic") else None
        value = value if value and value > 0 else 1.0
        _fee_cache[coin] = (value, now + 3600.0)
    except Exception:
        value = 1.0
        _fee_cache[coin] = (value, now + 60.0)
    return value


def payout(ask: float | None, fee_mult: float) -> float | None:
    """Lo que devuelve $1 comprado al ask, ya descontada la comision. Igual que el 'x' de Kalshi."""
    if ask is None or not (0 < ask < 1):
        return None  # lado sin ofertas: no hay precio al que comprar
    return 1.0 / (ask + KALSHI_FEE * fee_mult * ask * (1.0 - ask))


def current_market(coin: str, bust: bool = False) -> dict | None:
    """
    El contrato de 15 min que esta corriendo ahora para esa moneda.

    OJO: Kalshi sirve esta lista con 'Cache-Control: max-age=15' desde CloudFront
    (medido: X-Cache Hit, Age 14). Vale para lo que NO cambia dentro del contrato
    (ticker, target, horas) pero sus bid/ask llegan con hasta 15 s de retraso:
    los precios salen del libro de ordenes, ver book().
    bust=True agrega un parametro unico para saltarse esa cache; solo se usa en el
    cambio de contrato, para no esperar 15 s a que aparezca el nuevo.
    """
    url = f"{server.KALSHI}/markets?series_ticker={series_url(coin)}&status=open&limit=10"
    if bust:
        url += f"&_={int(time.time() * 1000)}"
    markets = server.fetch_json(url, ttl=0 if bust else 5.0, timeout=NET_TIMEOUT).get("markets", [])
    now = datetime.now(timezone.utc)

    live = [m for m in markets if m.get("close_time") and parse_ts(m["close_time"]) > now]
    if not live:
        return None
    # Si ya abrio el siguiente, se prefiere el que esta en curso
    running = [m for m in live if m.get("open_time") and parse_ts(m["open_time"]) <= now]
    pool = running or live
    pool.sort(key=lambda m: parse_ts(m["close_time"]))
    return pool[0]


_contract: dict[str, dict] = {}        # activo -> contrato en curso
_contract_seen: dict[str, float] = {}  # activo -> cuando se consulto por ultima vez (monotonic)
_rollover_until: dict[str, float] = {}  # activo -> hasta cuando vale saltarse la cache


def contract_for(coin: str) -> dict | None:
    """Contrato en curso, reutilizado mientras siga vivo: sus datos no cambian hasta que cierra."""
    now = datetime.now(timezone.utc)
    mono = time.monotonic()
    m = _contract.get(coin)

    alive = bool(m) and parse_ts(m["close_time"]) > now
    has_target = alive and fnum(m.get("floor_strike")) is not None
    if has_target and mono - _contract_seen.get(coin, 0.0) < 60.0:
        return m

    # Hace falta consultar. La cache solo se salta: la primera vez, durante los 90 s
    # siguientes a un cierre, y en los 2 primeros minutos de un contrato cuyo target aun
    # no aparece. Todo acotado: fuera de horario un activo puede pasar horas sin contrato
    # y ahi NO se debe martillar al servidor.
    if m and not alive and coin not in _rollover_until:
        _rollover_until[coin] = mono + 90.0
    waiting_target = (alive and not has_target and bool(m.get("open_time"))
                      and (now - parse_ts(m["open_time"])).total_seconds() < 120.0)
    bust = m is None or mono < _rollover_until.get(coin, 0.0) or waiting_target

    try:
        fresh = current_market(coin, bust=bust)
    except Exception:
        # Con un contrato vivo esto era solo una revalidacion (ticker, target y horas no
        # cambian): un fallo de la lista no debe apagar una ventana cuyo libro si responde.
        if has_target:
            _contract_seen[coin] = mono - 50.0  # reintentar en ~10 s, no en cada ciclo
            return m
        raise
    _contract_seen[coin] = mono

    if fresh is not None and alive and fresh.get("ticker") != m.get("ticker"):
        # La lista viene de una cache de 15 s: puede faltarle el contrato en curso y traer
        # solo el siguiente, aun sin abrir. El reloj manda: el vivo no se reemplaza por uno futuro.
        if fresh.get("open_time") and parse_ts(fresh["open_time"]) > now:
            return m
    if fresh is not None:
        if has_target and fresh.get("ticker") == m.get("ticker") and fnum(fresh.get("floor_strike")) is None:
            return m  # copia vieja del mismo contrato, de cuando aun no tenia target
        _contract[coin] = fresh
        _rollover_until.pop(coin, None)
        return fresh
    if alive:
        return m  # la lista (cacheada) no lo trae, pero por reloj sigue vivo
    if m is None:
        _contract[coin] = {}  # ya se intento una vez: los siguientes intentos van con cache
    return None


_pause: dict[str, float] = {}  # 'book' / 'trades' -> hasta cuando no reintentar tras un fallo


def _guarded(key: str, fn):
    """Ejecuta fn(); si falla, deja descansar ese endpoint (mas si es por exceso de peticiones)."""
    if time.monotonic() < _pause.get(key, 0.0):
        return None
    try:
        return fn()
    except urllib.error.HTTPError as e:
        _pause[key] = time.monotonic() + (30.0 if e.code == 429 else 5.0)
    except Exception:
        _pause[key] = time.monotonic() + 5.0
    return None


def book(ticker: str) -> tuple[float | None, float | None, float | None] | None:
    """
    (yes_bid, yes_ask, no_ask) del libro de ordenes: sin cache y a ~0.4 s del dato mas
    fresco (medido). El libro solo trae compras: el ask del Yes es 1 - mejor compra del No.
    """
    def fetch():
        data = server.fetch_json(f"{server.KALSHI}/markets/{server.esc(ticker)}/orderbook",
                                 ttl=0, timeout=NET_TIMEOUT)
        ob = data.get("orderbook_fp")
        if ob is None:
            ob = data.get("orderbook")
        if not isinstance(ob, dict):
            # Respuesta sin libro != libro vacio: que caiga al respaldo CON aviso
            raise ValueError("respuesta sin libro de ordenes")

        def best(side: str) -> float | None:
            levels, scale = ob.get(f"{side}_dollars"), 1.0
            if levels is None:
                levels, scale = ob.get(side) or [], 0.01  # formato viejo, en centavos
            prices = [fnum(lv[0]) for lv in levels
                      if isinstance(lv, (list, tuple)) and len(lv) >= 2 and (fnum(lv[1]) or 0) > 0]
            prices = [p * scale for p in prices if p is not None]
            return max(prices) if prices else None

        yes_bid, no_bid = best("yes"), best("no")
        return (yes_bid,
                None if no_bid is None else round(1.0 - no_bid, 4),
                None if yes_bid is None else round(1.0 - yes_bid, 4))
    return _guarded("book", fetch)


def last_trade(ticker: str) -> float | None:
    """Precio del Yes en la ultima operacion. Es lo que Kalshi pinta como % (ver chance())."""
    def fetch():
        data = server.fetch_json(f"{server.KALSHI}/markets/trades?ticker={server.esc(ticker)}&limit=1",
                                 ttl=0, timeout=NET_TIMEOUT)
        trades = data.get("trades") or []
        if not trades or not isinstance(trades[0], dict):
            return None
        px = fnum(trades[0].get("yes_price_dollars"))
        if px is None and fnum(trades[0].get("yes_price")) is not None:
            px = fnum(trades[0].get("yes_price")) / 100.0
        if px is not None:
            _last_px.clear()  # solo interesa el contrato en curso
            _last_px[ticker] = px
        return px
    return _guarded("trades", fetch)


# Ultimo trade conocido por ticker. Si /markets/trades falla o esta en pausa, se usa este
# en vez de saltar al punto medio: con spread ancho (30/60, ultimo en 32) el salto seria
# de 32 % a 45 % sin que el mercado se hubiera movido. chance() lo acota al spread vigente.
_last_px: dict[str, float] = {}


def _px(v) -> float | None:
    """Precio de la LISTA de mercados. Alli 'sin ordenes' viene como 0.0000 / 1.0000, no como vacio."""
    v = fnum(v)
    return v if v is not None and 0.0 < v < 1.0 else None


def chance(bid: float | None, ask: float | None, last: float | None) -> int | None:
    """
    El % que muestra Kalshi = ultimo precio operado, acotado al bid/ask vigente.

    Deducido de dos observaciones reales: con bid/ask 70/71 la app mostraba 70, y con
    44/45 la web mostraba 45. Ni el bid, ni el ask, ni el punto medio explican las
    dos; el ultimo trade si. Si el libro se movio sin operaciones, el ultimo trade
    queda fuera del spread y se usa el borde mas cercano. Sin trades: punto medio.
    """
    lo = bid if bid is not None else 0.0
    hi = ask if ask is not None else 1.0
    if last is not None:
        p = min(max(last, lo), hi)
    elif bid is not None and ask is not None:
        p = (bid + ask) / 2
    else:
        p = bid if bid is not None else ask
    if p is None:
        return None
    return max(1, min(99, math.floor(p * 100 + 0.5 + 1e-9)))  # un mercado abierto nunca es 0 ni 100


def live_price(asset: str) -> tuple[float | None, str]:
    """
    Ultimo valor del indice segun Kalshi, y por que no lo hay cuando no lo hay:
        'ok'     hay precio
        'quiet'  el endpoint respondio bien pero sin ticks en 10 s (subyacente en pausa)
        'error'  no respondio, simbolo inexistente, o respuesta ilegible
    Son causas distintas y la ventana las rotula distinto: 'quiet' es normal, 'error' no.
    """
    sym = LIVE_SYMBOL.get(asset) or (f"PYTH:{asset}" if is_commodity(asset) else asset)
    if time.monotonic() < _live_dead.get(sym, 0.0):
        return None, "error"
    try:
        data = server.fetch_json(f"{server.KALSHI_LIVE}/{server.esc(sym)}/1s?last_sec=10",
                                 ttl=1.0, timeout=NET_TIMEOUT)
        # last_sec lo filtra el servidor con SU reloj: si hay puntos, son frescos.
        # El feed emite un punto por segundo aunque el valor no cambie, asi que
        # una lista vacia significa que el feed esta parado, no que "no se movio".
        points = data.get("timeseries") or []
        if not points:
            return None, "quiet"
        last = points[-1]
        px = fnum(last.get("v")) if isinstance(last, dict) else None
        return px, ("ok" if px is not None else "error")
    except urllib.error.HTTPError as e:
        # Sin esta pausa, un endpoint caido le costaria 5 s de timeout a CADA ciclo
        # y toda la ventana parpadearia como "dato viejo" aunque Kalshi este bien.
        pause = 300.0 if e.code in (400, 404) else 60.0 if e.code == 429 else 15.0
        _live_dead[sym] = time.monotonic() + pause
        return None, "error"
    except Exception:  # timeout, DNS, JSON roto
        _live_dead[sym] = time.monotonic() + 15.0
        return None, "error"


def spot(asset: str) -> tuple[float | None, str | None]:
    """
    (precio, fuente). Fuente:
        'kalshi'    indice de liquidacion
        'coinbase'  respaldo aproximado (solo cripto)
        'quiet'     sin precio porque el indice no tiene ticks ahora (normal fuera de horario)
        None        sin precio por fallo
    """
    px, why = live_price(asset)
    if px is not None:
        return px, "kalshi"
    if is_commodity(asset):
        # sin sustituto publico fiable; ver nota en LIVE_SYMBOL
        return None, ("quiet" if why == "quiet" else None)
    try:
        data = server.fetch_json(f"{server.COINBASE}/products/{server.esc(asset + '-USD')}",
                                 ttl=1.0, timeout=NET_TIMEOUT)
        px = fnum(data.get("price"))
        return px, ("coinbase" if px is not None else None)
    except Exception:
        return None, None


def decimals_for(price: float | None) -> int:
    if price is None or price >= 100:
        return 2
    return 4 if price >= 1 else 6


def decimals_of(market: dict, target: float | None) -> int:
    """Mismos decimales que usa Kalshi en 'Target Price: $80,787.61'."""
    m = re.search(r"\$[\d,]+(?:\.(\d+))?", market.get("yes_sub_title") or "")
    return len(m.group(1) or "") if m else decimals_for(target)


_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="kalshi-net")


def snapshot(coin: str) -> dict:
    """Todo lo que la ventana necesita pintar, en un dict."""
    m = contract_for(coin)  # si Kalshi falla, esto lanza y la ventana avisa
    if not m:
        now_px, now_src = spot(coin)
        return {"coin": coin, "market": None, "now": now_px, "now_src": now_src,
                "decimals": decimals_for(now_px), "t": time.monotonic()}

    # Las tres lecturas en tiempo real van a la vez: el ciclo dura lo que la mas lenta
    f_book = _pool.submit(book, m["ticker"])
    f_last = _pool.submit(last_trade, m["ticker"])
    f_spot = _pool.submit(spot, coin)
    prices = f_book.result()
    # La edad del dato se cuenta desde que se LEYO el libro, no desde que se pinta: si otra
    # lectura tarda 5 s, esos 5 s cuentan para el aviso de "dato viejo".
    t_read = time.monotonic()
    last = f_last.result()
    now_px, now_src = f_spot.result()
    if last is None:
        last = _last_px.get(m["ticker"])

    target = fnum(m.get("floor_strike"))
    if prices is not None:
        yes_bid, yes_ask, no_ask = prices
        pct_src = "book"
    else:
        # Respaldo: los precios de la lista de mercados. Se pide EN ESTE ciclo (el contrato
        # guardado puede tener 60 s) y aun asi trae hasta ~20 s de retraso (15 de la cache
        # de Kalshi + 5 de la nuestra). La ventana lo avisa en el pie.
        src_m = m
        try:
            fresh = current_market(coin)
            if fresh and fresh.get("ticker") == m["ticker"]:
                src_m = fresh
        except Exception:
            pass
        yes_bid, yes_ask = _px(src_m.get("yes_bid_dollars")), _px(src_m.get("yes_ask_dollars"))
        no_ask = _px(src_m.get("no_ask_dollars"))
        if last is None:
            last = _px(src_m.get("last_price_dollars"))
        pct_src = "list"

    up_pct = chance(yes_bid, yes_ask, last)

    fee = fee_multiplier(coin)
    return {
        "coin": coin,
        "market": m.get("ticker"),
        "target": target,
        "decimals": decimals_of(m, target),
        "open": parse_ts(m["open_time"]) if m.get("open_time") else None,
        "close": parse_ts(m["close_time"]),
        "up_pct": up_pct,
        "down_pct": None if up_pct is None else 100 - up_pct,
        "up_x": payout(yes_ask, fee),
        "down_x": payout(no_ask, fee),
        "now": now_px,
        "now_src": now_src,
        "pct_src": pct_src,
        "t": t_read,
    }


# ------------------------------------------------------------------ ventana


class App:
    W = 380  # ancho logico (px a 96 dpi)

    def __init__(self, coin: str | None, pos: tuple[int, int] | None):
        cfg = self.load_cfg()

        # La moneda acaba en URLs (API y navegador): solo letras/numeros
        wanted = str(coin or cfg.get("coin") or "BTC").upper()
        self.coin = wanted if COIN_RE.match(wanted) else "BTC"

        # Dos grupos de fichas: cripto y materias primas
        self.groups: list[list[str]] = [list(FALLBACK), list(COMMODITIES)]
        if not any(self.coin in g for g in self.groups):
            self.groups[0].insert(0, self.coin)
        self.topmost = bool(cfg.get("topmost", True))
        self.local_time = bool(cfg.get("local_time", False))  # False = hora de Kalshi (ET)

        self.state: dict | None = None
        self.error: str | None = None
        self.last_ok = time.monotonic()
        self.prev_now: float | None = None
        self.now_color = VALUE
        self._press = None
        self._dragged = False

        self.q: queue.Queue = queue.Queue()
        self.wake = threading.Event()
        self.stop = threading.Event()

        self.root = tk.Tk()
        self.root.title("Kalshi 15m")
        self.root.overrideredirect(True)
        self.root.configure(bg=KEY)
        self.root.wm_attributes("-topmost", self.topmost)
        try:
            self.root.wm_attributes("-transparentcolor", KEY)
        except tk.TclError:
            pass
        self.root.report_callback_exception = self.on_tk_error

        self.s = self.root.winfo_fpixels("1i") / 96.0
        self.fonts()

        self.c = tk.Canvas(self.root, bg=KEY, highlightthickness=0, bd=0)
        self.c.pack(fill="both", expand=True)
        self.hits: list[tuple[float, float, float, float, tuple]] = []
        self.layout()

        # Tk ignora la posicion si se fija antes de que la ventana exista en
        # pantalla (Windows la cascadea donde quiere). Se mapea y luego se coloca.
        x, y = pos if pos else (cfg.get("x"), cfg.get("y"))
        self.root.update_idletasks()
        self.place(x, y)
        self.root.after(60, lambda: self.place(x, y))

        self.c.bind("<ButtonPress-1>", self.on_press)
        self.c.bind("<B1-Motion>", self.on_drag)
        self.c.bind("<ButtonRelease-1>", self.on_release)
        self.c.bind("<Button-3>", self.on_menu)
        self.root.bind("<Escape>", lambda e: self.quit())

        threading.Thread(target=self.worker, daemon=True).start()
        threading.Thread(target=self.discoverer, daemon=True).start()
        self.tick()

    # ---- infraestructura

    def fonts(self) -> None:
        px = lambda n: -max(1, int(round(n * self.s)))
        self.f_label = tkfont.Font(family="Segoe UI Semibold", size=px(13))
        self.f_value = tkfont.Font(family="Segoe UI", size=px(24), weight="bold")
        self.f_pill = tkfont.Font(family="Segoe UI", size=px(15), weight="bold")
        self.f_mult = tkfont.Font(family="Segoe UI Semibold", size=px(12))
        self.f_count = tkfont.Font(family="Segoe UI", size=px(18), weight="bold")
        self.f_small = tkfont.Font(family="Segoe UI", size=px(11))
        self.f_chip = tkfont.Font(family="Segoe UI Semibold", size=px(11))
        self.f_x = tkfont.Font(family="Segoe UI", size=px(15))

    GROUP_GAP = 8  # separacion entre el grupo cripto y el de materias primas

    def layout(self) -> None:
        """La altura depende de cuantas filas de fichas haya (6 por fila, por grupo)."""
        groups = [g for g in self.groups if g]
        rows = sum(-(-len(g) // 6) for g in groups) or 1
        self.H = 214 + rows * 28 + max(0, len(groups) - 1) * self.GROUP_GAP + 22
        self.root.geometry(f"{self.P(self.W)}x{self.P(self.H)}")

    def P(self, v: float) -> int:
        return int(round(v * self.s))

    def place(self, x, y) -> None:
        sw = self.root.winfo_screenwidth()
        w, h = self.P(self.W), self.P(self.H)
        if not isinstance(x, int) or not isinstance(y, int):
            x, y = sw - w - 40, 60

        # Se recorta contra el escritorio completo, no solo el monitor principal,
        # para que la posicion guardada en un segundo monitor se respete.
        try:
            gm = ctypes.windll.user32.GetSystemMetrics
            vx, vy, vw, vh = gm(76), gm(77), gm(78), gm(79)  # SM_*VIRTUALSCREEN
        except Exception:
            vx, vy, vw, vh = 0, 0, sw, self.root.winfo_screenheight()
        x = max(vx, min(x, vx + vw - w))
        y = max(vy, min(y, vy + vh - h))
        self.root.geometry(f"{w}x{h}+{x}+{y}")

    def load_cfg(self) -> dict:
        try:
            data = json.loads(CFG.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def save_cfg(self) -> None:
        try:
            CFG.write_text(json.dumps({
                "coin": self.coin,
                "x": self.root.winfo_x(),
                "y": self.root.winfo_y(),
                "topmost": self.topmost,
                "local_time": self.local_time,
            }), encoding="utf-8")
        except (OSError, tk.TclError):
            pass

    def on_tk_error(self, exc, val, tb) -> None:
        log("".join(traceback.format_exception(exc, val, tb)))

    def quit(self) -> None:
        self.stop.set()
        self.wake.set()
        self.save_cfg()
        self.root.destroy()

    # ---- hilos de red (nunca tocan Tk: solo escriben en la cola)

    def worker(self) -> None:
        fails = 0
        while not self.stop.is_set():
            coin = self.coin
            try:
                self.q.put(("state", snapshot(coin)))
                fails = 0
            except Exception as e:
                fails += 1
                if fails == 1 or fails % 20 == 0:  # sin inundar el log
                    log(f"snapshot({coin}) fallo x{fails}: {e!r}")
                self.q.put(("error", (coin, "Sin conexión — reintentando")))

            # Con fallos seguidos se espacia el sondeo (hasta 30 s) en vez de insistir
            delay = POLL_SECONDS if not fails else min(POLL_SECONDS * 2 ** min(fails, 5), 30.0)
            self.wake.wait(delay)
            self.wake.clear()

    def discoverer(self) -> None:
        """Aparte del sondeo: son ~13 peticiones y no deben frenar los precios."""
        for attempt in range(6):
            try:
                self.q.put(("coins", discover_assets()))
                return
            except Exception as e:
                log(f"discover_assets (intento {attempt + 1}): {e!r}")
            if self.stop.wait(30.0):
                return

    # ---- ciclo de la interfaz

    def tick(self) -> None:
        try:
            while True:
                kind, payload = self.q.get_nowait()
                if kind == "coins":
                    self.groups = [list(g) for g in payload]
                    if not any(self.coin in g for g in self.groups):
                        self.groups[1 if is_commodity(self.coin) else 0].insert(0, self.coin)
                    self.layout()
                elif kind == "state" and payload["coin"] == self.coin:
                    self.error = None
                    self.last_ok = payload.get("t") or time.monotonic()  # cuando se leyo, no cuando se pinta
                    now = payload.get("now")
                    # Al cambiar de fuente (Kalshi <-> Coinbase) la diferencia entre ambas
                    # no es un tick real: no se colorea y se empieza a comparar de nuevo.
                    if payload.get("now_src") != (self.state or {}).get("now_src"):
                        self.prev_now = None
                        self.now_color = VALUE
                    if now is not None and self.prev_now is not None and now != self.prev_now:
                        self.now_color = GREEN if now > self.prev_now else RED
                    if now is not None:
                        self.prev_now = now
                    self.state = payload
                elif kind == "error" and payload[0] == self.coin:
                    self.error = payload[1]
        except queue.Empty:
            pass

        try:
            self.render()
        except Exception:  # un fallo de dibujo no debe parar el reloj de la ventana
            log("render:\n" + traceback.format_exc())
        if not self.stop.is_set():
            self.root.after(250, self.tick)

    def select(self, coin: str) -> None:
        if coin == self.coin or not COIN_RE.match(coin):
            return
        self.coin = coin
        self.state = None
        self.error = None
        self.last_ok = time.monotonic()
        self.prev_now = None
        self.now_color = VALUE
        self.save_cfg()
        self.wake.set()  # que el hilo no espere al siguiente ciclo

    # ---- raton

    def on_press(self, e) -> None:
        self._press = (e.x_root, e.y_root, self.root.winfo_x(), self.root.winfo_y())
        self._dragged = False

    def on_drag(self, e) -> None:
        if not self._press:
            return
        px, py, wx, wy = self._press
        dx, dy = e.x_root - px, e.y_root - py
        if abs(dx) > 3 or abs(dy) > 3:
            self._dragged = True
        if self._dragged:
            self.root.geometry(f"+{wx + dx}+{wy + dy}")

    def on_release(self, e) -> None:
        self._press = None
        if self._dragged:
            self._dragged = False
            self.save_cfg()
            return
        for x1, y1, x2, y2, action in self.hits:
            if x1 <= e.x <= x2 and y1 <= e.y <= y2:
                kind, arg = action
                if kind == "coin":
                    self.select(arg)
                elif kind == "close":
                    self.quit()
                return

    def on_menu(self, e) -> None:
        old = getattr(self, "_menu", None)
        if old is not None:
            old.destroy()
        m = self._menu = tk.Menu(self.root, tearoff=0)
        self._mv_top = tk.BooleanVar(value=self.topmost)
        self._mv_loc = tk.BooleanVar(value=self.local_time)
        m.add_command(label="Abrir este contrato en Kalshi", command=self.open_kalshi)
        m.add_checkbutton(label="Siempre encima", command=self.toggle_top, variable=self._mv_top)
        m.add_checkbutton(label="Hora local (en vez de la de Kalshi, ET)", command=self.toggle_time,
                          variable=self._mv_loc)
        m.add_separator()
        m.add_command(label="Cerrar", command=self.quit)
        try:
            m.tk_popup(e.x_root, e.y_root)
        finally:
            m.grab_release()

    def toggle_top(self) -> None:
        self.topmost = not self.topmost
        self.root.wm_attributes("-topmost", self.topmost)
        self.save_cfg()

    def toggle_time(self) -> None:
        self.local_time = not self.local_time
        self.save_cfg()

    def open_kalshi(self) -> None:
        if COIN_RE.match(self.coin):
            webbrowser.open(f"https://kalshi.com/markets/kx{self.coin.lower()}15m")

    # ---- dibujo

    def rrect(self, x1, y1, x2, y2, r, **kw) -> None:
        x1, y1, x2, y2, r = (self.P(v) for v in (x1, y1, x2, y2, r))
        pts = [x1 + r, y1, x1 + r, y1, x2 - r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y1 + r,
               x2, y2 - r, x2, y2 - r, x2, y2, x2 - r, y2, x2 - r, y2, x1 + r, y2, x1 + r, y2,
               x1, y2, x1, y2 - r, x1, y2 - r, x1, y1 + r, x1, y1 + r, x1, y1]
        self.c.create_polygon(pts, smooth=True, **kw)

    def pill(self, x1, y1, x2, y2, fill) -> None:
        """Pastilla de verdad (radio = media altura): dos circulos y un rectangulo."""
        x1, y1, x2, y2 = (self.P(v) for v in (x1, y1, x2, y2))
        h = y2 - y1
        self.c.create_oval(x1, y1, x1 + h, y2, fill=fill, outline=fill)
        self.c.create_oval(x2 - h, y1, x2, y2, fill=fill, outline=fill)
        self.c.create_rectangle(x1 + h // 2, y1, x2 - h // 2, y2, fill=fill, outline=fill)

    def text(self, x, y, s, font, fill, anchor="w") -> None:
        self.c.create_text(self.P(x), self.P(y), text=s, font=font, fill=fill, anchor=anchor)

    def money(self, v: float | None, dec: int) -> str:
        return "—" if v is None else f"${v:,.{dec}f}"

    def render(self) -> None:
        c, W, H = self.c, self.W, self.H
        c.delete("all")
        self.hits = []

        self.rrect(0, 0, W - 1, H - 1, 18, fill=BG, outline=BORDER)

        st = self.state
        has_market = bool(st and st.get("market"))
        dec = st.get("decimals", 2) if st else 2

        # Un dato viejo no debe parecer vivo: si el sondeo se atasca o falla,
        # precios y pastillas se apagan y sale cuanto llevan sin refrescarse.
        age = time.monotonic() - self.last_ok
        stale = st is not None and (age > STALE_SECONDS or bool(self.error))

        # --- cerrar
        self.text(W - 18, 15, "×", self.f_x, DIM, anchor="center")
        self.hits.append((self.P(W - 30), 0, self.P(W), self.P(30), ("close", None)))

        # --- Target
        t_label = "Target"
        if has_market and st.get("open"):
            opened = st["open"].astimezone() if self.local_time else us_eastern(st["open"])
            t_label = f"Target · {opened.strftime('%I:%M%p').lstrip('0').lower()}"
        self.text(18, 26, t_label, self.f_label, DIM)
        self.text(18, 54, self.money(st.get("target"), dec) if has_market else "—",
                  self.f_value, FADED if stale else VALUE)

        # --- divisor
        c.create_line(self.P(186), self.P(18), self.P(186), self.P(70), fill=LINE, width=max(1, self.P(1)))

        # --- Now
        # "Now ↑ $20.03" va todo del color de la direccion respecto al target;
        # el precio de abajo va del color del ultimo tick, como en Kalshi.
        now = st.get("now") if st else None
        target = st.get("target") if has_market else None
        commodity = is_commodity(self.coin)
        src = st.get("now_src") if st else None
        now_label, side = "Now", DIM
        if st is not None and now is None:
            now_label = "Now · sin ticks ahora" if src == "quiet" else "Now · no disponible"
        if now is not None and target is not None:
            diff = now - target
            side = GREEN if diff >= 0 else RED  # empate = Up (strike 'greater_or_equal')
            now_label = f"Now {'↑' if diff >= 0 else '↓'} ${abs(diff):,.{dec}f}"
        self.text(202, 26, now_label, self.f_label, FADED if stale else side)
        self.text(202, 54, self.money(now, dec), self.f_value,
                  FADED if stale else (self.now_color if now is not None else VALUE))

        # --- pastillas Up / Down (indicadores: no compran nada)
        half = (W - 18 * 2 - 10) / 2
        for i, (name, pct, mult, color) in enumerate((
            ("Up", st.get("up_pct") if has_market else None, st.get("up_x") if has_market else None, GREEN),
            ("Down", st.get("down_pct") if has_market else None, st.get("down_x") if has_market else None, RED),
        )):
            x1 = 18 + i * (half + 10)
            self.pill(x1, 88, x1 + half, 132, CHIP_ON if stale else color)
            label = f"{name} · {pct}%" if pct is not None else f"{name} · —"
            self.text(x1 + half / 2, 110, label, self.f_pill, DIM if stale else INK, anchor="center")
            self.text(x1 + half / 2, 148, f"{mult:.2f}x" if mult else "—", self.f_mult,
                      FADED if stale else DIM, anchor="center")

        # --- cuenta regresiva
        c.create_line(self.P(18), self.P(166), self.P(W - 18), self.P(166), fill=LINE, width=max(1, self.P(1)))

        # En minutos a partir de 2 min: el texto no crece y no pisa lo que va a su izquierda
        warn = None
        if stale:
            warn = f"sin datos nuevos hace {int(age)} s" if age < 120 else f"sin datos nuevos hace {int(age // 60)} min"

        if st is None:
            self.text(18, 186, self.error or f"Cargando {self.coin}…", self.f_small,
                      RED if self.error else DIM)
        elif not has_market:
            # Las materias primas tienen horario: fuera de el pueden pasar horas sin contrato
            # Con aviso a la derecha se usa el texto corto para que no se encimen.
            if commodity:
                msg = "Sin contrato abierto ahora" + ("" if warn else " — esperando…")
            else:
                msg = "Esperando el siguiente contrato…"
            self.text(18, 186, msg, self.f_small, AMBER)
            if warn:
                self.text(W - 18, 186, warn, self.f_small, RED, anchor="e")
        else:
            left = (st["close"] - datetime.now(timezone.utc)).total_seconds()
            if left <= 0:
                self.text(18, 186, "Liquidando · esperando el siguiente…", self.f_small, AMBER)
            else:
                mm, ss = divmod(int(left), 60)
                color = RED if left < 15 else AMBER if left < 60 else WHITE
                self.text(18, 186, "Cierra en", self.f_small, DIM)
                c.create_text(self.P(18) + self.f_small.measure("Cierra en  "), self.P(185),
                              text=f"{mm:02d}:{ss:02d}", font=self.f_count, fill=color, anchor="w")
                # La cuenta sigue siendo valida (va por reloj); lo que se avisa es el precio
                self.text(W - 18, 186, warn or f"{LABELS.get(self.coin, self.coin)} · 15 min", self.f_small,
                          RED if warn else DIM, anchor="e")

                # barra de avance del contrato
                total = (st["close"] - st["open"]).total_seconds() if st.get("open") else 900.0
                frac = max(0.0, min(1.0, 1 - left / total)) if total > 0 else 0.0
                self.rrect(18, 200, W - 18, 204, 2, fill=CHIP, outline=CHIP)
                if frac > 0.01:
                    self.rrect(18, 200, 18 + (W - 36) * frac, 204, 2, fill=color, outline=color)

        # --- fichas de moneda
        gap, per_row = 6, 6
        cw = (W - 36 - gap * (per_row - 1)) / per_row
        y0 = 214
        for group in (g for g in self.groups if g):
            for i, coin in enumerate(group):
                r, k = divmod(i, per_row)
                x1 = 18 + k * (cw + gap)
                y1 = y0 + r * 28
                on = coin == self.coin
                self.rrect(x1, y1, x1 + cw, y1 + 22, 11, fill=CHIP_ON if on else CHIP,
                           outline=GREEN if on else CHIP)
                self.text(x1 + cw / 2, y1 + 11, LABELS.get(coin, coin), self.f_chip,
                          WHITE if on else DIM, anchor="center")
                self.hits.append((self.P(x1), self.P(y1), self.P(x1 + cw), self.P(y1 + 22), ("coin", coin)))
            y0 += -(-len(group) // per_row) * 28 + self.GROUP_GAP

        # --- pie: de donde sale "Now" en este momento
        # El libro de ordenes no respondio: el % viene de la lista cacheada de Kalshi
        late = has_market and st.get("pct_src") == "list"
        if late and src != "kalshi":
            foot = "% con retraso y Now sin el índice de Kalshi (Kalshi no respondió del todo)"
        elif late:
            foot = "% con hasta 20 s de retraso (el libro de órdenes no respondió)"
        elif src == "kalshi":
            foot = "Now = índice de Kalshi, el mismo con el que liquida · solo lectura"
        elif src == "quiet":
            foot = "El índice no emite ticks ahora (subyacente en pausa) · solo lectura"
        elif src == "coinbase":
            foot = "Now ≈ Coinbase (respaldo: el índice de Kalshi no respondió) · solo lectura"
        elif st is not None:
            foot = "Now no disponible ahora (el índice de Kalshi no respondió) · solo lectura"
        else:
            foot = "solo lectura"
        self.text(W / 2, H - 12, foot, self.f_small, AMBER if (late or src == "coinbase") else "#55555a",
                  anchor="center")

    def run(self) -> None:
        self.root.mainloop()


def main() -> int:
    ap = argparse.ArgumentParser(description="Ventana flotante Kalshi cripto 15 min")
    ap.add_argument("--coin", help="moneda inicial, p.ej. BTC, ETH, SOL")
    ap.add_argument("--pos", nargs=2, type=int, metavar=("X", "Y"), help="posicion inicial")
    try:
        args = ap.parse_args()
    except SystemExit:  # con pythonw argparse no tiene donde escribir el error
        log(f"argumentos invalidos: {sys.argv[1:]}")
        raise

    try:  # texto nitido en pantallas con escala > 100 %
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

    try:
        App(args.coin, tuple(args.pos) if args.pos else None).run()
    except Exception:
        log(traceback.format_exc())
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
