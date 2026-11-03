# Binance UI completeness matrix

Every imported family has a summary destination and a drill-down/raw destination. The raw inspector is the fallback destination for fields that are not useful in a summary.

| Imported category | Existing destination | Required destination / gap | Raw inspector and analytics |
|---|---|---|---|
| Balances, free/locked/borrowed | Settings / Overview | Portfolio workspace with valuation timestamp and quality badge | Portfolio record inspector; allocation/equity/margin |
| Spot orders and executions | Trades | Orders & Executions workspace plus linked trade lifecycle | Order/execution raw JSON; fills, FIFO, maker/taker, slippage |
| Futures orders/executions | Trades | Orders & Executions with position-side/reduce-only/contract metadata | Raw order/fill inspector; lifecycle/P&L |
| Open/current positions | None | Positions & Risk workspace | Position snapshot inspector; exposure, liquidation, margin |
| Deposits/withdrawals/transfers/conversions | None | Portfolio flows and Financial Events tab | Full financial-event JSON; equity/cost-basis boundaries |
| Dividends/commissions/funding/interest/borrow/repay | Partial trade fees | Financial Events tab and linked trade cost breakdown | Income inspector; net P&L/funding/interest |
| Account and position snapshots | None | Portfolio history and risk timeline | Snapshot inspector; equity/drawdown/margin |
| Candles/mark/index/funding | Partial analytics | Market Context panels attached to symbol/trade/analytics | Market observation inspector; volatility/basis/funding |
| Open interest/long-short/taker volume | None | Market Context and Analytics | Observation raw inspector; participation/regime |
| Journal/review/strategy/tags | Trades / Playbook | Preserve manual fields beside source-derived records | Review history; strategy and edge analytics |
| Coverage/errors/checkpoints | Settings | Data Coverage workspace/status on every page | Sync run and endpoint response inspector |
| Unknown or future Binance fields | None | Raw Data Inspector and versioned export | Never discarded; shown as unmapped raw fields |

## Source transparency treatment

Every value displays one of: `Exchange-reported`, `Reconstructed`, `Calculated`, `Estimated`, `Manual`, `Partial`, or `Unavailable`. Tooltips link to source IDs and endpoint records. Demo records remain labeled `Demo`; they cannot be silently presented as Binance data.
