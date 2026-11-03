import Decimal from 'decimal.js'
import type { CompletedTrade } from './types'

const Precise = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN })
type PreciseValue = InstanceType<typeof Precise>

export type CompletedTradePerformance = {
  asset: string
  trades: CompletedTrade[]
  total: number
  analyzable: number
  wins: number
  losses: number
  breakeven: number
  winRate: number | null
  gross: string | null
  net: string | null
  averageWin: string | null
  averageLoss: string | null
  largestWinner: string | null
  largestLoser: string | null
  profitFactor: number | null
  expectancy: string | null
  averageHoldingMs: number | null
  maxDrawdown: string | null
  currentDrawdown: string | null
  drawdownDurationMs: number | null
  recoveryTimeMs: number | null
  longestWinStreak: number | null
  longestLossStreak: number | null
  currentStreak: { type: 'win' | 'loss' | 'breakeven'; count: number } | null
  recoveryFactor: number | null
  dailyGross: { date: string; amount: string }[]
  monthlyGross: { month: string; amount: string }[]
}

export function completedTradeAsset(trade: CompletedTrade) {
  return trade.grossPnlAsset ?? `Unknown asset · ${trade.product} · ${trade.symbol}`
}

export function summarizeCompletedTrades(trades: CompletedTrade[]): CompletedTradePerformance[] {
  const grouped = new Map<string, CompletedTrade[]>()
  for (const trade of trades) {
    if (trade.status !== 'complete' || trade.closedAt === null) continue
    const asset = completedTradeAsset(trade)
    const group = grouped.get(asset) ?? []
    group.push(trade)
    grouped.set(asset, group)
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([asset, rows]) => summarizeAsset(asset, rows))
}

function summarizeAsset(asset: string, rows: CompletedTrade[]): CompletedTradePerformance {
  const trades = [...rows].sort((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? '') || a.id.localeCompare(b.id))
  const grossValues = trades.map(trade => valueOf(trade.grossPnlExact, trade.grossPnl))
  const netValues = trades.map(trade => valueOf(trade.netPnlExact, trade.netPnl))
  const analyzable = trades.filter((_, index) => netValues[index] !== null)
  const net = analyzable.length === trades.length ? sum(netValues) : null
  const outcomes = analyzable.map(trade => valueOf(trade.netPnlExact, trade.netPnl)!)
  const wins = outcomes.filter(value => value.gt(0))
  const losses = outcomes.filter(value => value.lt(0))
  const breakeven = outcomes.filter(value => value.isZero())
  const sumWins = wins.reduce((total, value) => total.plus(value), new Precise(0))
  const sumLosses = losses.reduce((total, value) => total.plus(value.abs()), new Precise(0))
  const netDrawdown = analyzable.length === trades.length ? calculateDrawdown(trades, netValues) : null
  const grossByDate = new Map<string, PreciseValue>()

  trades.forEach((trade, index) => {
    const time = Date.parse(trade.closedAt ?? '')
    if (!Number.isFinite(time) || !grossValues[index]) return
    const date = new Date(time).toISOString().slice(0, 10)
    grossByDate.set(date, (grossByDate.get(date) ?? new Precise(0)).plus(grossValues[index]!))
  })

  const grossByMonth = new Map<string, PreciseValue>()
  for (const [date, amount] of grossByDate) {
    const month = date.slice(0, 7)
    grossByMonth.set(month, (grossByMonth.get(month) ?? new Precise(0)).plus(amount))
  }

  const orderedOutcomes = analyzable.map((trade, index) => ({
    trade,
    value: valueOf(trade.netPnlExact, trade.netPnl)!,
  }))
  const outcomeStreaks = analyzable.length === trades.length ? streaks(orderedOutcomes) : null
  const largestWinner = wins.length ? Decimal.max(...wins) : null
  const largestLoser = losses.length ? Decimal.min(...losses) : null
  const averageHoldingMs = average(trades.flatMap(trade => {
    const opened = Date.parse(trade.openedAt ?? '')
    const closed = Date.parse(trade.closedAt ?? '')
    return Number.isFinite(opened) && Number.isFinite(closed) && closed >= opened ? [new Precise(closed - opened)] : []
  }))

  return {
    asset,
    trades,
    total: trades.length,
    analyzable: analyzable.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate: analyzable.length ? new Precise(wins.length).dividedBy(analyzable.length).times(100).toNumber() : null,
    gross: grossValues.every(value => value !== null) ? sum(grossValues)?.toString() ?? '0' : null,
    net: net?.toString() ?? null,
    averageWin: wins.length ? sumWins.dividedBy(wins.length).toString() : null,
    averageLoss: losses.length ? sumLosses.dividedBy(losses.length).negated().toString() : null,
    largestWinner: largestWinner?.toString() ?? null,
    largestLoser: largestLoser?.toString() ?? null,
    profitFactor: sumLosses.isZero() || analyzable.length !== trades.length ? null : sumWins.dividedBy(sumLosses).toNumber(),
    expectancy: net === null || !analyzable.length ? null : net.dividedBy(analyzable.length).toString(),
    averageHoldingMs: averageHoldingMs?.toNumber() ?? null,
    maxDrawdown: netDrawdown?.maxDrawdown.toString() ?? null,
    currentDrawdown: netDrawdown?.currentDrawdown.toString() ?? null,
    drawdownDurationMs: netDrawdown?.currentDrawdownDurationMs ?? null,
    recoveryTimeMs: netDrawdown?.recoveryTimeMs ?? null,
    longestWinStreak: outcomeStreaks?.longestWin ?? null,
    longestLossStreak: outcomeStreaks?.longestLoss ?? null,
    currentStreak: outcomeStreaks?.current ?? null,
    recoveryFactor: netDrawdown && !netDrawdown.maxDrawdown.isZero()
      ? new Precise(netDrawdown.netTotal).dividedBy(netDrawdown.maxDrawdown).toNumber()
      : null,
    dailyGross: [...grossByDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount: amount.toString() })),
    monthlyGross: [...grossByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount: amount.toString() })),
  }
}

function calculateDrawdown(trades: CompletedTrade[], netValues: (PreciseValue | null)[]) {
  let cumulative = new Precise(0)
  let peak = new Precise(0)
  let peakAt = Date.parse(trades[0]?.closedAt ?? '')
  let maximum = new Precise(0)
  let maxTroughAt: number | null = null
  let maxPeakAt: number | null = null
  let recoveryTimeMs: number | null = null

  trades.forEach((trade, index) => {
    const value = netValues[index]
    if (!value) return
    const timestamp = Date.parse(trade.closedAt ?? '')
    cumulative = cumulative.plus(value)
    if (cumulative.gt(peak)) {
      if (maxTroughAt !== null && recoveryTimeMs === null) recoveryTimeMs = timestamp - (maxPeakAt ?? maxTroughAt)
      peak = cumulative
      peakAt = timestamp
    } else {
      const drawdown = peak.minus(cumulative)
      if (drawdown.gt(maximum)) {
        maximum = drawdown
        maxTroughAt = timestamp
        maxPeakAt = peakAt
        recoveryTimeMs = null
      }
    }
  })

  const currentDrawdown = peak.minus(cumulative)
  return {
    maxDrawdown: maximum,
    currentDrawdown,
    currentDrawdownDurationMs: currentDrawdown.gt(0) && Number.isFinite(peakAt)
      ? Math.max(0, Date.parse(trades.at(-1)?.closedAt ?? '') - peakAt)
      : 0,
    recoveryTimeMs: maximum.gt(0) ? recoveryTimeMs : null,
    netTotal: cumulative,
  }
}

function streaks(rows: { value: PreciseValue }[]) {
  let currentType: 'win' | 'loss' | 'breakeven' = 'breakeven'
  let currentCount = 0
  let longestWin = 0
  let longestLoss = 0
  for (const row of rows) {
    const type = row.value.gt(0) ? 'win' : row.value.lt(0) ? 'loss' : 'breakeven'
    if (type !== currentType) currentCount = 0
    currentType = type
    currentCount += 1
    if (type === 'win') longestWin = Math.max(longestWin, currentCount)
    if (type === 'loss') longestLoss = Math.max(longestLoss, currentCount)
  }
  return { longestWin, longestLoss, current: { type: currentType, count: currentCount } }
}

function valueOf(exact: string | null | undefined, approximate: number | null | undefined) {
  const value = exact ?? approximate
  if (value === null || value === undefined) return null
  try {
    return new Precise(value)
  } catch {
    return null
  }
}

function sum(values: (PreciseValue | null)[]) {
  if (values.some(value => value === null)) return null
  return Precise.sum(...values as PreciseValue[])
}

function average(values: PreciseValue[]) {
  return values.length ? Precise.sum(...values).dividedBy(values.length) : null
}
