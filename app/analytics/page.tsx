import { AnalyticsDashboard } from '@/components/analytics-dashboard'
import { getTradingSnapshot, listAccounts } from '@/lib/binance/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default function AnalyticsPage() {
  const snapshot = getTradingSnapshot()
  const accountIds = listAccounts().filter(account => account.enabled).map(account => account.id)
  return <AnalyticsDashboard snapshot={snapshot} accountIds={accountIds} />
}
