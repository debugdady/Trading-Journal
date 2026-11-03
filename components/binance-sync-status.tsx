'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, RefreshCw, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Account = {
  id: string
  name: string
  status: string
  enabled: boolean
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  recordsImported: number
}

type Coverage = { accountId: string; complete: boolean; lastError: string | null; missingPeriods: string[] }
type StatusData = { accounts: Account[]; coverage: Coverage[] }

export function BinanceSyncStatus({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [data, setData] = useState<StatusData>({ accounts: [], coverage: [] })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const response = await fetch('/api/binance/coverage', { cache: 'no-store' })
    const result = await response.json() as StatusData & { error?: string }
    if (!response.ok) throw new Error(result.error ?? 'Could not load Binance sync status.')
    setData(result)
    return result
  }, [])

  useEffect(() => {
    let active = true
    void refresh()
      .then(result => {
        if (active && result.accounts.some(account => account.enabled)) return runUpdate(false)
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load sync status.')
      })
    return () => { active = false }
  }, [refresh])

  const accounts = data.accounts.filter(account => account.enabled)
  const accountIds = new Set(accounts.map(account => account.id))
  const coverage = data.coverage.filter(row => accountIds.has(row.accountId))
  const partial = coverage.some(row => !row.complete || row.lastError)
  const lastSuccess = accounts.map(account => account.lastSuccessAt).filter((value): value is string => Boolean(value)).sort().at(-1)
  const state = busy ? 'Syncing' : accounts.length === 0 ? 'Not connected' : partial ? 'Partial coverage' : lastSuccess ? 'Connected' : 'Not synced'

  async function runUpdate(showDetails = true) {
    if (busy) return
    setBusy(true)
    setError('')
    if (showDetails) setOpen(true)
    try {
      const response = await fetch('/api/binance/sync', { method: 'POST' })
      const result = await response.json() as StatusData & { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Binance sync failed.')
      setData(result)
      window.dispatchEvent(new Event('binance-data-updated'))
      const failures = result.accounts.filter(account => account.enabled && account.lastError)
      if (failures.length) setError(failures.map(account => `${account.name}: ${account.lastError}`).join(' · '))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Binance sync failed.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="relative flex items-center gap-1.5">
    <button onClick={() => setOpen(value => !value)} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left hover:bg-muted" aria-expanded={open} aria-label="Open Binance sync status">
      <span className={`size-1.5 rounded-full ${busy ? 'animate-pulse bg-[var(--info)]' : accounts.length && !partial ? 'bg-[var(--positive)]' : accounts.length ? 'bg-[var(--warning)]' : 'bg-muted-foreground'}`} />
      <span className="hidden text-[11px] font-medium sm:inline">{state}</span>
      {lastSuccess && <span className="hidden text-[10px] text-muted-foreground md:inline">· {new Date(lastSuccess).toLocaleString()}</span>}
      <ChevronDown className="size-3 text-muted-foreground" />
    </button>
    <Button variant="outline" size="sm" onClick={() => runUpdate()} disabled={busy || accounts.length === 0} aria-label="Sync Binance now">
      <RefreshCw data-icon="inline-start" className={busy ? 'animate-spin' : ''} /><span className="hidden sm:inline">Update</span>
    </Button>
    {open && <section className="absolute right-0 top-11 z-50 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
      <div className="flex items-start justify-between border-b border-border px-4 py-3">
        <div><p className="text-sm font-medium">Binance synchronization</p><p className="mt-1 text-xs text-muted-foreground">{state}</p></div>
        <button onClick={() => setOpen(false)} aria-label="Close sync details"><X className="size-4" /></button>
      </div>
      <div className="space-y-3 p-4 text-xs">
        {accounts.length === 0 && <p className="text-muted-foreground">No enabled Binance accounts. Connect a read-only account in settings.</p>}
        {accounts.map(account => <div key={account.id} className="rounded border border-border p-3">
          <div className="flex justify-between gap-2"><span className="font-medium">{account.name}</span><span>{account.status}</span></div>
          <p className="mt-2 text-muted-foreground">Last successful sync: {account.lastSuccessAt ? new Date(account.lastSuccessAt).toLocaleString() : 'Never'}</p>
          <p className="mt-1 text-muted-foreground">Records stored: {account.recordsImported.toLocaleString()}</p>
          {account.lastError && <p className="mt-2 text-destructive">{account.lastError}</p>}
        </div>)}
        {coverage.length > 0 && <p className="text-[11px] text-muted-foreground">{coverage.filter(row => row.complete).length}/{coverage.length} endpoint scopes report complete coverage. Historical account snapshots are not provided by Binance; per-symbol history endpoints constrain discovery.</p>}
        {error && <p className="rounded border border-destructive/30 p-2 text-destructive">{error}</p>}
        <div className="flex gap-2"><Button size="sm" onClick={() => runUpdate()} disabled={busy || accounts.length === 0}><RefreshCw data-icon="inline-start" className={busy ? 'animate-spin' : ''} />Sync now</Button><Button size="sm" variant="outline" onClick={onOpenSettings}><Settings2 data-icon="inline-start" />Connection settings</Button></div>
      </div>
    </section>}
  </div>
}
