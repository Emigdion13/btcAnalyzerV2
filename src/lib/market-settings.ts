import { isProductId } from '../../shared/coinbase'
import type { DataSource } from '../../shared/coinbase'
import { ASSETS, COINBASE_DEFAULTS, METAL_DEFAULTS, isDemoSymbol } from './market'
import { readStored, writeStored } from './storage'

/** Preserve demo work, while introducing distinct Coinbase USD symbols. */
export function initializeCoinbaseWorkspace() {
  // Replace the former Kalshi-gold chart with Coinbase's tradeable PAX Gold product even in
  // workspaces that completed the original Coinbase migration. Lists are de-duplicated because
  // PAXG may already have been added from Coinbase's catalog.
  const replaceLegacyGold = (id: string) => (id === 'XAU-USD' ? 'PAXG-USD' : id)
  const migrateList = (key: 'watchlist' | 'tabs') => {
    const previous = readStored<string[]>(key, [])
    if (previous.includes('XAU-USD'))
      writeStored(key, [...new Set(previous.map(replaceLegacyGold))])
  }
  migrateList('watchlist')
  migrateList('tabs')
  if (readStored<string>('symbol', '') === 'XAU-USD') writeStored('symbol', 'PAXG-USD')

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
  // PAX Gold (Coinbase) and silver (Kalshi) travel with the majors into a live workspace.
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
  // Old shared links bypass local-storage migration, so canonicalize them here as well.
  const candidate =
    source === 'coinbase' && storedOrLinked === 'XAU-USD' ? 'PAXG-USD' : storedOrLinked
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
