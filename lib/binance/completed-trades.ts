import Decimal from 'decimal.js'
import type { CompletedTrade, Execution, FinancialEvent, Product } from '@/lib/trading/types'

const Precise = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN })
type PreciseValue = InstanceType<typeof Precise>
type AssetAmount = Map<string, PreciseValue>

export type TradeReconstructionCoverage = {
  executionComplete: boolean
  executionMissingPeriods?: string[]
  funding: {
    earliest: string | null
    latest: string | null
    complete: boolean
    missingPeriods: string[]
  }
}

type Lifecycle = {
  id: string
  accountId: string
  product: Product
  symbol: string
  positionSide: string
  direction: 'Long' | 'Short'
  openedAt: string
  openedAtMs: number
  closedAt: string | null
  closedAtMs: number | null
  openedQuantity: PreciseValue
  remainingQuantity: PreciseValue
  entryNotional: PreciseValue
  exitQuantity: PreciseValue
  exitNotional: PreciseValue
  grossPnl: PreciseValue
  grossKnown: boolean
  feesKnown: boolean
  fees: AssetAmount
  funding: AssetAmount
  orderIds: Set<string>
  executionIds: Set<string>
  sourceRecordIds: Set<string>
  financialEventIds: Set<string>
  partialExitCount: number
  fundingAmbiguous: boolean
  reasons: Set<string>
}

const ZERO = new Precise(0)

export function reconstructFuturesTrades(
  inputExecutions: Execution[],
  financialEvents: FinancialEvent[],
  coverageBySymbol: Record<string, TradeReconstructionCoverage>,
): CompletedTrade[] {
  const executions = [...new Map(inputExecutions.map(item => [item.id, item])).values()]
    .filter(item => item.product === 'usd-m-futures' || item.product === 'coin-m-futures')
    .sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt) || compareExecutionIds(a.id, b.id))
  const active = new Map<string, Lifecycle>()
  const lifecycles: Lifecycle[] = []
  const output: CompletedTrade[] = []

  for (const execution of executions) {
    const time = Date.parse(execution.executedAt)
    const quantity = precise(execution.quantity, execution.quantityExact)
    const price = precise(execution.price, execution.priceExact)
    const side = execution.side.toUpperCase()
    if (!Number.isFinite(time) || !quantity || quantity.lte(0) || !price || price.lt(0) || !['BUY', 'SELL'].includes(side)) continue

    const positionSide = normalizePositionSide(execution.positionSide)
    const key = `${execution.accountId}:${execution.product}:${execution.symbol}:${positionSide}`
    const signedDirection = directionForFill(side, positionSide)
    const current = active.get(key)
    const fee = precise(execution.commission, execution.commissionExact)
    const feeAsset = execution.commissionAsset ?? 'UNKNOWN'

    if (!current) {
      if (execution.realizedPnl !== null && execution.realizedPnl !== 0) {
        output.push(orphanClosingFill(execution, positionSide, quantity, price))
        continue
      }
      const lifecycle = startLifecycle(execution, positionSide, signedDirection, quantity, price)
      addExecution(lifecycle, execution)
      addExecutionFee(lifecycle, feeAsset, fee)
      applyExecutionCoverage(lifecycle, coverageBySymbol[coverageKey(execution.product, execution.symbol)])
      active.set(key, lifecycle)
      lifecycles.push(lifecycle)
      continue
    }

    const currentDirection = current.direction === 'Long' ? 1 : -1
    if (currentDirection === signedDirection) {
      current.openedQuantity = current.openedQuantity.plus(quantity)
      current.remainingQuantity = current.remainingQuantity.plus(quantity)
      current.entryNotional = current.entryNotional.plus(price.times(quantity))
      addExecution(current, execution)
      addExecutionFee(current, feeAsset, fee)
      continue
    }

    const closingQuantity = Precise.min(current.remainingQuantity, quantity)
    const openingQuantity = quantity.minus(closingQuantity)
    current.remainingQuantity = current.remainingQuantity.minus(closingQuantity)
    current.exitQuantity = current.exitQuantity.plus(closingQuantity)
    current.exitNotional = current.exitNotional.plus(price.times(closingQuantity))
    addExecution(current, execution)
    addExecutionFee(current, feeAsset, fee, closingQuantity.dividedBy(quantity))
    const reportedPnl = precise(execution.realizedPnl, execution.realizedPnlExact)
    if (reportedPnl) current.grossPnl = current.grossPnl.plus(reportedPnl)
    else current.grossKnown = false

    if (current.remainingQuantity.isZero()) {
      current.closedAt = execution.executedAt
      current.closedAtMs = time
      active.delete(key)
    } else current.partialExitCount += 1

    if (openingQuantity.gt(0)) {
      if (current.remainingQuantity.gt(0)) current.reasons.add('A reversal fill arrived before the prior lifecycle was fully closed.')
      const lifecycle = startLifecycle(execution, positionSide, signedDirection, openingQuantity, price)
      addExecution(lifecycle, execution)
      addExecutionFee(lifecycle, feeAsset, fee, openingQuantity.dividedBy(quantity))
      applyExecutionCoverage(lifecycle, coverageBySymbol[coverageKey(execution.product, execution.symbol)])
      active.set(key, lifecycle)
      lifecycles.push(lifecycle)
    }
  }

  allocateFunding(lifecycles, financialEvents)
  for (const lifecycle of lifecycles) {
    if (!lifecycle.closedAt) lifecycle.reasons.add('Position remains open at the latest recorded execution.')
    const coverage = coverageBySymbol[coverageKey(lifecycle.product, lifecycle.symbol)]
    const fundingCovered = hasFundingCoverage(lifecycle, coverage?.funding)
    if (!fundingCovered && lifecycle.closedAt) lifecycle.reasons.add('Funding history does not cover this entire position lifecycle.')
    output.push(toCompletedTrade(lifecycle, coverage?.executionComplete ?? false, fundingCovered))
  }
  return output.sort((a, b) => (a.closedAt ?? a.openedAt ?? '').localeCompare(b.closedAt ?? b.openedAt ?? '') || a.id.localeCompare(b.id))
}

export function coverageKey(product: Product, symbol: string) {
  return `${product}:${symbol}`
}

function startLifecycle(
  execution: Execution,
  positionSide: string,
  directionSign: 1 | -1,
  quantity: PreciseValue,
  price: PreciseValue,
): Lifecycle {
  const direction = directionSign === 1 ? 'Long' : 'Short'
  const id = `${execution.accountId}:${execution.product}:${execution.symbol}:${positionSide}:${direction}:${execution.id}`
  return {
    id,
    accountId: execution.accountId,
    product: execution.product,
    symbol: execution.symbol,
    positionSide,
    direction,
    openedAt: execution.executedAt,
    openedAtMs: Date.parse(execution.executedAt),
    closedAt: null,
    closedAtMs: null,
    openedQuantity: quantity,
    remainingQuantity: quantity,
    entryNotional: price.times(quantity),
    exitQuantity: ZERO,
    exitNotional: ZERO,
    grossPnl: ZERO,
    grossKnown: true,
    feesKnown: true,
    fees: new Map(),
    funding: new Map(),
    orderIds: new Set(),
    executionIds: new Set(),
    sourceRecordIds: new Set(),
    financialEventIds: new Set(),
    partialExitCount: 0,
    fundingAmbiguous: false,
    reasons: new Set(),
  }
}

function addExecution(lifecycle: Lifecycle, execution: Execution) {
  lifecycle.executionIds.add(execution.id)
  lifecycle.orderIds.add(execution.orderId)
  for (const sourceId of execution.sourceRecordIds) lifecycle.sourceRecordIds.add(sourceId)
}

function addExecutionFee(lifecycle: Lifecycle, asset: string, fee: PreciseValue | null, fraction = new Precise(1)) {
  if (!fee) {
    lifecycle.feesKnown = false
    return
  }
  addAmount(lifecycle.fees, asset, fee.times(fraction))
}

function applyExecutionCoverage(lifecycle: Lifecycle, coverage: TradeReconstructionCoverage | undefined) {
  if (!coverage?.executionComplete) {
    for (const reason of coverage?.executionMissingPeriods?.length
      ? coverage.executionMissingPeriods
      : ['Execution history coverage is incomplete or unavailable.']) lifecycle.reasons.add(reason)
  }
}

function allocateFunding(lifecycles: Lifecycle[], events: FinancialEvent[]) {
  for (const event of events) {
    if (event.type !== 'funding' || event.amount === null || !event.symbol) continue
    const time = Date.parse(event.occurredAt)
    if (!Number.isFinite(time)) continue
    const candidates = lifecycles.filter(lifecycle =>
      lifecycle.accountId === event.accountId
      && lifecycle.product === event.product
      && lifecycle.symbol === event.symbol
      && lifecycle.openedAtMs <= time
      && (lifecycle.closedAtMs === null || time <= lifecycle.closedAtMs),
    )
    if (candidates.length !== 1) {
      if (candidates.length > 1) {
        for (const lifecycle of candidates) {
          lifecycle.fundingAmbiguous = true
          lifecycle.reasons.add('Funding event overlaps multiple position lifecycles and could not be attributed safely.')
        }
      }
      continue
    }
    const lifecycle = candidates[0]
    addAmount(lifecycle.funding, event.asset, precise(event.amount, event.amountExact))
    lifecycle.financialEventIds.add(event.id)
    for (const sourceId of event.sourceRecordIds) lifecycle.sourceRecordIds.add(sourceId)
  }
}

function toCompletedTrade(
  lifecycle: Lifecycle,
  executionCoverageComplete: boolean,
  fundingCovered: boolean,
): CompletedTrade {
  const pnlAsset = settlementAsset(lifecycle.product, lifecycle.symbol)
  const feesInPnlAsset = pnlAsset ? amountForAsset(lifecycle.fees, pnlAsset) : null
  const fundingInPnlAsset = pnlAsset ? amountForAsset(lifecycle.funding, pnlAsset) : null
  const allFeesInPnlAsset = lifecycle.feesKnown && (lifecycle.fees.size === 0 || (Boolean(pnlAsset) && [...lifecycle.fees.keys()].every(asset => asset === pnlAsset)))
  const allFundingInPnlAsset = lifecycle.funding.size === 0 || (Boolean(pnlAsset) && [...lifecycle.funding.keys()].every(asset => asset === pnlAsset))
  const closed = lifecycle.closedAt !== null
  const grossKnown = closed && lifecycle.grossKnown
  const netKnown = grossKnown && fundingCovered && !lifecycle.fundingAmbiguous && allFeesInPnlAsset && allFundingInPnlAsset && feesInPnlAsset !== null && fundingInPnlAsset !== null
  const reasons = new Set(lifecycle.reasons)

  if (!lifecycle.grossKnown && closed) reasons.add('One or more closing fills have no exchange-reported realized P&L.')
  if (!lifecycle.feesKnown) reasons.add('One or more executions have no reported commission; net P&L is unavailable.')
  if (!allFeesInPnlAsset) reasons.add('Commissions span multiple assets; net P&L is unavailable without conversion.')
  if (!allFundingInPnlAsset) reasons.add('Funding spans multiple assets; net P&L is unavailable without conversion.')
  if (!pnlAsset && grossKnown) reasons.add('The P&L settlement asset could not be determined from the futures symbol.')

  const grossExact = grossKnown ? lifecycle.grossPnl.toString() : null
  const feesExact = allFeesInPnlAsset && feesInPnlAsset !== null ? feesInPnlAsset.toString() : null
  const fundingExact = allFundingInPnlAsset && fundingInPnlAsset !== null ? fundingInPnlAsset.toString() : null
  const net = netKnown ? lifecycle.grossPnl.minus(feesInPnlAsset!).plus(fundingInPnlAsset!) : null
  const status = !closed ? 'open' : executionCoverageComplete && grossKnown ? 'complete' : 'incomplete'

  return {
    id: lifecycle.id,
    accountId: lifecycle.accountId,
    product: lifecycle.product,
    symbol: lifecycle.symbol,
    direction: lifecycle.direction,
    status,
    entryPrice: lifecycle.openedQuantity.isZero() ? null : lifecycle.entryNotional.dividedBy(lifecycle.openedQuantity).toNumber(),
    exitPrice: lifecycle.exitQuantity.isZero() ? null : lifecycle.exitNotional.dividedBy(lifecycle.exitQuantity).toNumber(),
    quantity: lifecycle.openedQuantity.toNumber(),
    openedAt: lifecycle.openedAt,
    closedAt: lifecycle.closedAt,
    grossPnl: grossExact === null ? null : lifecycle.grossPnl.toNumber(),
    grossPnlExact: grossExact,
    ...(pnlAsset ? { grossPnlAsset: pnlAsset } : {}),
    fees: feesExact === null ? null : feesInPnlAsset!.toNumber(),
    feesExact,
    feesByAsset: serializeAmounts(lifecycle.fees),
    funding: fundingExact === null ? null : fundingInPnlAsset!.toNumber(),
    fundingExact,
    fundingByAsset: serializeAmounts(lifecycle.funding),
    interest: null,
    netPnl: net?.toNumber() ?? null,
    netPnlExact: net?.toString() ?? null,
    orderIds: [...lifecycle.orderIds],
    executionIds: [...lifecycle.executionIds],
    financialEventIds: [...lifecycle.financialEventIds],
    partialExitCount: lifecycle.partialExitCount,
    sourceQuality: reasons.size ? 'partial' : 'reconstructed',
    sourceRecordIds: [...lifecycle.sourceRecordIds],
    sourceEndpoint: 'Binance futures userTrades + income',
    reason: [...reasons].join(' '),
  }
}

function orphanClosingFill(execution: Execution, positionSide: string, quantity: PreciseValue, price: PreciseValue): CompletedTrade {
  const direction = positionSide === 'SHORT' || (positionSide === 'BOTH' && execution.side.toUpperCase() === 'BUY') ? 'Short' : 'Long'
  const pnl = precise(execution.realizedPnl, execution.realizedPnlExact)
  const fee = precise(execution.commission, execution.commissionExact)
  return {
    id: `${execution.accountId}:${execution.product}:${execution.symbol}:${positionSide}:unmatched:${execution.id}`,
    accountId: execution.accountId,
    product: execution.product,
    symbol: execution.symbol,
    direction,
    status: 'incomplete',
    entryPrice: null,
    exitPrice: price.toNumber(),
    quantity: quantity.toNumber(),
    openedAt: null,
    closedAt: execution.executedAt,
    grossPnl: pnl?.toNumber() ?? null,
    grossPnlExact: pnl?.toString() ?? null,
    ...(settlementAsset(execution.product, execution.symbol) ? { grossPnlAsset: settlementAsset(execution.product, execution.symbol)! } : {}),
    fees: fee?.toNumber() ?? null,
    feesExact: fee?.toString() ?? null,
    feesByAsset: fee ? [{ asset: execution.commissionAsset ?? 'UNKNOWN', amount: fee.toString() }] : [],
    funding: null,
    fundingExact: null,
    fundingByAsset: [],
    interest: null,
    netPnl: null,
    netPnlExact: null,
    orderIds: [execution.orderId],
    executionIds: [execution.id],
    financialEventIds: [],
    partialExitCount: 1,
    sourceQuality: 'partial',
    sourceRecordIds: execution.sourceRecordIds,
    sourceEndpoint: execution.sourceEndpoint,
    reason: 'A closing fill has no matched opening execution in the available history; excluded from completed-trade metrics.',
  }
}

function hasFundingCoverage(lifecycle: Lifecycle, coverage: TradeReconstructionCoverage['funding'] | undefined) {
  if (!coverage) return false
  if (coverage.complete) return true
  if (coverage.missingPeriods.some(item => /page limit|response lacked|failed|error/i.test(item))) return false
  const earliest = coverage.earliest ? Date.parse(coverage.earliest) : Number.NaN
  const latest = coverage.latest ? Date.parse(coverage.latest) : Number.NaN
  const end = lifecycle.closedAtMs ?? Date.now()
  return Number.isFinite(earliest) && Number.isFinite(latest) && lifecycle.openedAtMs >= earliest && end <= latest
}

function normalizePositionSide(value: string | undefined) {
  return value === 'LONG' || value === 'SHORT' ? value : 'BOTH'
}

function directionForFill(side: string, positionSide: string): 1 | -1 {
  if (positionSide === 'LONG') return side === 'BUY' ? 1 : -1
  if (positionSide === 'SHORT') return side === 'SELL' ? -1 : 1
  return side === 'BUY' ? 1 : -1
}

function settlementAsset(product: Product, symbol: string) {
  if (product === 'usd-m-futures') {
    return ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD'].find(asset => symbol.endsWith(asset)) ?? null
  }
  if (product === 'coin-m-futures') {
    const base = symbol.split('_')[0]
    if (base && base !== symbol) return base.replace(/USD$/, '') || null
    return symbol.endsWith('USD') ? symbol.slice(0, -3) || null : null
  }
  return null
}

function precise(value: number | null, exact?: string | null) {
  const raw = exact?.trim() || (value !== null && Number.isFinite(value) ? String(value) : null)
  if (raw === null) return null
  try {
    const parsed = new Precise(raw)
    return parsed.isFinite() ? parsed : null
  } catch {
    return null
  }
}

function compareExecutionIds(left: string, right: string) {
  const numericId = (id: string) => id.slice(id.lastIndexOf(':') + 1)
  const leftId = numericId(left)
  const rightId = numericId(right)
  if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId)) {
    const normalizedLeft = leftId.replace(/^0+(?=\d)/, '')
    const normalizedRight = rightId.replace(/^0+(?=\d)/, '')
    if (normalizedLeft.length !== normalizedRight.length) return normalizedLeft.length - normalizedRight.length
    const order = normalizedLeft.localeCompare(normalizedRight)
    if (order !== 0) return order
  }
  return left.localeCompare(right)
}

function addAmount(amounts: AssetAmount, asset: string, value: PreciseValue | null) {
  if (!value) return
  amounts.set(asset, (amounts.get(asset) ?? ZERO).plus(value))
}

function amountForAsset(amounts: AssetAmount, asset: string) {
  return [...amounts.keys()].every(key => key === asset) ? amounts.get(asset) ?? ZERO : null
}

function serializeAmounts(amounts: AssetAmount) {
  return [...amounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([asset, amount]) => ({ asset, amount: amount.toString() }))
}
