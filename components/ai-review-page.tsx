'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { JournalTrade } from '@/lib/trading/manual-journal'
import type { TradingRepositorySnapshot } from '@/lib/trading/types'
import { formatMoney } from '@/lib/trading/format-money'

type Message = { id: string; role: 'user' | 'assistant'; text: string; createdAt: string }
type Conversation = { id: string; title: string; messages: Message[]; updatedAt: string }
const storageKey = 'journal-ai-conversations'
const prompts = ['Summarize my saved journal entries.', 'How many Binance executions are stored?', 'Show current positions and account coverage.']

export function AIReviewPage({ trades, snapshot }: {
  trades: JournalTrade[]
  snapshot: TradingRepositorySnapshot
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState('new')
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (!saved) return
      const parsed = JSON.parse(saved) as Conversation[]
      const cleaned = parsed.map(conversation => ({
        ...conversation,
        messages: conversation.messages.filter(message => message.role === 'user'),
      })).filter(conversation => conversation.messages.length > 0)
      setConversations(cleaned)
      if (cleaned.some(conversation => conversation.messages.length !== parsed.find(item => item.id === conversation.id)?.messages.length)) {
        localStorage.setItem(storageKey, JSON.stringify(cleaned))
      }
    } catch (reason) {
      console.error('Could not load saved review conversations.', reason)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(conversations))
    } catch (reason) {
      console.error('Could not save review conversations.', reason)
    }
  }, [conversations])

  const active = conversations.find(conversation => conversation.id === activeId)
  const visible = useMemo(() => conversations.filter(item => item.title.toLowerCase().includes(search.toLowerCase())), [conversations, search])

  function startNew() {
    setActiveId('new')
    setInput('')
  }

  function submit(value = input) {
    const question = value.trim()
    if (!question) return
    const createdAt = new Date().toISOString()
    const conversationId = activeId === 'new' ? crypto.randomUUID() : activeId
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', text: question, createdAt }
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: localSummary(question, trades, snapshot),
      createdAt,
    }
    const nextConversation: Conversation = {
      id: conversationId,
      title: activeId === 'new' ? question.slice(0, 48) : active?.title ?? question.slice(0, 48),
      messages: [...(active?.messages ?? []), userMessage, assistantMessage],
      updatedAt: createdAt,
    }
    setConversations(current => [nextConversation, ...current.filter(item => item.id !== conversationId)])
    setActiveId(conversationId)
    setInput('')
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }))
  }

  function removeConversation(id: string) {
    if (!window.confirm('Delete this saved conversation?')) return
    setConversations(current => current.filter(item => item.id !== id))
    if (activeId === id) startNew()
  }

  const messages = active?.messages ?? []

  return <div className="flex h-full min-h-[560px] overflow-hidden border border-border bg-background">
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-3"><Button size="sm" className="w-full" onClick={startNew}><Plus data-icon="inline-start" />New review</Button><div className="relative mt-3"><Search className="absolute left-2 top-2 size-3.5 text-muted-foreground" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search reviews" className="h-8 w-full rounded border border-border bg-background pl-7 pr-2 text-xs" /></div></div>
      <div className="flex-1 overflow-y-auto p-2"><p className="px-2 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Saved conversations</p>{visible.map(item => <div key={item.id} className={`group flex items-center gap-1 rounded px-2 py-2 ${activeId === item.id ? 'bg-accent' : 'hover:bg-muted'}`}><button onClick={() => setActiveId(item.id)} className="min-w-0 flex-1 truncate text-left text-xs">{item.title}</button><button onClick={() => removeConversation(item.id)} className="opacity-0 group-hover:opacity-100" aria-label={`Delete ${item.title}`}><Trash2 className="size-3.5 text-muted-foreground" /></button></div>)}{visible.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">No saved reviews.</p>}</div>
      <div className="border-t border-border p-3 text-[10px] leading-4 text-muted-foreground">Local data summary only. No AI, web research, news service, or document analysis is connected.</div>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-5 py-3"><div><h1 className="text-sm font-medium">AI Review</h1><p className="mt-1 text-[10px] text-muted-foreground">Local journal and Binance data · no AI provider configured</p></div><span className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground">Computed summaries</span></header>
      <div className="flex-1 overflow-y-auto p-5">
        {messages.length === 0 ? <div className="mx-auto mt-12 max-w-xl"><h2 className="text-xl font-medium">Review the data you have saved</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Summaries use only your local journal entries and persisted Binance records. The app does not contact an AI or research provider.</p><div className="mt-6 grid gap-2">{prompts.map(prompt => <button key={prompt} onClick={() => submit(prompt)} className="rounded-md border border-border bg-card p-3 text-left text-xs hover:bg-muted">{prompt}</button>)}</div></div> : <div className="mx-auto max-w-2xl space-y-5">{messages.map(message => <article key={message.id} className={message.role === 'user' ? 'ml-10 rounded-lg bg-muted p-4 text-sm' : 'mr-6 rounded-lg border border-border bg-card p-4 text-sm'}><p className="whitespace-pre-wrap leading-6">{message.text}</p><time className="mt-2 block text-[10px] text-muted-foreground">{new Date(message.createdAt).toLocaleString()}</time></article>)}</div>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-border p-4"><div className="mx-auto max-w-2xl"><form onSubmit={event => { event.preventDefault(); submit() }} className="flex items-end gap-2 rounded-lg border border-border bg-card p-2"><textarea value={input} onChange={event => setInput(event.target.value)} rows={2} placeholder="Ask about your saved journal or Binance records" className="max-h-32 min-h-12 flex-1 resize-y bg-transparent px-2 py-1 text-sm outline-none" /><Button type="submit" size="icon" disabled={!input.trim()} aria-label="Create data summary"><Send /></Button></form><p className="mt-2 text-center text-[10px] text-muted-foreground">Reports are deterministic summaries of available records, not AI-generated advice.</p></div></div>
    </section>
  </div>
}

function localSummary(question: string, trades: JournalTrade[], snapshot: TradingRepositorySnapshot) {
  const prompt = question.toLowerCase()
  const journalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0)
  const noted = trades.filter(trade => trade.note.trim()).length
  const realized = snapshot.financialEvents.filter(event => event.type === 'realized-pnl')
  const positions = snapshot.positions.filter(position => position.quantity !== null && position.quantity !== 0)
  if (prompt.includes('execution') || prompt.includes('fill')) {
    return `Persisted Binance data contains ${snapshot.executions.length} executions across ${new Set(snapshot.executions.map(item => item.symbol)).size} symbols. ${snapshot.executions.length ? `Latest fill: ${new Date(snapshot.executions.slice().sort((a, b) => b.executedAt.localeCompare(a.executedAt))[0].executedAt).toLocaleString()}.` : 'No executions have been synced.'}`
  }
  if (prompt.includes('position') || prompt.includes('coverage')) {
    return `Persisted data contains ${positions.length} non-zero positions, ${snapshot.coverage.length} endpoint coverage records, and ${snapshot.balances.length} balances. Coverage is partial wherever the endpoint record says so; historical account snapshots are not reconstructed.`
  }
  if (prompt.includes('p&l') || prompt.includes('pnl') || prompt.includes('journal') || prompt.includes('performance')) {
    const pnlEventsByAsset = new Map<string, number>()
    realized.forEach(event => { if (event.amount !== null) pnlEventsByAsset.set(event.asset, (pnlEventsByAsset.get(event.asset) ?? 0) + event.amount) })
    const exchangeResult = pnlEventsByAsset.size
      ? `Exchange-reported realized P&L: ${[...pnlEventsByAsset.entries()].map(([asset, amount]) => formatMoney(amount, { asset })).join(', ')}.`
      : 'No exchange-reported realized P&L events are stored.'
    return `Your manual journal contains ${trades.length} entries, ${noted} with notes, and reported P&L totaling ${formatMoney(journalPnl)} in the values you entered. ${exchangeResult} Values from different assets are not combined or converted.`
  }
  return `Available data: ${trades.length} manual journal entries, ${snapshot.orders.length} orders, ${snapshot.executions.length} executions, ${snapshot.positions.length} position records, ${snapshot.financialEvents.length} financial events, and ${snapshot.balances.length} balances. Ask about the journal, executions, positions, or coverage for a scoped summary.`
}
