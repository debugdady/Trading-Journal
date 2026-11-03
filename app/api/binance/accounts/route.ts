import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { verifyBinanceCredentials } from '@/lib/binance/sync'
import { listAccounts, saveAccount, setAccountEnabled } from '@/lib/binance/storage'
import type { Product } from '@/lib/trading/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const products = new Set<Product>(['spot', 'usd-m-futures', 'coin-m-futures'])

export async function GET() {
  try {
    return NextResponse.json({ accounts: listAccounts() })
  } catch {
    return NextResponse.json({ error: 'Could not load saved Binance accounts.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  let accountId: string | undefined
  try {
    const body = await request.json() as {
      id?: string
      name?: string
      products?: Product[]
      apiKey?: string
      apiSecret?: string
    }
    accountId = body.id
    const isNew = !accountId
    const name = body.name?.trim()
    const apiKey = body.apiKey?.trim()
    const apiSecret = body.apiSecret?.trim()
    const selected = Array.isArray(body.products) ? [...new Set(body.products)] : []
    if (!name || name.length > 80 || !apiKey || !apiSecret || selected.length === 0 || selected.some(product => !products.has(product))) {
      return NextResponse.json({ error: 'Enter an account name, API key and secret, and select at least one supported market.' }, { status: 400 })
    }
    if (apiKey.length > 256 || apiSecret.length > 256) {
      return NextResponse.json({ error: 'The credential fields exceed the supported length.' }, { status: 400 })
    }

    await verifyBinanceCredentials({ apiKey, apiSecret, products: selected })
    accountId ??= randomUUID()
    saveAccount({ id: accountId, name, products: selected, apiKey, apiSecret })
    const account = listAccounts().find(item => item.id === accountId)
    if (!account) throw new Error('The saved Binance account could not be loaded.')
    return NextResponse.json({ account, verified: true }, { status: isNew ? 201 : 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not connect to Binance.'
    const status = /set CREDENTIALS_ENCRYPTION_KEY/i.test(message) ? 503 : /Binance|network|reach/i.test(message) ? 502 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { accountId?: string }
    if (!body.accountId || !listAccounts().some(account => account.id === body.accountId)) {
      return NextResponse.json({ error: 'Binance account not found.' }, { status: 404 })
    }
    setAccountEnabled(body.accountId, false)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Could not disconnect the Binance account.' }, { status: 500 })
  }
}
