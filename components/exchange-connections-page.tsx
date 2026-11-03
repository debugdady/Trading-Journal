'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, History, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Product } from '@/lib/trading/types'

type Market = { value: Product; label: string }
type Connection = {
  id: string
  name: string
  products: Product[]
  apiKeyHint: string
  enabled: boolean
  status: string
  createdAt: string
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  recordsImported: number
}
type SyncRun = { id: string; accountId: string; startedAt: string; completedAt: string | null; status: string; recordsImported: number; error: string | null }

const markets: Market[] = [
  { value: 'spot', label: 'Spot' },
  { value: 'usd-m-futures', label: 'USDⓈ-M Futures' },
  { value: 'coin-m-futures', label: 'COIN-M Futures' },
]

export function ExchangeConnectionsPage() {
  const [accounts, setAccounts] = useState<Connection[]>([])
  const [history, setHistory] = useState<SyncRun[]>([])
  const [tab, setTab] = useState<'Accounts' | 'Sync Settings' | 'Connection History'>('Accounts')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyAccount, setBusyAccount] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch('/api/binance/coverage', { cache: 'no-store' })
    const result = await response.json() as { accounts?: Connection[]; history?: SyncRun[]; error?: string }
    if (!response.ok) throw new Error(result.error ?? 'Could not load Binance accounts.')
    setAccounts(result.accounts ?? [])
    setHistory(result.history ?? [])
  }, [])

  useEffect(() => {
    load().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load Binance accounts.'))
      .finally(() => setLoading(false))
  }, [load])

  async function sync(accountId: string) {
    setBusyAccount(accountId)
    setError('')
    try {
      const response = await fetch('/api/binance/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Binance sync failed.')
      await load()
      window.dispatchEvent(new Event('binance-data-updated'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Binance sync failed.')
      await load().catch(() => undefined)
    } finally {
      setBusyAccount(null)
    }
  }

  async function disconnect(account: Connection) {
    if (!window.confirm(`Disconnect ${account.name}? Synced journal records will be retained.`)) return
    try {
      const response = await fetch('/api/binance/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account.id }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Could not disconnect account.')
      await load()
      window.dispatchEvent(new Event('binance-data-updated'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not disconnect account.')
    }
  }

  return <div className="exchange-page flex flex-col gap-6">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">Exchange Connections</h1>
        <p className="text-sm text-muted-foreground">Connect Binance with read-only API permissions. Credentials are encrypted on this server and never returned.</p>
      </div>
      <Button onClick={() => { setEditing(null); setWizardOpen(true) }}><Plus data-icon="inline-start" />Connect Binance</Button>
    </div>
    <div className="flex flex-wrap gap-1 border-b border-border">
      {(['Accounts', 'Sync Settings', 'Connection History'] as const).map(item =>
        <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-3 py-2 text-xs ${tab === item ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{item}</button>)}
    </div>
    {error && <div role="alert" className="flex items-center justify-between rounded-md border border-destructive/30 px-4 py-3 text-xs text-destructive"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X className="size-4" /></button></div>}
    {tab === 'Accounts' && <section>
      <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-medium">Connected Accounts</h2><p className="mt-1 text-xs text-muted-foreground">Synced records remain available after an account is disconnected.</p></div><span className="text-[10px] text-muted-foreground">{accounts.length} account{accounts.length === 1 ? '' : 's'}</span></div>
      {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading saved accounts…</p> : accounts.length ? <div className="grid gap-4 lg:grid-cols-2">{accounts.map(account =>
        <article key={account.id} className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between"><div><h3 className="text-sm font-medium">{account.name}</h3><p className="mt-1 text-[10px] text-muted-foreground">Binance · {account.products.map(productName).join(' + ')} · API key {account.apiKeyHint}</p></div><span className="rounded-full border border-border px-2 py-1 text-[10px]">{account.status}</span></div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-y border-border py-4 text-xs">
            <Info label="Imported / updated records" value={account.recordsImported.toLocaleString()} />
            <Info label="Last successful sync" value={formatDate(account.lastSuccessAt)} />
            <Info label="Last attempt" value={formatDate(account.lastAttemptAt)} />
            <Info label="Created" value={formatDate(account.createdAt)} />
          </div>
          {account.lastError && <p className="mt-3 text-xs text-destructive">{account.lastError}</p>}
          <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" onClick={() => sync(account.id)} disabled={busyAccount !== null}><RefreshCw data-icon="inline-start" className={busyAccount === account.id ? 'animate-spin' : ''} />Sync Now</Button><Button size="sm" variant="outline" onClick={() => { setEditing(account); setWizardOpen(true) }}>Reconnect / edit</Button>{account.enabled && <Button size="sm" variant="ghost" onClick={() => disconnect(account)}><Trash2 data-icon="inline-start" />Disconnect</Button>}</div>
        </article>)}</div> : <div className="rounded-lg border border-dashed border-border p-8 text-center"><p className="text-sm font-medium">No Binance accounts connected</p><p className="mt-1 text-xs text-muted-foreground">Create a read-only API key on Binance, then connect it here.</p><Button className="mt-4" onClick={() => setWizardOpen(true)}><Plus data-icon="inline-start" />Connect Binance</Button></div>}
    </section>}
    {tab === 'Sync Settings' && <section className="max-w-3xl rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-medium">Automatic synchronization</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Enabled accounts are checked when the application is opened or reloaded. Sync runs on demand; no background worker or external scheduler is used. Each endpoint tracks its own cursor with overlap.</p>
      <div className="mt-4 flex gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Binance exposes trade and order history by symbol. Historical balances are not provided, and account-wide symbol discovery may be incomplete. Endpoint coverage and missing history are shown in sync status; never use this as a tax or accounting source without reconciliation.</span></div>
    </section>}
    {tab === 'Connection History' && <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border p-5"><div className="flex items-center gap-2"><History className="size-4" /><h2 className="text-sm font-medium">Connection History</h2></div><p className="mt-1 text-xs text-muted-foreground">Recorded automatic and manual sync attempts.</p></div>
      {history.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground"><tr>{['Started', 'Account', 'Records', 'Result', 'Error'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{history.map(run => <tr key={run.id}><td className="px-4 py-3">{formatDate(run.startedAt)}</td><td className="px-4 py-3">{accounts.find(account => account.id === run.accountId)?.name ?? run.accountId}</td><td className="px-4 py-3">{run.recordsImported}</td><td className="px-4 py-3">{run.status}</td><td className="max-w-xs truncate px-4 py-3 text-muted-foreground">{run.error ?? '—'}</td></tr>)}</tbody></table></div> : <p className="p-5 text-xs text-muted-foreground">No sync attempts have been recorded.</p>}
    </section>}
    {wizardOpen && <ConnectionWizard initial={editing} onClose={() => setWizardOpen(false)} onSaved={async () => { setWizardOpen(false); await load() }} />}
  </div>
}

function ConnectionWizard({ initial, onClose, onSaved }: { initial: Connection | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [selected, setSelected] = useState<Product[]>(initial?.products ?? ['spot'])
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggle(product: Product) {
    setSelected(current => current.includes(product) ? current.filter(item => item !== product) : [...current, product])
  }

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/binance/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: initial?.id, name, products: selected, apiKey, apiSecret }),
      })
      const result = await response.json() as { account?: Connection; error?: string }
      setApiKey('')
      setApiSecret('')
      if (!response.ok || !result.account) throw new Error(result.error ?? 'Could not save Binance connection.')
      const syncResponse = await fetch('/api/binance/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: result.account.id }),
      })
      if (!syncResponse.ok) {
        const syncResult = await syncResponse.json() as { error?: string }
        setError(syncResult.error ?? 'Connected, but the initial sync did not finish. Use Sync Now to retry.')
      }
      await onSaved()
      window.dispatchEvent(new Event('binance-data-updated'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not connect to Binance.')
    } finally {
      setApiKey('')
      setApiSecret('')
      setBusy(false)
    }
  }

  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4">
    <form onSubmit={connect} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-background p-5 shadow-xl">
      <div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">{initial ? 'Reconnect Binance' : 'Connect Binance'}</h2><p className="mt-1 text-xs text-muted-foreground">Your key and secret are sent directly to the server for verification and encryption. They are never stored in browser storage or returned.</p></div><button type="button" onClick={onClose} aria-label="Close connection wizard"><X className="size-4" /></button></div>
      <label className="mt-5 grid gap-1.5 text-xs font-medium">Account nickname<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required placeholder="e.g. Personal Binance" className="h-10 rounded border border-border bg-background px-3 text-sm" /></label>
      <fieldset className="mt-5"><legend className="text-xs font-medium">Markets to import</legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{markets.map(market => <label key={market.value} className="flex items-center gap-2 rounded border border-border p-3 text-xs"><input type="checkbox" checked={selected.includes(market.value)} onChange={() => toggle(market.value)} />{market.label}</label>)}</div></fieldset>
      <div className="mt-5 rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-amber-700 dark:text-amber-300"><ShieldCheck className="mr-2 inline size-4" />Use read-only permissions only. Do not enable spot/futures trading, margin trading, or withdrawals. Enable IP restrictions where practical.</div>
      <ol className="mt-4 list-inside list-decimal space-y-1 text-xs text-muted-foreground"><li>Create an API key in Binance API Management.</li><li>Enable read-only account access for each selected market.</li><li>Never share the Binance password or 2FA code.</li></ol>
      <a href="https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs underline">Official Binance API docs <ExternalLink className="size-3" /></a>
      <div className="mt-5 grid gap-4"><label className="grid gap-1.5 text-xs font-medium">API key<input value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" type="password" required className="h-10 rounded border border-border bg-background px-3 text-sm" /></label><label className="grid gap-1.5 text-xs font-medium">API secret<input value={apiSecret} onChange={event => setApiSecret(event.target.value)} autoComplete="off" type="password" required className="h-10 rounded border border-border bg-background px-3 text-sm" /></label></div>
      {error && <p role="alert" className="mt-4 rounded border border-destructive/30 p-3 text-xs text-destructive">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || selected.length === 0}>{busy && <RefreshCw data-icon="inline-start" className="animate-spin" />}{busy ? 'Verifying and syncing…' : 'Verify & connect'}</Button></div>
    </form>
  </div>
}

function productName(product: Product) {
  return markets.find(market => market.value === product)?.label ?? product
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>
}
