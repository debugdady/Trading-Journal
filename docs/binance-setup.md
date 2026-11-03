# Binance setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local`.
3. Generate an encryption key in the terminal:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Set the output as `CREDENTIALS_ENCRYPTION_KEY` in `.env.local`. Keep a secure backup of this key separate from the SQLite file; losing it makes saved API credentials unrecoverable. Do not commit `.env.local`.
4. Start the app with `pnpm dev`. The SQLite database is created at `data/trading-journal.sqlite`.
5. In Binance API Management, create a dedicated key with read-only/account-data permissions for the markets you select. Do not enable spot/futures trading, margin trading, or withdrawals. Configure IP restrictions when possible.
6. Connect the key in **Data & Settings → Exchange Connections**. The server verifies each selected market before encrypting and saving the credentials.

The app only issues server-side `GET` requests. Spot requests use `api.binance.com`, USDⓈ-M uses `fapi.binance.com`, and COIN-M uses `dapi.binance.com`. USER_DATA requests are timestamped, HMAC-SHA256 signed, and sent with `X-MBX-APIKEY`. API errors and sync history are persisted without credentials.

On each app load, enabled accounts are synchronized once. **Sync Now** runs the same endpoint sync manually. Data is upserted into SQLite using account, product, record type, and Binance IDs. Raw API responses are retained alongside normalized records. Historical account balance snapshots cannot be reconstructed from current-account endpoints; only current balances and positions are available.

## Coverage limits

- Binance Spot `allOrders` and `myTrades`, and USDⓈ-M/COIN-M order and trade history, require a symbol. Initial symbol discovery is based on current balances, positions, and open orders, so closed history for symbols no longer represented there may be unavailable. The UI records this as partial coverage.
- Spot deposit, withdrawal, dividend, and supported internal transfer history is requested with 90-day time windows and endpoint cursors. Futures income is limited to the accessible API retention period. Binance may limit older data or results further.
- Isolated-margin transfers require an isolated-margin symbol. The integration does not support isolated-margin markets and records those transfer endpoints as unavailable instead of issuing invalid requests.
- Current account information and position-risk endpoints provide current state, not historical balance or position snapshots.
- History requests are paginated, with overlapping cursor windows and stable-ID upserts. Rate limits are retried; unsupported permissions and Binance errors are shown in sync status.

## Official endpoint references

- [Spot account endpoints](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints)
- [Spot REST API general information and signing](https://developers.binance.com/docs/binance-spot-api-docs/rest-api)
- [USDⓈ-M account information V3](https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Account-Information-V3)
- [USDⓈ-M position information V3](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Position-Information-V3)
- [USDⓈ-M all orders](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/All-Orders)
- [USDⓈ-M account trade list](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Account-Trade-List)
- [USDⓈ-M income history](https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Get-Income-History)
- [COIN-M account information](https://developers.binance.com/docs/derivatives/coin-margined-futures/account/rest-api/Account-Information)
- [COIN-M position risk](https://developers.binance.com/docs/derivatives/coin-margined-futures/account/rest-api/Position-Information)
- [COIN-M all orders](https://developers.binance.com/docs/derivatives/coin-margined-futures/trade/All-Orders)
- [COIN-M account trade list](https://developers.binance.com/docs/derivatives/coin-margined-futures/trade/rest-api/Account-Trade-List)
