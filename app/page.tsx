import { TradingJournal } from '@/components/trading-journal'
import { getTradingSnapshot, listAccounts } from '@/lib/binance/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function Page() {
  return <TradingJournal initialSnapshot={getTradingSnapshot()} initialAccounts={listAccounts()} />
}
