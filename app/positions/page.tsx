import { PositionsRiskPage } from '@/components/data-workspaces'
import { DEMO_TRADING_SNAPSHOT } from '@/lib/demo/trading-snapshot'

export default function PositionsPage() {
  return <PositionsRiskPage snapshot={DEMO_TRADING_SNAPSHOT} />
}
