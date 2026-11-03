import 'server-only'

import Database from 'better-sqlite3'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Product, TradingRepositorySnapshot } from '@/lib/trading/types'

export type BinanceAccount = {
  id: string
  name: string
  products: Product[]
  apiKeyHint: string
  enabled: boolean
  status: 'connected' | 'needs-attention' | 'disabled'
  createdAt: string
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  recordsImported: number
}

export type StoredRecord = {
  recordId: string
  accountId: string
  product: Product
  kind: string
  exchangeId: string
  endpoint: string
  payload: Record<string, unknown>
  observedAt: string | null
  retrievedAt: string
  syncRunId: string
}

export type CoverageRow = {
  accountId: string
  product: Product
  endpoint: string
  earliest: string | null
  latest: string | null
  recordCount: number
  complete: boolean
  missingPeriods: string[]
  lastError: string | null
  updatedAt: string
}

export type SyncRun = {
  id: string
  accountId: string
  startedAt: string
  completedAt: string | null
  status: 'running' | 'successful' | 'partial' | 'failed'
  recordsImported: number
  error: string | null
}

type AccountRow = {
  id: string
  name: string
  products_json: string
  api_key_hint: string
  enabled: number
  status: BinanceAccount['status']
  created_at: string
  last_success_at: string | null
  last_attempt_at: string | null
  last_error: string | null
  encrypted_api_key: string
  encrypted_api_secret: string
}

let database: Database.Database | undefined

function db() {
  if (database) return database
  const file = path.join(process.cwd(), 'data', 'trading-journal.sqlite')
  mkdirSync(path.dirname(file), { recursive: true })
  database = new Database(file)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.exec(`
    CREATE TABLE IF NOT EXISTS connected_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      products_json TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      encrypted_api_secret TEXT NOT NULL,
      api_key_hint TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'connected',
      created_at TEXT NOT NULL,
      last_success_at TEXT,
      last_attempt_at TEXT,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS exchange_records (
      record_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES connected_accounts(id),
      product TEXT NOT NULL,
      kind TEXT NOT NULL,
      exchange_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      observed_at TEXT,
      retrieved_at TEXT NOT NULL,
      sync_run_id TEXT NOT NULL,
      UNIQUE(account_id, product, kind, exchange_id)
    );
    CREATE INDEX IF NOT EXISTS exchange_records_account_kind
      ON exchange_records(account_id, kind, observed_at);
    CREATE TABLE IF NOT EXISTS endpoint_cursors (
      account_id TEXT NOT NULL REFERENCES connected_accounts(id),
      product TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      cursor_value TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(account_id, product, endpoint)
    );
    CREATE TABLE IF NOT EXISTS endpoint_coverage (
      account_id TEXT NOT NULL REFERENCES connected_accounts(id),
      product TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      earliest TEXT,
      latest TEXT,
      record_count INTEGER NOT NULL DEFAULT 0,
      complete INTEGER NOT NULL DEFAULT 0,
      missing_periods_json TEXT NOT NULL DEFAULT '[]',
      last_error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(account_id, product, endpoint)
    );
    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES connected_accounts(id),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      records_imported INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_locks (
      account_id TEXT PRIMARY KEY REFERENCES connected_accounts(id),
      run_id TEXT NOT NULL,
      lease_until INTEGER NOT NULL
    );
  `)
  return database
}

function encryptionKey() {
  const configured = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!configured) throw new Error('Set CREDENTIALS_ENCRYPTION_KEY in .env.local before connecting an account.')
  const key = /^[\da-f]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64')
  if (key.length !== 32) throw new Error('CREDENTIALS_ENCRYPTION_KEY must encode exactly 32 bytes (base64 or 64 hex characters).')
  return key
}

export function encryptCredential(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.')
}

function decryptCredential(value: string) {
  const [iv, tag, encrypted] = value.split('.')
  if (!iv || !tag || !encrypted) throw new Error('Stored Binance credentials are invalid.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8')
}

export function saveAccount(input: {
  id: string
  name: string
  products: Product[]
  apiKey: string
  apiSecret: string
}) {
  const now = new Date().toISOString()
  db().prepare(`
    INSERT INTO connected_accounts
      (id, name, products_json, encrypted_api_key, encrypted_api_secret, api_key_hint, created_at)
    VALUES (@id, @name, @products, @apiKey, @apiSecret, @hint, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      products_json = excluded.products_json,
      encrypted_api_key = excluded.encrypted_api_key,
      encrypted_api_secret = excluded.encrypted_api_secret,
      api_key_hint = excluded.api_key_hint,
      enabled = 1,
      status = 'connected',
      last_error = NULL
  `).run({
    id: input.id,
    name: input.name,
    products: JSON.stringify(input.products),
    apiKey: encryptCredential(input.apiKey),
    apiSecret: encryptCredential(input.apiSecret),
    hint: input.apiKey.slice(-4),
    createdAt: now,
  })
}

export function getAccountCredentials(id: string) {
  const row = db().prepare('SELECT * FROM connected_accounts WHERE id = ? AND enabled = 1').get(id) as AccountRow | undefined
  if (!row) return null
  return {
    account: toAccount(row, 0),
    credentials: {
      apiKey: decryptCredential(row.encrypted_api_key),
      apiSecret: decryptCredential(row.encrypted_api_secret),
    },
  }
}

export function listAccounts(): BinanceAccount[] {
  const rows = db().prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM exchange_records r WHERE r.account_id = a.id AND r.kind != 'raw') AS records_imported
    FROM connected_accounts a ORDER BY a.created_at DESC
  `).all() as (AccountRow & { records_imported: number })[]
  return rows.map(row => toAccount(row, row.records_imported))
}

function toAccount(row: AccountRow, recordsImported: number): BinanceAccount {
  return {
    id: row.id,
    name: row.name,
    products: JSON.parse(row.products_json) as Product[],
    apiKeyHint: `•••• ${row.api_key_hint}`,
    enabled: row.enabled === 1,
    status: row.status,
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    recordsImported,
  }
}

export function setAccountEnabled(id: string, enabled: boolean) {
  db().prepare(`UPDATE connected_accounts SET enabled = ?, status = ?, last_error = NULL WHERE id = ?`)
    .run(enabled ? 1 : 0, enabled ? 'connected' : 'disabled', id)
}

export function beginSync(accountId: string, id: string) {
  const startedAt = new Date().toISOString()
  const start = db().transaction(() => {
    const now = Date.now()
    const lock = db().prepare('SELECT lease_until FROM sync_locks WHERE account_id = ?').get(accountId) as { lease_until: number } | undefined
    if (lock && lock.lease_until > now) return false
    db().prepare(`
      INSERT INTO sync_locks (account_id, run_id, lease_until) VALUES (?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET run_id = excluded.run_id, lease_until = excluded.lease_until
    `).run(accountId, id, now + 10 * 60_000)
    db().prepare('INSERT INTO sync_runs (id, account_id, started_at, status) VALUES (?, ?, ?, ?)').run(id, accountId, startedAt, 'running')
    db().prepare('UPDATE connected_accounts SET last_attempt_at = ? WHERE id = ?').run(startedAt, accountId)
    return true
  })()
  return start ? startedAt : null
}

export function refreshSyncLock(accountId: string, runId: string) {
  db().prepare('UPDATE sync_locks SET lease_until = ? WHERE account_id = ? AND run_id = ?')
    .run(Date.now() + 10 * 60_000, accountId, runId)
}

export function completeSync(input: {
  id: string
  accountId: string
  status: SyncRun['status']
  recordsImported: number
  error: string | null
}) {
  const completedAt = new Date().toISOString()
  db().transaction(() => {
    db().prepare('UPDATE sync_runs SET completed_at = ?, status = ?, records_imported = ?, error = ? WHERE id = ?')
      .run(completedAt, input.status, input.recordsImported, input.error, input.id)
    db().prepare(`
      UPDATE connected_accounts SET
        last_success_at = CASE WHEN ? IN ('successful', 'partial') THEN ? ELSE last_success_at END,
        status = CASE WHEN ? = 'failed' THEN 'needs-attention' ELSE 'connected' END,
        last_error = ?
      WHERE id = ?
    `).run(input.status, completedAt, input.status, input.error, input.accountId)
    db().prepare('DELETE FROM sync_locks WHERE account_id = ? AND run_id = ?').run(input.accountId, input.id)
  })()
}

export function saveEndpointResult(input: {
  accountId: string
  product: Product
  endpoint: string
  cursor?: string | null
  recordCount: number
  complete: boolean
  missingPeriods?: string[]
  error?: string | null
  earliest?: string | null
  latest?: string | null
}) {
  const updatedAt = new Date().toISOString()
  db().prepare(`
    INSERT INTO endpoint_coverage
      (account_id, product, endpoint, earliest, latest, record_count, complete, missing_periods_json, last_error, updated_at)
    VALUES (@accountId, @product, @endpoint, @earliest, @latest, @recordCount, @complete, @missingPeriods, @error, @updatedAt)
    ON CONFLICT(account_id, product, endpoint) DO UPDATE SET
      earliest = CASE WHEN excluded.earliest IS NULL THEN endpoint_coverage.earliest
        WHEN endpoint_coverage.earliest IS NULL OR excluded.earliest < endpoint_coverage.earliest THEN excluded.earliest
        ELSE endpoint_coverage.earliest END,
      latest = CASE WHEN excluded.latest IS NULL THEN endpoint_coverage.latest
        WHEN endpoint_coverage.latest IS NULL OR excluded.latest > endpoint_coverage.latest THEN excluded.latest
        ELSE endpoint_coverage.latest END,
      record_count = excluded.record_count,
      complete = excluded.complete,
      missing_periods_json = excluded.missing_periods_json,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run({
    ...input,
    earliest: input.earliest ?? null,
    latest: input.latest ?? null,
    complete: input.complete ? 1 : 0,
    missingPeriods: JSON.stringify(input.missingPeriods ?? []),
    error: input.error ?? null,
    updatedAt,
  })
  if (input.cursor !== undefined) {
    db().prepare(`
      INSERT INTO endpoint_cursors (account_id, product, endpoint, cursor_value, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, product, endpoint) DO UPDATE SET
        cursor_value = excluded.cursor_value, updated_at = excluded.updated_at
    `).run(input.accountId, input.product, input.endpoint, input.cursor, updatedAt)
  }
}

export function getEndpointCursor(accountId: string, product: Product, endpoint: string) {
  const row = db().prepare('SELECT cursor_value FROM endpoint_cursors WHERE account_id = ? AND product = ? AND endpoint = ?')
    .get(accountId, product, endpoint) as { cursor_value: string | null } | undefined
  return row?.cursor_value ?? null
}

export function saveRecords(records: StoredRecord[]) {
  const statement = db().prepare(`
    INSERT INTO exchange_records
      (record_id, account_id, product, kind, exchange_id, endpoint, payload_json, observed_at, retrieved_at, sync_run_id)
    VALUES (@recordId, @accountId, @product, @kind, @exchangeId, @endpoint, @payload, @observedAt, @retrievedAt, @syncRunId)
    ON CONFLICT(account_id, product, kind, exchange_id) DO UPDATE SET
      endpoint = excluded.endpoint,
      payload_json = excluded.payload_json,
      observed_at = excluded.observed_at,
      retrieved_at = excluded.retrieved_at,
      sync_run_id = excluded.sync_run_id
  `)
  db().transaction((rows: StoredRecord[]) => {
    for (const record of rows) statement.run({ ...record, payload: JSON.stringify(record.payload) })
  })(records)
}

export function replaceCurrentRecords(records: StoredRecord[], accountId: string, product: Product, kind: string) {
  const statement = db().prepare(`
    INSERT INTO exchange_records
      (record_id, account_id, product, kind, exchange_id, endpoint, payload_json, observed_at, retrieved_at, sync_run_id)
    VALUES (@recordId, @accountId, @product, @kind, @exchangeId, @endpoint, @payload, @observedAt, @retrievedAt, @syncRunId)
    ON CONFLICT(account_id, product, kind, exchange_id) DO UPDATE SET
      endpoint = excluded.endpoint,
      payload_json = excluded.payload_json,
      observed_at = excluded.observed_at,
      retrieved_at = excluded.retrieved_at,
      sync_run_id = excluded.sync_run_id
  `)
  db().transaction((rows: StoredRecord[]) => {
    db().prepare('DELETE FROM exchange_records WHERE account_id = ? AND product = ? AND kind = ?').run(accountId, product, kind)
    for (const record of rows) statement.run({ ...record, payload: JSON.stringify(record.payload) })
  })(records)
}

export function listRecords(accountId?: string, includeRaw = false): StoredRecord[] {
  const rawFilter = includeRaw ? '' : " AND kind != 'raw'"
  const rows = (accountId
    ? db().prepare(`SELECT * FROM exchange_records WHERE account_id = ?${rawFilter} ORDER BY observed_at`).all(accountId)
    : db().prepare(`SELECT * FROM exchange_records${includeRaw ? '' : " WHERE kind != 'raw'"} ORDER BY observed_at`).all()) as {
      record_id: string; account_id: string; product: Product; kind: string; exchange_id: string; endpoint: string
      payload_json: string; observed_at: string | null; retrieved_at: string; sync_run_id: string
    }[]
  return rows.map(row => ({
    recordId: row.record_id,
    accountId: row.account_id,
    product: row.product,
    kind: row.kind,
    exchangeId: row.exchange_id,
    endpoint: row.endpoint,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    observedAt: row.observed_at,
    retrievedAt: row.retrieved_at,
    syncRunId: row.sync_run_id,
  }))
}

export function listCoverage(accountId?: string): CoverageRow[] {
  const rows = (accountId
    ? db().prepare('SELECT * FROM endpoint_coverage WHERE account_id = ? ORDER BY product, endpoint').all(accountId)
    : db().prepare('SELECT * FROM endpoint_coverage ORDER BY account_id, product, endpoint').all()) as {
      account_id: string; product: Product; endpoint: string; earliest: string | null; latest: string | null
      record_count: number; complete: number; missing_periods_json: string; last_error: string | null; updated_at: string
    }[]
  return rows.map(row => ({
    accountId: row.account_id,
    product: row.product,
    endpoint: row.endpoint,
    earliest: row.earliest,
    latest: row.latest,
    recordCount: row.record_count,
    complete: row.complete === 1,
    missingPeriods: JSON.parse(row.missing_periods_json) as string[],
    lastError: row.last_error,
    updatedAt: row.updated_at,
  }))
}

export function listSyncRuns(accountId?: string): SyncRun[] {
  const rows = (accountId
    ? db().prepare('SELECT * FROM sync_runs WHERE account_id = ? ORDER BY started_at DESC LIMIT 100').all(accountId)
    : db().prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 100').all()) as {
      id: string; account_id: string; started_at: string; completed_at: string | null; status: SyncRun['status']
      records_imported: number; error: string | null
    }[]
  return rows.map(row => ({
    id: row.id,
    accountId: row.account_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    recordsImported: row.records_imported,
    error: row.error,
  }))
}

export function getTradingSnapshot(): TradingRepositorySnapshot {
  const records = listRecords()
  const byKind = <T>(kind: string) => records.filter(record => record.kind === kind).map(record => record.payload as T)
  return {
    raw: [],
    balances: byKind('balances'),
    orders: byKind('orders'),
    executions: byKind('executions'),
    financialEvents: byKind('financialEvents'),
    positions: byKind('positions'),
    snapshots: byKind('snapshots'),
    market: [],
    trades: byKind('trades'),
    coverage: listCoverage().map(row => ({
      accountId: row.accountId,
      product: row.product,
      endpoint: row.endpoint,
      earliest: row.earliest,
      latest: row.latest,
      recordCount: row.recordCount,
      complete: row.complete,
      missingPeriods: row.missingPeriods,
      ...(row.lastError ? { lastError: row.lastError } : {}),
    })),
  }
}
