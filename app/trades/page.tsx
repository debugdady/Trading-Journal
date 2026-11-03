import { TradesPage } from '@/components/trades-page'
import { demoTrades } from '@/lib/demo/trades'

export default function TradesPageRoute() {
  return <TradesPage initialTrades={demoTrades} />
}
