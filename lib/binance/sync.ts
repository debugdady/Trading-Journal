import 'server-only'

import { randomUUID } from 'node:crypto'
import { BinanceApiError, BinanceClient } from './client'
import {
  beginSync,
  completeSync,
  getAccountCredentials,
  getEndpointCursor,
  listAccounts,
  listRecords,
  refreshSyncLock,
  replaceCurrentRecords,
  saveEndpointResult,
  saveRecords,
  type StoredRecord,
  type SyncRun,
} from './storage'
import type {
  AccountSnapshot,
  Balance,
  Execution,
  FinancialEvent,
  MarketObservation,
  Order,
  Position,
  Product,
  RawExchangeRecord,
} from '@/lib/trading/types'

type JsonRecord = Record<string, unknown>
type SyncResult = { syncRunId: string; status: SyncRun['status']; recordsImported: number; error: string | null }

const inFlight = new Map<string, Promise<SyncResult>>()
const quotes = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'BTC', 'ETH', 'BNB', 'TRY', 'EUR', 'GBP']

export function verifyBinanceCredentials(input: { apiKey: string; apiSecret: string; products: Product[] }) {
  return Promise.all(input.products.map(async product => {
    const client = new BinanceClient({ ...input, product })
    const endpoint = product === 'spot'
      ? '/api/v3/account'
      : product === 'usd-m-futures' ? '/fapi/v3/account' : '/dapi/v1/account'
    const result = await client.request<JsonRecord>(endpoint, {}, true)
    return { product, endpoint: result.endpoint, checkedAt: result.retrievedAt }
  }))
}

export function syncEnabledAccounts() {
  return listAccounts().filter(account => account.enabled).reduce<Promise<SyncResult[]>>(
    async (previous, account) => [...await previous, await syncAccount(account.id)],
    Promise.resolve([]),
  )
}

export function syncAccount(accountId: string): Promise<SyncResult> {
  const ongoing = inFlight.get(accountId)
  if (ongoing) return ongoing
  const run = performSync(accountId).finally(() => inFlight.delete(accountId))
  inFlight.set(accountId, run)
  return run
}

async function performSync(accountId: string): Promise<SyncResult> {
  if (!listAccounts().some(account => account.id === accountId && account.enabled)) {
    throw new Error('Binance account is disabled or no longer connected.')
  }
  const syncRunId = randomUUID()
  const startedAt = beginSync(accountId, syncRunId)
  if (!startedAt) {
    return { syncRunId: '', status: 'running', recordsImported: 0, error: 'A sync for this account is already in progress.' }
  }
  let recordsImported = 0
  const errors: string[] = []
  try {
    const stored = getAccountCredentials(accountId)
    if (!stored) throw new Error('Binance account is disabled or no longer connected.')
    for (const product of stored.account.products) {
      try {
        recordsImported += await syncProduct(accountId, product, stored.credentials, syncRunId, errors)
      } catch (error) {
        const message = publicError(error)
        errors.push(`${product}: ${message}`)
      }
    }
  } catch (error) {
    errors.push(publicError(error))
  }
  const status: SyncRun['status'] = errors.length === 0 ? 'successful' : recordsImported > 0 ? 'partial' : 'failed'
  const error = errors.length ? errors.join(' · ').slice(0, 1000) : null
  completeSync({ id: syncRunId, accountId, status, recordsImported, error })
  return { syncRunId, status, recordsImported, error }
}

async function syncProduct(
  accountId: string,
  product: Product,
  credentials: { apiKey: string; apiSecret: string },
  syncRunId: string,
  failures: string[],
) {
  const client = new BinanceClient({ ...credentials, product })
  let imported = 0
  const read = async <T>(endpoint: string, params: Record<string, string | number | boolean> = {}, signed = true) => {
    refreshSyncLock(accountId, syncRunId)
    const response = await client.request<T>(endpoint, params, signed)
    if (signed) {
      const rawPayload = Array.isArray(response.data) ? { data: response.data } : object(response.data)
      const raw: RawExchangeRecord = {
        id: `${product}:${endpoint}:${response.retrievedAt}`,
        exchange: 'binance',
        accountId,
        product,
        endpoint,
        observedAt: response.retrievedAt,
        retrievedAt: response.retrievedAt,
        sourceQuality: 'exchange-reported',
        sourceRecordIds: [],
        payload: rawPayload,
        syncRunId,
      }
      saveRecords([storedRecord(accountId, product, 'raw', raw.id, endpoint, object(raw), response.retrievedAt, response.retrievedAt, syncRunId)])
    }
    return response
  }
  const safely = async (label: string, callback: () => Promise<number>) => {
    try {
      imported += await callback()
    } catch (error) {
      const message = publicError(error)
      failures.push(`${label}: ${message}`)
      saveEndpointResult({
        accountId, product, endpoint: label, recordCount: 0, complete: false,
        missingPeriods: [message], error: message,
      })
    }
  }

  if (product === 'spot') {
    let balances: JsonRecord[] = []
    await safely('/api/v3/account', async () => {
      const { data, endpoint, retrievedAt } = await read<JsonRecord>('/api/v3/account')
      balances = records(data.balances)
      const normalized: StoredRecord[] = balances.map(item => {
        const balance: Balance = {
          ...lineage(endpoint, retrievedAt),
          accountId,
          product,
          asset: text(item.asset) ?? 'unknown',
          free: numeric(item.free),
          locked: numeric(item.locked),
          borrowed: null,
          interest: null,
          valuation: null,
          valuationCurrency: 'USD',
          asOf: retrievedAt,
        }
        return storedRecord(accountId, product, 'balances', balance.asset, endpoint, balance, retrievedAt, retrievedAt, syncRunId)
      })
      const snapshot: AccountSnapshot = {
        ...lineage(endpoint, retrievedAt), id: `${accountId}:${product}:${retrievedAt}`, accountId, product,
        walletBalance: null, equity: null, unrealizedPnl: null, initialMargin: null,
        maintenanceMargin: null, marginBalance: null, exposure: null, currency: 'USD', asOf: retrievedAt,
      }
      normalized.push(storedRecord(accountId, product, 'snapshots', snapshot.id, endpoint, snapshot, retrievedAt, retrievedAt, syncRunId))
      replaceCurrentRecords(normalized.filter(record => record.kind === 'balances'), accountId, product, 'balances')
      saveRecords(normalized.filter(record => record.kind !== 'balances'))
      saveEndpointResult({ accountId, product, endpoint, recordCount: normalized.length, complete: true, earliest: retrievedAt, latest: retrievedAt })
      return normalized.length
    })
    await safely('/api/v3/openOrders', async () => importOrders(
      await read<JsonRecord[]>('/api/v3/openOrders'), accountId, product, syncRunId,
    ))
    const symbols = await discoverSymbols(read, product, accountId, balances, failures)
    await syncSymbolHistory({ read, accountId, product, syncRunId, symbols, failures })
    await syncMarketContext({ read, accountId, product, syncRunId, failures })
    await safely('/sapi/v1/capital/deposit/hisrec', () => syncTimeEndpoint(
      read, accountId, product, syncRunId, '/sapi/v1/capital/deposit/hisrec', '/sapi/v1/capital/deposit/hisrec',
      response => importFlows(response as { data: JsonRecord[]; endpoint: string; retrievedAt: string }, accountId, product, syncRunId, 'deposit'),
    ))
    await safely('/sapi/v1/capital/withdraw/history', () => syncTimeEndpoint(
      read, accountId, product, syncRunId, '/sapi/v1/capital/withdraw/history', '/sapi/v1/capital/withdraw/history',
      response => importFlows(response as { data: JsonRecord[]; endpoint: string; retrievedAt: string }, accountId, product, syncRunId, 'withdrawal'),
    ))
    await safely('/sapi/v1/asset/assetDividend', () => syncTimeEndpoint(
      read, accountId, product, syncRunId, '/sapi/v1/asset/assetDividend', '/sapi/v1/asset/assetDividend',
      response => importDividends(response as { data: JsonRecord; endpoint: string; retrievedAt: string }, accountId, product, syncRunId),
      500,
    ))
    for (const transferType of [
      'MAIN_UMFUTURE', 'UMFUTURE_MAIN', 'MAIN_CMFUTURE', 'CMFUTURE_MAIN',
      'MAIN_MARGIN', 'MARGIN_MAIN', 'MAIN_FUNDING', 'FUNDING_MAIN',
      'UMFUTURE_CMFUTURE', 'CMFUTURE_UMFUTURE', 'MARGIN_UMFUTURE', 'UMFUTURE_MARGIN',
      'MARGIN_CMFUTURE', 'CMFUTURE_MARGIN',
    ]) {
      await safely(`/sapi/v1/asset/transfer:${transferType}`, async () =>
        syncTimeEndpoint(
          read, accountId, product, syncRunId, `/sapi/v1/asset/transfer:${transferType}`, '/sapi/v1/asset/transfer',
          response => importTransfers(response as { data: JsonRecord; endpoint: string; retrievedAt: string }, accountId, product, syncRunId),
          500, { type: transferType },
        ))
    }
    for (const transferType of ['ISOLATEDMARGIN_MARGIN', 'MARGIN_ISOLATEDMARGIN']) {
      saveEndpointResult({
        accountId,
        product,
        endpoint: `/sapi/v1/asset/transfer:${transferType}`,
        recordCount: 0,
        complete: false,
        missingPeriods: ['Isolated-margin transfer history requires an isolated-margin symbol; isolated-margin markets are not supported by this integration.'],
      })
    }
    await safely('/sapi/v1/convert/tradeFlow', () => syncTimeEndpoint(
      read, accountId, product, syncRunId, '/sapi/v1/convert/tradeFlow', '/sapi/v1/convert/tradeFlow',
      response => importConversions(response as { data: JsonRecord; endpoint: string; retrievedAt: string }, accountId, product, syncRunId),
      1000,
    ))
  } else {
    const accountPath = product === 'usd-m-futures' ? '/fapi/v3/account' : '/dapi/v1/account'
    const positionPath = product === 'usd-m-futures' ? '/fapi/v3/positionRisk' : '/dapi/v1/positionRisk'
    let openOrders: JsonRecord[] = []
    let accountBalances: JsonRecord[] = []
    let positions: JsonRecord[] = []
    await safely(accountPath, async () => {
      const { data, endpoint, retrievedAt } = await read<JsonRecord>(accountPath)
      accountBalances = records(data.assets)
      positions = records(data.positions)
      const normalized: StoredRecord[] = accountBalances.map(item => {
        const balance: Balance = {
          ...lineage(endpoint, retrievedAt),
          accountId,
          product,
          asset: text(item.asset) ?? 'unknown',
          free: numeric(item.availableBalance ?? item.availableMargin),
          locked: numeric(item.walletBalance) === null || numeric(item.availableBalance) === null
            ? null : numeric(item.walletBalance)! - numeric(item.availableBalance)!,
          borrowed: null,
          interest: null,
          valuation: null,
          valuationCurrency: product === 'usd-m-futures' ? 'USDT' : 'BTC',
          asOf: retrievedAt,
        }
        return storedRecord(accountId, product, 'balances', balance.asset, endpoint, balance, retrievedAt, retrievedAt, syncRunId)
      })
      const snapshot: AccountSnapshot = {
        ...lineage(endpoint, retrievedAt),
        id: `${accountId}:${product}:${retrievedAt}`,
        accountId,
        product,
        walletBalance: numeric(data.totalWalletBalance ?? data.totalMarginBalance),
        equity: numeric(data.totalMarginBalance ?? data.marginBalance),
        unrealizedPnl: numeric(data.totalUnrealizedProfit ?? data.totalUnrealizedPnl),
        initialMargin: numeric(data.totalInitialMargin ?? data.initialMargin),
        maintenanceMargin: numeric(data.totalMaintMargin ?? data.maintMargin),
        marginBalance: numeric(data.totalMarginBalance ?? data.marginBalance),
        exposure: null,
        currency: product === 'usd-m-futures' ? 'USDT' : 'BTC',
        asOf: retrievedAt,
      }
      normalized.push(storedRecord(accountId, product, 'snapshots', snapshot.id, endpoint, snapshot, retrievedAt, retrievedAt, syncRunId))
      replaceCurrentRecords(normalized.filter(record => record.kind === 'balances'), accountId, product, 'balances')
      saveRecords(normalized.filter(record => record.kind !== 'balances'))
      saveEndpointResult({ accountId, product, endpoint, recordCount: normalized.length, complete: true, earliest: retrievedAt, latest: retrievedAt })
      return normalized.length
    })
    await safely(positionPath, async () => {
      const { data, endpoint, retrievedAt } = await read<JsonRecord[]>(positionPath)
      const normalized = records(data).map(item => {
        const position: Position = {
          ...lineage(endpoint, retrievedAt),
          id: `${accountId}:${product}:${text(item.symbol) ?? 'unknown'}:${text(item.positionSide) ?? 'BOTH'}`,
          accountId,
          product,
          symbol: text(item.symbol) ?? 'unknown',
          positionSide: text(item.positionSide) ?? undefined,
          quantity: numeric(item.positionAmt),
          entryPrice: numeric(item.entryPrice),
          breakEvenPrice: numeric(item.breakEvenPrice),
          markPrice: numeric(item.markPrice),
          liquidationPrice: numeric(item.liquidationPrice),
          unrealizedPnl: numeric(item.unRealizedProfit ?? item.unrealizedProfit),
          leverage: numeric(item.leverage),
          marginType: text(item.marginType) ?? undefined,
          notional: numeric(item.notional ?? item.notionalValue),
          asOf: retrievedAt,
        }
        return storedRecord(accountId, product, 'positions', position.id, endpoint, position, retrievedAt, retrievedAt, syncRunId)
      })
      replaceCurrentRecords(normalized, accountId, product, 'positions')
      saveEndpointResult({ accountId, product, endpoint, recordCount: normalized.length, complete: true, earliest: retrievedAt, latest: retrievedAt })
      return normalized.length
    })
    const openPath = product === 'usd-m-futures' ? '/fapi/v1/openOrders' : '/dapi/v1/openOrders'
    await safely(openPath, async () => {
      const response = await read<JsonRecord[]>(openPath)
      openOrders = records(response.data)
      return importOrders(response, accountId, product, syncRunId)
    })
    const incomePath = product === 'usd-m-futures' ? '/fapi/v1/income' : '/dapi/v1/income'
    await safely(incomePath, async () => syncIncome(
      read, accountId, product, syncRunId, incomePath, product === 'coin-m-futures' ? 100 : 1000,
    ))
    const incomeSymbols = listRecords(accountId)
      .filter(record => record.product === product && record.kind === 'financialEvents')
      .map(record => text(record.payload.symbol))
      .filter((symbol): symbol is string => Boolean(symbol))
    const symbols = await discoverSymbols(
      read,
      product,
      accountId,
      [...accountBalances, ...positions, ...openOrders, ...incomeSymbols.map(symbol => ({ symbol }))],
      failures,
    )
    await syncSymbolHistory({ read, accountId, product, syncRunId, symbols, failures })
    await syncMarketContext({ read, accountId, product, syncRunId, failures })
  }
  return imported
}

async function syncMarketContext(input: {
  read: <T>(path: string, params?: Record<string, string | number | boolean>, signed?: boolean) => Promise<{ data: T; endpoint: string; retrievedAt: string }>
  accountId: string
  product: Product
  syncRunId: string
  failures: string[]
}) {
  const { read, accountId, product, syncRunId, failures } = input
  const root = product === 'spot' ? '/api/v3' : product === 'usd-m-futures' ? '/fapi/v1' : '/dapi/v1'
  const accountRecords = listRecords(accountId)
  const symbolRecords = accountRecords
    .filter(record => record.product === product && ['executions', 'orders', 'financialEvents', 'positions', 'trades'].includes(record.kind))
    .filter(record => record.kind !== 'positions' || numeric(record.payload.quantity) !== 0)
    .filter(record => record.kind !== 'financialEvents' || Boolean(text(record.payload.symbol)))
    .sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? ''))
  const historyByEndpoint = new Map<string, Map<string, string>>()
  for (const record of accountRecords) {
    if (record.product !== product || record.kind !== 'market') continue
    const symbol = text(record.payload.symbol)
    const kind = text(record.payload.kind)
    const endpoint = symbol && kind === 'candle'
      ? `market/klines:${symbol}`
      : symbol && kind === 'funding-rate'
        ? `market/funding:${symbol}`
        : record.endpoint
    const history = historyByEndpoint.get(endpoint) ?? new Map<string, string>()
    history.set(record.exchangeId, record.observedAt ?? record.retrievedAt)
    historyByEndpoint.set(endpoint, history)
  }
  const updateHistory = (endpoint: string, rows: StoredRecord[]) => {
    const history = historyByEndpoint.get(endpoint) ?? new Map<string, string>()
    for (const row of rows) history.set(row.exchangeId, row.observedAt ?? row.retrievedAt)
    historyByEndpoint.set(endpoint, history)
    const times = [...history.values()].sort()
    return { recordCount: history.size, earliest: times[0] ?? null, latest: times.at(-1) ?? null }
  }
  const symbols = [...new Set(symbolRecords.map(record => text(record.payload.symbol)).filter((symbol): symbol is string => Boolean(symbol)))].slice(0, 20)
  const symbolLimitReached = new Set(symbolRecords.map(record => text(record.payload.symbol)).filter((symbol): symbol is string => Boolean(symbol))).size > symbols.length
  const candleStart = Date.now() - 365 * 24 * 60 * 60 * 1000
  const fundingStart = Date.now() - 90 * 24 * 60 * 60 * 1000

  for (const symbol of symbols) {
    const candleEndpoint = `market/klines:${symbol}`
    try {
      const cursor = getEndpointCursor(accountId, product, candleEndpoint)
      const startTime = cursor ? Math.max(candleStart, Number(cursor) - 24 * 60 * 60 * 1000) : candleStart
      const response = await read<unknown[][]>(`${root}/klines`, { symbol, interval: '1d', startTime, limit: 1000 }, false)
      const candles = Array.isArray(response.data) ? response.data : []
      const observations = candles.flatMap(candle => {
        if (!Array.isArray(candle) || candle.length < 7) return []
        const openTime = numeric(candle[0])
        const closeTime = numeric(candle[6])
        if (openTime === null || closeTime === null) return []
        const observation: MarketObservation = {
          ...lineage(response.endpoint, response.retrievedAt),
          id: `${symbol}:candle:1d:${openTime}`,
          symbol,
          product,
          kind: 'candle',
          observedAt: new Date(openTime).toISOString(),
          open: numeric(candle[1]) ?? undefined,
          high: numeric(candle[2]) ?? undefined,
          low: numeric(candle[3]) ?? undefined,
          close: numeric(candle[4]) ?? undefined,
          volume: numeric(candle[5]) ?? undefined,
          interval: '1d',
        }
        return [storedRecord(accountId, product, 'market', observation.id, response.endpoint, observation, observation.observedAt, response.retrievedAt, syncRunId)]
      })
      saveRecords(observations)
      const history = updateHistory(candleEndpoint, observations)
      saveMarketRaw(accountId, product, response.endpoint, symbol, startTime, response.data, response.retrievedAt, syncRunId)
      const lastOpen = candles.length ? numeric(candles.at(-1)?.[0]) : null
      saveEndpointResult({
        accountId, product, endpoint: candleEndpoint, cursor: lastOpen === null ? cursor : String(lastOpen),
        ...history, complete: !symbolLimitReached,
        missingPeriods: [
          `Daily candle history is limited to the most recent 365 days for the ${symbols.length} most recently active symbols.`,
          ...(symbolLimitReached ? ['More than 20 symbols have stored activity; remaining symbols are not included in market context.'] : []),
        ],
      })
    } catch (error) {
      const message = publicError(error)
      failures.push(`${candleEndpoint}: ${message}`)
      saveEndpointResult({ accountId, product, endpoint: candleEndpoint, ...updateHistory(candleEndpoint, []), complete: false, missingPeriods: [message], error: message })
    }

    if (product === 'spot' || product === 'coin-m-futures' && !symbol.endsWith('_PERP')) continue
    const fundingEndpoint = `market/funding:${symbol}`
    try {
      const cursor = getEndpointCursor(accountId, product, fundingEndpoint)
      const startTime = cursor ? Math.max(fundingStart, Number(cursor) - 8 * 60 * 60 * 1000) : fundingStart
      const response = await read<JsonRecord[]>(`${root}/fundingRate`, { symbol, startTime, limit: 1000 }, false)
      const fundingRows = records(response.data)
      const observations = fundingRows.flatMap(row => {
        const fundingTime = numeric(row.fundingTime)
        const rate = numeric(row.fundingRate)
        if (fundingTime === null || rate === null) return []
        const observation: MarketObservation = {
          ...lineage(response.endpoint, response.retrievedAt),
          id: `${symbol}:funding-rate:${fundingTime}`,
          symbol,
          product,
          kind: 'funding-rate',
          observedAt: new Date(fundingTime).toISOString(),
          value: rate,
          secondaryValue: numeric(row.markPrice),
        }
        return [storedRecord(accountId, product, 'market', observation.id, response.endpoint, observation, observation.observedAt, response.retrievedAt, syncRunId)]
      })
      saveRecords(observations)
      const history = updateHistory(fundingEndpoint, observations)
      saveMarketRaw(accountId, product, response.endpoint, symbol, startTime, response.data, response.retrievedAt, syncRunId)
      const lastFundingTime = fundingRows.length ? numeric(fundingRows.at(-1)?.fundingTime) : null
      saveEndpointResult({
        accountId, product, endpoint: fundingEndpoint, cursor: lastFundingTime === null ? cursor : String(lastFundingTime),
        ...history, complete: !symbolLimitReached,
        missingPeriods: [
          `Funding history is limited to the most recent 90 days for the ${symbols.length} most recently active perpetual symbols.`,
          ...(symbolLimitReached ? ['More than 20 symbols have stored activity; remaining symbols are not included in market context.'] : []),
        ],
      })
    } catch (error) {
      const message = publicError(error)
      failures.push(`${fundingEndpoint}: ${message}`)
      saveEndpointResult({ accountId, product, endpoint: fundingEndpoint, ...updateHistory(fundingEndpoint, []), complete: false, missingPeriods: [message], error: message })
    }
  }
}

function saveMarketRaw(
  accountId: string,
  product: Product,
  endpoint: string,
  symbol: string,
  startTime: number,
  data: unknown,
  retrievedAt: string,
  syncRunId: string,
) {
  const raw: RawExchangeRecord = {
    id: `${product}:${endpoint}:${symbol}:${startTime}`,
    exchange: 'binance',
    accountId,
    product,
    endpoint,
    observedAt: retrievedAt,
    retrievedAt,
    sourceQuality: 'exchange-reported',
    sourceRecordIds: [],
    payload: { data: Array.isArray(data) ? data : [data] },
    syncRunId,
  }
  saveRecords([storedRecord(accountId, product, 'raw', raw.id, endpoint, object(raw), retrievedAt, retrievedAt, syncRunId)])
}

async function discoverSymbols(
  read: <T>(path: string, params?: Record<string, string | number | boolean>, signed?: boolean) => Promise<{ data: T; endpoint: string; retrievedAt: string }>,
  product: Product,
  accountId: string,
  sourceRecords: JsonRecord[],
  failures: string[],
) {
  const infoPath = product === 'spot' ? '/api/v3/exchangeInfo' : product === 'usd-m-futures' ? '/fapi/v1/exchangeInfo' : '/dapi/v1/exchangeInfo'
  let symbolRows: JsonRecord[] = []
  try {
    const { data } = await read<JsonRecord>(infoPath, {}, false)
    symbolRows = records(data.symbols)
  } catch (error) {
    const message = publicError(error)
    failures.push(`${infoPath}: ${message}`)
    saveEndpointResult({ accountId, product, endpoint: infoPath, recordCount: 0, complete: false, missingPeriods: [message], error: message })
    return []
  }
  const candidates = new Set<string>()
  const directSymbols = new Set<string>()
  for (const record of sourceRecords) {
    const symbol = text(record.symbol)
    if (symbol) {
      candidates.add(symbol)
      directSymbols.add(symbol)
    }
  }
  if (product === 'spot') {
    for (const balance of sourceRecords) {
      const asset = text(balance.asset)
      if (!asset || numeric(balance.free) === 0 && numeric(balance.locked) === 0) continue
      for (const quote of quotes) if (asset !== quote) candidates.add(`${asset}${quote}`)
    }
  }
  const liveSymbols = new Set(symbolRows.filter(item => item.status === 'TRADING').map(item => text(item.symbol)).filter((item): item is string => Boolean(item)))
  const symbols = [...candidates].filter(symbol => directSymbols.has(symbol) || liveSymbols.has(symbol))
  saveEndpointResult({
    accountId,
    product,
    endpoint: `${infoPath} symbol discovery`,
    recordCount: symbols.length,
    complete: false,
    missingPeriods: ['History discovery is limited to symbols present in current balances, positions, or open orders. Binance trade/order history APIs require a symbol.'],
  })
  return symbols
}

async function syncSymbolHistory(input: {
  read: <T>(path: string, params?: Record<string, string | number | boolean>, signed?: boolean) => Promise<{ data: T; endpoint: string; retrievedAt: string }>
  accountId: string
  product: Product
  syncRunId: string
  symbols: string[]
  failures: string[]
}) {
  const { read, accountId, product, syncRunId } = input
  const root = product === 'spot' ? '/api/v3' : product === 'usd-m-futures' ? '/fapi/v1' : '/dapi/v1'
  for (const symbol of input.symbols) {
    const ordersPath = `${root}/allOrders`
    await guardedEndpoint(accountId, product, `${ordersPath}:${symbol}`, input.failures, async () => {
      const endpoint = `${ordersPath}:${symbol}`
      const cursor = getEndpointCursor(accountId, product, endpoint)
      const startOrderId = cursor ? Math.max(0, Number(cursor) - 10) : 0
      let nextOrderId = startOrderId
      let count = 0
      let complete = true
      const limit = product === 'coin-m-futures' ? 100 : 1000
      for (let page = 0; page < 25; page += 1) {
        const response = await read<JsonRecord[]>(ordersPath, { symbol, orderId: nextOrderId, limit })
        const items = records(response.data)
        const imported = await importOrders(response, accountId, product, syncRunId)
        count += imported
        if (items.length < limit) break
        const lastId = numeric(items.at(-1)?.orderId)
        if (lastId === null || lastId < nextOrderId) { complete = false; break }
        nextOrderId = lastId + 1
        if (page === 24) complete = false
      }
      const lastId = nextOrderId > startOrderId ? String(nextOrderId - 1) : cursor
      saveEndpointResult({
        accountId, product, endpoint, cursor: lastId, recordCount: count, complete,
        missingPeriods: complete ? [] : ['History page limit reached; remaining history will be imported on a later sync.'],
      })
      return count
    })

    const tradesPath = `${root}/userTrades`
    await guardedEndpoint(accountId, product, `${tradesPath}:${symbol}`, input.failures, async () => {
      const endpoint = `${tradesPath}:${symbol}`
      const cursor = getEndpointCursor(accountId, product, endpoint)
      let fromId = cursor ? Math.max(0, Number(cursor) - 10) : 0
      let count = 0
      let complete = true
      const limit = product === 'coin-m-futures' ? 100 : 1000
      for (let page = 0; page < 25; page += 1) {
        const response = await read<JsonRecord[]>(tradesPath, { symbol, fromId, limit })
        const items = records(response.data)
        count += importExecutions(response, accountId, product, syncRunId)
        if (items.length < limit) break
        const lastId = numeric(items.at(-1)?.id)
        if (lastId === null || lastId < fromId) { complete = false; break }
        fromId = lastId + 1
        if (page === 24) complete = false
      }
      const lastId = fromId > 0 ? String(fromId - 1) : cursor
      saveEndpointResult({
        accountId, product, endpoint, cursor: lastId, recordCount: count, complete,
        missingPeriods: complete ? [] : ['History page limit reached; remaining executions will be imported on a later sync.'],
      })
      return count
    })
  }
}

async function syncIncome(
  read: <T>(path: string, params?: Record<string, string | number | boolean>, signed?: boolean) => Promise<{ data: T; endpoint: string; retrievedAt: string }>,
  accountId: string,
  product: Product,
  syncRunId: string,
  endpoint: string,
  limit: number,
) {
  const cursor = getEndpointCursor(accountId, product, endpoint)
  const now = Date.now()
  let nextStart = cursor ? Math.max(0, Number(cursor) - 60_000) : now - 90 * 24 * 60 * 60 * 1000
  let count = 0
  let complete = true
  const earliest = nextStart
  const windowSize = 7 * 24 * 60 * 60 * 1000
  while (nextStart <= now) {
    const windowEnd = Math.min(nextStart + windowSize - 1, now)
    let page = 1
    for (; page <= 25; page += 1) {
      const response = await read<JsonRecord[]>(endpoint, { startTime: nextStart, endTime: windowEnd, page, limit })
      const items = records(response.data)
      count += importIncome(response, accountId, product, syncRunId)
      if (items.length < limit) break
    }
    if (page > 25) complete = false
    nextStart = windowEnd + 1
  }
  saveEndpointResult({
    accountId, product, endpoint, cursor: String(now),
    recordCount: count, complete: false,
    missingPeriods: [
      `Initial income history starts at ${new Date(earliest).toISOString()} because Binance limits the history window.`,
      ...(complete ? [] : ['History page limit reached for a time window.']),
    ],
    earliest: new Date(earliest).toISOString(),
    latest: new Date(now).toISOString(),
  })
  return count
}

async function syncTimeEndpoint(
  read: <T>(path: string, params?: Record<string, string | number | boolean>, signed?: boolean) => Promise<{ data: T; endpoint: string; retrievedAt: string }>,
  accountId: string,
  product: Product,
  syncRunId: string,
  cursorEndpoint: string,
  requestPath: string,
  process: (response: { data: unknown; endpoint: string; retrievedAt: string }) => number,
  limit = 1000,
  baseParams: Record<string, string | number | boolean> = {},
) {
  const cursor = getEndpointCursor(accountId, product, cursorEndpoint)
  const initialStart = Date.now() - 90 * 24 * 60 * 60 * 1000
  let nextStart = cursor ? Math.max(initialStart, Number(cursor) - 60_000) : initialStart
  const startedAt = nextStart
  const endTime = Date.now()
  let count = 0
  let earliest: number | null = null
  let latest: number | null = null
  let complete = true
  for (let page = 0; page < 25; page += 1) {
    const response = await read<JsonRecord[] | JsonRecord>(requestPath, {
      ...baseParams,
      startTime: nextStart,
      endTime,
      limit,
    })
    const items = Array.isArray(response.data) ? records(response.data) : records(response.data.rows ?? response.data.list)
    count += process(response)
    const times = items.map(item => timestamp(item.insertTime ?? item.applyTime ?? item.divTime ?? item.timestamp ?? item.completeTime ?? item.createTime)).filter((value): value is number => value !== null)
    if (times.length) {
      const pageEarliest = Math.min(...times)
      const pageLatest = Math.max(...times)
      earliest = earliest === null ? pageEarliest : Math.min(earliest, pageEarliest)
      latest = latest === null ? pageLatest : Math.max(latest, pageLatest)
      nextStart = pageLatest + 1
    }
    if (items.length < limit) break
    if (times.length === 0 || nextStart <= startedAt) { complete = false; break }
    if (page === 24) complete = false
  }
  const missingPeriods = [
    'History before the 90-day initial import window may not have been ingested.',
    ...(complete ? [] : ['History page limit reached or the response lacked a usable time cursor.']),
  ]
  saveEndpointResult({
    accountId,
    product,
    endpoint: cursorEndpoint,
    cursor: latest === null ? cursor : String(Math.max(latest, Number(cursor ?? 0))),
    recordCount: count,
    complete: false,
    missingPeriods,
    earliest: earliest === null ? null : new Date(earliest).toISOString(),
    latest: latest === null ? null : new Date(latest).toISOString(),
  })
  return count
}

async function guardedEndpoint(
  accountId: string,
  product: Product,
  endpoint: string,
  errors: string[],
  run: () => Promise<number>,
) {
  try {
    return await run()
  } catch (error) {
    const message = publicError(error)
    errors.push(`${endpoint}: ${message}`)
    saveEndpointResult({ accountId, product, endpoint, recordCount: 0, complete: false, missingPeriods: [message], error: message })
    return 0
  }
}

async function importOrders(response: { data: JsonRecord[]; endpoint: string; retrievedAt: string }, accountId: string, product: Product, syncRunId: string) {
  const rows = records(response.data).map(item => {
    const order: Order = {
      ...lineage(response.endpoint, response.retrievedAt),
      id: `${product}:${text(item.symbol) ?? 'unknown'}:${text(item.orderId) ?? 'unknown'}`,
      accountId,
      product,
      symbol: text(item.symbol) ?? 'unknown',
      clientOrderId: text(item.clientOrderId) ?? undefined,
      side: normalizeSide(item.side),
      type: text(item.type) ?? 'UNKNOWN',
      status: text(item.status) ?? 'UNKNOWN',
      price: numeric(item.price),
      quantity: numeric(item.origQty),
      executedQuantity: numeric(item.executedQty),
      quoteQuantity: numeric(item.cummulativeQuoteQty ?? item.cumQuote),
      reduceOnly: typeof item.reduceOnly === 'boolean' ? item.reduceOnly : undefined,
      positionSide: text(item.positionSide) ?? undefined,
      openedAt: isoTime(item.time) ?? undefined,
      updatedAt: isoTime(item.updateTime ?? item.time) ?? undefined,
    }
    return storedRecord(accountId, product, 'orders', order.id, response.endpoint, order, order.updatedAt ?? response.retrievedAt, response.retrievedAt, syncRunId)
  })
  saveRecords(rows)
  return rows.length
}

function importConversions(response: { data: JsonRecord; endpoint: string; retrievedAt: string }, accountId: string, product: Product, syncRunId: string) {
  const rows = records(response.data.list).map(item => {
    const id = text(item.orderId) ?? `${text(item.createTime)}:${text(item.fromAsset)}`
    const event: FinancialEvent = {
      ...lineage(response.endpoint, response.retrievedAt),
      id: `${product}:conversion:${id}`,
      accountId,
      product,
      type: 'conversion',
      asset: text(item.toAsset) ?? 'unknown',
      amount: numeric(item.toAmount),
      transactionId: id,
      occurredAt: isoTime(item.createTime) ?? response.retrievedAt,
      description: `${text(item.fromAmount) ?? 'unknown'} ${text(item.fromAsset) ?? ''} -> ${text(item.toAmount) ?? 'unknown'} ${text(item.toAsset) ?? ''}`,
    }
    return storedRecord(accountId, product, 'financialEvents', event.id, response.endpoint, event, event.occurredAt, response.retrievedAt, syncRunId)
  })
  saveRecords(rows)
  return rows.length
}

function importExecutions(response: { data: JsonRecord[]; endpoint: string; retrievedAt: string }, accountId: string, product: Product, syncRunId: string) {
  const rows = records(response.data).map(item => {
    const symbol = text(item.symbol) ?? 'unknown'
    const id = `${product}:${symbol}:${text(item.id) ?? 'unknown'}`
    const execution: Execution = {
      ...lineage(response.endpoint, response.retrievedAt),
      id,
      orderId: `${product}:${symbol}:${text(item.orderId) ?? 'unknown'}`,
      accountId,
      product,
      symbol,
      side: text(item.side) ?? (item.isBuyer === true || item.buyer === true ? 'BUY' : item.isBuyer === false || item.buyer === false ? 'SELL' : 'UNKNOWN'),
      price: numeric(item.price),
      quantity: numeric(item.qty ?? item.quantity),
      quoteQuantity: numeric(item.quoteQty),
      commission: numeric(item.commission),
      commissionAsset: text(item.commissionAsset) ?? undefined,
      realizedPnl: numeric(item.realizedPnl),
      isMaker: typeof item.isMaker === 'boolean' ? item.isMaker : typeof item.maker === 'boolean' ? item.maker : undefined,
      executedAt: isoTime(item.time) ?? response.retrievedAt,
    }
    return storedRecord(accountId, product, 'executions', id, response.endpoint, execution, execution.executedAt, response.retrievedAt, syncRunId)
  })
  saveRecords(rows)
  return rows.length
}

function importFlows(
  response: { data: JsonRecord[]; endpoint: string; retrievedAt: string },
  accountId: string,
  product: Product,
  syncRunId: string,
  type: 'deposit' | 'withdrawal',
) {
  const rows = records(response.data).map(item => {
    const exchangeId = text(item.id ?? item.txId) ?? `${type}:${text(item.insertTime ?? item.applyTime) ?? response.retrievedAt}`
    const event: FinancialEvent = {
      ...lineage(response.endpoint, response.retrievedAt),
      id: `${product}:${type}:${exchangeId}`,
      accountId,
      product,
      type,
      asset: text(item.coin) ?? 'unknown',
      amount: numeric(item.amount),
      transactionId: text(item.txId) ?? undefined,
      occurredAt: isoTime(item.completeTime ?? item.insertTime ?? item.applyTime) ?? response.retrievedAt,
      description: text(item.status) ?? undefined,
    }
    return storedRecord(accountId, product, 'financialEvents', event.id, response.endpoint, event, event.occurredAt, response.retrievedAt, syncRunId)
  })
  saveRecords(rows)
  return rows.length
}

function importDividends(response: { data: JsonRecord; endpoint: string; retrievedAt: string }, accountId: string, product: Product, syncRunId: string) {
  const rows = records(response.data.rows).map(item => {
    const id = text(item.tranId) ?? `${text(item.asset)}:${text(item.divTime)}`
    const event: FinancialEvent = {
      ...lineage(response.endpoint, response.retrievedAt),
      id: `${product}:dividend:${id}`,
      accountId,
      product,
      type: 'dividend',
      asset: text(item.asset) ?? 'unknown',
      amount: numeric(item.amount ?? item.qty),
      transactionId: id,
      occurredAt: isoTime(item.divTime) ?? response.retrievedAt,
      description: text(item.enInfo) ?? undefined,
    }
    return storedRecord(accountId, product, 'financialEvents', event.id, response.endpoint, event, event.occurredAt, response.retrievedAt, syncRunId)
  })
  saveRecords(rows)
  return rows.length
}

function importTransfers(response: { data: JsonRecord; endpoint: string; retrievedAt: string }, accountId: string, product: Product, syncRunId: string) {
  const rows = records(response.data.rows).map(item => {
    const id = text(item.tranId) ?? `${text(item.asset)}:${text(item.timestamp)}`
    const event: FinancialEvent = {
      ...lineage(response.endpoint, response.retrievedAt),
      id: `${product}:transfer:${id}`,
      accountId,
      product,
      type: 'internal-transfer',
      asset: text(item.asset) ?? 'unknown',
      amount: numeric(item.amount),
      transactionId: id,
      occurredAt: isoTime(item.timestamp) ?? response.retrievedAt,
      description: text(item.type) ?? undefined,
    }
    return storedRecord(accountId, product, 'financialEvents', event.id, response.endpoint, event, event.occurredAt, response.retrievedAt, syncRunId)
  })
  saveRecords(rows)
  return rows.length
}

function importIncome(response: { data: JsonRecord[]; endpoint: string; retrievedAt: string }, accountId: string, product: Product, syncRunId: string) {
  const rows = records(response.data).map(item => {
    const id = `${text(item.tranId) ?? 'unknown'}:${text(item.incomeType) ?? 'other'}`
    const incomeType = text(item.incomeType)
    const event: FinancialEvent = {
      ...lineage(response.endpoint, response.retrievedAt),
      id: `${product}:income:${id}`,
      accountId,
      product,
      type: incomeType === 'FUNDING_FEE' ? 'funding' : incomeType === 'COMMISSION' ? 'commission' : incomeType === 'REALIZED_PNL' ? 'realized-pnl' : 'other',
      asset: text(item.asset) ?? 'unknown',
      amount: numeric(item.income),
      symbol: text(item.symbol) ?? undefined,
      transactionId: text(item.tranId) ?? undefined,
      tradeId: text(item.tradeId) ?? undefined,
      occurredAt: isoTime(item.time) ?? response.retrievedAt,
      description: incomeType ?? text(item.info) ?? undefined,
    }
    return storedRecord(accountId, product, 'financialEvents', event.id, response.endpoint, event, event.occurredAt, response.retrievedAt, syncRunId)
  })
  saveRecords(rows)
  return rows.length
}

function storedRecord(
  accountId: string,
  product: Product,
  kind: string,
  exchangeId: string,
  endpoint: string,
  payload: JsonRecord,
  observedAt: string | null,
  retrievedAt: string,
  syncRunId: string,
): StoredRecord {
  return {
    recordId: `${accountId}:${product}:${kind}:${exchangeId}`,
    accountId,
    product,
    kind,
    exchangeId,
    endpoint,
    payload,
    observedAt,
    retrievedAt,
    syncRunId,
  }
}

function lineage(endpoint: string, retrievedAt: string) {
  return {
    sourceQuality: 'exchange-reported' as const,
    sourceRecordIds: [],
    sourceEndpoint: endpoint,
    retrievedAt,
  }
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

function object(value: unknown): JsonRecord {
  return isObject(value) ? value : { data: value }
}

function isObject(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function timestamp(value: unknown): number | null {
  const numericValue = numeric(value)
  if (numericValue !== null) return numericValue
  if (typeof value !== 'string' || value.trim() === '') return null
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function isoTime(value: unknown) {
  const valueTimestamp = timestamp(value)
  return valueTimestamp === null ? null : new Date(valueTimestamp).toISOString()
}

function normalizeSide(value: unknown): Order['side'] {
  return value === 'BUY' || value === 'SELL' || value === 'LONG' || value === 'SHORT' ? value : 'UNKNOWN'
}

function publicError(error: unknown) {
  if (error instanceof BinanceApiError) {
    if (error.status === 401 || error.code === -2015 || error.code === -2014) return 'Invalid API key, secret, or API key permissions.'
    if (error.code === -1021) return 'Binance rejected the request timestamp. Check the server clock and retry.'
    if (error.status === 429 || error.status === 418) return 'Binance rate limit reached. Retry later.'
    return `Binance API error (${error.code ?? error.status}): ${error.message}`
  }
  return error instanceof Error ? error.message.slice(0, 240) : 'Binance sync failed.'
}
