'use client'

import { useCallback, useEffect, useState } from 'react'

export type JournalTrade = {
  id: string
  symbol: string
  side: string
  product: string
  entry: string
  exit: string
  pnl: number
  fees: number
  duration: string
  closed: string
  strategy: string
  note: string
  status?: 'Open' | 'Closed'
  tags?: string[]
  reviewed?: boolean
  funding?: number
  quantity?: string
  opened?: string
}

const storageKey = 'journal-trades'
const changeEvent = 'journal-trades-updated'

function readTrades() {
  const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
  if (!Array.isArray(parsed)) throw new Error('Saved journal trades are not a list.')
  const trades = parsed.filter((trade): trade is JournalTrade =>
    typeof trade === 'object'
    && trade !== null
    && typeof trade.id === 'string'
    && !trade.id.startsWith('DEMO-'),
  )
  if (trades.length !== parsed.length) localStorage.setItem(storageKey, JSON.stringify(trades))
  return trades
}

export function useJournalTrades() {
  const [trades, setTrades] = useState<JournalTrade[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    try {
      setTrades(readTrades())
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load saved journal entries.')
    }
  }, [])

  useEffect(() => {
    reload()
    window.addEventListener(changeEvent, reload)
    window.addEventListener('storage', reload)
    return () => {
      window.removeEventListener(changeEvent, reload)
      window.removeEventListener('storage', reload)
    }
  }, [reload])

  const save = useCallback((next: JournalTrade[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setTrades(next)
      setError(null)
      window.dispatchEvent(new Event(changeEvent))
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save journal entries.')
      return false
    }
  }, [])

  return { trades, save, error }
}
