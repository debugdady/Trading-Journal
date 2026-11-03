import { OrdersExecutionsPage } from '@/components/data-workspaces'
import { DEMO_TRADING_SNAPSHOT } from '@/lib/demo/trading-snapshot'

export default function OrdersPage() {
  return <OrdersExecutionsPage snapshot={DEMO_TRADING_SNAPSHOT} />
}
