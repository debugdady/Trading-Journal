export type SourceQuality = 'exchange-reported' | 'reconstructed' | 'calculated' | 'estimated' | 'manual' | 'partial' | 'unavailable'
export type Product = 'spot' | 'usd-m-futures' | 'coin-m-futures' | 'margin'
export type RecordStatus = 'complete' | 'partial' | 'unavailable'

export type DataLineage = {
  sourceQuality: SourceQuality
  sourceRecordIds: string[]
  sourceEndpoint?: string
  retrievedAt?: string
  reason?: string
}

export type RawExchangeRecord = DataLineage & {
  id: string
  exchange: 'binance'
  accountId: string
  product: Product | 'wallet' | 'market'
  endpoint: string
  sourceId?: string
  observedAt?: string
  payload: Record<string, unknown>
  unmappedFields?: string[]
  syncRunId: string
}

export type Balance = DataLineage & { accountId: string; product?: Product; asset: string; free: number | null; locked: number | null; borrowed: number | null; interest: number | null; valuation: number | null; valuationCurrency: string; asOf: string }
export type Order = DataLineage & { id: string; accountId: string; product: Product; symbol: string; clientOrderId?: string; side: 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'UNKNOWN'; type: string; status: string; price: number | null; quantity: number | null; executedQuantity: number | null; quoteQuantity: number | null; reduceOnly?: boolean; positionSide?: string; openedAt?: string; updatedAt?: string }
export type Execution = DataLineage & { id: string; orderId: string; accountId: string; product: Product; symbol: string; side: string; price: number | null; quantity: number | null; quoteQuantity: number | null; commission: number | null; commissionAsset?: string; realizedPnl: number | null; isMaker?: boolean; executedAt: string }
export type FinancialEventType = 'deposit' | 'withdrawal' | 'internal-transfer' | 'conversion' | 'dividend' | 'commission' | 'funding' | 'interest' | 'borrow' | 'repayment' | 'realized-pnl' | 'rebate' | 'other'
export type FinancialEvent = DataLineage & { id: string; accountId: string; product: Product | 'wallet'; type: FinancialEventType; asset: string; amount: number | null; symbol?: string; transactionId?: string; tradeId?: string; occurredAt: string; description?: string }
export type Position = DataLineage & { id: string; accountId: string; product: 'usd-m-futures' | 'coin-m-futures' | 'margin'; symbol: string; positionSide?: string; quantity: number | null; entryPrice: number | null; breakEvenPrice: number | null; markPrice: number | null; liquidationPrice: number | null; unrealizedPnl: number | null; leverage: number | null; marginType?: string; notional: number | null; asOf: string }
export type AccountSnapshot = DataLineage & { id: string; accountId: string; product: Product | 'wallet'; walletBalance: number | null; equity: number | null; unrealizedPnl: number | null; initialMargin: number | null; maintenanceMargin: number | null; marginBalance: number | null; exposure: number | null; currency: string; asOf: string }
export type MarketObservation = DataLineage & { id: string; symbol: string; product: Product | 'spot'; kind: 'candle' | 'mark-price' | 'index-price' | 'funding-rate' | 'open-interest' | 'long-short-ratio' | 'taker-volume' | 'basis'; observedAt: string; open?: number; high?: number; low?: number; close?: number; volume?: number; value?: number | null; secondaryValue?: number | null; interval?: string }
export type CompletedTrade = DataLineage & { id: string; accountId: string; product: Product; symbol: string; direction: 'Long' | 'Short' | 'Buy' | 'Sell'; entryPrice: number | null; exitPrice: number | null; quantity: number | null; openedAt: string | null; closedAt: string | null; grossPnl: number | null; fees: number | null; funding: number | null; interest: number | null; netPnl: number | null; orderIds: string[]; executionIds: string[]; financialEventIds: string[]; strategy?: string; note?: string }
export type Coverage = { accountId: string; product: Product | 'wallet' | 'market'; endpoint: string; earliest: string | null; latest: string | null; recordCount: number; complete: boolean; missingPeriods: string[]; lastError?: string }
export type TradingRepositorySnapshot = { raw: RawExchangeRecord[]; balances: Balance[]; orders: Order[]; executions: Execution[]; financialEvents: FinancialEvent[]; positions: Position[]; snapshots: AccountSnapshot[]; market: MarketObservation[]; trades: CompletedTrade[]; coverage: Coverage[] }
