'use client'

import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, BookOpen, CalendarDays, ChevronRight, CircleHelp, Filter, Sparkles, Tags, TrendingDown, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FinancialEvent, TradingRepositorySnapshot } from '@/lib/trading/types'
import { formatMoney } from '@/lib/trading/format-money'

export type OverviewTrade = { id: string; symbol: string; side: string; product: string; entry: string; exit: string; duration: string; pnl: number; fees: number; closed: string; strategy: string; note: string }
type Trade = OverviewTrade
type Range = '7D' | '30D' | '90D' | '6M' | 'YTD' | 'All Time'
type FinancialSeries = { key: string; label: string; asset: string; color: string }
type OverviewDay = { date: string; label: string; count: number; dailyBySeries: Record<string, number>; cumulativeBySeries: Record<string, number> }
type RealizedDay = { date: string; label: string; amount: number }
type RealizedSeriesSummary = {
  key: string
  product: string
  asset: string
  events: FinancialEvent[]
  days: RealizedDay[]
  wins: number
  losses: number
  grossWins: number
  grossLosses: number
  total: number
  averageWin: number | null
  averageLoss: number | null
  expectancy: number | null
  drawdown: number
  profitableDays: number
  losingDays: number
}
const ranges: Range[] = ['7D', '30D', '90D', '6M', 'YTD', 'All Time']
const money = (value: number, signed = true) => formatMoney(value, { prefix: '$', signed })
const amount = (value: number, asset: string, signed = true) => formatMoney(value, { asset, signed })
const formatTimestamp = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'UTC' })
const dateFromTrade = (trade: Trade) => new Date(trade.closed.replace(' · ', ' '))
const dayKey = (trade: Trade) => dateFromTrade(trade).toISOString().slice(0, 10)
const dayLabel = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const netPnl = (trade: Trade) => trade.pnl
const productName = (value: string) => ({
  spot: 'Spot',
  'usd-m-futures': 'USDⓈ-M Futures',
  'coin-m-futures': 'COIN-M Futures',
  margin: 'Margin',
  wallet: 'Wallet',
}[value] ?? value.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase()))
const incomeTypes = new Set(['realized-pnl', 'commission', 'funding'])

function inRange(date: Date, range: Range, maxDate: number) {
  if (!Number.isFinite(date.getTime())) return false
  if (range === 'All Time') return true
  if (range === 'YTD') return date.getUTCFullYear() === new Date(maxDate).getUTCFullYear()
  const days = range === '6M' ? 180 : Number(range.replace('D', ''))
  return (maxDate - date.getTime()) / 86400000 <= days
}

function summarizeAmounts(items: { product: string; asset: string; value: number }[]) {
  const groups = new Map<string, { product: string; asset: string; value: number }>()
  for (const item of items) {
    const key = `${item.product}:${item.asset}`
    const group = groups.get(key) ?? { ...item, value: 0 }
    group.value += item.value
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a.product.localeCompare(b.product) || a.asset.localeCompare(b.asset))
}

function formatSummary(items: { product: string; asset: string; value: number }[], signed = true) {
  return items.length === 1
    ? amount(items[0].value, items[0].asset, signed)
    : items.map(item => `${item.product}: ${amount(item.value, item.asset, signed)}`).join(' · ')
}

function summarizeRealizedSeries(events: FinancialEvent[]): RealizedSeriesSummary[] {
  const grouped = new Map<string, { product: string; asset: string; events: FinancialEvent[]; days: Map<string, number> }>()
  for (const event of events) {
    if (event.amount === null) continue
    const key = `${event.product}:${event.asset}`
    const group = grouped.get(key) ?? { product: event.product, asset: event.asset, events: [], days: new Map<string, number>() }
    group.events.push(event)
    const timestamp = Date.parse(event.occurredAt)
    if (Number.isFinite(timestamp)) {
      const date = new Date(timestamp).toISOString().slice(0, 10)
      group.days.set(date, (group.days.get(date) ?? 0) + event.amount)
    }
    grouped.set(key, group)
  }
  return [...grouped.entries()].map(([key, group]) => {
    const days = [...group.days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
      date,
      label: dayLabel(date),
      amount: value,
    }))
    const wins = group.events.filter(event => (event.amount ?? 0) > 0)
    const losses = group.events.filter(event => (event.amount ?? 0) < 0)
    const grossWins = wins.reduce((sum, event) => sum + (event.amount ?? 0), 0)
    const grossLosses = Math.abs(losses.reduce((sum, event) => sum + (event.amount ?? 0), 0))
    let cumulative = 0
    let peak = 0
    let drawdown = 0
    for (const day of days) {
      cumulative += day.amount
      peak = Math.max(peak, cumulative)
      drawdown = Math.max(drawdown, peak - cumulative)
    }
    const total = group.events.reduce((sum, event) => sum + (event.amount ?? 0), 0)
    return {
      key,
      product: group.product,
      asset: group.asset,
      events: group.events,
      days,
      wins: wins.length,
      losses: losses.length,
      grossWins,
      grossLosses,
      total,
      averageWin: wins.length ? grossWins / wins.length : null,
      averageLoss: losses.length ? -grossLosses / losses.length : null,
      expectancy: group.events.length ? total / group.events.length : null,
      drawdown,
      profitableDays: days.filter(day => day.amount > 0).length,
      losingDays: days.filter(day => day.amount < 0).length,
    }
  })
}

function seriesMetric(summaries: RealizedSeriesSummary[], getValue: (item: RealizedSeriesSummary) => string) {
  if (!summaries.length) return { value: 'Unavailable', detail: 'No Binance realized P&L events in this selection' }
  const details = summaries.map(item => `${productName(item.product)} · ${item.asset}: ${getValue(item)}`)
  return {
    value: summaries.length === 1 ? getValue(summaries[0]) : 'Multiple assets',
    detail: summaries.length === 1 ? details[0] : details.join(' · '),
  }
}

export function OverviewDashboard({ trades, snapshot, accountIds, onSelect, onNavigate }: {
  trades: Trade[]
  snapshot: TradingRepositorySnapshot
  accountIds: string[]
  onSelect: (trade: Trade) => void
  onNavigate: (page: string) => void
}) {
  const [range, setRange] = useState<Range>('30D')
  const [market, setMarket] = useState('All Markets')
  const [symbol, setSymbol] = useState('All Symbols')
  const [filterOpen, setFilterOpen] = useState(false)
  const enabledAccounts = useMemo(() => new Set(accountIds), [accountIds])
  const marketOptions = useMemo(() => Array.from(new Set([
    ...trades.map(trade => trade.product),
    ...snapshot.financialEvents.map(event => productName(event.product)),
  ])), [trades, snapshot.financialEvents])
  const symbols = useMemo(() => Array.from(new Set([
    ...trades.map(trade => trade.symbol),
    ...snapshot.financialEvents.flatMap(event => event.symbol ? [event.symbol] : []),
  ])), [trades, snapshot.financialEvents])
  const maxDate = useMemo(() => Math.max(Date.now(),
    ...trades.map(trade => dateFromTrade(trade).getTime()).filter(Number.isFinite),
    ...snapshot.financialEvents.filter(event => enabledAccounts.has(event.accountId)).map(event => Date.parse(event.occurredAt)).filter(Number.isFinite),
  ), [trades, snapshot.financialEvents, enabledAccounts])
  const filtered = useMemo(() => trades.filter(trade => {
    const date = dateFromTrade(trade)
    return inRange(date, range, maxDate)
      && (market === 'All Markets' || trade.product === market)
      && (symbol === 'All Symbols' || trade.symbol === symbol)
  }), [trades, range, market, symbol, maxDate])
  const financialEvents = useMemo(() => snapshot.financialEvents.filter(event => {
    const date = new Date(event.occurredAt)
    return enabledAccounts.has(event.accountId)
      && inRange(date, range, maxDate)
      && (market === 'All Markets' || productName(event.product) === market)
      && (symbol === 'All Symbols' || event.symbol === symbol)
  }), [snapshot.financialEvents, enabledAccounts, range, market, symbol, maxDate])
  const incomeEvents = financialEvents.filter(event => incomeTypes.has(event.type) && event.amount !== null)
  const series = useMemo(() => Array.from(incomeEvents.reduce((groups, event) => {
    const key = `${event.product}:${event.asset}`
    const group = groups.get(key) ?? {
      key,
      label: `${productName(event.product)} · ${event.asset}`,
      asset: event.asset,
      color: 'var(--positive)',
    }
    groups.set(key, group)
    return groups
  }, new Map<string, { key: string; label: string; asset: string; color: string }>()).values()), [incomeEvents])
  const daily = useMemo<OverviewDay[]>(() => {
    const groups = new Map<string, OverviewDay>()
    for (const event of incomeEvents) {
      const date = event.occurredAt.slice(0, 10)
      const key = `${event.product}:${event.asset}`
      const day = groups.get(date) ?? { date, label: dayLabel(date), count: 0, dailyBySeries: {}, cumulativeBySeries: {} }
      day.dailyBySeries[key] = (day.dailyBySeries[key] ?? 0) + (event.amount ?? 0)
      day.count += 1
      groups.set(date, day)
    }
    const totals = new Map<string, number>()
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date)).map(day => {
      for (const item of series) {
        totals.set(item.key, (totals.get(item.key) ?? 0) + (day.dailyBySeries[item.key] ?? 0))
        day.cumulativeBySeries[item.key] = totals.get(item.key) ?? 0
      }
      return day
    })
  }, [incomeEvents, series])
  const cumulativeDomain = useMemo<[number, number]>(() => {
    const values = daily.flatMap(day => series.map(item => day.cumulativeBySeries[item.key] ?? 0))
    const minimum = Math.min(0, ...values)
    const maximum = Math.max(0, ...values)
    return minimum === maximum ? [-1, 1] : [minimum, maximum]
  }, [daily, series])
  const zeroOffset = cumulativeDomain[1] / (cumulativeDomain[1] - cumulativeDomain[0]) * 100
  const netAmounts = summarizeAmounts(incomeEvents.map(event => ({ product: productName(event.product), asset: event.asset, value: event.amount ?? 0 })))
  const feeAmounts = summarizeAmounts(incomeEvents.filter(event => event.type === 'commission').map(event => ({ product: productName(event.product), asset: event.asset, value: event.amount ?? 0 })))
  const accountValues = useMemo(() => {
    if (symbol !== 'All Symbols') return []
    const latestSnapshots = new Map<string, typeof snapshot.snapshots[number]>()
    for (const item of snapshot.snapshots) {
      if (!enabledAccounts.has(item.accountId)
        || (item.equity === null && item.walletBalance === null)
        || (market !== 'All Markets' && productName(item.product) !== market)) continue
      const key = `${item.accountId}:${item.product}`
      const previous = latestSnapshots.get(key)
      if (!previous || item.asOf > previous.asOf) latestSnapshots.set(key, item)
    }
    if (latestSnapshots.size) return [...latestSnapshots.values()].map(item => ({
      product: productName(item.product),
      asset: item.currency,
      value: item.equity ?? item.walletBalance ?? 0,
      asOf: item.asOf,
    }))
    const latestBalances = new Map<string, typeof snapshot.balances[number]>()
    for (const item of snapshot.balances) {
      if (!enabledAccounts.has(item.accountId)
        || item.free === null
        || item.locked === null
        || (market !== 'All Markets' && productName(item.product ?? 'unknown') !== market)) continue
      const key = `${item.accountId}:${item.product ?? 'unknown'}:${item.asset}`
      const previous = latestBalances.get(key)
      if (!previous || item.asOf > previous.asOf) latestBalances.set(key, item)
    }
    return [...latestBalances.values()].flatMap(item => item.free === null || item.locked === null ? [] : [{
      product: productName(item.product ?? 'unknown'),
      asset: item.asset,
      value: item.free + item.locked,
      asOf: item.asOf,
    }]).filter(item => item.value !== 0)
  }, [snapshot.snapshots, snapshot.balances, enabledAccounts, market, symbol])
  const latestAccountValue = summarizeAmounts(accountValues)
  const accountValueDetail = accountValues.length
    ? `Latest persisted values · ${new Date(Math.max(...accountValues.map(item => Date.parse(item.asOf)))).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC`
    : symbol !== 'All Symbols' ? 'Account value is not available by symbol'
      : accountIds.length ? 'No account snapshot or non-zero balance synced for this market' : 'Connect an enabled Binance account'

  const journalDaily = useMemo(() => {
    const groups = new Map<string, Trade[]>()
    filtered.forEach(trade => groups.set(dayKey(trade), [...(groups.get(dayKey(trade)) ?? []), trade]))
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({
      date,
      label: dayLabel(date),
      daily: items.reduce((sum, trade) => sum + netPnl(trade), 0),
      cumulative: 0,
      count: items.length,
    })).map((item, index, rows) => ({ ...item, cumulative: rows.slice(0, index + 1).reduce((sum, row) => sum + row.daily, 0) }))
  }, [filtered])
  const winners = filtered.filter(trade => netPnl(trade) > 0)
  const losers = filtered.filter(trade => netPnl(trade) < 0)
  const journalWinRate = filtered.length ? winners.length / filtered.length * 100 : null
  const journalProfitFactor = losers.length ? winners.reduce((sum, trade) => sum + netPnl(trade), 0) / Math.abs(losers.reduce((sum, trade) => sum + netPnl(trade), 0)) : null
  const realizedOutcomes = financialEvents.filter(event => event.type === 'realized-pnl' && event.amount !== null)
  const realizedWinners = realizedOutcomes.filter(event => (event.amount ?? 0) > 0)
  const realizedLosers = realizedOutcomes.filter(event => (event.amount ?? 0) < 0)
  const realizedWinRate = realizedOutcomes.length ? realizedWinners.length / realizedOutcomes.length * 100 : null
  const realizedSeriesSummaries = useMemo(() => summarizeRealizedSeries(realizedOutcomes), [realizedOutcomes])
  const realizedProfitFactors = realizedSeriesSummaries.map(item => ({
    product: item.product,
    asset: item.asset,
    grossWins: item.grossWins,
    grossLosses: item.grossLosses,
  }))
  const realizedProfitFactorDetails = realizedProfitFactors.map(item =>
    `${productName(item.product)} · ${item.asset}: ${item.grossLosses ? (item.grossWins / item.grossLosses).toFixed(2) : 'Unavailable'}`,
  )
  const useExchangeOutcomes = realizedOutcomes.length > 0
  const winRateValue = useExchangeOutcomes
    ? `${(realizedWinRate ?? 0).toFixed(1)}%`
    : journalWinRate === null ? 'Unavailable' : `${journalWinRate.toFixed(1)}%`
  const winRateDetail = useExchangeOutcomes
    ? `${realizedOutcomes.length} Binance realized P&L events · not round-trip trades`
    : filtered.length ? `${winners.length} profitable · ${losers.length} losing journal entries` : 'No Binance realized P&L or journal entries'
  const profitFactorValue = useExchangeOutcomes
    ? realizedProfitFactors.length === 1
      ? realizedProfitFactors[0].grossLosses
        ? (realizedProfitFactors[0].grossWins / realizedProfitFactors[0].grossLosses).toFixed(2)
        : 'Unavailable'
      : realizedProfitFactors.length > 1 ? 'Multiple assets' : 'Unavailable'
    : journalProfitFactor === null ? 'Unavailable' : journalProfitFactor.toFixed(2)
  const profitFactorDetail = useExchangeOutcomes
    ? realizedProfitFactors.length > 1
      ? `${realizedProfitFactorDetails.join(' · ')} · not combined across assets`
      : realizedProfitFactors[0]?.grossLosses
        ? `Binance realized P&L · ${productName(realizedProfitFactors[0].product)} · ${realizedProfitFactors[0].asset}`
        : 'No losing Binance realized P&L events in this selection'
    : losers.length ? 'Manual journal P&L only' : 'No losing journal entries'
  const realizedSnapshotMetrics = [
    { label: 'Best realized P&L day', ...seriesMetric(realizedSeriesSummaries, item => {
      const best = item.days.reduce((current, day) => !current || day.amount > current.amount ? day : current, undefined as RealizedDay | undefined)
      return best ? `${amount(best.amount, item.asset)} · ${best.label}` : 'Unavailable'
    }) },
    { label: 'Worst realized P&L day', ...seriesMetric(realizedSeriesSummaries, item => {
      const worst = item.days.reduce((current, day) => !current || day.amount < current.amount ? day : current, undefined as RealizedDay | undefined)
      return worst ? `${amount(worst.amount, item.asset)} · ${worst.label}` : 'Unavailable'
    }) },
    { label: 'Average positive P&L event', ...seriesMetric(realizedSeriesSummaries, item => item.averageWin === null ? 'Unavailable' : amount(item.averageWin, item.asset)) },
    { label: 'Average negative P&L event', ...seriesMetric(realizedSeriesSummaries, item => item.averageLoss === null ? 'Unavailable' : amount(item.averageLoss, item.asset)) },
    { label: 'Average realized P&L / event', ...seriesMetric(realizedSeriesSummaries, item => item.expectancy === null ? 'Unavailable' : amount(item.expectancy, item.asset)) },
    { label: 'Maximum drawdown', ...seriesMetric(realizedSeriesSummaries, item => amount(-item.drawdown, item.asset)) },
    { label: 'Profitable event-days', ...seriesMetric(realizedSeriesSummaries, item => String(item.profitableDays)) },
    { label: 'Losing event-days', ...seriesMetric(realizedSeriesSummaries, item => String(item.losingDays)) },
  ]
  const bestDay = journalDaily.length ? journalDaily.reduce((best, day) => day.daily > best.daily ? day : best) : null
  const worstDay = journalDaily.length ? journalDaily.reduce((worst, day) => day.daily < worst.daily ? day : worst) : null
  const avgWin = winners.length ? winners.reduce((sum, trade) => sum + netPnl(trade), 0) / winners.length : null
  const avgLoss = losers.length ? losers.reduce((sum, trade) => sum + netPnl(trade), 0) / losers.length : null
  const journalTotal = filtered.reduce((sum, trade) => sum + netPnl(trade), 0)
  const expectancy = filtered.length ? journalTotal / filtered.length : null
  const drawdown = journalDaily.reduce((state, day) => { const peak = Math.max(state.peak, day.cumulative); return { peak, max: Math.max(state.max, peak - day.cumulative) } }, { peak: 0, max: 0 }).max
  const strategyRows = useMemo(() => Array.from(new Set(filtered.map(trade => trade.strategy))).map(name => {
    const items = filtered.filter(trade => trade.strategy === name)
    const pnl = items.reduce((sum, trade) => sum + netPnl(trade), 0)
    return { name, count: items.length, pnl, winRate: items.filter(trade => netPnl(trade) > 0).length / items.length * 100 }
  }).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 5), [filtered])
  const recent = filtered.slice().sort((a, b) => dateFromTrade(b).getTime() - dateFromTrade(a).getTime()).slice(0, 5)
  const recentExchangeEvents = financialEvents.slice().sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 8)
  const realizedSeriesChartData = realizedSeriesSummaries.map(item => ({
    ...item,
    label: `${productName(item.product)} · ${item.asset}`,
  }))
  const recentDays = daily.length ? daily.map(item => item.date).slice(-10) : journalDaily.map(item => item.date).slice(-10)
  const netTone = netAmounts.length === 1 ? netAmounts[0].value > 0 ? 'positive' : netAmounts[0].value < 0 ? 'negative' : 'neutral' : 'neutral'
  const netValue = netAmounts.length ? formatSummary(netAmounts) : 'Unavailable'
  const feeValue = feeAmounts.length ? formatSummary(feeAmounts) : 'Unavailable'
  const accountValue = latestAccountValue.length ? formatSummary(latestAccountValue, false) : 'Unavailable'
  const feeDetail = feeAmounts.length ? `Commissions: ${formatSummary(feeAmounts)} · native assets` : 'No commission events in this range'
  const netDetail = netAmounts.length ? `Realized P&L + commissions + funding · ${feeDetail}` : 'No exchange-reported income events in this range'
  const eventsSummary = `${filtered.length} manual entries · ${financialEvents.length} Binance financial events in range`

  return <div className="overview-dashboard flex flex-col gap-5">
    <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div>
        <div className="mb-2 flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Overview</h1><span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-muted-foreground">ACCOUNT + JOURNAL</span></div>
        <p className="text-sm text-muted-foreground">Exchange-reported account activity and saved journal performance. Amounts stay in their reported assets.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-md border border-border p-0.5">{ranges.map(item => <button key={item} onClick={() => setRange(item)} className={`rounded px-2 py-1.5 text-[10px] ${range === item ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}>{item}</button>)}</div>
        <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setFilterOpen(value => !value)}><Filter data-icon="inline-start" />Filters</Button>
      </div>
    </div>
    <div className={`grid gap-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 ${filterOpen ? '' : 'hidden lg:grid'}`}>
      <Select label="Market" value={market} onChange={setMarket} options={['All Markets', ...marketOptions]} />
      <Select label="Symbol" value={symbol} onChange={setSymbol} options={['All Symbols', ...symbols]} />
      <div className="flex items-end"><span className="text-[10px] text-muted-foreground">{eventsSummary} · exchange P&amp;L is not converted or treated as closed trades</span></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Latest account value" value={accountValue} valueTitle={accountValue} detail={accountValueDetail} tone="neutral" />
      <Kpi label="Net exchange P&L" value={netValue} valueTitle={netValue} detail={netDetail} tone={netTone} />
      <Kpi label={useExchangeOutcomes ? 'Realized Event Win Rate' : 'Journal Win Rate'} value={winRateValue} detail={winRateDetail} tone="neutral" />
      <Kpi label={useExchangeOutcomes ? 'Realized P&L Profit Factor' : 'Journal Profit Factor'} value={profitFactorValue} valueTitle={realizedProfitFactorDetails.join(' · ')} detail={profitFactorDetail} tone="neutral" />
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
      <Panel title="Cumulative Net Exchange P&L" subtitle="Exchange-reported realized P&L, commissions, and funding. Each line stays in its product and asset." action={<span className="font-mono text-xs" title={netValue}>{netValue}</span>}>
        <div className="h-[280px] w-full">{daily.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={daily} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
          <defs><linearGradient id="pnl-line" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="238">
            <stop offset={`${zeroOffset}%`} stopColor="var(--positive)" />
            <stop offset={`${zeroOffset}%`} stopColor="var(--negative)" />
          </linearGradient>
            <linearGradient id="pnl-fill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="238">
              <stop offset={`${zeroOffset}%`} stopColor="var(--positive)" stopOpacity={0.14} />
              <stop offset={`${zeroOffset}%`} stopColor="var(--negative)" stopOpacity={0.14} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis domain={cumulativeDomain} tickFormatter={value => formatMoney(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip series={series} />} />
          {series.map(item => <Area key={item.key} type="monotone" dataKey={(row: OverviewDay) => row.cumulativeBySeries[item.key]} name={item.label} stroke="url(#pnl-line)" fill="url(#pnl-fill)" strokeWidth={3} dot={false} activeDot={false} />)}
        </AreaChart></ResponsiveContainer> : <EmptyState text="No realized P&L, commission, or funding events match these filters." />}</div>
      </Panel>
      <Panel title={useExchangeOutcomes ? 'Exchange Realized P&L Snapshot' : 'Journal Performance Snapshot'} subtitle={useExchangeOutcomes ? 'Calculated from Binance realized P&L events; values stay separated by product and asset.' : 'Calculated only from saved manual trades.'}>
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">{useExchangeOutcomes
          ? realizedSnapshotMetrics.map(item => <div key={item.label} title={item.detail}><p className="text-[10px] text-muted-foreground">{item.label}</p><p className={`mt-1 truncate font-mono text-xs ${item.value.startsWith('-') ? 'text-red-600 dark:text-red-400' : item.value.startsWith('+') ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{item.value}</p>{realizedSeriesSummaries.length > 1 && <p className="mt-1 truncate text-[9px] text-muted-foreground">{item.detail}</p>}</div>)
          : [['Best trading day', bestDay ? `${money(bestDay.daily)} · ${bestDay.label}` : 'Unavailable'], ['Worst trading day', worstDay ? `${money(worstDay.daily)} · ${worstDay.label}` : 'Unavailable'], ['Average winning trade', avgWin === null ? 'Unavailable' : money(avgWin)], ['Average losing trade', avgLoss === null ? 'Unavailable' : money(avgLoss)], ['Average expectancy', expectancy === null ? 'Unavailable' : money(expectancy)], ['Maximum drawdown', journalDaily.length ? money(-drawdown) : 'Unavailable'], ['Profitable days', String(journalDaily.filter(day => day.daily > 0).length)], ['Losing days', String(journalDaily.filter(day => day.daily < 0).length)]].map(([label, value]) => <div key={label}><p className="text-[10px] text-muted-foreground">{label}</p><p className={`mt-1 font-mono text-xs ${label.includes('loss') || label.includes('drawdown') || value.startsWith('-') ? 'text-red-600 dark:text-red-400' : value.startsWith('+') ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{value}</p></div>)}</div>
      </Panel>
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Panel title="Daily Exchange P&L" subtitle="Net exchange-reported amounts by event date; series are not combined across products or assets.">
        <div className="h-48">{daily.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={daily} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <ReferenceLine y={0} stroke="var(--muted-foreground)" />
          <XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={value => formatMoney(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip daily series={series} />} />
          {series.map(item => <Bar key={item.key} dataKey={(row: OverviewDay) => row.dailyBySeries[item.key]} name={item.label} fill={item.color} radius={[3, 3, 0, 0]}>
            {daily.map(day => <Cell key={day.date} fill={(day.dailyBySeries[item.key] ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)'} />)}
          </Bar>)}
        </BarChart></ResponsiveContainer> : <EmptyState text="No daily exchange results to display." />}</div>
      </Panel>
      <Panel title={realizedSeriesChartData.length ? 'Realized P&L by Product & Asset' : 'Strategy Performance'} subtitle={realizedSeriesChartData.length ? 'Net exchange-reported realized P&L in native assets; no cross-asset totals.' : 'Strategy tags from the selected manual journal records.'} action={<Button variant="ghost" size="sm" onClick={() => onNavigate('Analytics')}>View Analytics <ChevronRight data-icon="inline-end" /></Button>}>
        {realizedSeriesChartData.length ? <div className="h-48"><ResponsiveContainer width="100%" height="100%"><BarChart data={realizedSeriesChartData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="var(--border)" horizontal={false} />
          <ReferenceLine x={0} stroke="var(--muted-foreground)" />
          <XAxis type="number" tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={118} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} tickLine={false} axisLine={false} />
          <Tooltip content={<RealizedSeriesTooltip />} />
          <Bar dataKey="total" name="Realized P&L" radius={[0, 3, 3, 0]}>{realizedSeriesChartData.map(item => <Cell key={item.key} fill={item.total >= 0 ? 'var(--positive)' : 'var(--negative)'} />)}</Bar>
        </BarChart></ResponsiveContainer></div> : strategyRows.length ? <div className="space-y-4">{strategyRows.map(row => <div key={row.name}><div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium">{row.name}</span><span className={row.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{money(row.pnl)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${row.pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.max(8, Math.min(100, Math.abs(row.pnl) / Math.max(...strategyRows.map(item => Math.abs(item.pnl)), 1) * 100))}%` }} /></div><div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{row.count} trade{row.count === 1 ? '' : 's'}</span><span>{row.winRate.toFixed(0)}% win rate</span></div></div>)}</div> : <EmptyState text="No Binance realized P&L or saved strategy records match these filters." />}
      </Panel>
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
      <Panel title={recent.length ? 'Recent Trades' : 'Recent Binance Activity'} subtitle={recent.length ? 'Latest closed manual journal records in the selected view.' : 'Latest persisted financial events in the selected view; events are not reconstructed trades.'} action={<Button variant="ghost" size="sm" onClick={() => onNavigate(recent.length ? 'Trades' : 'Calendar')}>View All <ChevronRight data-icon="inline-end" /></Button>}>
        {recent.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground"><tr>{['Closed', 'Symbol', 'Market', 'Side', 'Net P&L', 'Strategy'].map(header => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr></thead><tbody className="divide-y divide-border">{recent.map(trade => <tr key={trade.id} onClick={() => onSelect(trade)} className="cursor-pointer hover:bg-muted/50"><td className="px-3 py-3 text-muted-foreground">{trade.closed}</td><td className="px-3 py-3 font-mono font-medium">{trade.symbol}</td><td className="px-3 py-3 text-muted-foreground">{trade.product}</td><td className="px-3 py-3">{trade.side}</td><td className={`px-3 py-3 font-mono ${netPnl(trade) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{money(netPnl(trade))}</td><td className="px-3 py-3 text-muted-foreground">{trade.strategy || '—'}</td></tr>)}</tbody></table></div> : recentExchangeEvents.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground"><tr>{['Time', 'Symbol', 'Product', 'Event', 'Amount', 'Details'].map(header => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr></thead><tbody className="divide-y divide-border">{recentExchangeEvents.map((event, index) => <tr key={`${event.accountId}:${event.product}:${event.id}:${event.occurredAt}:${index}`} className="hover:bg-muted/50"><td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{formatTimestamp(event.occurredAt)}</td><td className="px-3 py-3 font-mono font-medium">{event.symbol ?? '—'}</td><td className="px-3 py-3 text-muted-foreground">{productName(event.product)}</td><td className="px-3 py-3">{event.type}</td><td className={`px-3 py-3 whitespace-nowrap font-mono ${(event.amount ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : (event.amount ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{event.amount === null ? 'Unavailable' : amount(event.amount, event.asset)}</td><td className="px-3 py-3 text-muted-foreground">{event.description ?? '—'}</td></tr>)}</tbody></table></div> : <EmptyState text="No Binance financial events or manual trades match these filters." />}
      </Panel>
      <Panel title={useExchangeOutcomes ? 'Exchange Activity Insights' : 'Trading Insights'} subtitle={useExchangeOutcomes ? 'Computed from persisted Binance realized P&L events.' : 'Derived from saved manual journal records.'}>
        <div className="space-y-3 text-xs leading-5">{recent[0] && <Insight icon={recent[0].pnl >= 0 ? TrendingUp : TrendingDown} text={`Most recent journal result: ${recent[0].symbol} ${money(netPnl(recent[0]))}.`} />}{strategyRows[0] && <Insight icon={Tags} text={`${strategyRows[0].name} contributes ${money(strategyRows[0].pnl)} across ${strategyRows[0].count} trade${strategyRows[0].count === 1 ? '' : 's'}.`} />}{useExchangeOutcomes && <Insight icon={realizedSeriesSummaries[0].total >= 0 ? TrendingUp : TrendingDown} text={`${realizedOutcomes.length} realized P&L events across ${realizedSeriesSummaries.length} product/asset series. Values remain in native assets.`} />}{useExchangeOutcomes && realizedSnapshotMetrics[0].value !== 'Unavailable' && <Insight icon={TrendingUp} text={`${realizedSnapshotMetrics[0].label}: ${realizedSnapshotMetrics[0].value}.`} />}{!useExchangeOutcomes && filtered.length < 10 && <Insight icon={CircleHelp} text="No Binance realized P&L events or enough saved journal records are available for this selection." />}</div>
        <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="outline" size="sm" onClick={() => onNavigate('Analytics')}><BarChart3 data-icon="inline-start" />Analytics</Button><Button variant="outline" size="sm" onClick={() => onNavigate('AI Review')}><Sparkles data-icon="inline-start" />AI Review</Button><Button variant="outline" size="sm" onClick={() => onNavigate('Calendar')}><CalendarDays data-icon="inline-start" />Calendar</Button><Button variant="outline" size="sm" onClick={() => onNavigate('Playbook')}><BookOpen data-icon="inline-start" />Playbook</Button></div>
      </Panel>
    </div>
    <Panel title="Recent Trading Days" subtitle={daily.length ? 'Recent dates with exchange-reported realized P&L, fees, or funding.' : 'Recent dates from saved manual journal records.'}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">{recentDays.map(date => {
        const exchangeDay = daily.find(item => item.date === date)
        const journalDay = journalDaily.find(item => item.date === date)
        const dayCount = exchangeDay?.count ?? journalDay?.count ?? 0
        const exchangeAmounts = exchangeDay ? series.filter(item => exchangeDay.dailyBySeries[item.key] !== undefined).map(item => amount(exchangeDay.dailyBySeries[item.key], item.asset)).join(' · ') : ''
        const displayValue = exchangeDay ? exchangeAmounts : journalDay ? money(journalDay.daily) : '—'
        const values = exchangeDay ? Object.values(exchangeDay.dailyBySeries) : journalDay ? [journalDay.daily] : []
        const positive = values.length > 0 && values.every(value => value > 0)
        const negative = values.length > 0 && values.every(value => value < 0)
        return <button key={date} onClick={() => onNavigate('Calendar')} className="rounded-md border border-border p-2 text-left hover:bg-muted"><span className="block text-[10px] text-muted-foreground">{dayLabel(date)}</span><span className={`mt-2 block truncate font-mono text-xs ${positive ? 'text-emerald-600 dark:text-emerald-400' : negative ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>{displayValue}</span><span className="mt-1 block text-[9px] text-muted-foreground">{dayCount ? `${dayCount} ${exchangeDay ? 'event' : 'trade'}${dayCount === 1 ? '' : 's'}` : 'Inactive'}</span></button>
      })}</div>
    </Panel>
  </div>
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">{label}<select value={value} onChange={event => onChange(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring">{options.map(option => <option key={option}>{option}</option>)}</select></label>
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-lg border border-border bg-card"><div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5"><div><h2 className="text-sm font-medium">{title}</h2>{subtitle && <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>}</div>{action}</div><div className="p-4 sm:p-5">{children}</div></section>
}

function Kpi({ label, value, valueTitle, detail, tone }: { label: string; value: string; valueTitle?: string; detail: string; tone: 'positive' | 'negative' | 'neutral' }) {
  return <div className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p title={valueTitle} className={`mt-3 truncate font-mono text-xl tabular-nums tracking-tight ${tone === 'positive' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'negative' ? 'text-red-600 dark:text-red-400' : ''}`}>{value}</p><p title={detail} className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p></div>
}

function ChartTooltip({ active, payload, label, daily = false, series = [] }: {
  active?: boolean
  payload?: { payload?: OverviewDay }[]
  label?: string
  daily?: boolean
  series?: FinancialSeries[]
}) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  if (!item) return null
  return <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
    <p className="font-medium">{label}</p>
    {series.map(entry => {
      const value = daily ? item.dailyBySeries[entry.key] : item.cumulativeBySeries[entry.key]
      return value === undefined ? null : <p key={entry.key} className="mt-1 font-mono" style={{ color: entry.color }}>{entry.label}: {amount(value, entry.asset)}</p>
    })}
    <p className="text-muted-foreground">{item.count} exchange income event{item.count === 1 ? '' : 's'}</p>
  </div>
}

function RealizedSeriesTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload?: RealizedSeriesSummary & { label: string } }[]
}) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  if (!item) return null
  return <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
    <p className="font-medium">{item.label}</p>
    <p className="mt-1 font-mono">{amount(item.total, item.asset)} realized P&amp;L</p>
    <p className="text-muted-foreground">{item.events.length} events · {item.days.length} event-days</p>
  </div>
}

function EmptyState({ text }: { text: string }) {
  return <div className="grid h-full min-h-32 place-items-center text-center text-xs text-muted-foreground">{text}</div>
}

function Insight({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return <div className="flex gap-2"><Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span>{text}</span></div>
}
