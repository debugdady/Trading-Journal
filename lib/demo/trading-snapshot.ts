import type { AccountSnapshot, Balance, CompletedTrade, Coverage, Execution, FinancialEvent, MarketObservation, Order, Position, RawExchangeRecord, TradingRepositorySnapshot } from '@/lib/trading/types'

const lineage = { sourceQuality: 'demo' as const, sourceRecordIds: [], sourceEndpoint: 'demo://binance', retrievedAt: '2026-10-30T12:00:00.000Z', reason: 'Synthetic frontend demonstration data' }
const accountId = 'demo-binance-account'
const iso = (daysAgo: number, hour = 12) => new Date(Date.UTC(2026, 9, 30 - daysAgo, hour)).toISOString()

const assets: Balance[] = [
  { ...lineage, accountId, asset: 'USDT', free: 32540.18, locked: 1820.4, borrowed: 0, interest: 0, valuation: 34360.58, valuationCurrency: 'USDT', asOf: iso(0) },
  { ...lineage, accountId, asset: 'BTC', free: 0.1842, locked: 0.012, borrowed: 0, interest: 0, valuation: 13278.44, valuationCurrency: 'USDT', asOf: iso(0) },
  { ...lineage, accountId, asset: 'ETH', free: 4.82, locked: 0.4, borrowed: 0, interest: 0, valuation: 12862.4, valuationCurrency: 'USDT', asOf: iso(0) },
  { ...lineage, accountId, asset: 'BNB', free: 18.4, locked: 1.2, borrowed: 0, interest: 0, valuation: 10984.2, valuationCurrency: 'USDT', asOf: iso(0) },
  { ...lineage, accountId, asset: 'USDC', free: 3820, locked: 0, borrowed: 0, interest: 0, valuation: 3820, valuationCurrency: 'USDT', asOf: iso(0) },
]

const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AVAXUSDT']
const products = ['spot', 'usd-m-futures', 'coin-m-futures'] as const
const sides = ['BUY', 'SELL'] as const
const orderStatuses = ['FILLED', 'FILLED', 'FILLED', 'PARTIALLY_FILLED', 'NEW', 'CANCELED', 'REJECTED'] as const
const orderTypes = ['LIMIT', 'MARKET', 'STOP', 'STOP_LIMIT'] as const

export const demoOrders: Order[] = Array.from({ length: 24 }, (_, index) => {
  const symbol = symbols[index % symbols.length]; const product = products[index % products.length]; const side = sides[index % 2]; const status = orderStatuses[index % orderStatuses.length]; const type = orderTypes[index % orderTypes.length]; const quantity = Number((0.04 + (index % 5) * 0.03).toFixed(4)); const price = symbol === 'BTCUSDT' ? 66500 + index * 140 : symbol === 'ETHUSDT' ? 2460 + index * 13 : symbol === 'BNBUSDT' ? 575 + index * 2 : 110 + index * 1.7; const executedQuantity = status === 'FILLED' ? quantity : status === 'PARTIALLY_FILLED' ? Number((quantity * .42).toFixed(4)) : 0
  return { ...lineage, id: `ORD-${1040 + index}`, accountId, product, symbol, clientOrderId: `demo-${index + 1}`, side, type, status, price: Number(price.toFixed(2)), quantity, executedQuantity, quoteQuantity: Number((price * executedQuantity).toFixed(2)), reduceOnly: product !== 'spot' && index % 3 === 0, positionSide: product === 'spot' ? undefined : index % 2 ? 'SHORT' : 'LONG', openedAt: iso(index + 1, 9 + index % 8), updatedAt: iso(index, 10 + index % 8) }
})

export const demoExecutions: Execution[] = demoOrders.filter(order => order.executedQuantity && order.executedQuantity > 0).flatMap((order, orderIndex) => Array.from({ length: orderIndex % 3 === 0 ? 2 : 1 }, (_, fillIndex) => { const quantity = Number(((order.executedQuantity ?? 0) / (orderIndex % 3 === 0 ? 2 : 1)).toFixed(4)); const price = Number(((order.price ?? 0) + (fillIndex ? .8 : -.35)).toFixed(2)); return { ...lineage, id: `EXE-${order.id}-${fillIndex + 1}`, orderId: order.id, accountId, product: order.product, symbol: order.symbol, side: order.side, price, quantity, quoteQuantity: Number((price * quantity).toFixed(2)), commission: Number((price * quantity * .0004).toFixed(2)), commissionAsset: 'USDT', realizedPnl: order.product === 'spot' ? null : Number(((orderIndex % 4 - 1.2) * 42.8).toFixed(2)), isMaker: (orderIndex + fillIndex) % 3 === 0, executedAt: order.updatedAt ?? iso(orderIndex) } }))

export const demoPositions: Position[] = [
  { ...lineage, id: 'POS-BTC-LONG', accountId, product: 'usd-m-futures', symbol: 'BTCUSDT', positionSide: 'LONG', quantity: 0.42, entryPrice: 65780, breakEvenPrice: 65812, markPrice: 67112, liquidationPrice: 47840, unrealizedPnl: 559.44, leverage: 3, marginType: 'ISOLATED', notional: 28187.04, asOf: iso(0) },
  { ...lineage, id: 'POS-ETH-SHORT', accountId, product: 'usd-m-futures', symbol: 'ETHUSDT', positionSide: 'SHORT', quantity: -3.8, entryPrice: 2528, breakEvenPrice: 2532, markPrice: 2581, liquidationPrice: 3190, unrealizedPnl: -201.4, leverage: 5, marginType: 'CROSSED', notional: 9807.8, asOf: iso(0) },
  { ...lineage, id: 'POS-SOL-LONG', accountId, product: 'coin-m-futures', symbol: 'SOLUSDT', positionSide: 'LONG', quantity: 68, entryPrice: 171.4, breakEvenPrice: 171.8, markPrice: 178.2, liquidationPrice: 92.4, unrealizedPnl: 462.4, leverage: 4, marginType: 'ISOLATED', notional: 12117.6, asOf: iso(0) },
]

export const demoFinancialEvents: FinancialEvent[] = [
  { ...lineage, id: 'EVT-DEP-01', accountId, product: 'wallet', type: 'deposit', asset: 'USDT', amount: 15000, transactionId: 'demo-tx-deposit-01', occurredAt: iso(29), description: 'Synthetic deposit' },
  { ...lineage, id: 'EVT-WD-01', accountId, product: 'wallet', type: 'withdrawal', asset: 'USDT', amount: -2400, transactionId: 'demo-tx-withdrawal-01', occurredAt: iso(21), description: 'Synthetic withdrawal' },
  { ...lineage, id: 'EVT-TR-01', accountId, product: 'wallet', type: 'internal-transfer', asset: 'BTC', amount: .04, transactionId: 'demo-transfer-01', occurredAt: iso(18), description: 'Synthetic wallet to futures transfer' },
  { ...lineage, id: 'EVT-CONV-01', accountId, product: 'wallet', type: 'conversion', asset: 'USDC', amount: 3820, transactionId: 'demo-conversion-01', occurredAt: iso(13), description: 'Synthetic USDC conversion' },
  { ...lineage, id: 'EVT-DIV-01', accountId, product: 'wallet', type: 'dividend', asset: 'BNB', amount: .08, transactionId: 'demo-dividend-01', occurredAt: iso(8), description: 'Synthetic dividend' },
  { ...lineage, id: 'EVT-FUND-01', accountId, product: 'usd-m-futures', type: 'funding', asset: 'USDT', amount: 126.4, symbol: 'BTCUSDT', occurredAt: iso(3), description: 'Synthetic funding received' },
  { ...lineage, id: 'EVT-FEE-01', accountId, product: 'usd-m-futures', type: 'commission', asset: 'USDT', amount: -84.2, occurredAt: iso(1), description: 'Synthetic commissions' },
]

export const demoSnapshots: AccountSnapshot[] = Array.from({ length: 31 }, (_, index) => { const equity = 92000 + index * 180 + Math.sin(index / 2.6) * 780; return { ...lineage, id: `SNAP-${index + 1}`, accountId, product: 'wallet', walletBalance: equity - 1420, equity, unrealizedPnl: Math.sin(index / 2) * 420, initialMargin: 10400 + Math.sin(index) * 420, maintenanceMargin: 3100 + Math.sin(index / 1.4) * 120, marginBalance: equity, exposure: 37000 + Math.sin(index / 2) * 2400, currency: 'USDT', asOf: iso(30 - index) } })

export const demoRawRecords: RawExchangeRecord[] = [...demoOrders.slice(0, 8), ...demoExecutions.slice(0, 8), ...demoPositions, ...demoFinancialEvents].map((record: any, index) => ({ ...lineage, id: `RAW-${index + 1}`, exchange: 'demo', accountId, product: record.product ?? 'wallet', endpoint: record.type ? 'demo://financial-event' : record.orderId ? 'demo://execution' : record.symbol ? 'demo://order-or-position' : 'demo://record', sourceId: record.id, observedAt: record.updatedAt ?? record.executedAt ?? record.occurredAt ?? record.asOf, payload: record, syncRunId: 'demo-sync-001' }))

export const demoCoverage: Coverage[] = ['account', 'orders', 'executions', 'financial-events', 'positions', 'snapshots', 'raw-records'].map(endpoint => ({ accountId, product: endpoint === 'positions' ? 'usd-m-futures' : 'wallet', endpoint: `demo://${endpoint}`, earliest: iso(30), latest: iso(0), recordCount: endpoint === 'orders' ? demoOrders.length : endpoint === 'executions' ? demoExecutions.length : endpoint === 'snapshots' ? demoSnapshots.length : 1, complete: true, missingPeriods: [] }))

export const DEMO_TRADING_SNAPSHOT: TradingRepositorySnapshot = { raw: demoRawRecords, balances: assets, orders: demoOrders, executions: demoExecutions, financialEvents: demoFinancialEvents, positions: demoPositions, snapshots: demoSnapshots, market: [] as MarketObservation[], trades: [] as CompletedTrade[], coverage: demoCoverage }
