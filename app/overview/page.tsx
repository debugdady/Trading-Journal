'use client'

import { OverviewDashboard } from '@/components/overview-dashboard'
import { demoTrades } from '@/lib/demo/trades'

export default function OverviewPage() {
  return <OverviewDashboard trades={demoTrades} onSelect={() => {}} onNavigate={() => {}} />
}
