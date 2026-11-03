import type { TradingRepositorySnapshot } from './types'

export interface TradingRepository {
  snapshot(): Promise<TradingRepositorySnapshot>
  replace(next: TradingRepositorySnapshot): Promise<void>
  merge(next: Partial<TradingRepositorySnapshot>): Promise<void>
}

export function createMemoryRepository(initial: TradingRepositorySnapshot): TradingRepository {
  let state = structuredClone(initial)
  return { async snapshot() { return structuredClone(state) }, async replace(next) { state = structuredClone(next) }, async merge(next) { state = { ...state, ...next } } }
}

export function emptyTradingSnapshot(): TradingRepositorySnapshot { return { raw: [], balances: [], orders: [], executions: [], financialEvents: [], positions: [], snapshots: [], market: [], trades: [], coverage: [] } }
