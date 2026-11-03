import 'server-only'

import { createHmac } from 'node:crypto'
import type { Product } from '@/lib/trading/types'

export type BinanceCredentials = { apiKey: string; apiSecret: string; product: Product }
export type BinanceResponse<T> = { data: T; endpoint: string; retrievedAt: string }

const hosts: Partial<Record<Product, string>> = {
  spot: 'https://api.binance.com',
  'usd-m-futures': 'https://fapi.binance.com',
  'coin-m-futures': 'https://dapi.binance.com',
}

export class BinanceApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message)
    this.name = 'BinanceApiError'
  }
}

export class BinanceClient {
  private readonly baseUrl: string

  constructor(private readonly credentials: BinanceCredentials) {
    const host = hosts[credentials.product]
    if (!host) throw new Error(`Unsupported Binance product: ${credentials.product}`)
    this.baseUrl = host
  }

  async request<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
    signed = false,
  ): Promise<BinanceResponse<T>> {
    const query = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    )
    if (signed) {
      query.set('timestamp', String(Date.now()))
      query.set('recvWindow', '5000')
      query.set('signature', createHmac('sha256', this.credentials.apiSecret).update(query.toString()).digest('hex'))
    }

    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        response = await fetch(`${this.baseUrl}${path}?${query}`, {
          headers: signed ? { 'X-MBX-APIKEY': this.credentials.apiKey } : undefined,
          cache: 'no-store',
          signal: AbortSignal.timeout(30_000),
        })
      } catch {
        if (attempt < 2) {
          await delay(500 * (attempt + 1))
          continue
        }
        throw new BinanceApiError('Could not reach Binance. Check the network and try again.', 0)
      }

      const retrievedAt = new Date().toISOString()
      if (response.ok) return { data: await response.json() as T, endpoint: path, retrievedAt }

      const details = await response.json().catch(() => null) as { code?: number; msg?: string } | null
      const message = sanitizeBinanceMessage(details?.msg, [this.credentials.apiKey, this.credentials.apiSecret])
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : 500 * (attempt + 1))
        continue
      }
      throw new BinanceApiError(message, response.status, details?.code)
    }
  }
}

function sanitizeBinanceMessage(message: string | undefined, secrets: string[]) {
  if (!message) return 'Binance rejected the request.'
  return secrets.reduce((result, secret) => result.replaceAll(secret, '[redacted]'), message)
    .replace(/[\r\n]/g, ' ')
    .slice(0, 240)
}

function delay(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
