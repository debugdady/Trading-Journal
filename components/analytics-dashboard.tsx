'use client'

import { useMemo, useState } from 'react'
import { Activity, Download } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import type { JournalTrade } from '@/lib/trading/manual-journal'
import type { FinancialEvent, Product, TradingRepositorySnapshot } from '@/lib/trading/types'
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
  const manual = useMemo(() => trades.filter(trade => {
    const market = products.find(item => item.label === product)?.value
    return matchesDate(trade.closed)
      && (product === 'All' || trade.product === product || trade.product === market)
      && (symbol === 'All' || trade.symbol === symbol)
      && (direction === 'All' || trade.side.toLowerCase() === direction.toLowerCase())
      && (strategy === 'All' || trade.strategy === strategy)
  }), [trades, cutoff, product, symbol, direction, strategy])
  const accountExecutions = useMemo(() => snapshot.executions.filter(item => enabledAccounts.has(item.accountId)), [snapshot.executions, enabledAccounts])
  const accountEvents = useMemo(() => snapshot.financialEvents.filter(item => enabledAccounts.has(item.accountId)), [snapshot.financialEvents, enabledAccounts])
  const executions = useMemo(() => accountExecutions.filter(item => matchesDate(item.executedAt)
    && (product === 'All' || item.product === products.find(value => value.label === product)?.value)
    && (symbol === 'All' || item.symbol === symbol)
    && (direction === 'All' || item.side.toLowerCase() === direction.toLowerCase())), [accountExecutions, cutoff, product, symbol, direction])
  const events = useMemo(() => accountEvents.filter(item => matchesDate(item.occurredAt)
    && (product === 'All' || item.product === products.find(value => value.label === product)?.value)
    && (symbol === 'All' || item.symbol === symbol)), [accountEvents, cutoff, product, symbol])
  const symbols = [...new Set([...trades.map(item => item.symbol), ...accountExecutions.map(item => item.symbol), ...accountEvents.map(item => item.symbol).filter((value): value is string => Boolean(value))])].sort()
  const strategies = [...new Set(trades.map(item => item.strategy).filter(Boolean))].sort()
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
  const realizedByAsset = groupAmounts(realized)
  const commissionEvents = events.filter(event => event.type === 'commission' && event.amount !== null)
  const commissionsByAsset = groupAmounts(commissionEvents)
  const fundingEvents = events.filter(event => event.type === 'funding' && event.amount !== null)
  const fundingByAsset = groupAmounts(fundingEvents)
  const realizedSummary = summarizeAmounts(realizedByAsset, realized.length, 'realized P&L')
  const commissionSummary = summarizeAmounts(commissionsByAsset, commissionEvents.length, 'commission')
  const fundingSummary = summarizeAmounts(fundingByAsset, fundingEvents.length, 'funding')
  const positiveRealizedEvents = realized.filter(event => event.amount !== null && event.amount > 0).length
  const negativeRealizedEvents = realized.filter(event => event.amount !== null && event.amount < 0).length
  const realizedBySymbol = groupRealizedBySymbol(realized)
  const feesByAsset = groupAmounts(executions.filter(item => item.commission !== null).map(item => ({
    product: item.product,
    asset: item.commissionAsset ?? 'Unknown asset',
    amount: item.commission,
  })))
  const filteredPositions = snapshot.positions.filter(item => enabledAccounts.has(item.accountId) && (item.quantity === null || item.quantity !== 0))
  const accountSnapshots = snapshot.snapshots.filter(item => enabledAccounts.has(item.accountId))
  const latestSnapshots = [...accountSnapshots].sort((a, b) => b.asOf.localeCompare(a.asOf)).slice(0, 10).reverse()
  const accountCoverage = snapshot.coverage.filter(item => enabledAccounts.has(item.accountId))
  const accountBalances = snapshot.balances.filter(item => enabledAccounts.has(item.accountId))
  const completeCoverage = accountCoverage.filter(item => item.complete).length

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

  return <div className="flex flex-col gap-5">
    <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div><h1 className="text-2xl font-semibold tracking-tight">Analytics</h1><p className="mt-2 text-sm text-muted-foreground">Explore saved journal entries and persisted Binance records. Exchange amounts remain in their reported assets.</p></div>
      <div className="flex flex-wrap gap-2">
        <select value={range} onChange={event => setRange(event.target.value as Range)} className="h-8 border border-border bg-background px-2 text-xs">{(['7D', '30D', '90D', '6M', '1Y', 'All Time'] as const).map(item => <option key={item}>{item}</option>)}</select>
        <select value={product} onChange={event => setProduct(event.target.value)} className="h-8 border border-border bg-background px-2 text-xs"><option>All</option>{products.map(item => <option key={item.value}>{item.label}</option>)}</select>
        <select value={symbol} onChange={event => setSymbol(event.target.value)} className="h-8 border border-border bg-background px-2 text-xs"><option>All</option>{symbols.map(item => <option key={item}>{item}</option>)}</select>
        <Button variant="outline" size="sm" onClick={exportData}><Download data-icon="inline-start" />Export</Button>
      </div>
    </header>
    <div className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Select label="Direction" value={direction} onChange={setDirection} options={['All', 'Long', 'Short', 'Buy', 'Sell']} />
      <Select label="Journal strategy" value={strategy} onChange={setStrategy} options={['All', ...strategies]} />
      <p className="self-end text-[10px] text-muted-foreground">Manual journal: {manual.length} dated entries · Binance: {executions.length} executions and {events.length} financial events</p>
      <p className="self-end text-[10px] text-muted-foreground">Endpoint coverage: {accountCoverage.length} reports · {completeCoverage} complete</p>
    </div>
    <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Analytics views">{tabs.map(item => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`whitespace-nowrap border-b-2 px-3 pb-3 text-xs ${tab === item ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{item}</button>)}</div>

    {tab === 'Performance' && <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Exchange realized P&L" value={realizedSummary.value} detail={realizedSummary.detail} tone={realizedSummary.tone} />
        <Metric label="Positive / negative events" value={realized.length ? `${positiveRealizedEvents} / ${negativeRealizedEvents}` : 'Unavailable'} detail={realized.length ? `${realized.length} reported events · not a trade win rate` : 'No realized P&L events in this selection'} />
        <Metric label="Synced executions" value={executions.length.toLocaleString()} detail="Persisted Binance fills in this selection" />
        <Metric label="Exchange commissions" value={commissionSummary.value} detail={commissionSummary.detail} tone={commissionSummary.tone} />
        <Metric label="Funding net" value={fundingSummary.value} detail={fundingSummary.detail} tone={fundingSummary.tone} />
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
    </div>}

    {tab === 'Trade Edge' && <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Exchange realized P&L by symbol" subtitle="Persisted Binance realized-P&L events grouped by product, asset, and reported symbol.">
        {realizedBySymbol.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="sticky top-0 border-b border-border bg-card text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-2.5 pr-3">Symbol</th><th className="py-2.5 pr-3">Product · asset</th><th className="py-2.5 pr-3 text-right">Events</th><th className="py-2.5 text-right">Realized P&L</th></tr></thead><tbody className="divide-y divide-border">{realizedBySymbol.map(item => <tr key={item.key} className="transition-colors hover:bg-muted/30"><td className="py-3 pr-3 font-mono font-medium">{item.symbol ?? 'No symbol reported'}</td><td className="py-3 pr-3 text-muted-foreground">{productName(item.product)} · {item.asset}</td><td className="py-3 pr-3 text-right tabular-nums">{item.count}</td><td className={`py-3 text-right font-mono tabular-nums ${item.amount > 0 ? 'text-emerald-500' : item.amount < 0 ? 'text-rose-500' : 'text-muted-foreground'}`}>{money(item.amount, item.asset)}</td></tr>)}</tbody></table></div> : <Empty text="No exchange realized-P&L events match these filters." />}
        {strategies.length === 0 && <p className="mt-3 border-t border-border pt-3 text-[10px] text-muted-foreground">Manual strategy results are unavailable until a strategy is recorded on a journal entry.</p>}
      </Panel>
      <Panel title="Execution activity by symbol" subtitle="Persisted Binance fills and executed quantity; volume is not treated as performance.">
        {executions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead className="sticky top-0 border-b border-border bg-card text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-2.5 pr-3">Symbol</th><th className="py-2.5 pr-3">Product</th><th className="py-2.5 pr-3 text-right">Fills</th><th className="py-2.5 text-right">Executed quantity</th></tr></thead><tbody className="divide-y divide-border">{groupExecutions(executions).map(item => <tr key={item.key} className="transition-colors hover:bg-muted/30"><td className="py-3 pr-3 font-mono font-medium">{item.symbol}</td><td className="py-3 pr-3 text-muted-foreground">{productName(item.product)}</td><td className="py-3 pr-3 text-right tabular-nums">{item.count.toLocaleString()}</td><td className="py-3 text-right font-mono tabular-nums">{item.quantity === null ? 'Unavailable' : item.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td></tr>)}</tbody></table></div> : <Empty text="No synced executions match these filters." />}
      </Panel>
    </div>}
    {tab === 'Trade Edge' && strategies.length > 0 && <Panel title="Manual journal strategy results" subtitle="User-entered strategy labels and reported journal P&L; kept separate from exchange events.">
      {manual.some(item => item.strategy) ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-2.5 pr-3">Strategy</th><th className="py-2.5 pr-3 text-right">Entries</th><th className="py-2.5 pr-3 text-right">Reported P&L</th><th className="py-2.5 text-right">Win rate</th></tr></thead><tbody className="divide-y divide-border">{strategies.map(name => { const rows = manual.filter(item => item.strategy === name); if (!rows.length) return null; const pnl = rows.reduce((sum, item) => sum + item.pnl, 0); return <tr key={name} className="transition-colors hover:bg-muted/30"><td className="py-3 pr-3 font-medium">{name}</td><td className="py-3 pr-3 text-right tabular-nums">{rows.length}</td><td className={`py-3 pr-3 text-right font-mono tabular-nums ${pnl > 0 ? 'text-emerald-500' : pnl < 0 ? 'text-rose-500' : ''}`}>{money(pnl)}</td><td className="py-3 text-right tabular-nums">{(rows.filter(item => item.pnl > 0).length / rows.length * 100).toFixed(1)}%</td></tr> })}</tbody></table></div> : <Empty text="No manual journal entries with strategy labels match the current filters." />}
    </Panel>}

    {tab === 'Execution & Costs' && <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Synced executions" subtitle="Recorded Binance trade fills.">
        {executions.length ? <div className="max-h-[520px] overflow-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="sticky top-0 border-b border-border bg-card text-[10px] uppercase text-muted-foreground"><tr>{['Time', 'Symbol', 'Product', 'Side', 'Price', 'Quantity', 'Commission'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{executions.map(item => <tr key={`${item.accountId}:${item.id}`}><td className="py-3">{new Date(item.executedAt).toLocaleString()}</td><td className="font-mono">{item.symbol}</td><td>{productName(item.product)}</td><td>{item.side}</td><td>{money(item.price)}</td><td>{formatQuantity(item.quantity)}</td><td>{money(item.commission, item.commissionAsset)}</td></tr>)}</tbody></table></div> : <Empty text="No synced executions match these filters." />}
      </Panel>
      <div className="flex flex-col gap-5"><Panel title="Execution commissions" subtitle="Summed from Binance fill records, separated by product and commission asset.">{feesByAsset.length ? <AmountTable rows={feesByAsset} /> : <Empty text="No fill commission values are available." />}</Panel><Panel title="Funding and realized income" subtitle="Exchange financial events, kept in their reported assets.">{events.filter(item => ['funding', 'realized-pnl', 'interest'].includes(item.type)).length ? <EventTable events={events.filter(item => ['funding', 'realized-pnl', 'interest'].includes(item.type))} /> : <Empty text="No funding, realized P&L, or interest events are stored." />}</Panel></div>
    </div>}

    {tab === 'Risk' && <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Current non-zero positions" value={String(filteredPositions.filter(item => item.quantity !== 0).length)} detail="Exchange position-risk records" /><Metric label="Open notional" value={money(filteredPositions.every(item => item.notional !== null) ? filteredPositions.reduce((sum, item) => sum + Math.abs(item.notional ?? 0), 0) : null)} detail="Reported product units; no conversion" /><Metric label="Latest account snapshot" value={accountSnapshots.length ? new Date(accountSnapshots.reduce((latest, item) => item.asOf > latest ? item.asOf : latest, '')).toLocaleString() : 'Unavailable'} detail="Most recent persisted account state" /><Metric label="Exposure / equity" value="Unavailable" detail="No common valuation currency across products" /></div>
      <Panel title="Current position risk" subtitle="Only persisted Binance fields are shown."><PositionTable positions={filteredPositions} /></Panel>
      <Panel title="Account snapshot history" subtitle="Snapshots are captured during sync; Binance does not provide reconstructed historical account states.">{latestSnapshots.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="border-b border-border text-[10px] uppercase text-muted-foreground"><tr>{['As of', 'Product', 'Equity', 'Wallet balance', 'Unrealized P&L', 'Asset'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{latestSnapshots.map(item => <tr key={item.id}><td className="py-3">{new Date(item.asOf).toLocaleString()}</td><td>{productName(item.product)}</td><td>{money(item.equity, item.currency)}</td><td>{money(item.walletBalance, item.currency)}</td><td>{money(item.unrealizedPnl, item.currency)}</td><td>{item.currency}</td></tr>)}</tbody></table></div> : <Empty text="No account snapshots have been synced." />}</Panel>
    </div>}

    {tab === 'Market Context' && <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Stored market observations" subtitle="Market data is not collected by the current Binance account sync.">{snapshot.market.length ? <div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="border-b border-border text-[10px] uppercase text-muted-foreground"><tr>{['Time', 'Symbol', 'Type', 'Value'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody>{snapshot.market.map(item => <tr key={`${item.product}:${item.symbol}:${item.kind}:${item.observedAt}`}><td className="py-3">{new Date(item.observedAt).toLocaleString()}</td><td>{item.symbol}</td><td>{item.kind}</td><td>{money(item.value)}</td></tr>)}</tbody></table></div> : <Empty text="No market observations are stored. This workspace will populate only when market-data ingestion is added." />}</Panel>
      <Panel title="Coverage" subtitle="Endpoint-level coverage from persisted sync results.">{accountCoverage.length ? <div className="space-y-2">{accountCoverage.map(item => <div key={`${item.accountId}:${item.product}:${item.endpoint}`} className="rounded border border-border p-3 text-xs"><div className="flex justify-between gap-3"><span className="font-mono">{item.endpoint}</span><span>{item.complete ? 'Complete' : 'Partial'}</span></div><p className="mt-1 text-[10px] text-muted-foreground">{productName(item.product)} · {item.recordCount} records · {item.missingPeriods.join(' ') || 'No known missing periods'}</p></div>)}</div> : <Empty text="No Binance endpoint coverage has been recorded." />}</Panel>
    </div>}

    {tab === 'Portfolio' && <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Persisted asset balances" subtitle="Values are shown in each asset's units; valuations are not inferred.">{accountBalances.length ? <div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="border-b border-border text-[10px] uppercase text-muted-foreground"><tr>{['Asset', 'Product', 'Available', 'Locked', 'Valuation'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{accountBalances.map((item, index) => <tr key={`${item.accountId}:${item.product ?? 'unknown'}:${item.asset}:${index}`}><td className="py-3 font-mono">{item.asset}</td><td>{item.product ? productName(item.product) : 'Unavailable'}</td><td>{money(item.free, item.asset)}</td><td>{money(item.locked, item.asset)}</td><td>{money(item.valuation, item.valuationCurrency)}</td></tr>)}</tbody></table></div> : <Empty text="No Binance balances have been synced for enabled accounts." />}</Panel>
      <Panel title="Balance valuation coverage" subtitle="Unconverted balances stay in their native assets.">{accountBalances.some(item => item.valuation !== null) ? <Chart><PieChart><Pie data={accountBalances.filter(item => item.valuation !== null).map(item => ({ name: `${item.asset} · ${item.product ?? 'unknown'}`, value: item.valuation ?? 0 }))} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85}>{accountBalances.filter(item => item.valuation !== null).map((item, index) => <Cell key={`${item.accountId}:${item.product ?? 'unknown'}:${item.asset}:${index}`} fill={['#18181b', '#52525b', '#a1a1aa', '#d4d4d8', '#71717a'][index % 5]} />)}</Pie><Tooltip content={<Tip moneyValues />} /></PieChart></Chart> : <Empty text="No exchange-provided asset valuations are stored for enabled accounts." />}</Panel>
    </div>}

    {tab === 'Psychology' && <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Journal observations" subtitle="Only notes saved with manual entries are considered. No emotional state is inferred.">{manual.some(item => item.note.trim()) ? <div className="space-y-2">{manual.filter(item => item.note.trim()).map(item => <article key={item.id} className="rounded border border-border p-3 text-xs"><div className="flex justify-between gap-3"><span className="font-medium">{item.symbol} · {item.side}</span><span className="text-muted-foreground">{new Date(item.closed).toLocaleString()}</span></div><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{item.note}</p></article>)}</div> : <Empty text="No notes are saved on the selected manual journal entries." />}</Panel>
      <Panel title="Journal completeness" subtitle="Counts reflect available manual journal fields."><div className="grid grid-cols-2 gap-3"><Metric label="Entries" value={String(manual.length)} detail="In selected range" /><Metric label="With notes" value={String(manual.filter(item => item.note.trim()).length)} detail="User-written observations" /><Metric label="With strategy" value={String(manual.filter(item => item.strategy.trim()).length)} detail="User-entered labels" /><Metric label="Review marked" value={String(manual.filter(item => item.reviewed).length)} detail="User-marked entries" /></div></Panel>
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
  return <div className="grid min-h-40 place-items-center rounded border border-dashed border-border px-4 text-center text-xs text-muted-foreground">{text}</div>
}

function Chart({ children }: { children: React.ReactNode }) {
  return <div className="h-64 w-full min-w-0"><ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer></div>
}

function Tip({ active, payload, label, moneyValues = false }: { active?: boolean; payload?: { name?: string; value?: number }[]; label?: string; moneyValues?: boolean }) {
  if (!active || !payload?.length) return null
  return <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg"><p className="font-medium">{label}</p>{payload.map((item, index) => <p key={`${item.name}:${index}`} className="font-mono">{item.name}: {item.value == null ? 'Unavailable' : moneyValues ? formatMoney(item.value) : formatQuantity(item.value, 4)}</p>)}</div>
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
