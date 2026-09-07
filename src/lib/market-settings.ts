import { isProductId } from '../../shared/coinbase'
import type { DataSource } from '../../shared/coinbase'
import { ASSETS, COINBASE_DEFAULTS, isDemoSymbol } from './market'
import { readStored, writeStored } from './storage'

/** Preserve demo work, while introducing distinct Coinbase USD symbols. */
export function initializeCoinbaseWorkspace() {
  if (readStored('coinbase-initialized', false)) return
  const old = readStored<string>('symbol', 'BTCUSDT')
  const product = isProductId(old)
    ? old
    : (COINBASE_DEFAULTS.find(
        (id) => id.slice(0, -4) === ASSETS.find((a) => a.symbol === old)?.ticker,
      ) ?? 'BTC-USD')
  const watchlist = readStored<string[]>(
    'watchlist',
    ASSETS.slice(0, 10).map((a) => a.symbol),
  )
  const tabs = readStored<string[]>('tabs', ['BTCUSDT', 'ETHUSDT'])
  writeStored('watchlist', [...new Set([...watchlist, ...COINBASE_DEFAULTS.slice(0, 10)])])
  writeStored('tabs', [...new Set([...tabs.slice(-6), product, 'ETH-USD'])].slice(-8))
  writeStored('symbol', product)
  writeStored('data-source', 'coinbase')
  writeStored('coinbase-initialized', true)
}
export function initialMarket(): { source: DataSource; symbol: string } {
  const query = new URLSearchParams(window.location.search),
    symbol = query.get('symbol')
  const source: DataSource =
    query.get('source') === 'demo' || (symbol && isDemoSymbol(symbol))
      ? 'demo'
      : query.get('source') === 'coinbase' || (symbol && isProductId(symbol))
        ? 'coinbase'
        : readStored<DataSource>('data-source', 'coinbase') === 'demo'
          ? 'demo'
          : 'coinbase'
  const candidate = symbol ?? readStored('symbol', source === 'coinbase' ? 'BTC-USD' : 'BTCUSDT')
  return {
    source,
    symbol:
      source === 'coinbase'
        ? isProductId(candidate)
          ? candidate
          : 'BTC-USD'
        : isDemoSymbol(candidate)
          ? candidate
          : 'BTCUSDT',
  }
}
