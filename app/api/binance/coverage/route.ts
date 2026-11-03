import { NextResponse } from 'next/server'
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
    return NextResponse.json({ error: 'Could not load Binance coverage.' }, { status: 500 })
  }
}
