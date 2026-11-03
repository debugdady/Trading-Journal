import assert from 'node:assert/strict'
import test from 'node:test'
import { reconstructFuturesTrades } from './completed-trades.ts'
import { summarizeCompletedTrades } from '../trading/completed-trade-metrics.ts'

const coverage = {
  'usd-m-futures:BTCUSDT': {
    executionComplete: true,
    funding: {
      earliest: '2025-01-01T00:00:00.000Z',
      latest: '2025-12-31T23:59:59.000Z',
      complete: false,
      missingPeriods: ['History before the 90-day initial import window may not have been ingested.'],
    },
  },
}

function fill(id, side, quantity, price, realizedPnl = 0, options = {}) {
  return {
    id,
    orderId: `order-${id}`,
    accountId: 'account-1',
    product: 'usd-m-futures',
    symbol: 'BTCUSDT',
    side,
    positionSide: options.positionSide,
    price,
    priceExact: options.priceExact ?? String(price),
    quantity,
    quantityExact: options.quantityExact ?? String(quantity),
    quoteQuantity: quantity * price,
    commission: options.commission === undefined ? 0 : options.commission,
    commissionExact: options.commissionExact === undefined
      ? String(options.commission === undefined ? 0 : options.commission)
      : options.commissionExact,
    commissionAsset: options.commissionAsset ?? 'USDT',
    realizedPnl,
    realizedPnlExact: String(realizedPnl),
    executedAt: options.executedAt ?? `2025-06-01T00:0${id.slice(-1)}:00.000Z`,
    sourceQuality: 'exchange-reported',
    sourceRecordIds: [],
  }
}

function funding(id, amount, options = {}) {
  return {
    id,
    accountId: 'account-1',
    product: 'usd-m-futures',
    type: 'funding',
    symbol: 'BTCUSDT',
    asset: options.asset ?? 'USDT',
    amount,
    occurredAt: options.occurredAt ?? '2025-06-01T00:03:00.000Z',
    sourceQuality: 'exchange-reported',
    sourceRecordIds: [],
  }
}

test('aggregates multiple entries, partial exits, exact costs, funding and holding time', () => {
  const rows = [
    fill('1', 'BUY', 1, 100, 0, { commission: 0.1 }),
    fill('2', 'BUY', 1, 110, 0, { commission: 0.1 }),
    fill('3', 'SELL', 0.5, 120, 7.5, { commission: 0.05 }),
    fill('4', 'SELL', 1.5, 90, -22.5, { commission: 0.15 }),
  ]
  const trades = reconstructFuturesTrades(rows, [funding('fund-1', -0.5)], coverage)
  assert.equal(trades.length, 1)
  assert.equal(trades[0].status, 'complete')
  assert.equal(trades[0].direction, 'Long')
  assert.equal(trades[0].entryPrice, 105)
  assert.equal(trades[0].exitPrice, 97.5)
  assert.equal(trades[0].quantity, 2)
  assert.equal(trades[0].grossPnlExact, '-15')
  assert.equal(trades[0].feesExact, '0.4')
  assert.equal(trades[0].fundingExact, '-0.5')
  assert.equal(trades[0].netPnlExact, '-15.9')
  assert.equal(trades[0].partialExitCount, 1)
  assert.equal(trades[0].executionIds.length, 4)
  assert.deepEqual(trades[0].financialEventIds, ['fund-1'])
})

test('handles winning and losing completed lifecycles without combining them', () => {
  const rows = [
    fill('1', 'BUY', 1, 100, 0),
    fill('2', 'SELL', 1, 110, 10),
    fill('3', 'SELL', 2, 100, 0),
    fill('4', 'BUY', 2, 105, -10),
  ]
  const trades = reconstructFuturesTrades(rows, [], coverage)
  assert.equal(trades.length, 2)
  assert.deepEqual(trades.map(trade => trade.grossPnlExact), ['10', '-10'])
})

test('does not mark a partially closed position as a completed trade', () => {
  const trades = reconstructFuturesTrades([
    fill('1', 'BUY', 2, 100, 0),
    fill('2', 'SELL', 1, 110, 10),
  ], [], coverage)
  assert.equal(trades.length, 1)
  assert.equal(trades[0].status, 'open')
  assert.equal(trades[0].closedAt, null)
  assert.equal(trades[0].partialExitCount, 1)
})

test('reconstructs simultaneous hedge-mode long and short positions separately', () => {
  const trades = reconstructFuturesTrades([
    fill('1', 'BUY', 1, 100, 0, { positionSide: 'LONG' }),
    fill('2', 'SELL', 2, 110, 0, { positionSide: 'SHORT' }),
    fill('3', 'SELL', 1, 105, 5, { positionSide: 'LONG' }),
    fill('4', 'BUY', 2, 105, 10, { positionSide: 'SHORT' }),
  ], [], coverage)
  assert.equal(trades.length, 2)
  assert.deepEqual(trades.map(trade => trade.direction).sort(), ['Long', 'Short'])
  assert.ok(trades.every(trade => trade.status === 'complete'))
})

test('handles one-way position reversals as a close followed by a new open', () => {
  const trades = reconstructFuturesTrades([
    fill('1', 'BUY', 1, 100, 0),
    fill('2', 'SELL', 1.5, 110, 10),
  ], [], coverage)
  assert.equal(trades.length, 2)
  const closed = trades.find(trade => trade.status === 'complete')
  const open = trades.find(trade => trade.status === 'open')
  assert.equal(closed.direction, 'Long')
  assert.equal(closed.quantity, 1)
  assert.equal(closed.grossPnlExact, '10')
  assert.equal(open.direction, 'Short')
  assert.equal(open.quantity, 0.5)
  assert.deepEqual(open.executionIds, ['2'])
})

test('attributes funding only when a single matching hedge lifecycle is possible', () => {
  const rows = [
    fill('1', 'BUY', 1, 100, 0, { positionSide: 'LONG' }),
    fill('2', 'SELL', 1, 100, 0, { positionSide: 'SHORT' }),
    fill('3', 'SELL', 1, 110, 10, { positionSide: 'LONG' }),
    fill('4', 'BUY', 1, 90, 10, { positionSide: 'SHORT' }),
  ]
  const trades = reconstructFuturesTrades(rows, [funding('fund-1', -1)], coverage)
  assert.ok(trades.every(trade => trade.fundingExact === '0'))
  assert.ok(trades.every(trade => trade.netPnlExact === null))
  assert.ok(trades.every(trade => trade.reason.includes('overlaps multiple position lifecycles')))
})

test('deduplicates repeated execution IDs and produces stable output across repeated syncs', () => {
  const executions = [
    fill('1', 'BUY', 1, 100, 0),
    fill('2', 'SELL', 1, 110, 10),
  ]
  const once = reconstructFuturesTrades(executions, [], coverage)
  const repeated = reconstructFuturesTrades([...executions, ...executions], [], coverage)
  assert.deepEqual(repeated, once)
})

test('flags missing opening executions and incomplete endpoint history', () => {
  const orphan = reconstructFuturesTrades([fill('1', 'SELL', 1, 100, 5)], [], coverage)
  assert.equal(orphan[0].status, 'incomplete')
  assert.equal(orphan[0].entryPrice, null)
  assert.equal(orphan[0].netPnlExact, null)

  const incompleteCoverage = {
    ...coverage,
    'usd-m-futures:BTCUSDT': { ...coverage['usd-m-futures:BTCUSDT'], executionComplete: false },
  }
  const partial = reconstructFuturesTrades([
    fill('1', 'BUY', 1, 100, 0),
    fill('2', 'SELL', 1, 110, 10),
  ], [], incompleteCoverage)
  assert.equal(partial[0].status, 'incomplete')
  assert.match(partial[0].reason, /coverage is incomplete/)
})

test('does not double-count exchange realized-P&L income events', () => {
  const event = { ...funding('income-1', 10), type: 'realized-pnl' }
  const trades = reconstructFuturesTrades([
    fill('1', 'BUY', 1, 100, 0),
    fill('2', 'SELL', 1, 110, 10),
  ], [event], coverage)
  assert.equal(trades[0].grossPnlExact, '10')
  assert.deepEqual(trades[0].financialEventIds, [])
})

test('keeps fees in their original assets and refuses cross-asset net P&L', () => {
  const trades = reconstructFuturesTrades([
    fill('1', 'BUY', 1, 100, 0, { commission: 0.01, commissionAsset: 'BNB' }),
    fill('2', 'SELL', 1, 110, 10, { commission: 0.01, commissionAsset: 'USDT' }),
  ], [], coverage)
  assert.equal(trades[0].grossPnlExact, '10')
  assert.equal(trades[0].fees, null)
  assert.equal(trades[0].netPnl, null)
  assert.equal(trades[0].feesByAsset.length, 2)
})

test('uses source decimal strings for exact calculations and makes missing commissions unavailable', () => {
  const exact = reconstructFuturesTrades([
    fill('1', 'BUY', 0.3, 0.1, 0, { quantityExact: '0.3', priceExact: '0.1', commission: 0.01, commissionExact: '0.01' }),
    fill('2', 'SELL', 0.3, 0.2, 0.03, { quantityExact: '0.3', priceExact: '0.2', commission: 0.01, commissionExact: '0.01' }),
  ], [], coverage)
  assert.equal(exact[0].entryPrice, 0.1)
  assert.equal(exact[0].grossPnlExact, '0.03')
  assert.equal(exact[0].feesExact, '0.02')
  assert.equal(exact[0].netPnlExact, '0.01')

  const missingFee = reconstructFuturesTrades([
    fill('1', 'BUY', 1, 100, 0, { commission: null, commissionExact: null }),
    fill('2', 'SELL', 1, 110, 10),
  ], [], coverage)
  assert.equal(missingFee[0].status, 'complete')
  assert.equal(missingFee[0].feesExact, null)
  assert.equal(missingFee[0].netPnlExact, null)
  assert.match(missingFee[0].reason, /no reported commission/)
})

test('summarizes completed trades using net outcomes and excludes incomplete histories', () => {
  const rows = [
    { id: 'win', accountId: 'account-1', product: 'usd-m-futures', symbol: 'BTCUSDT', direction: 'Long', status: 'complete', openedAt: '2025-01-01T00:00:00.000Z', closedAt: '2025-01-01T01:00:00.000Z', quantity: 1, grossPnl: 12, grossPnlExact: '12', grossPnlAsset: 'USDT', netPnl: 10, netPnlExact: '10' },
    { id: 'loss', accountId: 'account-1', product: 'usd-m-futures', symbol: 'BTCUSDT', direction: 'Short', status: 'complete', openedAt: '2025-01-02T00:00:00.000Z', closedAt: '2025-01-02T02:00:00.000Z', quantity: 1, grossPnl: -4, grossPnlExact: '-4', grossPnlAsset: 'USDT', netPnl: -5, netPnlExact: '-5' },
    { id: 'flat', accountId: 'account-1', product: 'usd-m-futures', symbol: 'BTCUSDT', direction: 'Long', status: 'complete', openedAt: '2025-01-03T00:00:00.000Z', closedAt: '2025-01-03T00:30:00.000Z', quantity: 1, grossPnl: 0, grossPnlExact: '0', grossPnlAsset: 'USDT', netPnl: 0, netPnlExact: '0' },
    { id: 'partial', accountId: 'account-1', product: 'usd-m-futures', symbol: 'BTCUSDT', direction: 'Long', status: 'incomplete', openedAt: '2025-01-04T00:00:00.000Z', closedAt: '2025-01-04T01:00:00.000Z', grossPnl: 100, grossPnlExact: '100', grossPnlAsset: 'USDT' },
  ]
  const [summary] = summarizeCompletedTrades(rows)
  assert.equal(summary.total, 3)
  assert.equal(summary.analyzable, 3)
  assert.equal(summary.wins, 1)
  assert.equal(summary.losses, 1)
  assert.equal(summary.breakeven, 1)
  assert.equal(summary.gross, '8')
  assert.equal(summary.net, '5')
  assert.equal(summary.averageWin, '10')
  assert.equal(summary.averageLoss, '-5')
  assert.equal(summary.maxDrawdown, '5')
  assert.equal(summary.currentDrawdown, '5')
  assert.equal(summary.longestWinStreak, 1)
})

test('does not bridge outcome streaks across trades with unavailable net P&L', () => {
  const rows = [
    { id: 'win-1', accountId: 'account-1', product: 'usd-m-futures', symbol: 'BTCUSDT', direction: 'Long', status: 'complete', openedAt: '2025-01-01T00:00:00.000Z', closedAt: '2025-01-01T01:00:00.000Z', grossPnl: 10, grossPnlExact: '10', grossPnlAsset: 'USDT', netPnl: 8, netPnlExact: '8' },
    { id: 'unknown', accountId: 'account-1', product: 'usd-m-futures', symbol: 'BTCUSDT', direction: 'Long', status: 'complete', openedAt: '2025-01-02T00:00:00.000Z', closedAt: '2025-01-02T01:00:00.000Z', grossPnl: 10, grossPnlExact: '10', grossPnlAsset: 'USDT', netPnl: null, netPnlExact: null },
    { id: 'win-2', accountId: 'account-1', product: 'usd-m-futures', symbol: 'BTCUSDT', direction: 'Long', status: 'complete', openedAt: '2025-01-03T00:00:00.000Z', closedAt: '2025-01-03T01:00:00.000Z', grossPnl: 10, grossPnlExact: '10', grossPnlAsset: 'USDT', netPnl: 7, netPnlExact: '7' },
  ]
  const [summary] = summarizeCompletedTrades(rows)
  assert.equal(summary.analyzable, 2)
  assert.equal(summary.longestWinStreak, null)
  assert.equal(summary.currentStreak, null)
  assert.equal(summary.maxDrawdown, null)
})

test('summarizes win-only, loss-only and breakeven-only groups without empty decimal sums', () => {
  const createTrade = (id, net) => ({
    id,
    accountId: 'account-1',
    product: 'usd-m-futures',
    symbol: 'BTCUSDT',
    direction: 'Long',
    status: 'complete',
    openedAt: '2025-01-01T00:00:00.000Z',
    closedAt: '2025-01-01T01:00:00.000Z',
    grossPnl: net,
    grossPnlExact: String(net),
    grossPnlAsset: 'USDT',
    netPnl: net,
    netPnlExact: String(net),
  })

  const winOnly = summarizeCompletedTrades([createTrade('win', 2)])[0]
  assert.equal(winOnly.averageWin, '2')
  assert.equal(winOnly.averageLoss, null)
  assert.equal(winOnly.profitFactor, null)

  const lossOnly = summarizeCompletedTrades([createTrade('loss', -2)])[0]
  assert.equal(lossOnly.averageWin, null)
  assert.equal(lossOnly.averageLoss, '-2')
  assert.equal(lossOnly.profitFactor, 0)

  const breakevenOnly = summarizeCompletedTrades([createTrade('flat', 0)])[0]
  assert.equal(breakevenOnly.averageWin, null)
  assert.equal(breakevenOnly.averageLoss, null)
  assert.equal(breakevenOnly.profitFactor, null)
})
