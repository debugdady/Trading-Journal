import { NextResponse } from 'next/server'
import { verifyBinanceCredentials } from '@/lib/binance/sync'
import type { Product } from '@/lib/trading/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supported = new Set<Product>(['spot', 'usd-m-futures', 'coin-m-futures'])

export async function POST(request: Request) {
  try {
    const body = await request.json() as { apiKey?: string; apiSecret?: string; products?: Product[] }
    const products = Array.isArray(body.products) ? [...new Set(body.products)] : []
    if (!body.apiKey || !body.apiSecret || !products.length || products.some(product => !supported.has(product))) {
      return NextResponse.json({ ok: false, error: 'API key, API secret, and at least one supported market are required.' }, { status: 400 })
    }
    const verified = await verifyBinanceCredentials({
      apiKey: body.apiKey,
      apiSecret: body.apiSecret,
      products,
    })
    return NextResponse.json({ ok: true, verified })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to verify Binance connection.',
    }, { status: 502 })
  }
}
