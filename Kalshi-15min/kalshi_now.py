"""
Imprime los dos numeros que van en los inputs del indicador de TradingView:
el target (strike) de Kalshi y el YES %.

Uso:
    python kalshi_now.py                      # BTC diario, strike mas cercano al spot
    python kalshi_now.py KXETHD ETH-USD       # otra serie / otro par
    python kalshi_now.py KXBTCD BTC-USD KXBTCD-26SEP2017-T81249.99   # un ticker fijo

Solo lectura: reutiliza el mismo candado de server.py, no hay API key.
"""

import sys

import server


def main() -> int:
    series = sys.argv[1] if len(sys.argv) > 1 else "KXBTCD"
    product = sys.argv[2] if len(sys.argv) > 2 else "BTC-USD"
    ticker = sys.argv[3] if len(sys.argv) > 3 else None

    spot = server.spot_price(product)

    if ticker:
        market = server.fetch_json(f"{server.KALSHI}/markets/{server.esc(ticker)}").get("market")
    else:
        market = server.pick_market(series, spot)

    if not market:
        print(f"Sin mercado abierto en {series}.")
        return 1

    m = server.market_view(market)

    print(f"Mercado : {m['ticker']}")
    print(f"          {m['subtitle']}")
    print(f"Spot    : {spot:,.2f}" if spot else "Spot    : n/d")
    print(f"Cierra  : {m['close_time']}")
    print()
    print("Pega esto en Ajustes del indicador -> grupo Kalshi:")
    print(f"  Target (strike) de Kalshi : {m['target']:.2f}")
    print(f"  YES % de Kalshi           : {m['yes_pct']:.1f}")
    print(f"  (DOWN = {m['no_pct']:.1f} %)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
