'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  Activity, BarChart3, BookOpen, CalendarDays, ChevronDown, CircleHelp, ClipboardList,
  LayoutDashboard, Menu, Moon, Settings2, ShieldAlert, Sun, Wallet, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AnalyticsDashboard } from '@/components/analytics-dashboard'
import { CalendarPage } from '@/components/calendar-page'
import { PlaybookPage } from '@/components/playbook-page'
import { AIReviewPage } from '@/components/ai-review-page'
import { SettingsCenter } from '@/components/settings-center'
import { OverviewDashboard, type OverviewTrade } from '@/components/overview-dashboard'
import { TradesPage } from '@/components/trades-page'
import { OrdersExecutionsPage, PortfolioPage, PositionsRiskPage } from '@/components/data-workspaces'
import { BinanceSyncStatus } from '@/components/binance-sync-status'
import { useJournalTrades } from '@/lib/trading/manual-journal'
import type { TradingRepositorySnapshot } from '@/lib/trading/types'

type AccountSummary = { id: string; name: string; enabled: boolean }

const nav = [
  ['Overview', LayoutDashboard], ['Portfolio', Wallet], ['Trades', Activity],
  ['Orders & Executions', ClipboardList], ['Positions & Risk', ShieldAlert],
  ['Analytics', BarChart3], ['Calendar', CalendarDays], ['Playbook', BookOpen], ['AI Review', BookOpen],
] as const

export function TradingJournal({ initialSnapshot, initialAccounts }: {
  initialSnapshot: TradingRepositorySnapshot
  initialAccounts: AccountSummary[]
}) {
  const [active, setActive] = useState('Overview')
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [accounts, setAccounts] = useState(initialAccounts)
  const { trades, error: journalError } = useJournalTrades()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [accountMenu, setAccountMenu] = useState(false)
  const [selected, setSelected] = useState<OverviewTrade | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    async function refreshData() {
      const response = await fetch('/api/binance/coverage', { cache: 'no-store' })
      const result = await response.json() as { accounts?: AccountSummary[]; snapshot?: TradingRepositorySnapshot; error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not refresh persisted trading data.')
      if (result.snapshot) setSnapshot(result.snapshot)
      if (result.accounts) setAccounts(result.accounts)
    }

    function handleDataUpdate() {
      void refreshData().catch(error => console.error('Could not refresh Binance data after sync.', error))
    }

    window.addEventListener('binance-data-updated', handleDataUpdate)
    return () => window.removeEventListener('binance-data-updated', handleDataUpdate)
  }, [])

  const isDark = mounted && resolvedTheme === 'dark'
  const enabledAccounts = accounts.filter(account => account.enabled)
  const activeAccount = enabledAccounts[0]?.name
  const enabledAccountIds = useMemo(() => new Set(enabledAccounts.map(account => account.id)), [enabledAccounts])
  const enabledSnapshot = useMemo<TradingRepositorySnapshot>(() => ({
    raw: snapshot.raw.filter(record => enabledAccountIds.has(record.accountId)),
    balances: snapshot.balances.filter(record => enabledAccountIds.has(record.accountId)),
    orders: snapshot.orders.filter(record => enabledAccountIds.has(record.accountId)),
    executions: snapshot.executions.filter(record => enabledAccountIds.has(record.accountId)),
    financialEvents: snapshot.financialEvents.filter(record => enabledAccountIds.has(record.accountId)),
    positions: snapshot.positions.filter(record => enabledAccountIds.has(record.accountId)),
    snapshots: snapshot.snapshots.filter(record => enabledAccountIds.has(record.accountId)),
    market: snapshot.market,
    trades: snapshot.trades.filter(record => enabledAccountIds.has(record.accountId)),
    coverage: snapshot.coverage.filter(record => enabledAccountIds.has(record.accountId)),
  }), [snapshot, enabledAccountIds])

  return <div className="min-h-screen bg-background text-foreground">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[238px] flex-col border-r border-border bg-sidebar p-4 transition-transform lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between px-2 py-1"><div className="flex items-center gap-2"><div className="grid size-6 place-items-center border border-foreground"><span className="text-[10px] font-bold">J</span></div><span className="text-[13px] font-semibold tracking-[0.25em]">JOURNAL</span></div><Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X /></Button></div>
      <div className="relative mt-8"><button onClick={() => setAccountMenu(value => !value)} className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-xs hover:bg-muted" aria-expanded={accountMenu}><span><span className="block font-medium">{activeAccount ?? 'No exchange connected'}</span><span className="font-mono text-[10px] text-muted-foreground">{enabledAccounts.length ? `BINANCE · ${enabledAccounts.length} account${enabledAccounts.length === 1 ? '' : 's'}` : 'Connect an exchange in settings'}</span></span><ChevronDown className="size-3.5 text-muted-foreground" /></button>{accountMenu && <div className="absolute left-0 right-0 top-12 z-50 rounded-md border border-border bg-popover p-1 shadow-lg">{enabledAccounts.length ? enabledAccounts.map(account => <div key={account.id} className="flex items-center gap-2 rounded px-2 py-2 text-xs"><span className="size-1.5 rounded-full bg-[var(--positive)]" />{account.name}<span className="ml-auto text-[10px] text-muted-foreground">Binance</span></div>) : <div className="px-2 py-2 text-xs text-muted-foreground">No connected accounts</div>}<button onClick={() => { setActive('Data & Settings'); setAccountMenu(false); setMobileNav(false) }} className="w-full rounded px-2 py-2 text-left text-xs hover:bg-muted">Manage Connections</button></div>}</div>
      <nav className="mt-7 flex flex-1 flex-col gap-1" aria-label="Primary navigation"><p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Workspace</p>{nav.map(([label, Icon]) => <button key={label} onClick={() => { setActive(label); setMobileNav(false) }} className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${active === label ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="size-4" />{label}</button>)}<div className="my-5 border-t border-border" /><p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">System</p><button onClick={() => setActive('Data & Settings')} className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] ${active === 'Data & Settings' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Settings2 className="size-4" />Data & Settings</button></nav>
      <div className="border-t border-border pt-4"><div className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-foreground" /> Local workspace</div><div className="mt-3 flex items-center justify-between px-2"><span className="font-mono text-[10px] text-muted-foreground">v0.1.0</span><CircleHelp className="size-3.5 text-muted-foreground" /></div></div>
    </aside>
    <main className="lg:pl-[238px]"><header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-5 backdrop-blur lg:px-8"><div className="flex items-center gap-3"><Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu /></Button><div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span>Workspace</span><span>/</span><span className="text-foreground">{active}</span></div><span className="text-sm font-medium sm:hidden">{active}</span></div><div className="flex items-center gap-1.5"><BinanceSyncStatus onOpenSettings={() => setActive('Data & Settings')} /><Button variant="ghost" size="icon-sm" onClick={() => setTheme(isDark ? 'light' : 'dark')} aria-label={mounted ? (isDark ? 'Switch to light theme' : 'Switch to dark theme') : 'Toggle theme'}>{mounted && isDark ? <Sun /> : <Moon />}</Button><div className="ml-2 grid size-7 place-items-center rounded-full border border-border bg-muted text-[10px] font-medium">TJ</div></div></header>
      <div className={`mx-auto max-w-[1440px] ${active === 'AI Review' ? 'h-[calc(100dvh-3.5rem)] p-0 lg:p-0' : 'p-5 lg:p-8'}`}>
        {journalError && <p role="alert" className="mb-4 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive">{journalError}</p>}
        {active === 'Overview' ? <OverviewDashboard trades={trades} snapshot={enabledSnapshot} accountIds={enabledAccounts.map(account => account.id)} onSelect={setSelected} onNavigate={setActive} />
          : active === 'Portfolio' ? <PortfolioPage snapshot={enabledSnapshot} />
            : active === 'Trades' ? <TradesPage snapshot={enabledSnapshot} />
              : active === 'Orders & Executions' ? <OrdersExecutionsPage snapshot={enabledSnapshot} />
                : active === 'Positions & Risk' ? <PositionsRiskPage snapshot={enabledSnapshot} />
                  : active === 'Analytics' ? <AnalyticsDashboard snapshot={enabledSnapshot} trades={trades} accountIds={enabledAccounts.map(account => account.id)} />
                    : active === 'Calendar' ? <CalendarPage trades={trades} events={enabledSnapshot.financialEvents} />
                      : active === 'Playbook' ? <PlaybookPage trades={trades} />
                        : active === 'AI Review' ? <AIReviewPage trades={trades} snapshot={enabledSnapshot} />
                          : <SettingsCenter theme={resolvedTheme} setTheme={setTheme} trades={trades} />}
      </div>
    </main>
    {selected && <TradeDrawer trade={selected} onClose={() => setSelected(null)} />}
  </div>
}

function TradeDrawer({ trade, onClose }: { trade: OverviewTrade; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}><aside className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-background p-5 shadow-xl" onClick={event => event.stopPropagation()}><div className="mb-5 flex items-center justify-between"><h2 className="text-base font-semibold">{trade.symbol} journal entry</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div><div className="space-y-3 text-xs"><p><span className="text-muted-foreground">Direction:</span> {trade.side}</p><p><span className="text-muted-foreground">Market:</span> {trade.product}</p><p><span className="text-muted-foreground">Reported P&amp;L:</span> {trade.pnl}</p><p><span className="text-muted-foreground">Fees recorded:</span> {trade.fees}</p><p><span className="text-muted-foreground">Strategy:</span> {trade.strategy || 'Not specified'}</p><p><span className="text-muted-foreground">Notes:</span> {trade.note || 'No journal note'}</p><p><span className="text-muted-foreground">Closed:</span> {trade.closed}</p></div></aside></div>
}
