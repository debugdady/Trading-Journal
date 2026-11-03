'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ChevronLeft, ChevronRight, FileText, Save, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FinancialEvent } from '@/lib/trading/types'
import { formatMoney } from '@/lib/trading/format-money'

type Trade = { id: string; symbol: string; side: string; product: string; pnl: number; fees: number; duration: string; closed: string; strategy: string; note: string }
type Journal = { mood: string; notes: string; tags: string[]; checks: string[] }
type DayStats = { rows: Trade[]; gross: number; fees: number; net: number; wins: number; losses: number; events: FinancialEvent[] }
const moods = ['Excellent', 'Focused', 'Neutral', 'Frustrated', 'Impulsive']
const checks = ['Followed my trading plan.', 'Respected risk limits.', 'Avoided impulsive entries.', 'Exited according to plan.', 'Recorded mistakes and lessons.']
const tags = ['Followed plan', 'Overtrading', 'Revenge trading', 'Missed setup', 'Excellent execution', 'Poor risk management', 'News-driven trading']
const fmt = (n: number) => formatMoney(n, { prefix: '$', signed: true })
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const parseClosed = (value: string) => new Date(value.replace(' · ', ' '))
const productName = (value: string) => ({ spot: 'Spot', 'usd-m-futures': 'USDⓈ-M Futures', 'coin-m-futures': 'COIN-M Futures', wallet: 'Wallet' }[value] ?? value)
const formatEventAmount = (value: number, asset: string) => formatMoney(value, { asset, signed: true })

export function CalendarPage({ trades, events = [] }: { trades: Trade[]; events?: FinancialEvent[] }) {
  const now = new Date()
  const [view, setView] = useState<'Month' | 'Year'>('Month')
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1))
  const [selected, setSelected] = useState(dateKey(now))
  const [market, setMarket] = useState('All Markets')
  const [symbol, setSymbol] = useState('All Symbols')
  const [direction, setDirection] = useState('All')
  const [strategy, setStrategy] = useState('All')
  const [pnlMode, setPnlMode] = useState('Net P&L')
  const [journal, setJournal] = useState<Record<string, Journal>>({})
  const [draft, setDraft] = useState<Journal>({ mood: 'Focused', notes: '', tags: [], checks: [] })
  const [saved, setSaved] = useState(false)

  useEffect(() => { try { setJournal(JSON.parse(localStorage.getItem('trading-journal-entries') || '{}')) } catch {} }, [])
  useEffect(() => { setDraft(journal[selected] || { mood: 'Focused', notes: '', tags: [], checks: [] }); setSaved(false) }, [selected, journal])

  const filtered = useMemo(() => trades.filter(t => (market === 'All Markets' || t.product === market) && (symbol === 'All Symbols' || t.symbol === symbol) && (direction === 'All' || t.side === direction) && (strategy === 'All' || t.strategy === strategy)), [trades, market, symbol, direction, strategy])
  const byDay = useMemo(() => { const map: Record<string, Trade[]> = {}; filtered.forEach(t => { const d = dateKey(parseClosed(t.closed)); (map[d] ||= []).push(t) }); return map }, [filtered])
  const eventsByDay = useMemo(() => {
    const map: Record<string, FinancialEvent[]> = {}
    events.filter(event => market === 'All Markets' || productName(event.product) === market)
      .filter(event => symbol === 'All Symbols' || event.symbol === symbol)
      .forEach(event => {
        const occurredAt = new Date(event.occurredAt)
        if (!Number.isFinite(occurredAt.getTime())) return
        const key = dateKey(occurredAt)
        ;(map[key] ||= []).push(event)
      })
    return map
  }, [events, market, symbol])
  const dayStats = (key: string): DayStats => { const rows = byDay[key] || []; const gross = rows.reduce((s, t) => s + t.pnl, 0); const fees = rows.reduce((s, t) => s + t.fees, 0); const net = pnlMode === 'Gross P&L' ? gross : gross - fees; return { rows, gross, fees, net, wins: rows.filter(t => t.pnl > 0).length, losses: rows.filter(t => t.pnl < 0).length, events: eventsByDay[key] ?? [] } }
  const monthRows = Object.entries(byDay).filter(([key]) => { const d = new Date(`${key}T12:00:00`); return d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear() })
  const monthNet = monthRows.length ? monthRows.reduce((sum, [key]) => sum + dayStats(key).net, 0) : null
  const monthlyStats = monthRows.map(([key]) => dayStats(key))
  const tradingDays = monthRows.length
  const closedTrades = monthlyStats.reduce((s, x) => s + x.rows.length, 0)
  const wins = monthlyStats.reduce((s, x) => s + x.wins, 0)
  const best = monthRows.length ? Math.max(...monthlyStats.map(x => x.net)) : null
  const worst = monthRows.length ? Math.min(...monthlyStats.map(x => x.net)) : null
  const monthEvents = Object.entries(eventsByDay).filter(([key]) => {
    const d = new Date(`${key}T12:00:00`)
    return d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear()
  }).reduce((sum, [, rows]) => sum + rows.length, 0)
  const strategies = Array.from(new Set(trades.map(t => t.strategy)))
  const symbols = Array.from(new Set([...trades.map(t => t.symbol), ...events.map(event => event.symbol).filter((value): value is string => Boolean(value))]))
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const offset = (start.getDay() + 6) % 7
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => i - offset + 1)
  const changePeriod = (delta: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1))
  const saveJournal = () => { const next = { ...journal, [selected]: draft }; setJournal(next); localStorage.setItem('trading-journal-entries', JSON.stringify(next)); setSaved(true) }
  const clearFilters = () => { setMarket('All Markets'); setSymbol('All Symbols'); setDirection('All'); setStrategy('All'); setPnlMode('Net P&L') }

  return <div className="flex flex-col gap-5">
    <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end"><div><div className="mb-2 flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">Trading Calendar</h1><span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-muted-foreground">ACCOUNT + LOCAL DATA</span></div><p className="text-sm text-muted-foreground">Review synced account activity alongside saved journal entries and daily notes.</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex rounded-md border border-border p-0.5"><button onClick={() => setView('Month')} className={`px-3 py-1.5 text-xs ${view === 'Month' ? 'bg-foreground text-background' : 'text-muted-foreground'}`}>Month</button><button onClick={() => setView('Year')} className={`px-3 py-1.5 text-xs ${view === 'Year' ? 'bg-foreground text-background' : 'text-muted-foreground'}`}>Year</button></div><Button variant="outline" size="sm" onClick={() => { setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(dateKey(now)) }}>Today</Button><Button variant="outline" size="icon-sm" onClick={() => changePeriod(-1)} aria-label="Previous period"><ChevronLeft /></Button><span className="min-w-[130px] text-center text-xs font-medium">{cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span><Button variant="outline" size="icon-sm" onClick={() => changePeriod(1)} aria-label="Next period"><ChevronRight /></Button></div></header>
    <div className="flex flex-wrap items-center gap-2 border border-border bg-card p-3"><SlidersHorizontal className="mr-1 size-4 text-muted-foreground" />{[['Market', market, setMarket, ['All Markets', 'Spot', 'USDⓈ-M Futures', 'COIN-M Futures']], ['Symbol', symbol, setSymbol, ['All Symbols', ...symbols]], ['Direction', direction, setDirection, ['All', 'Long', 'Short']], ['Strategy', strategy, setStrategy, ['All', ...strategies]], ['P&L', pnlMode, setPnlMode, ['Net P&L', 'Gross P&L']]].map(([label, value, setter, options]: any) => <label key={label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span>{label}</span><select value={value} onChange={e => setter(e.target.value)} className="h-8 border border-border bg-background px-2 text-xs text-foreground">{options.map((o: string) => <option key={o}>{o}</option>)}</select></label>)}<Button variant="ghost" size="sm" onClick={clearFilters}><X data-icon="inline-start" /> Clear</Button></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{[['Net P&L', monthNet === null ? 'Unavailable' : fmt(monthNet), monthNet === null ? '' : monthNet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'], ['Trading Days', tradingDays, ''], ['Closed Trades', closedTrades, ''], ['Win Rate', closedTrades ? `${Math.round((wins / closedTrades) * 100)}%` : 'Unavailable', ''], ['Best Day', best === null ? 'Unavailable' : fmt(best), best === null ? '' : 'text-emerald-600 dark:text-emerald-400'], ['Worst Day', worst === null ? 'Unavailable' : fmt(worst), worst === null ? '' : worst < 0 ? 'text-red-600 dark:text-red-400' : '']].map(([label, value, color]) => <div key={label} className="border border-border bg-card p-4"><p className="text-[11px] text-muted-foreground">{label}</p><p className={`mt-2 font-mono text-lg ${color}`}>{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{label === 'Closed Trades' ? 'attributed to exit dates' : label === 'Trading Days' ? 'days with journal trades' : 'manual journal data only'}</p></div>)}</div>
    {view === 'Year' ? <YearView year={cursor.getFullYear()} trades={filtered} events={Object.values(eventsByDay).flat()} journals={journal} onMonth={(month, day) => { setCursor(new Date(cursor.getFullYear(), month, 1)); setSelected(`${cursor.getFullYear()}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`); setView('Month') }} /> : <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]"><section className="min-w-0 border border-border bg-card"><div className="grid grid-cols-7 border-b border-border bg-muted/30">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="px-2 py-3 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{d}</div>)}</div><div className="grid grid-cols-7">{cells.map((day, i) => { const date = new Date(cursor.getFullYear(), cursor.getMonth(), day); const key = dateKey(date); const current = day > 0 && day <= days; const stat = dayStats(key); const note = Boolean(journal[key]); return <button key={`${key}-${i}`} disabled={!current} onClick={() => setSelected(key)} title={`${date.toLocaleDateString('en-US', { dateStyle: 'full' })} · ${stat.rows.length ? fmt(stat.net) : 'No journal P&L'} · ${stat.rows.length} trades · ${stat.events.length} Binance events`} className={`min-h-[94px] border-b border-r border-border p-2 text-left transition-colors hover:bg-muted/60 ${!current ? 'bg-muted/15 text-muted-foreground/40' : ''} ${selected === key ? 'bg-accent ring-2 ring-inset ring-foreground' : ''}`}><div className="flex items-start justify-between"><span className="font-mono text-xs">{current ? day : ''}</span>{note && <FileText className="size-3 text-amber-600" />}</div>{current && stat.rows.length > 0 && <><div className={`mt-3 font-mono text-xs ${stat.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fmt(stat.net)}</div><div className="mt-1 text-[10px] text-muted-foreground">{stat.rows.length} trades · {stat.wins}W / {stat.losses}L</div></>}{current && stat.events.length > 0 && <div className={`mt-1 text-[10px] ${stat.rows.length ? 'text-muted-foreground' : 'text-[var(--info)]'}`}>{stat.events.length} Binance event{stat.events.length === 1 ? '' : 's'}</div>}</button> })}</div><div className="flex items-center justify-between border-t border-border px-4 py-3 text-[11px] text-muted-foreground"><span>Week totals are derived from exit dates</span><span className="font-mono text-foreground">Journal month {monthNet === null ? 'Unavailable' : fmt(monthNet)} · {monthEvents} Binance events</span></div></section><DayReview selected={selected} stat={dayStats(selected)} draft={draft} setDraft={setDraft} saved={saved} saveJournal={saveJournal} journal={journal} /></div>}
  </div>
}

function DayReview({ selected, stat, draft, setDraft, saved, saveJournal, journal }: {
  selected: string
  stat: DayStats
  draft: Journal
  setDraft: Dispatch<SetStateAction<Journal>>
  saved: boolean
  saveJournal: () => void
  journal: Record<string, Journal>
}) {
  const date = new Date(`${selected}T12:00:00Z`)
  const toggle = (field: 'tags' | 'checks', value: string) => setDraft(current => ({
    ...current,
    [field]: current[field].includes(value) ? current[field].filter(item => item !== value) : [...current[field], value],
  }))
  const metrics = [
    ['Gross', stat.rows.length ? fmt(stat.gross) : 'Unavailable'],
    ['Fees', stat.rows.length ? fmt(-stat.fees) : 'Unavailable'],
    ['Avg trade', stat.rows.length ? fmt(stat.net / stat.rows.length) : 'Unavailable'],
    ['Win rate', stat.rows.length ? `${Math.round((stat.wins / stat.rows.length) * 100)}%` : 'Unavailable'],
  ]

  return <aside className="flex flex-col gap-4 border border-border bg-card p-5">
    <div className="flex items-start justify-between">
      <div>
        <h2 className="text-sm font-medium">{date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</h2>
        <p className={`mt-1 font-mono text-lg ${stat.rows.length ? stat.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>{stat.rows.length ? fmt(stat.net) : 'Unavailable'}</p>
        <p className="text-[11px] text-muted-foreground">{stat.rows.length} closed trades · {stat.wins}W / {stat.losses}L</p>
      </div>
      {journal[selected] && <span className="rounded border border-amber-500/40 px-2 py-1 text-[10px] text-amber-600">Saved</span>}
    </div>
    <div className="grid grid-cols-2 gap-2 text-xs">{metrics.map(([label, value]) => <div key={label} className="border border-border p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-mono">{value}</p></div>)}</div>
    <div>
      <h3 className="mb-2 text-xs font-medium">Trades closed this day</h3>
      {stat.rows.length
        ? <div className="divide-y divide-border border-y border-border">{stat.rows.map(trade => <div key={trade.id} className="flex items-center justify-between py-2 text-xs"><span><span className="font-mono">{trade.symbol}</span><span className="ml-2 text-[10px] text-muted-foreground">{trade.side} · {trade.strategy}</span></span><span className={trade.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{fmt(trade.pnl - trade.fees)}</span></div>)}</div>
        : <div className="border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No closed manual trades on this day.<br /><Button variant="link" size="sm">Write a journal entry</Button></div>}
    </div>
    <div>
      <h3 className="mb-2 text-xs font-medium">Binance financial events <span className="font-normal text-muted-foreground">· {stat.events.length}</span></h3>
      {stat.events.length
        ? <div className="max-h-48 divide-y divide-border overflow-y-auto border-y border-border">{stat.events.map((event, index) => <div key={`${event.accountId}:${event.product}:${event.id}:${event.occurredAt}:${index}`} className="flex items-start justify-between gap-3 py-2 text-xs">
          <span className="min-w-0"><span className="block font-medium">{event.type.replaceAll('-', ' ')}</span><span className="text-[10px] text-muted-foreground">{productName(event.product)}{event.symbol ? ` · ${event.symbol}` : ''}</span></span>
          <span className="shrink-0 text-right font-mono">{event.amount === null ? 'Unavailable' : formatEventAmount(event.amount, event.asset)}<span className="block text-[10px] font-sans text-muted-foreground">{new Date(event.occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} UTC</span></span>
        </div>)}</div>
        : <p className="border border-dashed border-border p-3 text-center text-xs text-muted-foreground">No synced financial events for this day and market.</p>}
    </div>
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between"><h3 className="text-xs font-medium">Daily Journal</h3><span className="text-[10px] text-muted-foreground">{saved ? 'Saved just now' : 'Local only'}</span></div>
      <div className="mt-3 flex flex-wrap gap-1.5">{moods.map(mood => <button key={mood} onClick={() => setDraft(current => ({ ...current, mood }))} className={`rounded border px-2 py-1 text-[10px] ${draft.mood === mood ? 'border-foreground bg-accent text-foreground' : 'border-border text-muted-foreground'}`}>{mood}</button>)}</div>
      <textarea value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} placeholder="What went well, what went wrong, and what will you improve next time?" className="mt-3 min-h-20 w-full resize-y border border-border bg-background p-2 text-xs outline-none focus:ring-1 focus:ring-ring" />
      <div className="mt-3 flex flex-col gap-2">{checks.map(check => <label key={check} className="flex items-start gap-2 text-[11px] text-muted-foreground"><input type="checkbox" checked={draft.checks.includes(check)} onChange={() => toggle('checks', check)} />{check}</label>)}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">{tags.map(tag => <button key={tag} onClick={() => toggle('tags', tag)} className={`rounded border px-2 py-1 text-[10px] ${draft.tags.includes(tag) ? 'border-foreground bg-accent' : 'border-border text-muted-foreground'}`}>{tag}</button>)}</div>
      <Button className="mt-4 w-full" size="sm" onClick={saveJournal}><Save data-icon="inline-start" /> Save journal</Button>
    </div>
  </aside>
}

function YearView({ year, trades, events, journals, onMonth }: {
  year: number
  trades: Trade[]
  events: FinancialEvent[]
  journals: Record<string, Journal>
  onMonth: (month: number, day: number) => void
}) {
  return <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {Array.from({ length: 12 }, (_, month) => {
      const days = new Date(year, month + 1, 0).getDate()
      const first = (new Date(year, month, 1).getDay() + 6) % 7
      const rows = trades.filter(trade => {
        const closed = parseClosed(trade.closed)
        return closed.getFullYear() === year && closed.getMonth() === month
      })
      const monthEvents = events.filter(event => {
        const occurredAt = new Date(event.occurredAt)
        return occurredAt.getFullYear() === year && occurredAt.getMonth() === month
      })
      const net = rows.reduce((sum, trade) => sum + trade.pnl - trade.fees, 0)
      return <button key={month} onClick={() => onMonth(month, 1)} className="border border-border bg-card p-4 text-left hover:border-foreground">
        <div className="flex items-center justify-between"><span className="text-xs font-medium">{new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long' })}</span><span className={`font-mono text-xs ${rows.length ? net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>{rows.length ? fmt(net) : 'Unavailable'}</span></div>
        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[9px] text-muted-foreground">
          {['M','T','W','T','F','S','S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          {Array.from({ length: first + days }, (_, index) => {
            const day = index - first + 1
            const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const dayTrades = trades.filter(trade => day > 0 && dateKey(parseClosed(trade.closed)) === key)
            const dayEvents = events.filter(event => day > 0 && Number.isFinite(Date.parse(event.occurredAt)) && dateKey(new Date(event.occurredAt)) === key)
            const value = dayTrades.reduce((sum, trade) => sum + trade.pnl - trade.fees, 0)
            const color = day < 1 || day > days
              ? 'opacity-0'
              : dayTrades.length && value > 0
                ? 'bg-emerald-500/60'
                : dayTrades.length && value < 0
                  ? 'bg-red-500/60'
                  : dayEvents.length
                    ? 'bg-[var(--info)]/50'
                    : journals[key] ? 'bg-amber-500/60' : 'bg-muted'
            return <span key={index} onClick={event => { event.stopPropagation(); if (day > 0 && day <= days) onMonth(month, day) }} title={`${dayTrades.length} journal trades · ${dayEvents.length} Binance events`} className={`aspect-square rounded-sm ${color}`} />
          })}
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">{new Set(rows.map(trade => dateKey(parseClosed(trade.closed)))).size} journal days · {rows.length} trades · {monthEvents.length} Binance events</p>
      </button>
    })}
  </section>
}
