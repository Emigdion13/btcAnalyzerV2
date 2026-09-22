import { isProductId } from '../../shared/coinbase'
import type { DataSource } from '../../shared/coinbase'
import { ASSETS, COINBASE_DEFAULTS, METAL_DEFAULTS, isDemoSymbol } from './market'
import { readStored, writeStored } from './storage'

/** Preserve demo work, while introducing distinct Coinbase USD symbols and Kalshi metals. */
export function initializeCoinbaseWorkspace() {
  // Restore Gold to Kalshi's XAU-USD settlement feed, migrating any legacy PAXG-USD entries.
  const replaceLegacyGold = (id: string) => (id === 'PAXG-USD' ? 'XAU-USD' : id)
  const migrateList = (key: 'watchlist' | 'tabs') => {
    const previous = readStored<string[]>(key, [])
    if (previous.includes('PAXG-USD'))
      writeStored(key, [...new Set(previous.map(replaceLegacyGold))])
  }
  migrateList('watchlist')
  migrateList('tabs')
  if (readStored<string>('symbol', '') === 'PAXG-USD') writeStored('symbol', 'XAU-USD')

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
  // Gold and silver (Kalshi) travel with the majors into a live workspace.
  writeStored('watchlist', [
    ...new Set([...watchlist, ...COINBASE_DEFAULTS.slice(0, 10), ...METAL_DEFAULTS]),
  ])
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
  const storedOrLinked =
    symbol ?? readStored('symbol', source === 'coinbase' ? 'BTC-USD' : 'BTCUSDT')
  // Legacy PAXG links bypass local-storage migration, so canonicalize them back to XAU-USD here.
  const candidate =
    source === 'coinbase' && storedOrLinked === 'PAXG-USD' ? 'XAU-USD' : storedOrLinked
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
