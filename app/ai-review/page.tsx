import { AIReviewPage } from '@/components/ai-review-page'
import { demoTrades } from '@/lib/demo/trades'

export default function AIReviewPageRoute() {
  return <AIReviewPage trades={demoTrades} />
}
