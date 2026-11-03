# Analytics dependency matrix

All metrics are calculated from normalized records and carry `sourceQuality` plus `coverage`. Missing prerequisites produce `Unavailable` or `Incomplete`.

| Metric | Formula / method | Required fields | History / limitations |
|---|---|---|---|
| Gross realized P&L | Product-specific matched proceeds minus cost basis before costs | Executions, quantity, price, contract metadata, FIFO lots for Spot | Requires complete lifecycle; inverse contracts use settlement-asset formula |
| Net realized P&L | Gross P&L minus commissions, funding, interest, and explicitly attributable costs | Gross result plus linked financial events | Never subtract a cost twice; unlinked events remain separate |
| Unrealized P&L | Position-specific exchange formula using mark price and entry/break-even | Position, mark price, contract size, settlement asset | Point-in-time only; unavailable without current mark price |
| Win rate | Winning completed trades / completed trades | Reconstructed completed trades | Incomplete when trade reconstruction coverage is partial |
| Profit factor | Sum positive net trade P&L / absolute sum negative net trade P&L | Completed trades | Unavailable with no losing trades, not zero |
| Expectancy | Sum net trade P&L / completed trade count | Completed trades | Sample-size warning required |
| Equity curve | Snapshot account valuation plus classified flows | Balance snapshots, prices, deposits/withdrawals/transfers/conversions | No fabricated backfill; only snapshot-covered periods |
| Drawdown | Peak-to-trough decline from equity snapshots or realized curve | Equity series | Label whether snapshot-based or realized-only |
| Exposure / concentration | Absolute notional by asset/symbol/product divided by portfolio valuation | Balances, positions, mark/index prices, valuation currency | Unavailable when conversion price or equity is missing |
| Margin utilization | Initial/maint/position margin divided by margin balance or wallet balance | Futures account/position snapshots | Product/account scope must be explicit |
| Liquidation distance | Distance between mark price and liquidation price | Position risk, mark price | Unavailable if liquidation price is absent |
| Holding time | Exit timestamp minus entry timestamp | Matched executions/orders | Partial lifecycles are excluded and flagged |
| Slippage | Execution price versus contemporaneous benchmark/mark or order price | Execution price, order price, mark/index/candle | Estimated when benchmark is not exchange-reported |
| MAE/MFE | Min/max favorable excursion during lifecycle | Entry, exit, high-resolution candles or mark series | Unavailable when candle interval does not cover lifecycle |
| Sharpe / Sortino / volatility | Return series statistics with documented annualization | Historical equity/returns | Requires sufficient periodic snapshots; no synthetic samples |
| Correlation / beta | Covariance/benchmark regression on aligned returns | Portfolio and market candles/equity snapshots | Requires overlap and selected benchmark |
| Funding impact | Sum funding income/expense linked by symbol/position window | Futures income events, position lifecycle | Exchange-reported when income records exist |
| Basis | Futures mark/index or contract-vs-spot price differential | Futures/spot mark/index observations | Requires aligned timestamps and conversion |
| Execution quality | Fill ratio, maker/taker, latency, price improvement, order slippage | Orders, executions, timestamps, maker flags | Latency unavailable if client/order timestamps absent |
| Streaks / session / weekday / hour | Ordered completed trades grouped by UTC and configured timezone | Completed trade close timestamps and results | Timezone must be explicit; no inferred session labels |
