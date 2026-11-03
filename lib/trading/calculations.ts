import type { AccountSnapshot, CompletedTrade, Coverage, Execution, FinancialEvent, Position, SourceQuality, TradingRepositorySnapshot } from './types'

export type Availability = { value: number | null; sourceQuality: SourceQuality; reason?: string }
export type PerformanceSummary = { gross: Availability; fees: Availability; funding: Availability; interest: Availability; net: Availability; winRate: Availability; profitFactor: Availability; expectancy: Availability; maxDrawdown: Availability; completedTrades: number; winners: number; losers: number }
const unavailable = (reason: string): Availability => ({ value: null, sourceQuality: 'unavailable', reason })
const calculated = (value: number, quality: SourceQuality = 'calculated'): Availability => ({ value, sourceQuality: quality })

export function calculatePerformance(trades: CompletedTrade[]): PerformanceSummary {
  const complete = trades.filter(trade => trade.netPnl !== null)
  const gross = complete.reduce((sum, trade) => sum + (trade.grossPnl ?? 0), 0)
  const fees = complete.reduce((sum, trade) => sum + (trade.fees ?? 0), 0)
  const funding = complete.reduce((sum, trade) => sum + (trade.funding ?? 0), 0)
  const interest = complete.reduce((sum, trade) => sum + (trade.interest ?? 0), 0)
  const net = complete.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0)
  const winners = complete.filter(trade => (trade.netPnl ?? 0) > 0)
  const losers = complete.filter(trade => (trade.netPnl ?? 0) < 0)
  return { gross: calculated(gross), fees: calculated(fees), funding: calculated(funding), interest: calculated(interest), net: calculated(net), winRate: complete.length ? calculated(winners.length / complete.length * 100) : unavailable('No completed trades'), profitFactor: losers.length ? calculated(winners.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0) / Math.abs(losers.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0))) : unavailable('No losing trades'), expectancy: complete.length ? calculated(net / complete.length) : unavailable('No completed trades'), maxDrawdown: calculateDrawdown(complete), completedTrades: complete.length, winners: winners.length, losers: losers.length }
}

export function calculateDrawdown(trades: CompletedTrade[]): Availability {
  const ordered = trades.filter(trade => trade.netPnl !== null && trade.closedAt).sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime())
  if (!ordered.length) return unavailable('No dated realized results')
  let equity = 0; let peak = 0; let max = 0
  ordered.forEach(trade => { equity += trade.netPnl ?? 0; peak = Math.max(peak, equity); max = Math.max(max, peak - equity) })
  return calculated(-max)
}

export function calculateExposure(positions: Position[], snapshots: AccountSnapshot[]): Availability {
  const exposure = positions.reduce((sum, position) => sum + Math.abs(position.notional ?? 0), 0)
  const latest = snapshots.slice().sort((a, b) => new Date(b.asOf).getTime() - new Date(a.asOf).getTime())[0]
  if (latest?.equity === null || latest?.equity === undefined || latest.equity === 0) return unavailable('Current account equity is not available')
  return calculated(exposure / latest.equity * 100, latest.sourceQuality === 'exchange-reported' ? 'calculated' : 'partial')
}

export function calculateCosts(events: FinancialEvent[], executions: Execution[]): { commissions: Availability; funding: Availability; interest: Availability } {
  const commissionEvents = events.filter(event => event.type === 'commission')
  const fundingEvents = events.filter(event => event.type === 'funding')
  const interestEvents = events.filter(event => event.type === 'interest')
  const commission = commissionEvents.length ? commissionEvents.reduce((sum, event) => sum + Math.abs(event.amount ?? 0), 0) : executions.length ? executions.reduce((sum, execution) => sum + Math.abs(execution.commission ?? 0), 0) : null
  return { commissions: commission === null ? unavailable('No commission records') : calculated(commission, commissionEvents.length ? 'exchange-reported' : 'calculated'), funding: fundingEvents.length ? calculated(fundingEvents.reduce((sum, event) => sum + (event.amount ?? 0), 0), 'exchange-reported') : unavailable('No funding records'), interest: interestEvents.length ? calculated(interestEvents.reduce((sum, event) => sum + (event.amount ?? 0), 0), 'exchange-reported') : unavailable('No interest records') }
}

export function latestSnapshot(snapshot: TradingRepositorySnapshot): AccountSnapshot | null { return snapshot.snapshots.slice().sort((a, b) => new Date(b.asOf).getTime() - new Date(a.asOf).getTime())[0] ?? null }
export function coverageFor(snapshot: TradingRepositorySnapshot, product?: string): Coverage[] { return snapshot.coverage.filter(item => !product || item.product === product) }
