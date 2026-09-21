"""
Puente local Kalshi -> navegador.

Kalshi responde 403 si la peticion trae cabecera Origin, asi que el navegador
no puede llamarla directo. Este servidor hace de proxy (no reenvia Origin) y
ademas sirve las velas del subyacente desde Coinbase.

Uso:  python server.py     ->  http://localhost:8787
Solo libreria estandar, no hace falta instalar nada.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import indicators

PORT = 8787
ROOT = Path(__file__).parent

KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
COINBASE = "https://api.coinbase.com/api/v3/brokerage/market"

# Precio en vivo del subyacente, el mismo que la pagina de Kalshi pinta como "Now".
# Publico y sin clave, pero NO documentado (lo usa su propia web): puede cambiar.
KALSHI_LIVE = "https://api.elections.kalshi.com/v1/live_data/assets"

UA = "kalshi-target-indicator/1.0"

# ---------------------------------------------------------------------------
# MODO SOLO LECTURA
# Este puente nunca opera ni consulta el portafolio. No usa API key: los datos
# de mercado de Kalshi son publicos. La lista de abajo es un candado duro: solo
# se permite GET a estas rutas, cualquier otra cosa revienta antes de salir.
# ---------------------------------------------------------------------------
READ_ONLY_PREFIXES = (
    f"{KALSHI}/markets",
    f"{KALSHI}/events",
    f"{KALSHI}/series",
    f"{KALSHI_LIVE}/",
    f"{COINBASE}/products",
)

# Nunca, bajo ninguna ruta: ordenes, posiciones, fills, balance.
FORBIDDEN = ("/portfolio", "/orders", "/positions", "/fills", "/balance")


class ReadOnlyViolation(Exception):
    pass


def esc(value: str) -> str:
    """Escapa un valor de la URL. safe='' para que '/' y '..' no escapen la ruta."""
    return urllib.parse.quote(str(value), safe="")


def assert_read_only(url: str) -> None:
    # Se revisa la URL tal cual y tambien decodificada, para que un %2F no
    # esconda una ruta prohibida.
    for form in (url, urllib.parse.unquote(url)):
        low = form.lower()
        if any(f in low for f in FORBIDDEN):
            raise ReadOnlyViolation(f"ruta de escritura/portafolio bloqueada: {url}")
    if not url.startswith(READ_ONLY_PREFIXES):
        raise ReadOnlyViolation(f"ruta no permitida en modo solo lectura: {url}")

# Granularidad Coinbase -> segundos por vela
GRANULARITY = {
    "FIFTEEN_MINUTE": 900,
    "ONE_HOUR": 3600,
    "ONE_DAY": 86400,
}

_cache: dict[str, tuple[float, object]] = {}


def fetch_json(url: str, ttl: float = 3.0, timeout: float = 20.0):
    """
    GET con cache corto. Sin cabecera Origin (Kalshi la rechaza con 403).
    ttl <= 0: sin cache (ni se lee ni se guarda), para datos en tiempo real cuya
    URL cambia con cada contrato y que de otro modo harian crecer _cache sin fin.
    """
    assert_read_only(url)

    now = time.time()
    if ttl > 0:
        hit = _cache.get(url)
        if hit and now - hit[0] < ttl:
            return hit[1]

    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    if ttl > 0:
        _cache[url] = (now, data)
    return data


def spot_price(product: str) -> float | None:
    """Ultimo precio del subyacente."""
    try:
        data = fetch_json(f"{COINBASE}/products/{esc(product)}", ttl=3.0)
        return float(data["price"])
    except Exception:
        return None


def candles(product: str, granularity: str, count: int) -> list[dict]:
    """Velas ordenadas de mas vieja a mas nueva."""
    secs = GRANULARITY[granularity]
    end = int(time.time())
    start = end - secs * count
    url = (
        f"{COINBASE}/products/{esc(product)}/candles"
        f"?start={start}&end={end}&granularity={granularity}"
    )
    raw = fetch_json(url, ttl=20.0).get("candles", [])
    out = [
        {
            "time": int(c["start"]),
            "open": float(c["open"]),
            "high": float(c["high"]),
            "low": float(c["low"]),
            "close": float(c["close"]),
        }
        for c in raw
    ]
    out.sort(key=lambda c: c["time"])
    return out


def pick_market(series: str, spot: float | None) -> dict | None:
    """Mercado abierto de la serie cuyo strike queda mas cerca del spot."""
    data = fetch_json(f"{KALSHI}/markets?series_ticker={esc(series)}&status=open&limit=1000", ttl=5.0)
    markets = [m for m in data.get("markets", []) if m.get("strike_type") in ("greater", "less", "between")]
    if not markets:
        return None
    if spot is None:
        return markets[0]

    def strike_of(m):
        for key in ("floor_strike", "cap_strike"):
            v = m.get(key)
            if v not in (None, ""):
                return float(v)
        return None

    scored = [(abs(strike_of(m) - spot), m) for m in markets if strike_of(m) is not None]
    if not scored:
        return markets[0]
    scored.sort(key=lambda p: p[0])
    return scored[0][1]


def market_view(m: dict) -> dict:
    """Normaliza un mercado de Kalshi a lo que la pagina necesita."""
    def num(key):
        v = m.get(key)
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    floor_s, cap_s = num("floor_strike"), num("cap_strike")
    target = floor_s if floor_s is not None else cap_s

    bid, ask = num("yes_bid_dollars"), num("yes_ask_dollars")
    if bid is not None and ask is not None and (bid or ask):
        yes = (bid + ask) / 2
    else:
        yes = num("last_price_dollars")
    yes_pct = round((yes or 0) * 100, 1)

    return {
        "ticker": m.get("ticker"),
        "title": m.get("title"),
        "subtitle": m.get("yes_sub_title"),
        "strike_type": m.get("strike_type"),
        "target": target,
        "floor_strike": floor_s,
        "cap_strike": cap_s,
        "yes_pct": yes_pct,
        "no_pct": round(100 - yes_pct, 1),
        "yes_bid": bid,
        "yes_ask": ask,
        "close_time": m.get("close_time"),
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # silencio

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(parsed.query)
        one = lambda k, d=None: (q.get(k) or [d])[0]

        try:
            if parsed.path in ("/", "/index.html"):
                html = (ROOT / "index.html").read_bytes()
                self._send(200, html, "text/html; charset=utf-8")

            elif parsed.path == "/api/state":
                series = one("series", "KXBTCD")
                product = one("product", "BTC-USD")
                ticker = one("ticker")

                spot = spot_price(product)

                if ticker:
                    data = fetch_json(f"{KALSHI}/markets/{esc(ticker)}", ttl=3.0)
                    market = data.get("market")
                else:
                    market = pick_market(series, spot)

                # Parametros del indicador (mismos defaults que el Pine)
                factor = int(one("factor", 3))
                pd = int(one("pd", 7))
                ema_len = int(one("len", 20))

                tf = {
                    "day": ("ONE_DAY", 300),
                    "h1": ("ONE_HOUR", 300),
                    "m15": ("FIFTEEN_MINUTE", 300),
                }
                # Se calcula sobre toda la serie y despues se recorta, para que
                # el calentamiento de ATR/EMA no ensucie lo que se dibuja.
                KEEP = 180
                trends, series_data, ind_data = {}, {}, {}
                for key, (gran, n) in tf.items():
                    cs = candles(product, gran, n)
                    ind = indicators.comunidad_jd(cs, factor, pd, ema_len)
                    trends[key] = indicators.summarize(cs, ind)

                    kept = cs[-KEEP:]
                    cut = len(cs) - len(kept)
                    times = [c["time"] for c in kept]

                    def line(name):
                        return [
                            {"time": t, "value": v}
                            for t, v in zip(times, ind[name][cut:])
                            if v is not None
                        ]

                    series_data[key] = kept
                    ind_data[key] = {
                        "tsl": [
                            {"time": t, "value": v, "trend": tr}
                            for t, v, tr in zip(times, ind["tsl"][cut:], ind["trend"][cut:])
                            if v is not None
                        ],
                        "ema": line("ema"),
                        "last8h": line("last8h"),
                        "lastl8": line("lastl8"),
                        "markers": [m for m in ind["markers"] if m["time"] >= times[0]] if times else [],
                    }

                self._json({
                    "ok": True,
                    "spot": spot,
                    "product": product,
                    "market": market_view(market) if market else None,
                    "trends": trends,
                    "candles": series_data,
                    "indicators": ind_data,
                    "params": {"factor": factor, "pd": pd, "len": ema_len},
                    "ts": int(time.time()),
                })

            elif parsed.path == "/api/markets":
                series = one("series", "KXBTCD")
                data = fetch_json(
                    f"{KALSHI}/markets?series_ticker={esc(series)}&status=open&limit=1000",
                    ttl=10.0,
                )
                rows = [market_view(m) for m in data.get("markets", [])]
                rows = [r for r in rows if r["target"] is not None]
                rows.sort(key=lambda r: r["target"])
                self._json({"ok": True, "markets": rows})

            else:
                self._json({"ok": False, "error": "not found"}, 404)

        except ReadOnlyViolation as e:
            self._json({"ok": False, "error": "modo solo lectura", "detail": str(e)}, 403)
        except urllib.error.HTTPError as e:
            self._json({"ok": False, "error": f"HTTP {e.code} desde upstream", "detail": e.reason}, 502)
        except Exception as e:
            self._json({"ok": False, "error": type(e).__name__, "detail": str(e)}, 500)


if __name__ == "__main__":
    print(f"Indicador Kalshi -> http://localhost:{PORT}")
    print("Ctrl+C para detener.")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

