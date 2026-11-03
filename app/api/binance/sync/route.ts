import { NextResponse } from 'next/server'
import { syncAccount, syncEnabledAccounts } from '@/lib/binance/sync'
import { getTradingSnapshot, listAccounts, listCoverage, listSyncRuns } from '@/lib/binance/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({
      accounts: listAccounts(),
      coverage: listCoverage(),
      history: listSyncRuns(),
      snapshot: getTradingSnapshot(),
    })
  } catch {
    return NextResponse.json({ error: 'Could not load Binance sync status.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { accountId?: string }
    const results = body.accountId
      ? [await syncAccount(body.accountId)]
      : await syncEnabledAccounts()
    return NextResponse.json({
      results,
      accounts: listAccounts(),
      coverage: listCoverage(),
      history: listSyncRuns(),
      snapshot: getTradingSnapshot(),
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Binance sync failed.',
    }, { status: 502 })
  }
}
