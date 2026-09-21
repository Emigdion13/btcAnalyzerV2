"""
Port del indicador "COMUNIDAD JD" de Pine v5 a Python.

  Parte 1: Supertrend V1.0 (Rajandran R / Marketcalls)
  Parte 2: TonyUX EMA Scalper - Buy / Sell (tux)

Se replican las funciones de Pine tal como las define TradingView:
  - ta.atr   = RMA del True Range (suavizado de Wilder), semilla SMA
  - ta.ema   = EMA con semilla SMA (no con el primer valor)
  - ta.cross = cruce en CUALQUIER direccion
  - na       = None; se propaga durante el calentamiento
"""

Num = float | None


# ---------------------------------------------------------------- primitivas


def rma(vals: list[float], length: int) -> list[Num]:
    """ta.rma — suavizado de Wilder, alpha = 1/length, semilla SMA(length)."""
    out: list[Num] = [None] * len(vals)
    if len(vals) < length or length < 1:
        return out
    acc = sum(vals[:length]) / length
    out[length - 1] = acc
    a = 1.0 / length
    for i in range(length, len(vals)):
        acc = a * vals[i] + (1 - a) * acc
        out[i] = acc
    return out


def ema(vals: list[float], length: int) -> list[Num]:
    """ta.ema — semilla SMA(length), luego k = 2/(length+1)."""
    out: list[Num] = [None] * len(vals)
    if len(vals) < length or length < 1:
        return out
    acc = sum(vals[:length]) / length
    out[length - 1] = acc
    k = 2.0 / (length + 1)
    for i in range(length, len(vals)):
        acc = vals[i] * k + acc * (1 - k)
        out[i] = acc
    return out


def rolling(vals: list[float], length: int, fn) -> list[Num]:
    out: list[Num] = [None] * len(vals)
    for i in range(length - 1, len(vals)):
        out[i] = fn(vals[i - length + 1 : i + 1])
    return out


def highest(vals: list[float], length: int) -> list[Num]:
    return rolling(vals, length, max)


def lowest(vals: list[float], length: int) -> list[Num]:
    return rolling(vals, length, min)


def true_range(cs: list[dict]) -> list[float]:
    """TR. En la primera vela Pine usa high - low."""
    out = [cs[0]["high"] - cs[0]["low"]] if cs else []
    for i in range(1, len(cs)):
        pc = cs[i - 1]["close"]
        out.append(max(cs[i]["high"] - cs[i]["low"], abs(cs[i]["high"] - pc), abs(cs[i]["low"] - pc)))
    return out


def atr(cs: list[dict], length: int) -> list[Num]:
    return rma(true_range(cs), length)


def crossed(a: list[Num], b: list[Num], i: int) -> bool:
    """ta.cross(a, b) en la barra i — cruce en cualquier direccion."""
    if i == 0:
        return False
    a0, a1, b0, b1 = a[i - 1], a[i], b[i - 1], b[i]
    if None in (a0, a1, b0, b1):
        return False
    return (a0 < b0 and a1 > b1) or (a0 > b0 and a1 < b1)


# ---------------------------------------------------------------- SuperTrend


def supertrend(cs: list[dict], factor: int = 3, pd: int = 7) -> dict:
    """
    Supertrend V1.0. Devuelve la linea Tsl y el estado Trend (+1 / -1) por barra.

    Ojo: no es el SuperTrend "clasico". Este compara close[1] contra la banda
    anterior para arrastrarla, y el estado gira contra la banda del bar previo.
    """
    n = len(cs)
    tsl: list[Num] = [None] * n
    trend: list[Num] = [None] * n

    a = atr(cs, pd)
    trend_up = trend_dn = None
    cur = 1

    for i in range(n):
        if a[i] is None:
            continue
        hl2 = (cs[i]["high"] + cs[i]["low"]) / 2
        up = hl2 - factor * a[i]
        dn = hl2 + factor * a[i]

        # nz(TrendUp[1], Up) — si aun no hay estado, se usa la banda de hoy
        prev_up = trend_up if trend_up is not None else up
        prev_dn = trend_dn if trend_dn is not None else dn
        prev_close = cs[i - 1]["close"] if i > 0 else None

        trend_up = max(up, prev_up) if (prev_close is not None and prev_close > prev_up) else up
        trend_dn = min(dn, prev_dn) if (prev_close is not None and prev_close < prev_dn) else dn

        c = cs[i]["close"]
        if c > prev_dn:
            cur = 1
        elif c < prev_up:
            cur = -1
        # si no, se mantiene el estado anterior

        trend[i] = cur
        tsl[i] = trend_up if cur == 1 else trend_dn

    return {"tsl": tsl, "trend": trend}


# ---------------------------------------------------------------- indicador


def comunidad_jd(cs: list[dict], factor: int = 3, pd: int = 7,
                 ema_len: int = 20, hl_len: int = 8) -> dict:
    """Calcula todo el indicador sobre una serie de velas."""
    n = len(cs)
    if n == 0:
        return {"tsl": [], "trend": [], "ema": [], "last8h": [], "lastl8": [], "markers": []}

    closes = [c["close"] for c in cs]
    st = supertrend(cs, factor, pd)
    tsl, trend = st["tsl"], st["trend"]

    out = ema(closes, ema_len)
    last8h = highest(closes, hl_len)
    lastl8 = lowest(closes, hl_len)

    markers = []
    for i in range(n):
        t = cs[i]["time"]
        c = closes[i]

        # 2-3. Triangulos: cruce del precio con la linea SuperTrend
        if tsl[i] is not None and crossed(closes, tsl, i):
            if c > tsl[i]:
                markers.append({"time": t, "kind": "upArrow"})
            elif c < tsl[i]:
                markers.append({"time": t, "kind": "downArrow"})

        # 4-5. Flechas de entrada: giro de tendencia
        if i > 0 and trend[i] is not None and trend[i - 1] is not None:
            if trend[i] == 1 and trend[i - 1] == -1:
                markers.append({"time": t, "kind": "longEntry"})
            elif trend[i] == -1 and trend[i - 1] == 1:
                markers.append({"time": t, "kind": "shortEntry"})

        # 9-10. Buy / Sell del scalper: cruce con la EMA, la vela confirma
        if crossed(closes, out, i):
            prev = closes[i - 1]
            if prev > c:
                markers.append({"time": t, "kind": "sell"})
            elif prev < c:
                markers.append({"time": t, "kind": "buy"})

    return {
        "tsl": tsl,
        "trend": trend,
        "ema": out,
        "last8h": last8h,
        "lastl8": lastl8,
        "markers": markers,
    }


def summarize(cs: list[dict], ind: dict) -> dict:
    """Estado actual, para la tabla de tendencia."""
    trend, tsl, out = ind["trend"], ind["tsl"], ind["ema"]
    if not trend or trend[-1] is None:
        return {"trend": "Sin datos", "strength": 0, "change": 0.0, "bars": 0, "ema_ok": None}

    cur = trend[-1]
    label = "Alcista" if cur == 1 else "Bajista"

    # Velas desde el giro
    bars = 0
    for i in range(len(trend) - 1, -1, -1):
        if trend[i] != cur:
            break
        bars += 1

    closes = [c["close"] for c in cs]
    ref = closes[-min(len(closes), bars + 1)]
    change = (closes[-1] - ref) / ref * 100 if ref else 0.0

    # La EMA confirma cuando el precio esta del mismo lado que la tendencia
    ema_ok = None
    if out[-1] is not None:
        above = closes[-1] > out[-1]
        ema_ok = (above and cur == 1) or (not above and cur == -1)

    # Fuerza: distancia del precio a la linea SuperTrend
    strength = 1
    if tsl[-1]:
        dist = abs(closes[-1] - tsl[-1]) / closes[-1] * 100
        strength = 2 if (dist > 1.0 and ema_ok) else 1

    return {
        "trend": label,
        "strength": strength,
        "change": round(change, 2),
        "bars": bars,
        "ema_ok": ema_ok,
    }
