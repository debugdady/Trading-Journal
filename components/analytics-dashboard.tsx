'use client'

import { useMemo, useState } from 'react'
import { Activity, Download, RotateCcw } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import type { JournalTrade } from '@/lib/trading/manual-journal'
import type { Coverage, FinancialEvent, Product, TradingRepositorySnapshot } from '@/lib/trading/types'
import { formatMoney, formatQuantity } from '@/lib/trading/format-money'

type Tab = 'Performance' | 'Trade Edge' | 'Execution & Costs' | 'Risk' | 'Market Context' | 'Portfolio' | 'Psychology'
type Range = '7D' | '30D' | '90D' | '6M' | '1Y' | 'All Time'
type RealizedSeries = { key: string; name: string; asset: string; color: string }
type RealizedPoint = { date: string; label: string; daily: Record<string, number>; cumulative: Record<string, number> }
type RealizedAssetChart = { asset: string; series: RealizedSeries[]; data: RealizedPoint[] }

const tabs: Tab[] = ['Performance', 'Trade Edge', 'Execution & Costs', 'Risk', 'Market Context', 'Portfolio', 'Psychology']
const products: { value: Product; label: string }[] = [
  { value: 'spot', label: 'Spot' },
  { value: 'usd-m-futures', label: 'USDⓈ-M Futures' },
  { value: 'coin-m-futures', label: 'COIN-M Futures' },
]
const productName = (value: string) => products.find(item => item.value === value)?.label ?? value
const formatDate = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const money = (value: number | null | undefined, asset?: string) => formatMoney(value, { asset, unavailable: 'Unavailable' })
const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`

export function AnalyticsDashboard({ snapshot, trades, accountIds }: { snapshot: TradingRepositorySnapshot; trades: JournalTrade[]; accountIds: string[] }) {
  const [tab, setTab] = useState<Tab>('Performance')
  const [range, setRange] = useState<Range>('30D')
  const [product, setProduct] = useState('All')
  const [symbol, setSymbol] = useState('All')
  const [direction, setDirection] = useState('All')
  const [strategy, setStrategy] = useState('All')
  const [session, setSession] = useState('All')
  const [asset, setAsset] = useState('All')
  const [marketChartSymbol, setMarketChartSymbol] = useState('')
  const [balanceSearch, setBalanceSearch] = useState('')
  const [showZeroBalances, setShowZeroBalances] = useState(false)
  const enabledAccounts = useMemo(() => new Set(accountIds), [accountIds])

  const cutoff = useMemo(() => {
    if (range === 'All Time') return null
    const days = range === '7D' ? 7 : range === '30D' ? 30 : range === '90D' ? 90 : range === '6M' ? 180 : 365
    return Date.now() - days * 86_400_000
  }, [range])
  const matchesDate = (value: string) => {
    const time = Date.parse(value)
    return Number.isFinite(time) && (cutoff === null || time >= cutoff)
  }
  const matchesSession = (value: string) => {
    if (session === 'All') return true
    const time = Date.parse(value)
    if (!Number.isFinite(time)) return false
    const hour = new Date(time).getUTCHours()
    return session === '00:00–08:00 UTC' ? hour < 8 : session === '08:00–16:00 UTC' ? hour >= 8 && hour < 16 : hour >= 16
  }
  const manual = useMemo(() => trades.filter(trade => {
    const market = products.find(item => item.label === product)?.value
    return matchesDate(trade.closed)
      && matchesSession(trade.closed)
      && (product === 'All' || trade.product === product || trade.product === market)
      && (symbol === 'All' || trade.symbol === symbol)
      && (direction === 'All' || trade.side.toLowerCase() === direction.toLowerCase())
      && (strategy === 'All' || trade.strategy === strategy)
  }), [trades, cutoff, product, symbol, direction, strategy, session])
  const accountExecutions = useMemo(() => snapshot.executions.filter(item => enabledAccounts.has(item.accountId)), [snapshot.executions, enabledAccounts])
  const accountEvents = useMemo(() => snapshot.financialEvents.filter(item => enabledAccounts.has(item.accountId)), [snapshot.financialEvents, enabledAccounts])
  const executions = useMemo(() => accountExecutions.filter(item => matchesDate(item.executedAt)
    && matchesSession(item.executedAt)
    && (product === 'All' || item.product === products.find(value => value.label === product)?.value)
    && (symbol === 'All' || item.symbol === symbol)
    && (asset === 'All' || item.commissionAsset === asset)
    && (direction === 'All' || item.side.toLowerCase() === direction.toLowerCase())), [accountExecutions, cutoff, product, symbol, direction, asset, session])
  const events = useMemo(() => accountEvents.filter(item => matchesDate(item.occurredAt)
    && matchesSession(item.occurredAt)
    && (product === 'All' || item.product === products.find(value => value.label === product)?.value)
    && (asset === 'All' || item.asset === asset)
    && (symbol === 'All' || item.symbol === symbol)), [accountEvents, cutoff, product, symbol, asset, session])
  const symbols = [...new Set([...trades.map(item => item.symbol), ...accountExecutions.map(item => item.symbol), ...accountEvents.map(item => item.symbol).filter((value): value is string => Boolean(value))])].sort()
  const strategies = [...new Set(trades.map(item => item.strategy).filter(Boolean))].sort()
  const manualStrategies = [...new Set(manual.map(item => item.strategy).filter(Boolean))].sort()
  const assets = [...new Set([...accountEvents.map(item => item.asset), ...accountExecutions.map(item => item.commissionAsset).filter((value): value is string => Boolean(value))])].sort()
  const manualTotal = manual.reduce((sum, trade) => sum + trade.pnl, 0)
  const winners = manual.filter(trade => trade.pnl > 0)
  const losers = manual.filter(trade => trade.pnl < 0)
  const manualDaily = useMemo(() => {
    const groups = new Map<string, number>()
    manual.forEach(trade => {
      const key = new Date(trade.closed).toISOString().slice(0, 10)
      groups.set(key, (groups.get(key) ?? 0) + trade.pnl)
    })
    let cumulative = 0
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, daily]) => {
      cumulative += daily
      return { date, label: formatDate(date), daily, cumulative }
    })
  }, [manual])
  const realized = events.filter(event => event.type === 'realized-pnl' && event.amount !== null)
  const realizedCharts = useMemo(() => buildRealizedCharts(realized), [realized])
  const realizedDrawdownCharts = useMemo(() => buildRealizedDrawdown(realizedCharts), [realizedCharts])
  const realizedByAsset = groupAmounts(realized)
  const commissionEvents = events.filter(event => event.type === 'commission' && event.amount !== null)
  const commissionsByAsset = groupAmounts(commissionEvents)
  const fundingEvents = events.filter(event => event.type === 'funding' && event.amount !== null)
  const fundingByAsset = groupAmounts(fundingEvents)
  const financialComponents = groupFinancialComponents(events.filter(event => ['commission', 'funding', 'realized-pnl'].includes(event.type)))
  const realizedSummary = summarizeAmounts(realizedByAsset, realized.length, 'realized P&L')
  const commissionSummary = summarizeAmounts(commissionsByAsset, commissionEvents.length, 'commission')
  const fundingSummary = summarizeAmounts(fundingByAsset, fundingEvents.length, 'funding')
  const positiveRealizedEvents = realized.filter(event => event.amount !== null && event.amount > 0).length
  const negativeRealizedEvents = realized.filter(event => event.amount !== null && event.amount < 0).length
  const realizedBySymbol = groupRealizedBySymbol(realized)
  const realizedByMonth = groupRealizedByMonth(realized)
  const realizedByHour = groupEventsByUtcHour(realized)
  const manualDurationCounts = groupManualDurations(manual)
  const feesByAsset = groupAmounts(executions.filter(item => item.commission !== null).map(item => ({
    product: item.product,
    asset: item.commissionAsset ?? 'Unknown asset',
    amount: item.commission,
  })))
  const selectedProduct = products.find(value => value.label === product)?.value
  const currentPositionRecords = snapshot.positions.filter(item => enabledAccounts.has(item.accountId)
    && (product === 'All' || item.product === selectedProduct))
  const filteredPositions = currentPositionRecords.filter(item => enabledAccounts.has(item.accountId)
    && (item.quantity === null || item.quantity !== 0)
    && (symbol === 'All' || item.symbol === symbol))
  const accountSnapshots = snapshot.snapshots.filter(item => enabledAccounts.has(item.accountId)
    && (product === 'All' || item.product === selectedProduct)
    && hasSnapshotValues(item))
  const accountCoverage = snapshot.coverage.filter(item => enabledAccounts.has(item.accountId)
    && (product === 'All' || item.product === selectedProduct))
  const accountBalances = snapshot.balances.filter(item => enabledAccounts.has(item.accountId)
    && (product === 'All' || item.product === products.find(value => value.label === product)?.value))
  const zeroBalanceCount = accountBalances.filter(isZeroBalance).length
  const nonZeroBalanceCount = accountBalances.filter(hasNonZeroBalance).length
  const visibleBalances = accountBalances.filter(item => (showZeroBalances || !isZeroBalance(item))
    && item.asset.toLowerCase().includes(balanceSearch.trim().toLowerCase()))
  const completeCoverage = accountCoverage.filter(item => item.complete).length
  const positionRiskCoverage = latestPositionRiskCoverage(accountCoverage)
  const positionRiskCoverageComplete = positionRiskCoverage.length > 0 && positionRiskCoverage.every(item =>
    item.complete && snapshot.positions.filter(position => position.accountId === item.accountId && position.product === item.product).length === item.recordCount)
  const positionRiskFlat = positionRiskCoverageComplete && filteredPositions.length === 0
  const positionRiskNotApplicable = product === 'Spot'
  const unknownSizePositions = filteredPositions.filter(item => item.quantity === null).length
  const knownOpenPositionCount = filteredPositions.length - unknownSizePositions
  const filteredSnapshots = accountSnapshots.filter(item => matchesDate(item.asOf)
    && matchesSession(item.asOf)
    && (product === 'All' || item.product === products.find(value => value.label === product)?.value))
  const latestSnapshots = latestSnapshotPerAccountProduct(filteredSnapshots)
  const latestEquitySnapshots = latestSnapshots.filter(item => item.equity !== null)
  const latestEquitySummary = latestEquitySnapshots.length === 1
    ? money(latestEquitySnapshots[0].equity, latestEquitySnapshots[0].currency)
    : latestEquitySnapshots.length > 1 ? 'By account' : 'Unavailable'
  const portfolioSnapshotGroups = groupSnapshotHistories(filteredSnapshots)
  const filteredMarket = snapshot.market.filter(item => matchesDate(item.observedAt)
    && matchesSession(item.observedAt)
    && (product === 'All' || item.product === products.find(value => value.label === product)?.value)
    && (symbol === 'All' || item.symbol === symbol))
  const priceObservations = filteredMarket.filter(item => item.close !== undefined || ((item.kind === 'mark-price' || item.kind === 'index-price') && item.value !== null && item.value !== undefined))
    .map(item => ({ ...item, price: item.close ?? item.value ?? null }))
    .filter((item): item is typeof item & { price: number } => item.price !== null)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  const priceSymbols = [...new Set(priceObservations.map(item => item.symbol))]
  const marketMovement = summarizeMarketMovement(priceObservations)
  const activeMarketSymbol = symbol !== 'All' && priceSymbols.includes(symbol)
    ? symbol
    : priceSymbols.includes(marketChartSymbol)
      ? marketChartSymbol
      : priceSymbols[0] ?? ''
  const activePriceObservations = priceObservations.filter(item => item.symbol === activeMarketSymbol)
  const activeMarketMovement = marketMovement.find(item => item.symbol === activeMarketSymbol)
  const fundingChart = buildFundingRateSeries(filteredMarket)
  const marketCoverage = accountCoverage.filter(item => item.endpoint.startsWith('market/'))
  const filteredOrders = snapshot.orders.filter(item => enabledAccounts.has(item.accountId)
    && matchesDate(item.updatedAt ?? item.openedAt ?? '')
    && matchesSession(item.updatedAt ?? item.openedAt ?? '')
    && (product === 'All' || item.product === products.find(value => value.label === product)?.value)
    && (symbol === 'All' || item.symbol === symbol))
  const realizedEventMix = [
    { name: 'Positive', value: positiveRealizedEvents, color: 'var(--positive)' },
    { name: 'Negative', value: negativeRealizedEvents, color: 'var(--negative)' },
    { name: 'Zero', value: realized.length - positiveRealizedEvents - negativeRealizedEvents, color: 'var(--muted-foreground)' },
  ].filter(item => item.value > 0)
  const realizedWeekdays = groupEventsByWeekday(realized)
  const executionSides = groupExecutionSides(executions)
  const makerTaker = groupMakerTaker(executions)
  const positionLeverage = groupPositionLeverage(filteredPositions.filter(item => item.quantity !== null && item.quantity !== 0))
  const liquidationDistances = filteredPositions.filter(item => item.quantity !== null && item.quantity !== 0).flatMap(item => {
    if (item.markPrice === null || item.markPrice <= 0 || item.liquidationPrice === null) return []
    return [{ ...item, distance: Math.abs((item.markPrice - item.liquidationPrice) / item.markPrice) * 100 }]
  })
    .sort((a, b) => a.distance - b.distance)
  const positionNotional = groupPositionNotional(filteredPositions)
  const positionNotionalComplete = filteredPositions.length > 0 && filteredPositions.every(item => item.notional !== null)
  const openNotionalValue = positionRiskNotApplicable
    ? '—'
    : positionRiskFlat
    ? 'Flat'
    : positionNotionalComplete && positionNotional.length === 1
      ? money(positionNotional[0].amount)
      : positionNotionalComplete && positionNotional.length > 1
        ? 'By market'
        : 'Unavailable'
  const openNotionalDetail = positionRiskNotApplicable
    ? 'Spot exposure is represented by balances'
    : positionRiskFlat
    ? 'No open positions reported by Binance'
    : positionNotionalComplete && positionNotional.length > 1
      ? positionNotional.map(item => `${productName(item.product)}: ${money(item.amount)}`).join(' · ')
      : positionRiskCoverageComplete
        ? 'Notional is not reported for every open position'
        : 'Position-risk coverage is incomplete'
  const journalTags = groupJournalTags(manual)

  function exportData() {
    const rows = [
      ['record_type', 'id', 'product', 'symbol', 'side_or_type', 'timestamp', 'amount', 'asset'],
      ...manual.map(item => ['manual_journal', item.id, item.product, item.symbol, item.side, item.closed, item.pnl, '']),
      ...events.map(item => ['financial_event', item.id, productName(item.product), item.symbol ?? '', item.type, item.occurredAt, item.amount ?? '', item.asset]),
      ...executions.map(item => ['execution', item.id, productName(item.product), item.symbol, item.side, item.executedAt, item.quantity ?? '', item.commissionAsset ?? '']),
    ]
    const content = rows.map(row => row.map(csv).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'trading-analytics.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function resetFilters() {
    setRange('30D')
    setProduct('All')
    setSymbol('All')
    setDirection('All')
    setStrategy('All')
    setSession('All')
    setAsset('All')
  }

  return <div className="flex flex-col gap-5">
    <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div><h1 className="text-2xl font-semibold tracking-tight">Analytics</h1><p className="mt-2 text-sm text-muted-foreground">Explore saved journal entries and persisted Binance records. Exchange amounts remain in their reported assets.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={resetFilters}><RotateCcw data-icon="inline-start" />Reset filters</Button>
        <Button variant="outline" size="sm" onClick={exportData}><Download data-icon="inline-start" />Export</Button>
      </div>
    </header>
    <div className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <Select label="Date range" value={range} onChange={value => setRange(value as Range)} options={['7D', '30D', '90D', '6M', '1Y', 'All Time']} />
      <Select label="Product" value={product} onChange={setProduct} options={['All', ...products.map(item => item.label)]} />
      <Select label="Symbol" value={symbol} onChange={setSymbol} options={['All', ...symbols]} />
      <Select label="Direction" value={direction} onChange={setDirection} options={['All', 'Long', 'Short', 'Buy', 'Sell']} />
      <Select label="Journal strategy" value={strategy} onChange={setStrategy} options={['All', ...strategies]} />
      <Select label="UTC time block" value={session} onChange={setSession} options={['All', '00:00–08:00 UTC', '08:00–16:00 UTC', '16:00–24:00 UTC']} />
      <Select label="Binance asset" value={asset} onChange={setAsset} options={['All', ...assets]} />
    </div>
    <p className="text-[10px] text-muted-foreground">Manual journal: {manual.length} dated entries · Binance: {executions.length} executions and {events.length} financial events · {completeCoverage}/{accountCoverage.length} coverage reports complete. Asset filter applies to exchange events and fill commissions; manual entries have no asset field.</p>
    <div className="flex gap-1 overflow-x-auto border-b border-border pb-px" role="tablist" aria-label="Analytics views">{tabs.map(item => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-xs ${tab === item ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{item}</button>)}</div>

    {tab === 'Performance' && <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Exchange realized P&L" value={realizedSummary.value} detail={realizedSummary.detail} tone={realizedSummary.tone} />
        <Metric label="Positive / negative events" value={realized.length ? `${positiveRealizedEvents} / ${negativeRealizedEvents}` : 'Unavailable'} detail={realized.length ? `${realized.length} reported events · not a trade win rate` : 'No realized P&L events in this selection'} />
        <Metric label="Synced executions" value={executions.length.toLocaleString()} detail="Persisted Binance fills in this selection" />
        <Metric label="Exchange commissions" value={commissionSummary.value} detail={commissionSummary.detail} tone={commissionSummary.tone} />
        <Metric label="Funding net" value={fundingSummary.value} detail={fundingSummary.detail} tone={fundingSummary.tone} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Manual journal entries" value={String(manual.length)} detail="User-entered records matching filters" />
        <Metric label="Financial events" value={events.length.toLocaleString()} detail="Persisted exchange records in range" />
        <Metric label="Orders in range" value={filteredOrders.length.toLocaleString()} detail="Exchange orders updated in the selected period" />
        <Metric label="Account snapshots" value={filteredSnapshots.length.toLocaleString()} detail="Captured states; no historical reconstruction" />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Realized event outcomes" subtitle="Positive and negative exchange P&L events, not completed-trade outcomes.">
          {realizedEventMix.length ? <Chart><PieChart><Pie data={realizedEventMix} dataKey="value" nameKey="name" innerRadius={56} outerRadius={84} paddingAngle={3}>{realizedEventMix.map(item => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip content={<Tip />} /></PieChart></Chart> : <Empty text="No realized P&L events match these filters." />}
        </Panel>
        <Panel title="Realized event activity by weekday" subtitle="UTC event counts. Amounts are not combined across assets.">
          {realizedWeekdays.length ? <Chart><BarChart data={realizedWeekdays}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip content={<Tip />} /><Bar dataKey="count" name="Realized P&L events" fill="var(--chart-3)" radius={[3, 3, 0, 0]} /></BarChart></Chart> : <Empty text="No dated realized P&L events match these filters." />}
        </Panel>
        <Panel title="Exchange results by symbol" subtitle="Actual realized P&L events grouped by product and reported asset.">
          {realizedBySymbol.length ? <div className="space-y-2">{realizedBySymbol.slice(0, 6).map(item => <div key={item.key} className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs"><span className="min-w-0"><span className="font-mono font-medium">{item.symbol ?? 'Unspecified symbol'}</span><span className="ml-2 text-[10px] text-muted-foreground">{productName(item.product)} · {item.asset}</span></span><span className={`shrink-0 font-mono tabular-nums ${item.amount > 0 ? 'text-emerald-500' : item.amount < 0 ? 'text-rose-500' : ''}`}>{money(item.amount, item.asset)}</span></div>)}</div> : <Empty text="No symbol-level realized P&L events are stored." />}
        </Panel>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel title={realizedCharts.length ? 'Cumulative exchange realized P&L' : 'Cumulative reported journal P&L'} subtitle={realizedCharts.length ? 'Exchange events by product and asset. Different assets are charted separately.' : 'User-entered values by close date.'}>
          {realizedCharts.length
            ? <div className="space-y-6">{realizedCharts.map(chart => <div key={chart.asset} className="min-w-0"><div className="mb-2 flex items-center justify-between gap-3"><p className="text-[10px] font-medium text-muted-foreground">{chart.asset}</p><p className="text-[10px] text-muted-foreground">Line color reflects latest net</p></div><Chart><AreaChart data={chart.data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" interval="preserveStartEnd" tickMargin={8} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis width={64} tickFormatter={value => formatMoney(Number(value), { signed: true })} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" /><Tooltip content={<RealizedTip asset={chart.asset} />} />{chart.series.map(item => { const latest = chart.data.at(-1)?.cumulative[item.key] ?? 0; const color = latest >= 0 ? 'var(--positive)' : 'var(--negative)'; return <Area key={item.key} type="monotone" dataKey={(point: RealizedPoint) => point.cumulative[item.key] ?? 0} name={item.name} stroke={color} fill={color} fillOpacity={0.08} strokeWidth={2} dot={false} activeDot={{ r: 4 }} /> })}</AreaChart></Chart></div>)}</div>
            : manualDaily.length ? <Chart><AreaChart data={manualDaily}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tickFormatter={value => formatMoney(Number(value))} tick={{ fontSize: 10 }} /><Tooltip content={<Tip moneyValues />} /><Area dataKey="cumulative" name="Reported P&L" stroke="var(--foreground)" fill="var(--muted)" /></AreaChart></Chart> : <Empty text="No exchange realized P&L or dated manual journal entries match these filters." />}
        </Panel>
        <Panel title="Realized P&L by product and asset" subtitle="Exchange-reported Binance income events.">
          {realizedByAsset.length ? <AmountTable rows={realizedByAsset} /> : <Empty text="No realized P&L events are stored for this selection." />}
        </Panel>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={realizedCharts.length ? 'Daily exchange realized P&L' : 'Daily reported journal P&L'} subtitle={realizedCharts.length ? 'Green bars are positive; red bars are negative. Assets remain separate.' : 'Manual journal entries only.'}>
          {realizedCharts.length
            ? <div className="space-y-6">{realizedCharts.map(chart => <div key={chart.asset} className="min-w-0"><p className="mb-2 text-[10px] font-medium text-muted-foreground">{chart.asset}</p><Chart><BarChart data={chart.data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" interval="preserveStartEnd" tickMargin={8} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis width={64} tickFormatter={value => formatMoney(Number(value), { signed: true })} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" /><Tooltip content={<RealizedTip asset={chart.asset} daily />} />{chart.series.map(item => <Bar key={item.key} dataKey={(point: RealizedPoint) => point.daily[item.key] ?? 0} name={item.name} radius={[2, 2, 0, 0]}>{chart.data.map(point => <Cell key={`${item.key}:${point.date}`} fill={(point.daily[item.key] ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)'} />)}</Bar>)}</BarChart></Chart></div>)}</div>
            : manualDaily.length ? <Chart><BarChart data={manualDaily}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10 }} /><YAxis tickFormatter={value => formatMoney(Number(value))} tick={{ fontSize: 10 }} /><Tooltip content={<Tip moneyValues />} /><Bar dataKey="daily" name="Reported P&L" fill="var(--chart-3)" /></BarChart></Chart> : <Empty text="No exchange realized P&L or dated manual journal entries match these filters." />}
        </Panel>
        <Panel title="Recorded commissions" subtitle="Exchange income events, grouped by product and asset without currency conversion.">
          {commissionsByAsset.length ? <AmountTable rows={commissionsByAsset} /> : <Empty text="No commission financial events are stored. Execution fees are shown in Execution & Costs." />}
        </Panel>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Monthly realized P&L" subtitle="Monthly exchange events are kept separate by product and reported asset.">
          {realizedByMonth.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-2.5 pr-3">Month</th><th className="py-2.5 pr-3">Product · asset</th><th className="py-2.5 pr-3 text-right">Events</th><th className="py-2.5 text-right">Realized P&L</th></tr></thead><tbody className="divide-y divide-border">{realizedByMonth.map(item => <tr key={item.key}><td className="py-3 pr-3">{item.month}</td><td className="py-3 pr-3 text-muted-foreground">{productName(item.product)} · {item.asset}</td><td className="py-3 pr-3 text-right tabular-nums">{item.count}</td><td className={`py-3 text-right font-mono tabular-nums ${item.amount > 0 ? 'text-emerald-500' : item.amount < 0 ? 'text-rose-500' : ''}`}>{money(item.amount, item.asset)}</td></tr>)}</tbody></table></div> : <Empty text="No monthly realized P&L can be calculated for the selected range." />}
        </Panel>
        <Panel title="Holding duration" subtitle="Duration counts from manual journal entries only; no result is inferred from Binance fills.">
          {manualDurationCounts.length ? <div className="space-y-2">{manualDurationCounts.map(item => <div key={item.label} className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-3 text-xs"><span>{item.label}</span><span className="font-mono tabular-nums">{item.count} entries</span></div>)}</div> : <Empty text="No parseable manual holding durations match these filters." />}
        </Panel>
      </div>
    </div>}

    {tab === 'Trade Edge' && <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Exchange realized P&L by symbol" subtitle="Persisted Binance realized-P&L events grouped by product, asset, and reported symbol.">
        {realizedBySymbol.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="sticky top-0 border-b border-border bg-card text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-2.5 pr-3">Symbol</th><th className="py-2.5 pr-3">Product · asset</th><th className="py-2.5 pr-3 text-right">Events</th><th className="py-2.5 text-right">Realized P&L</th></tr></thead><tbody className="divide-y divide-border">{realizedBySymbol.map(item => <tr key={item.key} className="transition-colors hover:bg-muted/30"><td className="py-3 pr-3 font-mono font-medium">{item.symbol ?? 'No symbol reported'}</td><td className="py-3 pr-3 text-muted-foreground">{productName(item.product)} · {item.asset}</td><td className="py-3 pr-3 text-right tabular-nums">{item.count}</td><td className={`py-3 text-right font-mono tabular-nums ${item.amount > 0 ? 'text-emerald-500' : item.amount < 0 ? 'text-rose-500' : 'text-muted-foreground'}`}>{money(item.amount, item.asset)}</td></tr>)}</tbody></table></div> : <Empty text="No exchange realized-P&L events match these filters." />}
        {manualStrategies.length === 0 && <p className="mt-3 border-t border-border pt-3 text-[10px] text-muted-foreground">Manual strategy results are unavailable until a strategy is recorded on a journal entry.</p>}
      </Panel>
      <Panel title="Execution activity by symbol" subtitle="Persisted Binance fills and executed quantity; volume is not treated as performance.">
        {executions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead className="sticky top-0 border-b border-border bg-card text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-2.5 pr-3">Symbol</th><th className="py-2.5 pr-3">Product</th><th className="py-2.5 pr-3 text-right">Fills</th><th className="py-2.5 text-right">Executed quantity</th></tr></thead><tbody className="divide-y divide-border">{groupExecutions(executions).map(item => <tr key={item.key} className="transition-colors hover:bg-muted/30"><td className="py-3 pr-3 font-mono font-medium">{item.symbol}</td><td className="py-3 pr-3 text-muted-foreground">{productName(item.product)}</td><td className="py-3 pr-3 text-right tabular-nums">{item.count.toLocaleString()}</td><td className="py-3 text-right font-mono tabular-nums">{item.quantity === null ? 'Unavailable' : item.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td></tr>)}</tbody></table></div> : <Empty text="No synced executions match these filters." />}
      </Panel>
    </div>}
    {tab === 'Trade Edge' && <div className="grid gap-5 xl:grid-cols-3">
      <Panel title="Fill activity by side" subtitle="Actual fill counts and executed quantities from Binance.">
        {executionSides.length ? <div className="space-y-2">{executionSides.map(item => <div key={item.label} className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-3 text-xs"><span className="font-medium">{item.label}</span><span className="font-mono text-right tabular-nums">{item.count} fills<span className="block text-[10px] text-muted-foreground">{item.quantity === null ? 'quantity unavailable' : `qty ${formatQuantity(item.quantity)}`}</span></span></div>)}</div> : <Empty text="No Binance executions match these filters." />}
      </Panel>
      <Panel title="Realized events by weekday" subtitle="UTC event counts only; an event is not a round-trip trade.">
        {realizedWeekdays.length ? <Chart><BarChart data={realizedWeekdays}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip content={<Tip />} /><Bar dataKey="count" name="Reported events" fill="var(--chart-3)" radius={[3, 3, 0, 0]} /></BarChart></Chart> : <Empty text="No realized P&L event times are available." />}
      </Panel>
      <Panel title="Manual strategy results" subtitle="Journal-reported results only; separate from exchange events.">
        {manualStrategies.length ? <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-2.5 pr-3">Strategy</th><th className="py-2.5 pr-3 text-right">Entries</th><th className="py-2.5 pr-3 text-right">Reported P&L</th><th className="py-2.5 text-right">Win rate</th></tr></thead><tbody className="divide-y divide-border">{manualStrategies.map(name => { const rows = manual.filter(item => item.strategy === name); const pnl = rows.reduce((sum, item) => sum + item.pnl, 0); return <tr key={name} className="transition-colors hover:bg-muted/30"><td className="py-3 pr-3 font-medium">{name}</td><td className="py-3 pr-3 text-right tabular-nums">{rows.length}</td><td className={`py-3 pr-3 text-right font-mono tabular-nums ${pnl > 0 ? 'text-emerald-500' : pnl < 0 ? 'text-rose-500' : ''}`}>{money(pnl)}</td><td className="py-3 text-right tabular-nums">{(rows.filter(item => item.pnl > 0).length / rows.length * 100).toFixed(1)}%</td></tr> })}</tbody></table></div> : <Empty text="Add a strategy to a manual journal entry to compare it here. No exchange strategy is inferred." />}
      </Panel>
    </div>}
    {tab === 'Trade Edge' && <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="UTC hourly event activity" subtitle="Counts of exchange-reported realized P&L events by UTC hour, not a strategy-performance signal.">
        {realizedByHour.length ? <Chart><BarChart data={realizedByHour}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" interval="preserveStartEnd" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip content={<Tip />} /><Bar dataKey="count" name="Realized P&L events" fill="var(--chart-3)" radius={[3, 3, 0, 0]} /></BarChart></Chart> : <Empty text="No realized P&L event timestamps are available." />}
      </Panel>
      <Panel title="Trade expectancy versus holding duration" subtitle="Requires complete round-trip trades and comparable P&L units.">
        <Empty text="Unavailable — fills and income events are not reconstructed into completed trades for analytics." />
      </Panel>
    </div>}

    {tab === 'Execution & Costs' && <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Synced executions" value={executions.length.toLocaleString()} detail="Persisted Binance fills in range" />
        <Metric label="Fill commissions" value={summarizeAmounts(feesByAsset, executions.filter(item => item.commission !== null).length, 'fill commission').value} detail="Grouped by product and commission asset" tone={feesByAsset.length === 1 ? feesByAsset[0].amount < 0 ? 'negative' : feesByAsset[0].amount > 0 ? 'positive' : 'neutral' : 'neutral'} />
        <Metric label="Income commission events" value={commissionSummary.value} detail={commissionSummary.detail} tone={commissionSummary.tone} />
        <Metric label="Funding net" value={fundingSummary.value} detail={fundingSummary.detail} tone={fundingSummary.tone} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Synced executions" subtitle="Recorded Binance trade fills.">
        {executions.length ? <div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="sticky top-0 border-b border-border bg-card text-[10px] uppercase text-muted-foreground"><tr>{['Time', 'Symbol', 'Product', 'Side', 'Price', 'Quantity', 'Commission'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{executions.map(item => <tr key={`${item.accountId}:${item.id}`}><td className="py-3">{new Date(item.executedAt).toLocaleString()}</td><td className="font-mono">{item.symbol}</td><td>{productName(item.product)}</td><td>{item.side}</td><td>{money(item.price)}</td><td>{formatQuantity(item.quantity)}</td><td>{money(item.commission, item.commissionAsset)}</td></tr>)}</tbody></table></div> : <Empty text="No synced executions match these filters." />}
      </Panel>
      <div className="flex flex-col gap-5"><Panel title="Execution commissions" subtitle="Summed from Binance fill records, separated by product and commission asset.">{feesByAsset.length ? <AmountTable rows={feesByAsset} /> : <Empty text="No fill commission values are available." />}</Panel><Panel title="Funding and realized income" subtitle="Exchange financial events, kept in their reported assets.">{events.filter(item => ['funding', 'realized-pnl', 'interest'].includes(item.type)).length ? <EventTable events={events.filter(item => ['funding', 'realized-pnl', 'interest'].includes(item.type))} /> : <Empty text="No funding, realized P&L, or interest events are stored." />}</Panel></div>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Maker versus taker fills" subtitle="Classification is shown only when Binance reports the maker flag.">
          {makerTaker.length ? <div className="space-y-2">{makerTaker.map(item => <div key={item.label} className="flex justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-3 text-xs"><span>{item.label}</span><span className="font-mono tabular-nums">{item.count.toLocaleString()} fills</span></div>)}</div> : <Empty text="No fill liquidity classifications are stored." />}
        </Panel>
        <Panel title="Fee drag by symbol" subtitle="Actual fill commissions, kept in each reported asset.">
          {groupExecutionFeesBySymbol(executions).length ? <div className="space-y-2">{groupExecutionFeesBySymbol(executions).slice(0, 8).map(item => <div key={item.key} className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs"><span><span className="font-mono">{item.symbol}</span><span className="ml-2 text-[10px] text-muted-foreground">{productName(item.product)} · {item.asset}</span></span><span className={`font-mono tabular-nums ${item.amount > 0 ? 'text-emerald-500' : item.amount < 0 ? 'text-rose-500' : ''}`}>{money(item.amount, item.asset)}</span></div>)}</div> : <Empty text="No symbol-level fill commissions are available." />}
        </Panel>
        <Panel title="Order analytics" subtitle="Counts and statuses from persisted Binance orders in the selected range.">
          {filteredOrders.length ? <div className="space-y-2">{groupOrdersByStatus(filteredOrders).map(item => <div key={item.status} className="flex justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-3 text-xs"><span>{item.status}</span><span className="font-mono tabular-nums">{item.count.toLocaleString()}</span></div>)}</div> : <Empty text="No persisted orders match these filters." />}
        </Panel>
        <Panel title="Income and cost components" subtitle="Exchange-reported totals stay separate; no cross-asset net figure is inferred.">
          {financialComponents.length ? <div className="space-y-2">{financialComponents.map(item => <div key={item.key} className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs"><span><span className="font-medium capitalize">{item.type}</span><span className="ml-2 text-[10px] text-muted-foreground">{productName(item.product)} · {item.asset} · {item.count} events</span></span><span className={`font-mono tabular-nums ${item.amount > 0 ? 'text-emerald-500' : item.amount < 0 ? 'text-rose-500' : ''}`}>{money(item.amount, item.asset)}</span></div>)}</div> : <Empty text="No realized P&L, commission, or funding events match these filters." />}
        </Panel>
      </div>
    </div>}

    {tab === 'Risk' && <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Current non-zero positions" value={positionRiskNotApplicable ? '—' : unknownSizePositions ? `${knownOpenPositionCount} + ${unknownSizePositions} unknown` : String(knownOpenPositionCount)} detail={positionRiskNotApplicable ? 'Spot is tracked through asset balances' : positionRiskFlat ? 'Binance confirms no open positions' : positionRiskCoverageComplete ? 'Current Binance position-risk records' : 'Position-risk coverage incomplete'} />
        <Metric label="Reported open notional" value={openNotionalValue} detail={openNotionalDetail} />
        <Metric label="Positions with liquidation price" value={positionRiskNotApplicable || !positionRiskCoverageComplete && filteredPositions.length === 0 ? 'Unavailable' : String(liquidationDistances.length)} detail={positionRiskFlat ? 'No open positions reported by Binance' : positionRiskNotApplicable ? 'Not applicable to Spot balances' : 'Requires reported mark and liquidation prices'} />
        <Metric label="Maximum reported leverage" value={filteredPositions.some(item => item.leverage !== null) ? `${Math.max(...filteredPositions.map(item => item.leverage ?? 0))}×` : positionRiskFlat || positionRiskNotApplicable ? '—' : 'Unavailable'} detail={positionRiskFlat ? 'No open positions reported by Binance' : positionRiskNotApplicable ? 'Not applicable to Spot balances' : 'Current persisted positions only'} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Realized P&L drawdown" subtitle="Pullback from the high-water mark within the selected range. Exchange events only; this is not account-equity drawdown.">
          {realizedDrawdownCharts.length ? <div className="space-y-5">{realizedDrawdownCharts.map(chart => <div key={chart.asset}><p className="mb-2 text-[10px] font-medium text-muted-foreground">{chart.asset}</p><Chart><AreaChart data={chart.data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" interval="preserveStartEnd" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis width={72} tickFormatter={value => money(Number(value), chart.asset)} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" /><Tooltip content={<Tip moneyValues asset={chart.asset} />} /><Area dataKey="drawdown" name="P&L pullback" stroke="var(--negative)" fill="var(--negative)" fillOpacity={0.12} /></AreaChart></Chart></div>)}</div> : <Empty text="No realized P&L event history is available to calculate a pullback." />}
        </Panel>
        <Panel title="Open positions by leverage" subtitle="Counts from current Binance position-risk records.">
          {positionLeverage.length ? <Chart><BarChart data={positionLeverage}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip content={<Tip />} /><Bar dataKey="count" name="Positions" fill="var(--chart-3)" radius={[3, 3, 0, 0]} /></BarChart></Chart> : <Empty text={positionRiskNotApplicable ? 'Spot does not have futures leverage positions.' : positionRiskFlat ? 'No open positions reported by Binance, so there is no leverage distribution.' : 'No open positions with reported leverage match these filters.'} />}
        </Panel>
      </div>
      <Panel title="Current position risk" subtitle="Only persisted Binance fields are shown; zero-quantity rows are not treated as open positions.">
        {filteredPositions.length
          ? <PositionTable positions={filteredPositions} />
          : positionRiskFlat
            ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{positionRiskCoverage.map(item => {
              const rows = snapshot.positions.filter(position => position.accountId === item.accountId && position.product === item.product)
              return <div key={`${item.accountId}:${item.product}`} className="rounded-md border border-[var(--positive)]/30 bg-[var(--positive)]/5 p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium">{productName(item.product)}</p><p className="mt-1 text-[10px] text-muted-foreground">Account ···{item.accountId.slice(-4)}</p></div><span className="rounded-full border border-[var(--positive)]/30 px-2 py-0.5 text-[10px] font-medium text-[var(--positive)]">Flat</span></div>
                <p className="mt-3 text-xs text-muted-foreground">{symbol !== 'All' ? 'No open positions match the selected symbol.' : rows.length ? `${rows.length} zero-quantity records; no open positions reported.` : 'Binance returned no position records.'}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">Checked {item.latest ? new Date(item.latest).toLocaleString() : 'time unavailable'}</p>
              </div>
            })}</div>
            : <Empty text={positionRiskNotApplicable ? 'Spot balances are not represented as futures position-risk records.' : positionRiskCoverage.length ? 'Latest Binance position-risk coverage is incomplete or does not match the stored records.' : 'No Binance position-risk coverage is available for the selected markets.'} />}
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Liquidation distance" subtitle="Distance from reported mark price to liquidation price; no risk threshold is inferred.">
          {liquidationDistances.length ? <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase text-muted-foreground"><tr><th className="py-2.5 pr-3">Symbol</th><th className="py-2.5 pr-3">Product</th><th className="py-2.5 pr-3 text-right">Mark</th><th className="py-2.5 pr-3 text-right">Liquidation</th><th className="py-2.5 text-right">Distance</th></tr></thead><tbody className="divide-y divide-border">{liquidationDistances.map(item => <tr key={item.id}><td className="py-3 pr-3 font-mono">{item.symbol}</td><td className="py-3 text-muted-foreground">{productName(item.product)}</td><td className="py-3 pr-3 text-right font-mono">{money(item.markPrice)}</td><td className="py-3 pr-3 text-right font-mono">{money(item.liquidationPrice)}</td><td className="py-3 text-right font-mono tabular-nums">{item.distance.toFixed(2)}%</td></tr>)}</tbody></table></div> : <Empty text={positionRiskNotApplicable ? 'Spot balances do not have a futures liquidation price.' : positionRiskFlat ? 'No open positions reported by Binance; liquidation distance does not apply.' : 'No positions with both mark and liquidation prices are available.'} />}
        </Panel>
        <Panel title="Latest account snapshots" subtitle="Most recent persisted values by account and product; full captured history is available in Portfolio.">{latestSnapshots.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase text-muted-foreground"><tr>{['As of', 'Product', 'Equity', 'Wallet balance', 'Unrealized P&L', 'Asset'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{latestSnapshots.map(item => <tr key={item.id}><td className="py-3">{new Date(item.asOf).toLocaleString()}</td><td>{productName(item.product)}</td><td>{money(item.equity, item.currency)}</td><td>{money(item.walletBalance, item.currency)}</td><td>{money(item.unrealizedPnl, item.currency)}</td><td>{item.currency}</td></tr>)}</tbody></table></div> : <Empty text="No non-null account snapshot values are available in this selected range." />}</Panel>
      </div>
    </div>}

    {tab === 'Market Context' && <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Market observations" value={filteredMarket.length.toLocaleString()} detail="Persisted Binance data in the selected range" />
        <Metric label="Symbols observed" value={String(new Set(filteredMarket.map(item => `${item.product}:${item.symbol}`)).size)} detail={`${marketMovement.length} symbols with price history`} />
        <Metric label="Funding rate samples" value={String(filteredMarket.filter(item => item.kind === 'funding-rate').length)} detail="Funding rates are separate from funding payments" />
        <Metric label="Market-data endpoints" value={String(marketCoverage.length)} detail={`${marketCoverage.filter(item => item.complete).length} current · history is window-limited`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Panel title="Observed price movement" subtitle="Change from the first to last persisted daily close in the selected range. Markets remain separate; no conversions or regime labels are inferred.">
          {marketMovement.length ? <div className="space-y-4">
            <Chart><BarChart data={marketMovement.slice(0, 12)} layout="vertical" margin={{ left: 8, right: 12 }}><CartesianGrid stroke="var(--border)" horizontal={false} /><XAxis type="number" tickFormatter={value => `${Number(value).toFixed(1)}%`} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis type="category" dataKey="label" width={132} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip content={<MarketMovementTip />} /><ReferenceLine x={0} stroke="var(--muted-foreground)" strokeDasharray="3 3" /><Bar dataKey="changePct" name="Price change" radius={[0, 3, 3, 0]}>{marketMovement.slice(0, 12).map(item => <Cell key={item.key} fill={item.changePct >= 0 ? 'var(--positive)' : 'var(--negative)'} />)}</Bar></BarChart></Chart>
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase text-muted-foreground"><tr>{['Symbol', 'Product', 'First close', 'Latest close', 'Period change', 'High–low range'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{marketMovement.slice(0, 12).map(item => <tr key={item.key}><td className="py-2.5 pr-3 font-mono">{item.symbol}</td><td className="pr-3 text-muted-foreground">{productName(item.product)}</td><td className="pr-3 font-mono">{formatQuantity(item.firstClose, 8)}</td><td className="pr-3 font-mono">{formatQuantity(item.latestClose, 8)}</td><td className={`pr-3 font-mono ${item.changePct > 0 ? 'text-emerald-500' : item.changePct < 0 ? 'text-rose-500' : ''}`}>{item.changePct > 0 ? '+' : ''}{item.changePct.toFixed(2)}%</td><td className="font-mono">{item.rangePct.toFixed(2)}%</td></tr>)}</tbody></table></div>
            <p className="text-[10px] text-muted-foreground">Calculated from stored Binance 1-day candle OHLC data; percentage changes are not account returns.</p>
          </div> : <Empty text="No persisted daily candles match this range yet. Use Update to sync public Binance market history for symbols with account activity." />}
        </Panel>
        <Panel title="Funding rate timeline" subtitle="Stored market funding-rate observations. This is separate from funding payments.">
          {fundingChart.data.length ? <div className="space-y-3">
            <Chart><LineChart data={fundingChart.data}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" interval="preserveStartEnd" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis tickFormatter={value => `${(Number(value) * 100).toFixed(3)}%`} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip content={<FundingRateTip />} />{fundingChart.series.map(item => <Line key={item.key} dataKey={item.key} name={item.label} stroke={item.color} dot={false} connectNulls />)}</LineChart></Chart>
            <div className="flex flex-wrap gap-x-4 gap-y-2">{fundingChart.series.map(item => <span key={item.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>)}</div>
            <p className="text-[10px] text-muted-foreground">Rates are exchange-reported intervals, not a forecast or realized funding payment.</p>
          </div> : <Empty text="No persisted Binance funding-rate observations match this range. Funding applies only to perpetual futures." />}
        </Panel>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Stored symbol price context" subtitle="Inspect one Binance daily close series at a time; use the selector or symbol filter to switch markets.">
          {activePriceObservations.length ? <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
                Market
                <select
                  aria-label="Price chart market"
                  value={activeMarketSymbol}
                  onChange={event => setMarketChartSymbol(event.target.value)}
                  disabled={symbol !== 'All'}
                  className="h-8 min-w-48 rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:opacity-70"
                >
                  {priceSymbols.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              {activeMarketMovement && <div className="flex flex-wrap gap-x-5 gap-y-2 text-right">
                <div><p className="text-[10px] text-muted-foreground">Latest close</p><p className="font-mono text-sm tabular-nums">{formatQuantity(activeMarketMovement.latestClose, 8)}</p></div>
                <div><p className="text-[10px] text-muted-foreground">Selected range</p><p className={`font-mono text-sm tabular-nums ${activeMarketMovement.changePct > 0 ? 'text-emerald-500' : activeMarketMovement.changePct < 0 ? 'text-rose-500' : ''}`}>{activeMarketMovement.changePct > 0 ? '+' : ''}{activeMarketMovement.changePct.toFixed(2)}%</p></div>
                <div><p className="text-[10px] text-muted-foreground">Daily high–low range</p><p className="font-mono text-sm tabular-nums">{activeMarketMovement.rangePct.toFixed(2)}%</p></div>
              </div>}
            </div>
            <Chart><LineChart data={activePriceObservations} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="observedAt" tickFormatter={value => formatDate(String(value))} interval="preserveStartEnd" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} />
              <YAxis width={78} domain={['auto', 'auto']} tickFormatter={value => formatQuantity(Number(value), 4)} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} />
              <Tooltip content={<Tip />} />
              <Line dataKey="price" name={`${activeMarketSymbol} daily close`} stroke="var(--chart-3)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart></Chart>
            <p className="text-[10px] text-muted-foreground">{activePriceObservations.length} persisted daily candles · Binance reported close prices · selected range only</p>
          </div> : <Empty text="No stored daily candles match this market and range." />}
        </Panel>
        <Panel title="Observed candle range" subtitle="Reported daily high and low over the selected period, with no synthetic volatility classification.">
          {marketMovement.length ? <div className="space-y-2">{marketMovement.slice(0, 8).map(item => <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2.5 text-xs"><span className="min-w-0"><span className="font-mono font-medium">{item.symbol}</span><span className="ml-2 text-[10px] text-muted-foreground">{productName(item.product)}</span><span className="mt-1 block text-[10px] text-muted-foreground">Low {formatQuantity(item.low, 8)} · High {formatQuantity(item.high, 8)}</span></span><span className="text-right font-mono tabular-nums">{item.rangePct.toFixed(2)}%<span className="block text-[10px] text-muted-foreground">high–low range</span></span></div>)}</div> : <Empty text="Range data appears after daily Binance candles have been synced." />}
        </Panel>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Stored market observations" subtitle="Persisted candle, mark, index, funding-rate, and other market records.">
          {filteredMarket.length ? <div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="sticky top-0 border-b border-border bg-card text-[10px] uppercase text-muted-foreground"><tr>{['Time', 'Symbol', 'Product', 'Type', 'Value'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{[...filteredMarket].sort((a, b) => b.observedAt.localeCompare(a.observedAt)).map(item => <tr key={`${item.product}:${item.symbol}:${item.kind}:${item.observedAt}`}><td className="py-3">{new Date(item.observedAt).toLocaleString()}</td><td className="font-mono">{item.symbol}</td><td>{productName(item.product)}</td><td>{item.kind}</td><td>{item.close !== undefined ? money(item.close) : money(item.value)}</td></tr>)}</tbody></table></div> : <Empty text="No market observations are stored for this selection." />}
        </Panel>
        <Panel title="Market-data coverage" subtitle="Coverage is limited to symbols with stored account activity. Daily candles cover one year; perpetual funding history covers 90 days.">
          {marketCoverage.length ? <div className="max-h-[420px] space-y-2 overflow-auto">{marketCoverage.map(item => <div key={`${item.accountId}:${item.product}:${item.endpoint}`} className="rounded border border-border p-3 text-xs"><div className="flex items-center justify-between gap-3"><span className="truncate font-mono">{item.endpoint.replace('market/', '')}</span><span className={item.complete ? 'text-emerald-500' : 'text-amber-500'}>{item.complete ? 'Synced' : 'Partial'}</span></div><p className="mt-1 text-[10px] text-muted-foreground">{productName(item.product)} · {item.recordCount} observations · {item.missingPeriods.join(' ') || 'Current window captured'}</p></div>)}</div> : <Empty text="No market-data sync coverage is recorded. Use Update to fetch Binance market history for symbols with account activity." />}
        </Panel>
      </div>
    </div>}

    {tab === 'Portfolio' && <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Latest reported equity" value={latestEquitySummary} detail={latestEquitySnapshots.length === 1 ? `${productName(latestEquitySnapshots[0].product)} · Binance snapshot` : `${latestEquitySnapshots.length} account/product snapshots · not combined`} />
        <Metric label="Non-zero balance rows" value={String(nonZeroBalanceCount)} detail={`${zeroBalanceCount.toLocaleString()} confirmed zero balances hidden`} />
        <Metric label="Assets represented" value={String(new Set(accountBalances.filter(hasNonZeroBalance).map(item => item.asset)).size)} detail="Native asset units are not combined" />
        <Metric label="Exchange valuations" value={String(accountBalances.filter(item => item.valuation !== null).length)} detail="Valuations supplied by Binance" />
      </div>
      <Panel title="Current asset balances" subtitle="Persisted Binance amounts in native asset units. Missing values remain unavailable; no valuation is inferred.">
        {accountBalances.length ? <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="sr-only">Search assets</span>
              <input value={balanceSearch} onChange={event => setBalanceSearch(event.target.value)} placeholder="Search asset" className="h-8 w-40 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground" />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={showZeroBalances} onChange={event => setShowZeroBalances(event.target.checked)} className="size-3.5 accent-foreground" />
              Show zero balances ({zeroBalanceCount})
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground">Showing {visibleBalances.length.toLocaleString()} of {accountBalances.length.toLocaleString()} records · values as of the latest account sync</p>
          {visibleBalances.length ? <div className="max-h-[420px] overflow-auto rounded-md border border-border">
            <table className="w-full min-w-[820px] table-fixed text-left text-xs">
              <colgroup><col className="w-[110px]" /><col className="w-[150px]" /><col className="w-[150px]" /><col className="w-[140px]" /><col className="w-[150px]" /><col className="w-[130px]" /><col className="w-[120px]" /></colgroup>
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/70 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>{['Asset', 'Product', 'Available', 'Locked', 'Total', 'Valuation', 'As of'].map(item => <th key={item} className="px-3 py-2.5 font-medium">{item}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleBalances.map(item => <tr key={`${item.accountId}:${item.product ?? 'unknown'}:${item.asset}`} className="transition-colors hover:bg-muted/40">
                  <td className="px-3 py-2.5 font-mono font-medium">{item.asset}</td>
                  <td className="px-3 py-2.5 text-[10px] text-muted-foreground">{item.product ? productName(item.product) : 'Unavailable'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{quantity(item.free, item.asset)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{quantity(item.locked, item.asset)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium tabular-nums">{quantity(item.free === null || item.locked === null ? null : item.free + item.locked, item.asset)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{money(item.valuation, item.valuationCurrency)}</td>
                  <td className="px-3 py-2.5"><span className="block whitespace-nowrap text-[10px]">{Number.isFinite(Date.parse(item.asOf)) ? new Date(item.asOf).toLocaleDateString() : '—'}</span><span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] text-muted-foreground">{Number.isFinite(Date.parse(item.asOf)) ? new Date(item.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</span></td>
                </tr>)}
              </tbody>
            </table>
          </div> : <div className="grid min-h-32 place-items-center rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">{balanceSearch ? 'No assets match this search.' : 'No non-zero balances are reported. Enable “Show zero balances” to inspect all persisted assets.'}</div>}
        </div> : <Empty text="No Binance balances have been synced for enabled accounts." />}
        {accountBalances.some(item => item.valuation !== null) ? <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-medium">Exchange-reported valuation coverage</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{groupBalancesByValuationCurrency(accountBalances).map(group => <div key={group.currency} className="rounded-md border border-border bg-muted/20 p-3"><p className="text-[10px] font-medium text-muted-foreground">{group.currency} valuations</p><Chart><PieChart><Pie data={group.rows.map(item => ({ name: `${item.asset} · ${item.product ?? 'unknown'}`, value: item.valuation ?? 0 }))} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85}>{group.rows.map((item, index) => <Cell key={`${item.accountId}:${item.product ?? 'unknown'}:${item.asset}:${index}`} fill={['#18181b', '#52525b', '#a1a1aa', '#d4d4d8', '#71717a'][index % 5]} />)}</Pie><Tooltip content={<Tip moneyValues asset={group.currency.startsWith('Unspecified') ? undefined : group.currency} />} /></PieChart></Chart></div>)}</div>
        </div> : <p className="mt-3 text-[10px] text-muted-foreground">Binance has not supplied valuations for these balances; native quantities above are not converted.</p>}
      </Panel>
      <Panel title="Portfolio equity history" subtitle="Exchange-reported snapshots, kept separate by account, product, and currency. No balances are combined or history reconstructed.">
        {portfolioSnapshotGroups.length ? <div className="space-y-6">{portfolioSnapshotGroups.map(group => {
          const domain = snapshotValueDomain(group.data)
          const range = snapshotValueRange(group.data)
          const latest = group.data.at(-1)
          const unchanged = range.min === range.max
          return <div key={group.key} className="rounded-md border border-border bg-muted/10 p-3 sm:p-4">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-medium">{group.label}</p><p className="mt-1 text-[10px] text-muted-foreground">{group.data.length.toLocaleString()} persisted captures · {group.data[0]?.label} – {latest?.label}</p></div>
              <div className="text-right"><p className="font-mono text-sm font-medium tabular-nums">{money(latest?.equity, group.currency)}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{unchanged ? 'No recorded change in this range' : `Observed range ${money(range.min, group.currency)} – ${money(range.max, group.currency)}`}</p></div>
            </div>
            <Chart><LineChart data={group.data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={32} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} />
              <YAxis width={92} domain={domain} tickFormatter={value => formatMoney(Number(value), { asset: group.currency })} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} />
              <Tooltip content={<Tip moneyValues asset={group.currency} />} />
              <Line dataKey="equity" name="Reported equity" stroke="var(--chart-3)" strokeWidth={2} dot={group.data.length < 2 ? { r: 3 } : false} activeDot={{ r: 4 }} />
            </LineChart></Chart>
            <p className="mt-1 text-[10px] text-muted-foreground">Vertical scale is fitted to the observed range; values are Binance-reported, not an account return calculation.</p>
          </div>
        })}</div> : <Empty text="No historical equity snapshots are stored for this selection." />}
      </Panel>
      <Panel title="Latest account snapshots" subtitle="Most recent exchange-reported state per account and product. The chart above retains the full captured history.">{latestSnapshots.length ? <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[860px] table-fixed text-xs">
          <colgroup><col className="w-[150px]" /><col className="w-[150px]" /><col className="w-[150px]" /><col className="w-[150px]" /><col className="w-[150px]" /><col className="w-[110px]" /><col className="w-[100px]" /></colgroup>
          <thead className="border-b border-border bg-muted/70 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>{['As of', 'Account', 'Product', 'Equity', 'Wallet balance', 'Unrealized P&L', 'Asset'].map(item => <th key={item} className="px-3 py-2.5 font-medium">{item}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">{[...latestSnapshots].sort((a, b) => b.asOf.localeCompare(a.asOf)).map(item => <tr key={item.id} className="transition-colors hover:bg-muted/40">
            <td className="px-3 py-2.5"><span className="block whitespace-nowrap">{Number.isFinite(Date.parse(item.asOf)) ? new Date(item.asOf).toLocaleDateString() : '—'}</span><span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] text-muted-foreground">{Number.isFinite(Date.parse(item.asOf)) ? new Date(item.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}</span></td>
            <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">···{item.accountId.slice(-4)}</td>
            <td className="px-3 py-2.5 text-[10px] text-muted-foreground">{productName(item.product)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium tabular-nums">{money(item.equity, item.currency)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{money(item.walletBalance, item.currency)}</td>
            <td className={`whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums ${item.unrealizedPnl === null || item.unrealizedPnl === 0 ? 'text-muted-foreground' : item.unrealizedPnl > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{money(item.unrealizedPnl, item.currency)}</td>
            <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground">{item.currency}</td>
          </tr>)}</tbody>
        </table>
      </div> : <Empty text="No account snapshots match this selection." />}</Panel>
    </div>}

    {tab === 'Psychology' && <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Binance executions" value={executions.length.toLocaleString()} detail="Real fills in the selected range" />
        <Metric label="Realized P&L" value={realizedSummary.value} detail={realizedSummary.detail} tone={realizedSummary.tone} />
        <Metric label="Trading commissions" value={commissionSummary.value} detail={commissionSummary.detail} tone={commissionSummary.tone} />
        <Metric label="Funding payments" value={fundingSummary.value} detail={fundingSummary.detail} tone={fundingSummary.tone} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Recent exchange executions" subtitle={`Newest ${Math.min(executions.length, 20).toLocaleString()} of ${executions.length.toLocaleString()} persisted Binance fills. Quantities and fees stay in their reported units.`}>
          {executions.length ? <div className="max-h-[420px] overflow-auto rounded-md border border-border">
            <table className="w-full min-w-[540px] table-fixed text-xs">
              <colgroup><col className="w-[130px]" /><col className="w-[140px]" /><col className="w-[70px]" /><col className="w-[95px]" /><col className="w-[105px]" /></colgroup>
              <thead className="sticky top-0 border-b border-border bg-muted/70 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>{['Time', 'Symbol / product', 'Side', 'Quantity', 'Fee / asset'].map(item => <th key={item} className="px-3 py-2.5 font-medium">{item}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">{[...executions].sort((a, b) => b.executedAt.localeCompare(a.executedAt)).slice(0, 20).map(item => {
                const side = item.side.toUpperCase()
                const sideTone = ['BUY', 'LONG'].includes(side) ? 'text-emerald-500' : ['SELL', 'SHORT'].includes(side) ? 'text-rose-500' : 'text-muted-foreground'
                const timestamp = Date.parse(item.executedAt)
                return <tr key={item.id} className="transition-colors hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2.5"><span className="block truncate font-mono font-medium">{item.symbol}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{productName(item.product)}</span></td>
                  <td className={`px-3 py-2.5 font-medium ${sideTone}`}>{item.side || 'Unavailable'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{formatQuantity(item.quantity)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right"><span className="block font-mono tabular-nums">{money(item.commission, item.commissionAsset)}</span><span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{item.commissionAsset ?? 'Unavailable'}</span></td>
                </tr>
              })}</tbody>
            </table>
          </div> : <Empty text="No persisted Binance executions match these filters." />}
        </Panel>
        <Panel title="Exchange-reported outcomes" subtitle="Actual realized P&L, commission, and funding totals. Different assets are not combined.">
          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            {[
              { label: 'Realized P&L', rows: realizedByAsset },
              { label: 'Commissions', rows: commissionsByAsset },
              { label: 'Funding', rows: fundingByAsset },
            ].map(group => <div key={group.label}>
              <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h3>
              {group.rows.length ? <div className="max-h-40 space-y-2 overflow-auto"><AmountTable rows={group.rows} /></div> : <p className="rounded-md border border-dashed border-border px-3 py-3 text-[11px] text-muted-foreground">No matching records</p>}
            </div>)}
          </div>
        </Panel>
      </div>
      <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-medium">Manual journal signals</h2><p className="mt-1 text-[11px] text-muted-foreground">Notes, tags, and review marks are user-entered. Binance activity is not treated as behavioral data.</p></div>
          <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground">Separate from exchange records</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Journal entries" value={String(manual.length)} detail="Manual records in range" />
          <Metric label="Entries with notes" value={String(manual.filter(item => item.note.trim()).length)} detail="User-written observations" />
          <Metric label="Entries with strategy" value={String(manual.filter(item => item.strategy.trim()).length)} detail="User-entered labels" />
          <Metric label="Review marked" value={String(manual.filter(item => item.reviewed).length)} detail="Explicit review marks" />
        </div>
        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          <div className="rounded-md border border-border/70 p-3">
            <h3 className="text-xs font-medium">Journal observations</h3>
            {manual.some(item => item.note.trim()) ? <div className="mt-3 max-h-[320px] space-y-2 overflow-auto">{manual.filter(item => item.note.trim()).sort((a, b) => b.closed.localeCompare(a.closed)).map(item => <article key={item.id} className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs"><div className="flex justify-between gap-3"><span className="font-medium">{item.symbol} · {item.side}</span><span className="text-muted-foreground">{new Date(item.closed).toLocaleString()}</span></div><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{item.note}</p></article>)}</div> : <div className="mt-3"><Empty text="No notes on the selected manual entries." /></div>}
          </div>
          <div className="grid gap-5">
            <div className="rounded-md border border-border/70 p-3">
              <h3 className="text-xs font-medium">Journal tag distribution</h3>
              <p className="mt-1 text-[10px] text-muted-foreground">Only tags explicitly saved on manual entries.</p>
              {journalTags.length ? <div className="mt-3"><Chart><BarChart data={journalTags} layout="vertical" margin={{ left: 8 }}><CartesianGrid stroke="var(--border)" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><YAxis type="category" dataKey="label" width={90} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip content={<Tip />} /><Bar dataKey="count" name="Tagged entries" fill="var(--chart-3)" radius={[0, 3, 3, 0]} /></BarChart></Chart></div> : <div className="mt-3"><Empty text="No manual tags recorded for this selection." /></div>}
            </div>
            <div className="rounded-md border border-border/70 bg-muted/10 p-3">
              <h3 className="text-xs font-medium">Behavioral analysis unavailable</h3>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Emotional state, rule adherence, and mistake labels are not stored. No behavior score or cause-and-effect conclusion is inferred from exchange trades.</p>
            </div>
          </div>
        </div>
      </section>
    </div>}
  </div>
}

function groupAmounts(rows: { product: Product | 'wallet'; asset: string; amount: number | null }[]) {
  const amounts = new Map<string, { product: Product | 'wallet'; asset: string; amount: number }>()
  rows.forEach(row => {
    if (row.amount === null) return
    const key = `${row.product}:${row.asset}`
    const group = amounts.get(key) ?? { product: row.product, asset: row.asset, amount: 0 }
    group.amount += row.amount
    amounts.set(key, group)
  })
  return [...amounts.values()]
}

function summarizeAmounts(rows: { product: Product | 'wallet'; asset: string; amount: number }[], eventCount: number, label: string) {
  if (!rows.length) {
    return { value: 'Unavailable', detail: `No exchange-reported ${label} in this selection`, tone: 'neutral' as const }
  }
  if (rows.length > 1) {
    return { value: 'Multiple units', detail: `${rows.length} separate product / asset totals · no conversion`, tone: 'neutral' as const }
  }

  const [row] = rows
  return {
    value: formatMoney(row.amount, { asset: row.asset, signed: true, unavailable: 'Unavailable' }),
    detail: `${eventCount} events · ${productName(row.product)} · ${row.asset}`,
    tone: row.amount > 0 ? 'positive' as const : row.amount < 0 ? 'negative' as const : 'neutral' as const,
  }
}

function buildRealizedCharts(events: FinancialEvent[]): RealizedAssetChart[] {
  const seriesByAsset = new Map<string, Map<string, RealizedSeries>>()
  const amountsByAssetDate = new Map<string, Map<string, Map<string, number>>>()
  const colors = ['#16a34a', '#2563eb', '#d97706', '#9333ea', '#0891b2', '#dc2626']

  for (const event of events) {
    if (event.amount === null) continue
    const time = Date.parse(event.occurredAt)
    if (!Number.isFinite(time)) continue
    const date = new Date(time).toISOString().slice(0, 10)
    const key = `${event.product}:${event.asset}`
    const assetSeries = seriesByAsset.get(event.asset) ?? new Map<string, RealizedSeries>()
    if (!assetSeries.has(key)) {
      const colorIndex = assetSeries.size % colors.length
      assetSeries.set(key, {
        key,
        name: productName(event.product),
        asset: event.asset,
        color: colors[colorIndex],
      })
    }
    seriesByAsset.set(event.asset, assetSeries)

    const dates = amountsByAssetDate.get(event.asset) ?? new Map<string, Map<string, number>>()
    const daily = dates.get(date) ?? new Map<string, number>()
    daily.set(key, (daily.get(key) ?? 0) + event.amount)
    dates.set(date, daily)
    amountsByAssetDate.set(event.asset, dates)
  }

  return [...seriesByAsset.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([asset, assetSeries]) => {
    const cumulative = new Map<string, number>()
    const data = [...(amountsByAssetDate.get(asset) ?? new Map()).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dailyAmounts]) => {
        const daily: Record<string, number> = {}
        const total: Record<string, number> = {}
        for (const item of assetSeries.values()) {
          const value = dailyAmounts.get(item.key) ?? 0
          daily[item.key] = value
          cumulative.set(item.key, (cumulative.get(item.key) ?? 0) + value)
          total[item.key] = cumulative.get(item.key) ?? 0
        }
        return { date, label: formatDate(date), daily, cumulative: total }
      })
    return { asset, series: [...assetSeries.values()], data }
  })
}

function groupExecutions(rows: TradingRepositorySnapshot['executions']) {
  const grouped = new Map<string, { key: string; symbol: string; product: Product; count: number; quantity: number | null }>()
  rows.forEach(row => {
    const key = `${row.product}:${row.symbol}`
    const current = grouped.get(key) ?? { key, symbol: row.symbol, product: row.product, count: 0, quantity: 0 }
    current.count += 1
    current.quantity = current.quantity === null || row.quantity === null ? null : current.quantity + row.quantity
    grouped.set(key, current)
  })
  return [...grouped.values()].sort((a, b) => b.count - a.count)
}

function groupRealizedBySymbol(events: FinancialEvent[]) {
  const grouped = new Map<string, { key: string; product: Product | 'wallet'; asset: string; symbol?: string; amount: number; count: number }>()
  for (const event of events) {
    if (event.amount === null) continue
    const key = `${event.product}:${event.asset}:${event.symbol ?? ''}`
    const current = grouped.get(key) ?? {
      key,
      product: event.product,
      asset: event.asset,
      symbol: event.symbol,
      amount: 0,
      count: 0,
    }
    current.amount += event.amount
    current.count += 1
    grouped.set(key, current)
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || Math.abs(b.amount) - Math.abs(a.amount))
}

function buildRealizedDrawdown(charts: RealizedAssetChart[]) {
  return charts.map(chart => {
    let peak = 0
    const data = chart.data.map(point => {
      const cumulative = Object.values(point.cumulative).reduce((sum, value) => sum + value, 0)
      peak = Math.max(peak, cumulative)
      return { date: point.date, label: point.label, drawdown: cumulative - peak }
    })
    return { asset: chart.asset, data }
  })
}

function groupEventsByWeekday(events: FinancialEvent[]) {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const counts = new Map<number, number>()
  for (const event of events) {
    const time = Date.parse(event.occurredAt)
    if (Number.isFinite(time)) {
      const weekday = new Date(time).getUTCDay()
      counts.set(weekday, (counts.get(weekday) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([day, count]) => ({ label: weekdays[day], count }))
}

function groupEventsByUtcHour(events: FinancialEvent[]) {
  const counts = new Map<number, number>()
  for (const event of events) {
    const time = Date.parse(event.occurredAt)
    if (Number.isFinite(time)) {
      const hour = new Date(time).getUTCHours()
      counts.set(hour, (counts.get(hour) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort(([a], [b]) => a - b).map(([hour, count]) => ({ label: `${String(hour).padStart(2, '0')}:00`, count }))
}

function groupRealizedByMonth(events: FinancialEvent[]) {
  const groups = new Map<string, { key: string; month: string; product: Product | 'wallet'; asset: string; amount: number; count: number }>()
  for (const event of events) {
    if (event.amount === null) continue
    const time = Date.parse(event.occurredAt)
    if (!Number.isFinite(time)) continue
    const month = new Date(time).toISOString().slice(0, 7)
    const key = `${month}:${event.product}:${event.asset}`
    const group = groups.get(key) ?? { key, month, product: event.product, asset: event.asset, amount: 0, count: 0 }
    group.amount += event.amount
    group.count += 1
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.month.localeCompare(a.month) || a.product.localeCompare(b.product) || a.asset.localeCompare(b.asset))
}

function groupFinancialComponents(events: FinancialEvent[]) {
  const groups = new Map<string, { key: string; type: string; product: Product | 'wallet'; asset: string; amount: number; count: number }>()
  for (const event of events) {
    if (event.amount === null) continue
    const key = `${event.type}:${event.product}:${event.asset}`
    const group = groups.get(key) ?? { key, type: event.type, product: event.product, asset: event.asset, amount: 0, count: 0 }
    group.amount += event.amount
    group.count += 1
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => a.type.localeCompare(b.type) || a.product.localeCompare(b.product) || a.asset.localeCompare(b.asset))
}

function groupManualDurations(trades: JournalTrade[]) {
  const buckets = [
    { label: '<5m', min: 0, max: 5 },
    { label: '5–30m', min: 5, max: 30 },
    { label: '30m–2h', min: 30, max: 120 },
    { label: '2–8h', min: 120, max: 480 },
    { label: '8–24h', min: 480, max: 1440 },
    { label: '>24h', min: 1440, max: Infinity },
  ]
  const minutes = trades.map(trade => parseDurationMinutes(trade.duration)).filter((value): value is number => value !== null)
  return buckets.map(bucket => ({ label: bucket.label, count: minutes.filter(value => value >= bucket.min && value < bucket.max).length })).filter(item => item.count > 0)
}

function parseDurationMinutes(value: string) {
  const hours = value.match(/(\d+(?:\.\d+)?)\s*h/i)
  const minutes = value.match(/(\d+(?:\.\d+)?)\s*m/i)
  if (!hours && !minutes) return null
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)
  return Number.isFinite(total) ? total : null
}

function groupExecutionSides(rows: TradingRepositorySnapshot['executions']) {
  const groups = new Map<string, { label: string; count: number; quantity: number | null }>()
  for (const row of rows) {
    const label = row.side || 'Unavailable'
    const group = groups.get(label) ?? { label, count: 0, quantity: 0 }
    group.count += 1
    group.quantity = group.quantity === null || row.quantity === null ? null : group.quantity + row.quantity
    groups.set(label, group)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

function groupMakerTaker(rows: TradingRepositorySnapshot['executions']) {
  const groups = new Map<string, number>()
  for (const row of rows) {
    const label = row.isMaker === undefined ? 'Unavailable' : row.isMaker ? 'Maker' : 'Taker'
    groups.set(label, (groups.get(label) ?? 0) + 1)
  }
  return [...groups.entries()].map(([label, count]) => ({ label, count }))
}

function groupPositionLeverage(rows: TradingRepositorySnapshot['positions']) {
  const groups = new Map<string, number>()
  for (const row of rows) {
    const label = row.leverage === null ? `Unavailable · ${productName(row.product)}` : `${row.leverage}× · ${productName(row.product)}`
    groups.set(label, (groups.get(label) ?? 0) + 1)
  }
  return [...groups.entries()].map(([label, count]) => ({ label, count }))
}

function groupJournalTags(trades: JournalTrade[]) {
  const counts = new Map<string, number>()
  for (const trade of trades) {
    for (const tag of new Set((trade.tags ?? []).map(item => item.trim()).filter(Boolean))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

function groupExecutionFeesBySymbol(rows: TradingRepositorySnapshot['executions']) {
  const groups = new Map<string, { key: string; product: Product; asset: string; symbol: string; amount: number }>()
  for (const row of rows) {
    if (row.commission === null) continue
    const asset = row.commissionAsset ?? 'Unknown asset'
    const key = `${row.product}:${asset}:${row.symbol}`
    const group = groups.get(key) ?? { key, product: row.product, asset, symbol: row.symbol, amount: 0 }
    group.amount += row.commission
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

function groupOrdersByStatus(rows: TradingRepositorySnapshot['orders']) {
  const statuses = new Map<string, number>()
  for (const row of rows) statuses.set(row.status || 'Unavailable', (statuses.get(row.status || 'Unavailable') ?? 0) + 1)
  return [...statuses.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count)
}

function groupBalancesByValuationCurrency(rows: TradingRepositorySnapshot['balances']) {
  const groups = new Map<string, { currency: string; rows: TradingRepositorySnapshot['balances'] }>()
  for (const row of rows) {
    if (row.valuation === null) continue
    const currency = row.valuationCurrency.trim()
    const key = currency || `unknown:${row.accountId}:${row.product ?? 'unknown'}:${row.asset}`
    const label = currency || `Unspecified currency · ${row.asset}`
    const group = groups.get(key) ?? { currency: label, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function isZeroBalance(balance: TradingRepositorySnapshot['balances'][number]) {
  const amounts = balance.product === 'margin'
    ? [balance.free, balance.locked, balance.borrowed, balance.interest]
    : [balance.free, balance.locked]
  return amounts.every(value => value !== null && value === 0)
    && (balance.valuation === null || balance.valuation === 0)
}

function hasNonZeroBalance(balance: TradingRepositorySnapshot['balances'][number]) {
  const amounts = [balance.free, balance.locked, balance.borrowed, balance.interest, balance.valuation]
  return amounts.some(value => value !== null && value !== 0)
}

function quantity(value: number | null, asset: string) {
  return value === null ? 'Unavailable' : `${formatQuantity(value, 12)} ${asset}`
}

function snapshotValueRange(rows: { equity: number }[]) {
  return rows.reduce((range, row) => Number.isFinite(row.equity)
    ? { min: Math.min(range.min, row.equity), max: Math.max(range.max, row.equity) }
    : range, { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY })
}

function snapshotValueDomain(rows: { equity: number }[]): [number, number] {
  const range = snapshotValueRange(rows)
  const min = Number.isFinite(range.min) ? range.min : 0
  const max = Number.isFinite(range.max) ? range.max : 0
  const padding = min === max ? Math.max(Math.abs(min) * 0.01, 0.01) : (max - min) * 0.08
  return [min - padding, max + padding]
}

function groupSnapshotHistories(rows: TradingRepositorySnapshot['snapshots']) {
  const groups = new Map<string, { key: string; label: string; currency: string; data: { label: string; equity: number }[] }>()
  for (const row of [...rows].sort((a, b) => a.asOf.localeCompare(b.asOf))) {
    if (row.equity === null) continue
    const key = `${row.accountId}:${row.product}:${row.currency}`
    const group = groups.get(key) ?? {
      key,
      label: `${productName(row.product)} · ${row.currency} · account …${row.accountId.slice(-4)}`,
      currency: row.currency,
      data: [],
    }
    group.data.push({
      label: new Date(row.asOf).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      equity: row.equity,
    })
    groups.set(key, group)
  }
  return [...groups.values()]
}

function hasSnapshotValues(snapshot: TradingRepositorySnapshot['snapshots'][number]) {
  return [snapshot.walletBalance, snapshot.equity, snapshot.unrealizedPnl, snapshot.marginBalance]
    .some(value => value !== null)
}

function latestSnapshotPerAccountProduct(rows: TradingRepositorySnapshot['snapshots']) {
  const latest = new Map<string, TradingRepositorySnapshot['snapshots'][number]>()
  for (const row of [...rows].sort((a, b) => a.asOf.localeCompare(b.asOf))) {
    latest.set(`${row.accountId}:${row.product}`, row)
  }
  return [...latest.values()].sort((a, b) => b.asOf.localeCompare(a.asOf))
}

function latestPositionRiskCoverage(rows: Coverage[]) {
  const latest = new Map<string, Coverage>()
  for (const row of rows) {
    if (!row.endpoint.endsWith('/positionRisk')) continue
    const key = `${row.accountId}:${row.product}`
    const current = latest.get(key)
    if (!current || (row.latest ?? '') > (current.latest ?? '')) latest.set(key, row)
  }
  return [...latest.values()].sort((a, b) => a.product.localeCompare(b.product) || a.accountId.localeCompare(b.accountId))
}

function summarizeMarketMovement(rows: (TradingRepositorySnapshot['market'][number] & { price: number })[]) {
  const groups = new Map<string, (TradingRepositorySnapshot['market'][number] & { price: number })[]>()
  for (const row of rows) {
    const key = `${row.product}:${row.symbol}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].flatMap(([key, observations]) => {
    const sorted = observations.slice().sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    const first = sorted[0]
    const last = sorted.at(-1)
    if (!first || !last || first.price <= 0) return []
    const highs = sorted.map(item => item.high ?? item.price).filter(Number.isFinite)
    const lows = sorted.map(item => item.low ?? item.price).filter(value => Number.isFinite(value) && value > 0)
    const high = Math.max(...highs)
    const low = Math.min(...lows)
    return [{
      key,
      symbol: first.symbol,
      product: first.product,
      label: `${first.symbol} · ${productName(first.product)}`,
      firstClose: first.price,
      latestClose: last.price,
      changePct: (last.price / first.price - 1) * 100,
      high,
      low,
      rangePct: (high / low - 1) * 100,
      observations: sorted.length,
    }]
  }).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
}

function buildFundingRateSeries(rows: TradingRepositorySnapshot['market']) {
  const groups = new Map<string, { key: string; label: string; points: { observedAt: string; value: number }[] }>()
  for (const row of rows) {
    if (row.kind !== 'funding-rate' || row.value === null || row.value === undefined) continue
    const key = `${row.product}:${row.symbol}`
    const group = groups.get(key) ?? { key, label: `${row.symbol} · ${productName(row.product)}`, points: [] }
    group.points.push({ observedAt: row.observedAt, value: row.value })
    groups.set(key, group)
  }
  const series = [...groups.values()]
    .sort((a, b) => b.points.length - a.points.length)
    .slice(0, 8)
    .map((group, index) => ({ key: `rate${index}`, label: group.label, points: group.points }))
  const merged = new Map<string, Record<string, string | number>>()
  for (const item of series) {
    for (const point of item.points) {
      const current = merged.get(point.observedAt) ?? {
        timestamp: point.observedAt,
        label: formatDate(point.observedAt),
      }
      current[item.key] = point.value
      merged.set(point.observedAt, current)
    }
  }
  return {
    data: [...merged.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))),
    series: series.map(({ key, label }) => ({ key, label, color: `var(--chart-${3 + (Number(key.slice(4)) % 3)})` })),
  }
}

function groupPositionNotional(rows: TradingRepositorySnapshot['positions']) {
  const groups = new Map<Product, { product: Product; amount: number }>()
  for (const row of rows) {
    if (row.notional === null) continue
    const group = groups.get(row.product) ?? { product: row.product, amount: 0 }
    group.amount += Math.abs(row.notional)
    groups.set(row.product, group)
  }
  return [...groups.values()]
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">{label}<select value={value} onChange={event => onChange(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground">{options.map(item => <option key={item}>{item}</option>)}</select></label>
}

function Metric({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const toneClass = tone === 'positive' ? 'text-emerald-500' : tone === 'negative' ? 'text-rose-500' : 'text-foreground'
  return <div className="rounded-lg border border-border bg-card p-4"><p className="text-[11px] text-muted-foreground">{label}</p><p className={`mt-2 truncate font-mono text-lg ${toneClass}`}>{value}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p></div>
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-border bg-card p-4 sm:p-5"><h2 className="text-sm font-medium">{title}</h2><p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p><div className="mt-4">{children}</div></section>
}

function Empty({ text }: { text: string }) {
  return <div className="grid min-h-28 place-items-center rounded-md border border-dashed border-border bg-muted/10 px-4 text-center text-xs text-muted-foreground"><span className="flex flex-col items-center gap-2"><Activity aria-hidden="true" className="size-4 opacity-60" /><span>{text}</span></span></div>
}

function Chart({ children }: { children: React.ReactNode }) {
  return <div className="h-[240px] w-full min-w-0"><ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer></div>
}

function Tip({ active, payload, label, moneyValues = false, asset }: { active?: boolean; payload?: { name?: string; value?: number }[]; label?: string; moneyValues?: boolean; asset?: string }) {
  if (!active || !payload?.length) return null
  return <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg"><p className="font-medium">{label}</p>{payload.map((item, index) => <p key={`${item.name}:${index}`} className="font-mono">{item.name}: {item.value == null ? 'Unavailable' : moneyValues ? formatMoney(item.value, { asset }) : formatQuantity(item.value, 4)}</p>)}</div>
}

function MarketMovementTip({ active, payload }: { active?: boolean; payload?: { payload?: { label?: string; firstClose?: number; latestClose?: number; changePct?: number; rangePct?: number } }[] }) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  return <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
    <p className="font-medium">{item.label}</p>
    <p className="font-mono">Period change: {item.changePct === undefined ? 'Unavailable' : `${item.changePct > 0 ? '+' : ''}${item.changePct.toFixed(2)}%`}</p>
    <p className="font-mono">High–low range: {item.rangePct === undefined ? 'Unavailable' : `${item.rangePct.toFixed(2)}%`}</p>
    <p className="mt-1 text-[10px] text-muted-foreground">Close: {formatQuantity(item.firstClose, 8)} → {formatQuantity(item.latestClose, 8)}</p>
  </div>
}

function FundingRateTip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
    <p className="mb-1 font-medium">{label}</p>
    {payload.filter(item => item.value !== undefined).map(item => <p key={item.name} className="font-mono" style={{ color: item.color }}>
      {item.name}: {((item.value ?? 0) * 100).toFixed(4)}%
    </p>)}
  </div>
}

function RealizedTip({ active, payload, label, asset, daily = false }: {
  active?: boolean
  payload?: { name?: string; value?: number; color?: string }[]
  label?: string
  asset: string
  daily?: boolean
}) {
  if (!active || !payload?.length) return null
  return <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
    <p className="mb-1 font-medium">{label}</p>
    {payload.map((item, index) => <p key={`${item.name}:${index}`} className="font-mono" style={{ color: item.color }}>
      {item.name}: {formatMoney(item.value, { asset, signed: true, unavailable: 'Unavailable' })}
    </p>)}
    <p className="mt-1 text-[10px] text-muted-foreground">{daily ? 'Daily realized P&L' : 'Cumulative realized P&L'}</p>
  </div>
}

function AmountTable({ rows }: { rows: { product: Product | 'wallet'; asset: string; amount: number }[] }) {
  return <div className="space-y-2">{rows.map(item => {
    const tone = item.amount > 0 ? 'positive' : item.amount < 0 ? 'negative' : 'neutral'
    const valueClass = tone === 'positive' ? 'text-emerald-500' : tone === 'negative' ? 'text-rose-500' : 'text-foreground'
    return <div key={`${item.product}:${item.asset}`} className="flex items-center justify-between gap-4 rounded-md border border-border/70 bg-muted/20 px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${tone === 'positive' ? 'bg-emerald-500' : tone === 'negative' ? 'bg-rose-500' : 'bg-muted-foreground'}`} />
        <div className="min-w-0"><p className="truncate text-xs font-medium">{productName(item.product)}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{item.asset}</p></div>
      </div>
      <span className={`shrink-0 font-mono text-sm tabular-nums ${valueClass}`}>{money(item.amount, item.asset)}</span>
    </div>
  })}</div>
}

function EventTable({ events }: { events: FinancialEvent[] }) {
  return <div className="max-h-64 overflow-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="sticky top-0 border-b border-border bg-card text-[10px] uppercase text-muted-foreground"><tr>{['Time', 'Type', 'Asset', 'Amount', 'Symbol'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{events.map((item, index) => <tr key={`${item.accountId}:${item.product}:${item.id}:${item.occurredAt}:${index}`}><td className="py-2">{new Date(item.occurredAt).toLocaleString()}</td><td>{item.type}</td><td>{item.asset}</td><td>{money(item.amount, item.asset)}</td><td>{item.symbol ?? '—'}</td></tr>)}</tbody></table></div>
}

function PositionTable({ positions }: { positions: TradingRepositorySnapshot['positions'] }) {
  return positions.length ? <div className="overflow-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase text-muted-foreground"><tr>{['Symbol', 'Product', 'Side', 'Quantity', 'Entry', 'Mark', 'Notional', 'Unrealized P&L', 'Liquidation'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{positions.map(item => <tr key={item.id}><td className="py-3 font-mono">{item.symbol}</td><td>{productName(item.product)}</td><td>{item.positionSide ?? 'Unavailable'}</td><td>{formatQuantity(item.quantity)}</td><td>{money(item.entryPrice)}</td><td>{money(item.markPrice)}</td><td>{money(item.notional)}</td><td>{money(item.unrealizedPnl)}</td><td>{money(item.liquidationPrice)}</td></tr>)}</tbody></table></div> : <Empty text="No position-risk records are stored." />
}
