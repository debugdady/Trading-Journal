import { PortfolioPage } from '@/components/data-workspaces'
import { DEMO_TRADING_SNAPSHOT } from '@/lib/demo/trading-snapshot'

export default function PortfolioPageRoute() {
  return <PortfolioPage snapshot={DEMO_TRADING_SNAPSHOT} />
}
