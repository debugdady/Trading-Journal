'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Search, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Execution, FinancialEvent, Order, Position, TradingRepositorySnapshot } from '@/lib/trading/types'
import { formatMoney, formatQuantity } from '@/lib/trading/format-money'

const emptySnapshot: TradingRepositorySnapshot = { raw: [], balances: [], orders: [], executions: [], financialEvents: [], positions: [], snapshots: [], market: [], trades: [], coverage: [] }
const productName = (value: string) => ({
  spot: 'Spot',
  'usd-m-futures': 'USDⓈ-M Futures',
  'coin-m-futures': 'COIN-M Futures',
  margin: 'Margin',
  wallet: 'Wallet',
  market: 'Market',
  unknown: 'Unknown',
}[value] ?? value.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase()))
const money = (value: number | null | undefined, asset?: string) => formatMoney(value, { asset })
const number = (value: number | null | undefined, digits = 4) => formatQuantity(value, digits)
const balanceAmount = (value: number | null, asset: string) => value === null ? '—' : `${number(value, 8)} ${asset}`
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '—'
const label = (value: string) => value.replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
const source = <span className="rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Persisted Binance data</span>

export function PortfolioPage({ snapshot: data = emptySnapshot }: { snapshot?: TradingRepositorySnapshot }) {
  const [period, setPeriod] = useState('30D')
  const snapshotsNewestFirst = data.snapshots
    .filter(item => Number.isFinite(Date.parse(item.asOf)))
    .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf))
  const snapshots = snapshotsNewestFirst.slice().reverse()
  const latestEquity = snapshotsNewestFirst.find(item => Number.isFinite(item.equity))
  const latestWalletBalance = snapshotsNewestFirst.find(item => Number.isFinite(item.walletBalance))
  const latestUnrealizedPnl = snapshotsNewestFirst.find(item => Number.isFinite(item.unrealizedPnl))
  const cutoff = period === 'All' ? null : Date.now() - (period === '7D' ? 7 : period === '90D' ? 90 : 30) * 86_400_000
  const equitySnapshots = snapshots.filter(item => Number.isFinite(item.equity) && (cutoff === null || Date.parse(item.asOf) >= cutoff))
  const accountLabels = new Map([...new Set(equitySnapshots.map(item => item.accountId))].map((accountId, index) => [accountId, `Account ${index + 1}`]))
  const equitySeries = [...new Map(equitySnapshots.map(item => {
    const key = `${item.accountId}:${item.product}:${item.currency}`
    return [key, { key, name: `${accountLabels.get(item.accountId)} · ${productName(item.product)} · ${item.currency}` }]
  })).values()]
  const equityPoints = new Map<number, Record<string, string | number>>()
  for (const item of equitySnapshots) {
    const key = `${item.accountId}:${item.product}:${item.currency}`
    const timestamp = Date.parse(item.asOf)
    const point = equityPoints.get(timestamp) ?? { timestamp, asOf: item.asOf }
    if (item.equity !== null) point[key] = item.equity
    equityPoints.set(timestamp, point)
  }
  const equity = [...equityPoints.values()].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
  const equityValues = equitySnapshots.flatMap(item => item.equity === null ? [] : [item.equity])
  const equityDomain = paddedDomain(equityValues)
  const equitySpan = equity.length > 1 ? Number(equity[equity.length - 1].timestamp) - Number(equity[0].timestamp) : 0
  const equityTick = (value: number) => new Date(value).toLocaleString('en-US', equitySpan < 86_400_000
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' })
  const balanceRows = data.balances.filter(item =>
    (item.free !== null || item.locked !== null)
    && (item.free === null || item.free !== 0 || item.locked === null || item.locked !== 0),
  )
  const nativeBalanceRows = balanceRows.flatMap(item => {
    if (item.free === null || item.locked === null || !Number.isFinite(item.free) || !Number.isFinite(item.locked)) return []
    const free = item.free
    const locked = item.locked
    const absoluteTotal = Math.abs(free) + Math.abs(locked)
    if (absoluteTotal === 0) return []
    return [{
      ...item,
      free,
      locked,
      absoluteTotal,
      availableShare: Math.abs(free) / absoluteTotal * 100,
    }]
  }).sort((a, b) => b.absoluteTotal - a.absoluteTotal).slice(0, 8)
  const flows = data.financialEvents.filter(item => item.amount !== null)
  return <Workspace title="Portfolio" description="Persisted Binance balances, account snapshots, and financial events. Values remain in the exchange-reported assets.">
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">{source}<span className="text-[11px] text-muted-foreground">{balanceRows.length} non-zero balances · {data.snapshots.length} snapshots</span></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Latest equity" value={money(latestEquity?.equity, latestEquity?.currency)} detail={latestEquity ? `${productName(latestEquity.product)} · ${date(latestEquity.asOf)}` : 'No exchange-reported equity is available'} />
      <Metric label="Wallet balance" value={money(latestWalletBalance?.walletBalance, latestWalletBalance?.currency)} detail={latestWalletBalance ? `${productName(latestWalletBalance.product)} · ${date(latestWalletBalance.asOf)}` : 'No exchange-reported wallet balance is available'} />
      <Metric label="Unrealized P&L" value={money(latestUnrealizedPnl?.unrealizedPnl, latestUnrealizedPnl?.currency)} detail={latestUnrealizedPnl ? `${productName(latestUnrealizedPnl.product)} · ${date(latestUnrealizedPnl.asOf)}` : 'No exchange-reported unrealized P&L is available'} />
      <Metric label="Financial events" value={String(data.financialEvents.length)} detail="Persisted event records" />
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
      <Panel title="Portfolio equity history" subtitle="Persisted Binance snapshots only. Separate lines preserve each account, product, and currency."><div className="mb-3 flex gap-1">{['7D', '30D', '90D', 'All'].map(item => <button key={item} onClick={() => setPeriod(item)} className={`rounded px-2 py-1 text-[10px] ${period === item ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}>{item}</button>)}</div>{equity.length ? <Chart height={250}><LineChart data={equity}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={equityTick} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} /><YAxis domain={equityDomain} tickFormatter={value => formatMoney(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} /><Tooltip content={<Tip moneyValues />} />{equitySeries.map((item, index) => <Line key={item.key} type="monotone" dataKey={item.key} name={item.name} stroke={`var(--chart-${index % 5 + 1})`} strokeWidth={2} dot={equity.length <= 30 ? { r: 2, fill: `var(--chart-${index % 5 + 1})` } : false} activeDot={{ r: 4 }} connectNulls={false} />)}</LineChart></Chart> : <Empty text="No account equity snapshots are available for this range." />}</Panel>
      <Panel title="Native asset composition" subtitle="Real Binance balances in their original units. Bars show each asset's available vs locked share—not a converted valuation.">{nativeBalanceRows.length ? <div className="space-y-4 pt-2">{nativeBalanceRows.map(item => <div key={`${item.accountId}:${item.product}:${item.asset}`} title={`${productName(item.product ?? 'unknown')} · ${item.asset}: ${number(item.free, 8)} available, ${number(item.locked, 8)} locked`}>
        <div className="flex items-baseline justify-between gap-3 text-xs"><span className="font-medium">{item.asset}<span className="ml-2 text-[10px] text-muted-foreground">{productName(item.product ?? 'unknown')}</span></span><span className="font-mono tabular-nums">{number(item.free + item.locked, 8)} {item.asset}</span></div>
        <div role="img" aria-label={`${item.asset}: ${item.availableShare.toFixed(1)}% available, ${(100 - item.availableShare).toFixed(1)}% locked`} className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
          <span className="bg-[var(--chart-1)]" style={{ width: `${item.availableShare}%` }} />
          <span className="bg-[var(--chart-2)]" style={{ width: `${100 - item.availableShare}%` }} />
        </div>
        <div className="mt-1 flex justify-between gap-3 text-[10px] text-muted-foreground"><span>Available {number(item.free, 8)} {item.asset}</span><span>Locked {number(item.locked, 8)} {item.asset}</span></div>
      </div>)}</div> : <Empty text="No non-zero available or locked Binance balances are stored for the selected accounts." />}</Panel>
    </div>
    <Panel title="Asset balances" subtitle="Original balance values are shown without currency conversion.">
      {balanceRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-xs"><thead className="border-b border-border text-left text-[10px] uppercase text-muted-foreground"><tr>{['Asset', 'Product', 'Total', 'Available', 'Locked', 'Borrowed', 'Valuation'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{balanceRows.map((item, index) => <tr key={`${item.accountId}:${item.product ?? 'unknown'}:${item.asset}:${index}`}><td className="py-3 font-mono font-medium">{item.asset}</td><td>{item.product ? productName(item.product) : '—'}</td><td>{item.free == null || item.locked == null ? '—' : balanceAmount(item.free + item.locked, item.asset)}</td><td>{balanceAmount(item.free, item.asset)}</td><td>{balanceAmount(item.locked, item.asset)}</td><td>{balanceAmount(item.borrowed, item.asset)}</td><td>{money(item.valuation, item.valuationCurrency)}</td></tr>)}</tbody></table></div> : <Empty text="No non-zero Binance balances have been synced." />}
    </Panel>
    <Panel title="Financial event history" subtitle="Deposits, withdrawals, transfers, income, and other exchange events.">{flows.length ? <EventTable events={flows} /> : <Empty text="No Binance financial events have been synced." />}</Panel>
  </Workspace>
}

export function OrdersExecutionsPage({ snapshot: data = emptySnapshot }: { snapshot?: TradingRepositorySnapshot }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('All')
  const [selected, setSelected] = useState<Order | null>(null)
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null)
  const orders = data.orders
    .filter(item => (!query || `${item.id} ${item.symbol}`.toLowerCase().includes(query.toLowerCase())) && (status === 'All' || item.status === status))
    .sort((a, b) => Date.parse(b.updatedAt ?? b.openedAt ?? '') - Date.parse(a.updatedAt ?? a.openedAt ?? '') || b.id.localeCompare(a.id))
  const executionsNewestFirst = [...data.executions]
    .sort((a, b) => Date.parse(b.executedAt) - Date.parse(a.executedAt) || b.id.localeCompare(a.id))
  const filled = data.orders.filter(item => item.status === 'FILLED').length
  const open = data.orders.filter(item => ['NEW', 'PARTIALLY_FILLED'].includes(item.status)).length
  const incomeEvents = data.financialEvents.filter(item => ['realized-pnl', 'commission', 'funding'].includes(item.type))
  const realizedEvents = incomeEvents.filter(item => item.type === 'realized-pnl')
  const commissionEvents = incomeEvents.filter(item => item.type === 'commission')
  const fundingEvents = incomeEvents.filter(item => item.type === 'funding')
  const eventActivity = buildFinancialEventActivity(incomeEvents)
  const eventTypes = Array.from(new Set(data.financialEvents.map(item => item.type))).map(name => ({
    name: label(name),
    value: data.financialEvents.filter(item => item.type === name).length,
  }))
  const activity = useMemo(() => buildActivity(data.orders, data.executions), [data.orders, data.executions])
  const statusData = Array.from(new Set(data.orders.map(item => item.status))).map(name => ({ name, value: data.orders.filter(item => item.status === name).length }))
  const typeData = Array.from(new Set(data.orders.map(item => item.type))).map(name => ({ name, value: data.orders.filter(item => item.type === name).length }))
  const commissions = new Map<string, number>()
  data.executions.forEach(item => {
    if (item.commission === null) return
    const asset = item.commissionAsset ?? 'Unknown asset'
    commissions.set(asset, (commissions.get(asset) ?? 0) + item.commission)
  })
  return <Workspace title="Orders & Executions" description="Synced Binance order and fill history, retained alongside original API responses.">
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">{source}<span className="text-[11px] text-muted-foreground">{data.orders.length} orders · {data.executions.length} executions · {data.financialEvents.length} financial events</span></div>
    {data.orders.length || data.executions.length
      ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Orders" value={String(data.orders.length)} detail="Persisted order records" /><Metric label="Filled" value={String(filled)} detail="Exchange status: FILLED" /><Metric label="Open / partial" value={String(open)} detail="NEW or PARTIALLY_FILLED" /><Metric label="Executions" value={String(data.executions.length)} detail="Persisted Binance fills" /></div>
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Realized P&L events" value={String(realizedEvents.length)} detail="Exchange-reported, not reconstructed trades" />
        <Metric label="Realized P&L" value={summarizeEventAmounts(realizedEvents)} detail="No cross-asset conversion applied" />
        <Metric label="Commission events" value={String(commissionEvents.length)} detail="Persisted exchange events" />
        <Metric label="Funding events" value={String(fundingEvents.length)} detail="Persisted exchange events" />
      </div>}
    <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
      <Panel title={activity.length ? 'Order activity' : 'Realized activity'} subtitle={activity.length ? 'Counts grouped by dates present in synced orders and executions.' : 'Exchange-reported realized P&L, commission, and funding events by date.'}>{activity.length ? <Chart height={250}><ActivityChart data={activity} /></Chart> : eventActivity.length ? <Chart height={250}><FinancialEventActivityChart data={eventActivity} /></Chart> : <Empty text="No dated order, execution, or financial event activity is stored." />}</Panel>
      <Panel title={data.orders.length ? 'Order status and type' : 'Financial event types'} subtitle={data.orders.length ? 'Distributions from persisted Binance orders.' : 'Counts from persisted Binance financial events.'}>{data.orders.length ? <div className="grid gap-3 sm:grid-cols-2"><Chart height={220}><PieChart><Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}>{statusData.map((item, index) => <Cell key={item.name} fill={['#18181b', '#71717a', '#a1a1aa', '#d4d4d8', '#52525b'][index % 5]} />)}</Pie><Tooltip content={<Tip />} /></PieChart></Chart><Chart height={220}><BarChart data={typeData}><XAxis dataKey="name" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip content={<Tip />} /><Bar dataKey="value" name="Orders" fill="var(--chart-3)" /></BarChart></Chart></div> : eventTypes.length ? <Chart height={220}><PieChart><Pie data={eventTypes} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}>{eventTypes.map((item, index) => <Cell key={item.name} fill={`var(--chart-${index % 5 + 1})`} />)}</Pie><Tooltip content={<Tip />} /></PieChart></Chart> : <Empty text="No order status or type data is available." />}</Panel>
    </div>
    <Panel title="Orders" subtitle="Select an order to inspect its fields and matching raw response.">
      <div className="mb-3 flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-2 top-2 size-3.5 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search ID or symbol" className="h-8 rounded-md border border-border bg-background pl-7 pr-2 text-xs" /></div><select value={status} onChange={event => setStatus(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-xs"><option>All</option>{Array.from(new Set(data.orders.map(item => item.status))).map(item => <option key={item}>{item}</option>)}</select></div>
      {orders.length ? <OrderTable orders={orders} onSelect={setSelected} /> : <Empty text="No orders match this search and status." />}
    </Panel>
    <Panel title="Execution ledger" subtitle={`${executionsNewestFirst.length} persisted fills · newest first. Select a fill to inspect its source fields.`}>
      {executionsNewestFirst.length
        ? <ExecutionTable executions={executionsNewestFirst} onSelect={setSelectedExecution} />
        : <Empty text="No Binance executions have been synced." />}
      {commissions.size > 0 && <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs"><span className="text-muted-foreground">Commission paid</span>{[...commissions.entries()].map(([asset, amount]) => <span key={asset} className="rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1 font-mono tabular-nums text-red-600 dark:text-red-400">{formatMoney(-Math.abs(amount), { asset, signed: true })}</span>)}</div>}
    </Panel>
    {selected && <Drawer title={`Order ${selected.id}`} onClose={() => setSelected(null)}><Detail label="Lifecycle" value={`${selected.status} · ${date(selected.openedAt)} → ${date(selected.updatedAt)}`} /><Detail label="Instrument" value={`${selected.symbol} · ${productName(selected.product)} · ${selected.side}`} /><Detail label="Order parameters" value={`${selected.type} at ${money(selected.price)} · ${number(selected.quantity)} original · ${number(selected.executedQuantity)} filled`} /><h3 className="mt-5 text-xs font-medium">Linked executions</h3>{data.executions.filter(item => item.orderId === selected.id).map(item => <div key={item.id} className="mt-2 rounded border border-border p-3 text-xs"><span className="font-mono">{item.id}</span> · {money(item.price)} × {number(item.quantity, 8)} · {item.isMaker === undefined ? 'Maker/taker unavailable' : item.isMaker ? 'Maker' : 'Taker'}</div>)}<RawBlock /></Drawer>}
    {selectedExecution && <Drawer title={`Execution ${selectedExecution.id}`} onClose={() => setSelectedExecution(null)}><Detail label="Linked order" value={selectedExecution.orderId} /><Detail label="Fill" value={`${selectedExecution.symbol} · ${selectedExecution.side} · ${money(selectedExecution.price)} × ${number(selectedExecution.quantity, 8)}`} /><Detail label="Fees" value={`${money(selectedExecution.commission, selectedExecution.commissionAsset)} · ${selectedExecution.isMaker === undefined ? 'Maker/taker unavailable' : selectedExecution.isMaker ? 'Maker' : 'Taker'}`} /><RawBlock /></Drawer>}
  </Workspace>
}

export function PositionsRiskPage({ snapshot: data = emptySnapshot }: { snapshot?: TradingRepositorySnapshot }) {
  const [selected, setSelected] = useState<Position | null>(null)
  const positions = data.positions.filter(item => item.quantity === null || item.quantity !== 0)
  const latest = data.snapshots.slice().sort((a, b) => b.asOf.localeCompare(a.asOf))[0]
  const positionCoverage = data.coverage.filter(item => item.endpoint.endsWith('/positionRisk'))
  const positionCoverageComplete = positionCoverage.length > 0 && positionCoverage.every(item => item.complete)
  const accountSnapshots = [...new Set(data.snapshots.map(item => `${item.accountId}:${item.product}`))]
    .map(key => data.snapshots
      .filter(item => `${item.accountId}:${item.product}` === key && [item.walletBalance, item.equity, item.unrealizedPnl, item.marginBalance].some(value => value !== null))
      .sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf))[0])
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  const realizedEvents = data.financialEvents
    .filter(item => item.type === 'realized-pnl' && item.amount !== null && Number.isFinite(Date.parse(item.occurredAt)))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  const financialAnalytics = buildFinancialAnalytics(data.financialEvents)
  const accountEquitySummary = summarizeSnapshotValues(accountSnapshots, 'equity')
  const snapshotUnrealizedSummary = summarizeSnapshotValues(accountSnapshots, 'unrealizedPnl')
  const nonZeroBalances = data.balances
    .filter(item => [item.free, item.locked, item.borrowed].some(value => value !== null && Number.isFinite(value) && value !== 0))
    .slice()
    .sort((a, b) => productName(a.product ?? 'unknown').localeCompare(productName(b.product ?? 'unknown')) || a.asset.localeCompare(b.asset))
  const notionalByProduct = groupPositionValues(positions, 'notional')
  const unrealizedByProduct = groupPositionValues(positions, 'unrealizedPnl')
  const leverageValues = positions.map(item => item.leverage).filter((value): value is number => value !== null)
  const avgLeverage = leverageValues.length ? leverageValues.reduce((sum, value) => sum + value, 0) / leverageValues.length : null
  const margin = latest?.initialMargin !== null && latest?.initialMargin !== undefined && latest.marginBalance !== null && latest.marginBalance !== 0
    ? latest.initialMargin / latest.marginBalance * 100 : null
  const equityHistory = buildEquityHistory(data.snapshots)
  return <Workspace title="Positions & Risk" description="Current persisted Binance position-risk data, with unavailable fields left blank.">
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">{source}<span className="text-[11px] text-muted-foreground">Informational account data; no trade controls are available</span></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <Metric label="Non-zero positions" value={String(positions.filter(item => item.quantity !== null && item.quantity !== 0).length)} detail={positions.length ? `${positions.length} current records, including unknown size` : positionCoverageComplete ? 'No open positions reported by Binance' : 'No position records available'} />
      <Metric label="Unrealized P&L" value={positions.length ? summaryValue(unrealizedByProduct) : snapshotUnrealizedSummary.value} detail={positions.length ? summaryDetail(unrealizedByProduct) : snapshotUnrealizedSummary.detail} />
      <Metric label="Known notional" value={summaryValue(notionalByProduct)} detail={notionalByProduct.length ? summaryDetail(notionalByProduct) : positionCoverageComplete ? 'No open positions reported by Binance' : 'No position data'} />
      <Metric label="Long positions" value={String(positions.filter(item => item.positionSide === 'LONG').length)} detail="Current exchange-reported positions" />
      <Metric label="Short positions" value={String(positions.filter(item => item.positionSide === 'SHORT').length)} detail="Current exchange-reported positions" />
      {positions.length
        ? <>
          <Metric label="Average leverage" value={avgLeverage === null ? '—' : `${avgLeverage.toFixed(2)}x`} detail={`${leverageValues.length} known values`} />
          <Metric label="Margin utilization" value={margin === null ? '—' : `${margin.toFixed(1)}%`} detail="Initial margin ÷ margin balance" />
        </>
        : <>
          <Metric label="Account equity" value={accountEquitySummary.value} detail={accountEquitySummary.detail} />
          <Metric label="Realized P&L" value={summarizeEventAmounts(realizedEvents)} detail={`${realizedEvents.length} exchange-reported events`} />
        </>}
    </div>
    <Panel title="Persisted account snapshots" subtitle="Most recent exchange-reported values for each product. These balances are not position notional.">
      {accountSnapshots.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="border-b border-border text-left text-[10px] uppercase text-muted-foreground"><tr>{['Product', 'Wallet balance', 'Equity', 'Unrealized P&L', 'Margin balance', 'As of'].map(item => <th key={item} className="py-2 pr-4">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{accountSnapshots.map(item => <tr key={`${item.accountId}:${item.product}`}><td className="py-3 pr-4 font-medium">{productName(item.product)}</td><td className="pr-4 font-mono">{money(item.walletBalance, item.currency)}</td><td className="pr-4 font-mono">{money(item.equity, item.currency)}</td><td className="pr-4 font-mono">{money(item.unrealizedPnl, item.currency)}</td><td className="pr-4 font-mono">{money(item.marginBalance, item.currency)}</td><td className="whitespace-nowrap text-muted-foreground">{date(item.asOf)}</td></tr>)}</tbody></table></div> : <Empty text="No exchange-reported account snapshot values are available." />}
    </Panel>
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Realized P&L by symbol" subtitle="Exchange-reported realized events. Gains are green; losses are red.">
        {financialAnalytics.some(unit => unit.symbolPnl.length) ? <div className="space-y-5">{financialAnalytics.filter(unit => unit.symbolPnl.length).map(unit => <div key={unit.key}>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{unit.name} · {unit.realizedCount} events</p>
          <Chart height={Math.max(170, unit.symbolPnl.length * 34)}><BarChart data={unit.symbolPnl} layout="vertical" margin={{ left: 4, right: 12 }}>
            <CartesianGrid stroke="var(--border)" horizontal={false} /><XAxis type="number" tickFormatter={value => formatMoney(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} /><YAxis type="category" dataKey="symbol" width={92} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} /><ReferenceLine x={0} stroke="var(--border)" /><Tooltip content={<Tip moneyValues asset={unit.asset} />} />
            <Bar dataKey="amount" name="Realized P&L" radius={[0, 4, 4, 0]}>{unit.symbolPnl.map(item => <Cell key={item.symbol} fill={item.amount >= 0 ? 'var(--positive)' : 'var(--negative)'} />)}</Bar>
          </BarChart></Chart>
        </div>)}</div> : <Empty text="No symbol-level exchange-reported realized P&L is available." />}
      </Panel>
      <Panel title="Commissions & funding by symbol" subtitle="Exchange-reported cash-flow amounts, kept in their original product and asset units.">
        {financialAnalytics.some(unit => unit.symbolCosts.length) ? <div className="space-y-5">{financialAnalytics.filter(unit => unit.symbolCosts.length).map(unit => <div key={unit.key}>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{unit.name}</p>
          <Chart height={Math.max(170, unit.symbolCosts.length * 34)}><BarChart data={unit.symbolCosts} layout="vertical" margin={{ left: 4, right: 12 }}>
            <CartesianGrid stroke="var(--border)" horizontal={false} /><XAxis type="number" tickFormatter={value => formatMoney(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} /><YAxis type="category" dataKey="symbol" width={92} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} /><ReferenceLine x={0} stroke="var(--border)" /><Tooltip content={<Tip moneyValues asset={unit.asset} />} />
            <Bar dataKey="commission" name="Commission" fill="var(--negative)" radius={[0, 3, 3, 0]} />
            <Bar dataKey="funding" name="Funding" radius={[0, 3, 3, 0]}>{unit.symbolCosts.map(item => <Cell key={item.symbol} fill={item.funding >= 0 ? 'var(--positive)' : 'var(--negative)'} />)}</Bar>
          </BarChart></Chart>
        </div>)}</div> : <Empty text="No symbol-level commission or funding events are available." />}
      </Panel>
    </div>
    {realizedEvents.length > 0 && <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Realized P&L history" subtitle="Exchange-reported realized events grouped by day, product, and asset. No currencies are combined.">
        {financialAnalytics.some(unit => unit.daily.length) ? <div className="space-y-5">{financialAnalytics.filter(unit => unit.daily.length).map(unit => <div key={unit.key}>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{unit.name}</p>
          <Chart height={250}><BarChart data={unit.daily} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="day" tickFormatter={value => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} /><YAxis tickFormatter={value => formatMoney(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} /><ReferenceLine y={0} stroke="var(--border)" /><Tooltip content={<Tip moneyValues asset={unit.asset} />} />
            <Bar dataKey="amount" name="Realized P&L" radius={[3, 3, 0, 0]}>{unit.daily.map(item => <Cell key={item.day} fill={item.amount >= 0 ? 'var(--positive)' : 'var(--negative)'} />)}</Bar>
          </BarChart></Chart>
        </div>)}</div> : <Empty text="No daily exchange-reported realized P&L is available." />}
      </Panel>
      <Panel title="Recent realized events" subtitle="Closed activity reported by Binance; these are not current positions or reconstructed trades.">
        <EventTable events={realizedEvents} />
      </Panel>
    </div>}
    <Panel title="Current positions" subtitle="Current exchange-reported position risk. Zero-quantity rows are omitted.">
      {positions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-xs"><thead className="border-b border-border text-left text-[10px] uppercase text-muted-foreground"><tr>{['Symbol', 'Product', 'Side', 'Quantity', 'Entry', 'Break-even', 'Mark', 'Notional', 'Unrealized', 'Leverage', 'Margin', 'Liquidation', 'Distance', 'Updated'].map(item => <th key={item} className="py-2 pr-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{positions.map(item => { const distance = item.markPrice !== null && item.markPrice > 0 && item.liquidationPrice !== null && item.liquidationPrice > 0 ? Math.abs(item.markPrice - item.liquidationPrice) / item.markPrice * 100 : null; return <tr key={item.id} onClick={() => setSelected(item)} className="cursor-pointer hover:bg-muted/50"><td className="py-3 font-mono font-medium">{item.symbol}</td><td>{productName(item.product)}</td><td>{item.positionSide ?? '—'}</td><td>{number(item.quantity)}</td><td>{money(item.entryPrice)}</td><td>{money(item.breakEvenPrice)}</td><td>{money(item.markPrice)}</td><td>{money(item.notional)}</td><td>{money(item.unrealizedPnl)}</td><td>{item.leverage === null ? '—' : `${item.leverage}x`}</td><td>{label(item.marginType ?? '') || '—'}</td><td>{money(item.liquidationPrice)}</td><td>{distance === null ? '—' : `${distance.toFixed(1)}%`}</td><td>{date(item.asOf)}</td></tr> })}</tbody></table></div> : positionCoverage.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{positionCoverage.map(item => {
        const accountSnapshot = accountSnapshots.find(snapshot => snapshot.accountId === item.accountId && snapshot.product === item.product)
        const isCurrent = item.complete
        return <div key={`${item.accountId}:${item.product}`} className="rounded-md border border-border bg-background/50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs font-medium">{productName(item.product)}</p><p className="mt-1 text-[10px] text-muted-foreground">{isCurrent ? 'Latest position-risk response' : 'Position-risk data needs attention'}</p></div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${isCurrent ? 'border-[var(--positive)]/30 bg-[var(--positive)]/10 text-[var(--positive)]' : 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]'}`}>{isCurrent ? 'Flat' : 'Check sync'}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{isCurrent ? 'Binance reported no open positions.' : item.lastError ?? item.missingPeriods[0] ?? 'The latest position response is incomplete.'}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
            <div><p className="text-[10px] text-muted-foreground">Account equity</p><p className="mt-1 font-mono text-xs">{accountSnapshot ? money(accountSnapshot.equity, accountSnapshot.currency) : 'Unavailable'}</p></div>
            <div><p className="text-[10px] text-muted-foreground">Unrealized P&amp;L</p><p className={`mt-1 font-mono text-xs ${accountSnapshot?.unrealizedPnl !== null && accountSnapshot?.unrealizedPnl !== undefined ? accountSnapshot.unrealizedPnl > 0 ? 'text-[var(--positive)]' : accountSnapshot.unrealizedPnl < 0 ? 'text-[var(--negative)]' : '' : ''}`}>{accountSnapshot ? money(accountSnapshot.unrealizedPnl, accountSnapshot.currency) : 'Unavailable'}</p></div>
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">Checked {date(item.latest ?? undefined)}</p>
        </div>
      })}</div> : <div className="rounded-md border border-dashed border-border bg-background/40 px-4 py-5"><p className="text-xs font-medium">Position data not available</p><p className="mt-1 text-[11px] text-muted-foreground">No position-risk sync coverage is stored for the connected Binance products yet.</p></div>}
    </Panel>
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Account equity history" subtitle="Exchange-reported snapshots, with intraday capture times shown separately.">
        {equityHistory.points.length && equityHistory.currencies.length === 1
          ? <><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{equityHistory.points.length} recorded snapshots</span><span>Latest {money(equityHistory.latest?.value ?? null, equityHistory.latest?.currency)}</span></div><Chart height={230}><LineChart data={equityHistory.points} margin={{ left: 4, right: 12, top: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="asOf" tickFormatter={value => Number.isFinite(Date.parse(String(value))) ? new Date(String(value)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : String(value)} minTickGap={28} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} /><YAxis domain={equityHistory.domain} tickFormatter={value => formatMoney(Number(value))} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} /><Tooltip labelFormatter={value => date(String(value))} content={<Tip moneyValues asset={equityHistory.currencies[0]} />} /><Legend />
            {equityHistory.series.map((item, index) => <Line key={item.key} dataKey={item.key} name={item.name} stroke={`var(--chart-${index % 5 + 1})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />)}
          </LineChart></Chart></>
          : equityHistory.currencies.length > 1 ? <Empty text="Multiple currencies are present; no cross-currency chart is shown." /> : <Empty text="No historical exchange-reported equity snapshots are stored." />}
      </Panel>
      <Panel title="Available balances" subtitle="Non-zero exchange-reported asset amounts, shown in native units.">
        {nonZeroBalances.length ? <BalancesTable balances={nonZeroBalances} /> : <Empty text={data.balances.length ? 'No non-zero balances were reported by Binance.' : 'No account balances are stored.'} />}
      </Panel>
    </div>
    {selected && <Drawer title={`${selected.symbol} position`} onClose={() => setSelected(null)}><Detail label="Product and side" value={`${productName(selected.product)} · ${selected.positionSide ?? 'unavailable'}`} /><Detail label="Size and prices" value={`${number(selected.quantity)} · entry ${money(selected.entryPrice)} · break-even ${money(selected.breakEvenPrice)} · mark ${money(selected.markPrice)}`} /><Detail label="Risk" value={`${selected.leverage === null ? 'Leverage unavailable' : `${selected.leverage}x`} · liquidation ${money(selected.liquidationPrice)}`} /><RiskFlag position={selected} /><RawBlock /></Drawer>}
  </Workspace>
}

function groupPositionValues(positions: Position[], field: 'notional' | 'unrealizedPnl') {
  const groups = new Map<string, { name: string; value: number; complete: boolean }>()
  for (const position of positions) {
    const name = productName(position.product)
    const group = groups.get(name) ?? { name, value: 0, complete: true }
    const amount = position[field]
    if (amount === null) group.complete = false
    else group.value += field === 'notional' ? Math.abs(amount) : amount
    groups.set(name, group)
  }
  return [...groups.values()].map(item => ({ name: item.name, value: item.complete ? item.value : null }))
}

function summaryValue(items: { name: string; value: number | null }[]) {
  if (!items.length) return 'Unavailable'
  return items.length === 1 ? money(items[0].value) : 'See product totals'
}

function summaryDetail(items: { name: string; value: number | null }[]) {
  return items.length ? items.map(item => `${item.name}: ${money(item.value)}`).join(' · ') : 'No position data'
}

function buildActivity(orders: Order[], executions: Execution[]) {
  const groups = new Map<string, { label: string; orders: number; executions: number }>()
  for (const order of orders) {
    if (!order.openedAt || !Number.isFinite(Date.parse(order.openedAt))) continue
    const key = order.openedAt.slice(0, 10)
    const group = groups.get(key) ?? { label: new Date(order.openedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), orders: 0, executions: 0 }
    group.orders += 1
    groups.set(key, group)
  }
  for (const execution of executions) {
    if (!Number.isFinite(Date.parse(execution.executedAt))) continue
    const key = execution.executedAt.slice(0, 10)
    const group = groups.get(key) ?? { label: new Date(execution.executedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), orders: 0, executions: 0 }
    group.executions += 1
    groups.set(key, group)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([, group]) => group)
}

function buildFinancialEventActivity(events: FinancialEvent[]) {
  const groups = new Map<string, { label: string; events: number }>()
  for (const event of events) {
    if (!Number.isFinite(Date.parse(event.occurredAt))) continue
    const key = event.occurredAt.slice(0, 10)
    const group = groups.get(key) ?? {
      label: new Date(event.occurredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      events: 0,
    }
    group.events += 1
    groups.set(key, group)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([, group]) => group)
}

function buildFinancialAnalytics(events: FinancialEvent[]) {
  type SymbolPnl = { symbol: string; amount: number }
  type SymbolCost = { symbol: string; commission: number; funding: number }
  type Unit = {
    key: string
    product: FinancialEvent['product']
    asset: string
    accountId: string
    dailyAmounts: Map<string, number>
    symbolPnl: Map<string, number>
    symbolCosts: Map<string, { commission: number; funding: number }>
    realizedCount: number
  }
  const units = new Map<string, Unit>()
  for (const event of events) {
    if (!['realized-pnl', 'commission', 'funding'].includes(event.type) ||
      event.amount === null || !Number.isFinite(event.amount)) continue
    const key = `${event.accountId}:${event.product}:${event.asset}`
    let unit = units.get(key)
    if (!unit) {
      unit = {
        key,
        product: event.product,
        asset: event.asset,
        accountId: event.accountId,
        dailyAmounts: new Map(),
        symbolPnl: new Map(),
        symbolCosts: new Map(),
        realizedCount: 0,
      }
      units.set(key, unit)
    }
    if (event.type === 'realized-pnl') {
      unit.realizedCount += 1
      if (Number.isFinite(Date.parse(event.occurredAt))) {
        const day = event.occurredAt.slice(0, 10)
        unit.dailyAmounts.set(day, (unit.dailyAmounts.get(day) ?? 0) + event.amount)
      }
      if (event.symbol) unit.symbolPnl.set(event.symbol, (unit.symbolPnl.get(event.symbol) ?? 0) + event.amount)
    }
    if (event.symbol && (event.type === 'commission' || event.type === 'funding')) {
      const costs = unit.symbolCosts.get(event.symbol) ?? { commission: 0, funding: 0 }
      costs[event.type] += event.amount
      unit.symbolCosts.set(event.symbol, costs)
    }
  }
  const unitList = [...units.values()]
  const unitCounts = new Map<string, number>()
  const unitIndices = new Map<string, number>()
  for (const unit of unitList) {
    const base = `${productName(unit.product)} · ${unit.asset}`
    const index = (unitCounts.get(base) ?? 0) + 1
    unitCounts.set(base, index)
    unitIndices.set(unit.key, index)
  }
  return unitList.map(unit => {
    const base = `${productName(unit.product)} · ${unit.asset}`
    const accountIndex = unitIndices.get(unit.key) ?? 1
    return {
      key: unit.key,
      asset: unit.asset,
      name: (unitCounts.get(base) ?? 0) > 1 ? `${base} · Account ${accountIndex}` : base,
      realizedCount: unit.realizedCount,
      daily: [...unit.dailyAmounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ day, amount })),
      symbolPnl: [...unit.symbolPnl.entries()].map(([symbol, amount]) => ({ symbol, amount } satisfies SymbolPnl)).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
      symbolCosts: [...unit.symbolCosts.entries()].map(([symbol, amounts]) => ({ symbol, ...amounts } satisfies SymbolCost)).sort((a, b) => Math.abs(b.commission) + Math.abs(b.funding) - Math.abs(a.commission) - Math.abs(a.funding)),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

function buildEquityHistory(snapshots: TradingRepositorySnapshot['snapshots']) {
  const records = snapshots.filter(item =>
    item.equity !== null && Number.isFinite(item.equity) && Number.isFinite(Date.parse(item.asOf)),
  )
  const baseCounts = new Map<string, number>()
  const seriesByKey = new Map<string, { key: string; base: string; accountIndex: number }>()
  const pointsByTime = new Map<string, Record<string, string | number>>()
  const currencies = new Set<string>()
  for (const item of records) {
    const key = `${item.accountId}:${item.product}:${item.currency}`
    const base = `${productName(item.product)} · ${item.currency}`
    if (!seriesByKey.has(key)) {
      const accountIndex = (baseCounts.get(base) ?? 0) + 1
      seriesByKey.set(key, { key, base, accountIndex })
      baseCounts.set(base, accountIndex)
    }
    currencies.add(item.currency)
    const point = pointsByTime.get(item.asOf) ?? { asOf: item.asOf }
    if (item.equity !== null) point[key] = item.equity
    pointsByTime.set(item.asOf, point)
  }
  const series = [...seriesByKey.values()].map(item => ({
    key: item.key,
    name: (baseCounts.get(item.base) ?? 0) > 1 ? `${item.base} · Account ${item.accountIndex}` : item.base,
  }))
  const latest = records.reduce<(typeof records)[number] | null>((current, item) =>
    !current || Date.parse(item.asOf) > Date.parse(current.asOf) ? item : current, null)
  const values = records.flatMap(item => item.equity === null ? [] : [item.equity])
  return {
    series,
    points: [...pointsByTime.entries()].sort(([a], [b]) => Date.parse(a) - Date.parse(b)).map(([, point]) => point),
    currencies: [...currencies],
    domain: paddedDomain(values),
    latest: latest && latest.equity !== null ? { value: latest.equity, currency: latest.currency } : null,
  }
}

function summarizeEventAmounts(events: FinancialEvent[]) {
  const amounts = new Map<string, { product: FinancialEvent['product']; asset: string; amount: number }>()
  for (const event of events) {
    if (event.amount === null || !Number.isFinite(event.amount)) continue
    const key = `${event.product}:${event.asset}`
    const current = amounts.get(key)
    if (current) current.amount += event.amount
    else amounts.set(key, { product: event.product, asset: event.asset, amount: event.amount })
  }
  if (!amounts.size) return 'Unavailable'
  if (amounts.size > 1) return 'Multiple units'
  const [{ asset, amount }] = amounts.values()
  return formatMoney(amount, { asset, signed: true })
}

function summarizeSnapshotValues(
  snapshots: TradingRepositorySnapshot['snapshots'],
  field: 'equity' | 'walletBalance' | 'unrealizedPnl',
) {
  const values = snapshots.filter(item => item[field] !== null && Number.isFinite(item[field]))
  const label = field === 'equity' ? 'equity' : field === 'walletBalance' ? 'wallet balance' : 'unrealized P&L'
  if (!values.length) return { value: 'Unavailable', detail: `No exchange-reported ${label} is available` }
  if (values.length > 1) return { value: 'Multiple units', detail: `${values.length} product/account snapshots; not combined` }
  const [snapshot] = values
  return {
    value: money(snapshot[field], snapshot.currency),
    detail: `${productName(snapshot.product)} · ${date(snapshot.asOf)}`,
  }
}

function paddedDomain(values: number[]): [number, number] {
  if (!values.length) return [0, 1]
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const padding = minimum === maximum
    ? Math.max(Math.abs(minimum) * 0.02, 0.01)
    : (maximum - minimum) * 0.05
  return [minimum - padding, maximum + padding]
}

function Workspace({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="flex flex-col gap-5"><header><div className="mb-2 flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{source}</div><p className="text-sm text-muted-foreground">{description}</p></header>{children}</div>
}
function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <section className="rounded-lg border border-border bg-card p-4 sm:p-5"><h2 className="text-sm font-medium">{title}</h2>{subtitle && <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>}<div className="mt-4">{children}</div></section>
}
function Metric({ label: title, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-lg border border-border bg-card p-4"><p className="text-[11px] text-muted-foreground">{title}</p><p className="mt-2 truncate font-mono text-lg">{value}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p></div>
}
function ExecutionTable({ executions, onSelect }: { executions: Execution[]; onSelect: (execution: Execution) => void }) {
  const shortId = (id: string) => id.split(':').at(-1) ?? id
  const price = (value: number | null) => value === null ? '—' : number(value, 8)
  const sideTone = (side: string) => ['BUY', 'LONG'].includes(side.toUpperCase())
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : ['SELL', 'SHORT'].includes(side.toUpperCase())
      ? 'border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400'
      : 'border-border bg-muted text-muted-foreground'
  return <div className="overflow-x-auto rounded-md border border-border">
    <table className="w-full min-w-[880px] table-fixed text-xs">
      <colgroup><col className="w-[150px]" /><col className="w-[145px]" /><col className="w-[155px]" /><col className="w-[120px]" /><col className="w-[72px]" /><col className="w-[100px]" /><col className="w-[100px]" /><col className="w-[100px]" /><col className="w-[105px]" /><col className="w-[78px]" /></colgroup>
      <thead className="sticky top-0 z-10 border-b border-border bg-muted/70 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
        <tr>{['Execution / order', 'Timestamp', 'Instrument', 'Product', 'Side', 'Price', 'Quantity', 'Commission', 'Realized P&L', 'Liquidity'].map(item => <th key={item} className="px-3 py-2.5 font-medium">{item}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-border">
        {executions.map(item => <tr key={`${item.accountId}:${item.id}`} onClick={() => onSelect(item)} className="cursor-pointer transition-colors hover:bg-muted/40">
          <td className="px-3 py-2.5" title={`Execution ${item.id}\nOrder ${item.orderId}`}><span className="block truncate font-mono text-[11px] font-medium">{shortId(item.id)}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">Order {shortId(item.orderId)}</span></td>
          <td className="px-3 py-2.5"><span className="block whitespace-nowrap">{Number.isFinite(Date.parse(item.executedAt)) ? new Date(item.executedAt).toLocaleDateString() : '—'}</span><span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] text-muted-foreground">{Number.isFinite(Date.parse(item.executedAt)) ? new Date(item.executedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}</span></td>
          <td className="truncate px-3 py-2.5 font-mono font-medium" title={item.symbol}>{item.symbol}</td>
          <td className="px-3 py-2.5 text-[10px] text-muted-foreground">{productName(item.product)}</td>
          <td className="px-3 py-2.5"><span className={`inline-flex min-w-12 justify-center rounded border px-1.5 py-1 text-[10px] font-semibold ${sideTone(item.side)}`}>{item.side}</span></td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{price(item.price)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{number(item.quantity, 8)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-red-600 dark:text-red-400">{item.commission === null ? '—' : formatMoney(-Math.abs(item.commission), { asset: item.commissionAsset, signed: true })}</td>
          <td className={`whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium tabular-nums ${item.realizedPnl === null || item.realizedPnl === 0 ? 'text-muted-foreground' : item.realizedPnl > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{item.realizedPnl === null ? '—' : formatMoney(item.realizedPnl, { signed: true })}</td>
          <td className="px-3 py-2.5 text-[10px] text-muted-foreground">{item.isMaker === undefined ? '—' : item.isMaker ? 'Maker' : 'Taker'}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}
function OrderTable({ orders, onSelect }: { orders: Order[]; onSelect: (order: Order) => void }) {
  const shortId = (id: string) => id.split(':').at(-1) ?? id
  const sideTone = (side: Order['side']) => ['BUY', 'LONG'].includes(side)
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : ['SELL', 'SHORT'].includes(side)
      ? 'border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400'
      : 'border-border bg-muted text-muted-foreground'
  return <div className="overflow-x-auto rounded-md border border-border">
    <table className="w-full min-w-[940px] table-fixed text-xs">
      <colgroup><col className="w-[110px]" /><col className="w-[150px]" /><col className="w-[130px]" /><col className="w-[118px]" /><col className="w-[72px]" /><col className="w-[90px]" /><col className="w-[105px]" /><col className="w-[100px]" /><col className="w-[100px]" /><col className="w-[110px]" /><col className="w-[95px]" /></colgroup>
      <thead className="sticky top-0 z-10 border-b border-border bg-muted/70 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
        <tr>{['Order ID', 'Timestamp', 'Instrument', 'Product', 'Side', 'Type', 'Price', 'Quantity', 'Filled', 'Status', 'Reduce only'].map(item => <th key={item} className="px-3 py-2.5 font-medium">{item}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-border">
        {orders.map(order => <tr key={`${order.accountId}:${order.id}`} onClick={() => onSelect(order)} className="cursor-pointer transition-colors hover:bg-muted/40">
          <td className="px-3 py-2.5 font-mono text-[11px] font-medium" title={order.id}>{shortId(order.id)}</td>
          <td className="px-3 py-2.5"><span className="block whitespace-nowrap">{order.openedAt && Number.isFinite(Date.parse(order.openedAt)) ? new Date(order.openedAt).toLocaleDateString() : '—'}</span><span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] text-muted-foreground">{order.openedAt && Number.isFinite(Date.parse(order.openedAt)) ? new Date(order.openedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}</span></td>
          <td className="truncate px-3 py-2.5 font-mono font-medium" title={order.symbol}>{order.symbol}</td>
          <td className="px-3 py-2.5 text-[10px] text-muted-foreground">{productName(order.product)}</td>
          <td className="px-3 py-2.5"><span className={`inline-flex min-w-12 justify-center rounded border px-1.5 py-1 text-[10px] font-semibold ${sideTone(order.side)}`}>{order.side}</span></td>
          <td className="px-3 py-2.5 text-[10px]">{label(order.type)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{order.type.toUpperCase() === 'MARKET' ? <span className="text-muted-foreground">Market</span> : order.price === null ? '—' : number(order.price, 8)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{number(order.quantity, 8)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{number(order.executedQuantity, 8)}</td>
          <td className="px-3 py-2.5"><StatusBadge status={order.status} /></td>
          <td className="px-3 py-2.5">{order.reduceOnly === undefined ? '—' : order.reduceOnly ? <span className="text-amber-600 dark:text-amber-400">Yes</span> : <span className="text-muted-foreground">No</span>}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}
function Chart({ children, height = 240 }: { children: ReactNode; height?: number }) {
  return <div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer></div>
}
function Tip({ active, payload, label: tipLabel, moneyValues = false, asset }: { active?: boolean; payload?: { dataKey: string; name?: string; value?: number }[]; label?: string; moneyValues?: boolean; asset?: string }) {
  if (!active || !payload?.length) return null
  return <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg"><p className="font-medium">{tipLabel}</p>{payload.map((item, index) => <p key={`${item.dataKey}:${index}`} className="font-mono">{item.name}: {typeof item.value === 'number' ? moneyValues ? formatMoney(item.value, { asset }) : number(item.value) : item.value}</p>)}</div>
}
function ActivityChart({ data }: { data: { label: string; orders: number; executions: number }[] }) {
  return <LineChart data={data}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip content={<Tip />} /><Line dataKey="orders" name="Orders" stroke="var(--foreground)" /><Line dataKey="executions" name="Executions" stroke="var(--muted-foreground)" /></LineChart>
}
function FinancialEventActivityChart({ data }: { data: { label: string; events: number }[] }) {
  return <BarChart data={data}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip content={<Tip />} /><Bar dataKey="events" name="Financial events" fill="var(--chart-3)" /></BarChart>
}
function Empty({ text }: { text: string }) {
  return <div className="grid min-h-40 place-items-center rounded border border-dashed border-border px-4 text-center text-xs text-muted-foreground">{text}</div>
}
function EventTable({ events }: { events: TradingRepositorySnapshot['financialEvents'] }) {
  const eventIdentifier = (item: FinancialEvent) => item.tradeId ?? item.transactionId ?? item.id.split(':').slice(-2).join(':')
  const amountTone = (amount: number | null) => amount === null || amount === 0
    ? 'text-muted-foreground'
    : amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  return <div className="max-h-[320px] overflow-auto rounded-md border border-border">
    <table className="w-full min-w-[760px] table-fixed text-xs">
      <colgroup><col className="w-[130px]" /><col className="w-[145px]" /><col className="w-[150px]" /><col className="w-[115px]" /><col className="w-[110px]" /><col className="w-[110px]" /></colgroup>
      <thead className="sticky top-0 z-10 border-b border-border bg-muted/70 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
        <tr>{['Event ID', 'Timestamp', 'Instrument', 'Product', 'Type', 'Realized P&L'].map(item => <th key={item} className="px-3 py-2.5 font-medium">{item}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-border">
        {events.map((item, index) => <tr key={`${item.accountId}:${item.product}:${item.id}:${item.occurredAt}:${index}`} className="transition-colors hover:bg-muted/40">
          <td className="px-3 py-2.5 font-mono text-[11px] font-medium" title={item.id}><span className="block truncate">{eventIdentifier(item)}</span></td>
          <td className="px-3 py-2.5"><span className="block whitespace-nowrap">{Number.isFinite(Date.parse(item.occurredAt)) ? new Date(item.occurredAt).toLocaleDateString() : '—'}</span><span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] text-muted-foreground">{Number.isFinite(Date.parse(item.occurredAt)) ? new Date(item.occurredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''}</span></td>
          <td className="truncate px-3 py-2.5 font-mono font-medium" title={item.symbol ?? item.description ?? 'No symbol reported'}>{item.symbol ?? '—'}</td>
          <td className="px-3 py-2.5 text-[10px] text-muted-foreground">{productName(item.product)}</td>
          <td className="px-3 py-2.5"><span className="inline-flex rounded border border-border bg-muted/50 px-1.5 py-1 text-[10px] font-medium">{label(item.type)}</span></td>
          <td className={`whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums ${amountTone(item.amount)}`}>{item.amount === null ? '—' : formatMoney(item.amount, { asset: item.asset, signed: true })}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}

function BalancesTable({ balances }: { balances: TradingRepositorySnapshot['balances'] }) {
  const total = (free: number | null, locked: number | null) => free === null || locked === null ? null : free + locked
  return <div className="overflow-auto rounded-md border border-border">
    <table className="w-full min-w-[720px] table-fixed text-xs">
      <colgroup><col className="w-[140px]" /><col className="w-[155px]" /><col className="w-[115px]" /><col className="w-[115px]" /><col className="w-[115px]" /><col className="w-[105px]" /></colgroup>
      <thead className="sticky top-0 z-10 border-b border-border bg-muted/70 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
        <tr>{['Asset', 'Product', 'Available', 'Locked', 'Total', 'As of'].map(item => <th key={item} className="px-3 py-2.5 font-medium">{item}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-border">
        {balances.map((item, index) => <tr key={`${item.accountId}:${item.product}:${item.asset}:${index}`} className="transition-colors hover:bg-muted/40">
          <td className="px-3 py-2.5 font-mono font-medium">{item.asset}</td>
          <td className="px-3 py-2.5 text-[10px] text-muted-foreground">{productName(item.product ?? 'unknown')}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{balanceAmount(item.free, item.asset)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{balanceAmount(item.locked, item.asset)}</td>
          <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{balanceAmount(total(item.free, item.locked), item.asset)}</td>
          <td className="px-3 py-2.5"><span className="block whitespace-nowrap text-[10px]">{Number.isFinite(Date.parse(item.asOf)) ? new Date(item.asOf).toLocaleDateString() : '—'}</span><span className="mt-0.5 block whitespace-nowrap font-mono text-[10px] text-muted-foreground">{Number.isFinite(Date.parse(item.asOf)) ? new Date(item.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</span></td>
        </tr>)}
      </tbody>
    </table>
  </div>
}
function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}><aside className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-background p-5 shadow-xl" onClick={event => event.stopPropagation()}><div className="mb-5 flex items-center justify-between"><h2 className="text-base font-semibold">{title}</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>{children}</aside></div>
}
function StatusBadge({ status }: { status: string }) {
  const tone = status === 'FILLED' ? 'border-[var(--positive)]/40 text-[var(--positive)] bg-[var(--positive)]/5' : status === 'PARTIALLY_FILLED' ? 'border-[var(--warning)]/40 text-[var(--warning)] bg-[var(--warning)]/5' : status === 'NEW' ? 'border-[var(--info)]/40 text-[var(--info)] bg-[var(--info)]/5' : status === 'REJECTED' ? 'border-[var(--negative)]/40 text-[var(--negative)] bg-[var(--negative)]/5' : 'border-border text-muted-foreground'
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] ${tone}`}>{label(status)}</span>
}
function Detail({ label: title, value }: { label: string; value: string }) {
  return <div className="border-b border-border py-3 text-xs"><p className="text-muted-foreground">{title}</p><p className="mt-1 font-mono">{value}</p></div>
}
function RawBlock() {
  return <details className="mt-5 rounded border border-border p-3"><summary className="cursor-pointer text-xs font-medium">Original Binance response</summary><p className="mt-3 text-[10px] leading-4 text-muted-foreground">The complete response is retained in the local SQLite database and omitted from workspace payloads to avoid loading large historical data into the browser.</p></details>
}
function RiskFlag({ position }: { position: Position }) {
  const distance = position.markPrice !== null && position.markPrice > 0 && position.liquidationPrice !== null && position.liquidationPrice > 0
    ? Math.abs(position.markPrice - position.liquidationPrice) / position.markPrice * 100 : null
  const high = (position.leverage ?? 0) >= 5 || (distance !== null && distance < 15)
  return <div className={`mt-5 rounded border p-3 text-xs ${high ? 'border-amber-500/40 bg-amber-500/5' : 'border-border'}`}><div className="flex gap-2"><ShieldAlert className="size-4 shrink-0" /><span>{high ? 'Informational flag based on reported leverage or liquidation distance.' : distance === null && position.leverage === null ? 'Insufficient reported fields to evaluate this position.' : 'No configured informational thresholds were met.'}</span></div></div>
}
