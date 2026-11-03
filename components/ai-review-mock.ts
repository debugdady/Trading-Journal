export type ReviewTrade = { id: string; symbol: string; side: string; pnl: number; fees: number; strategy: string; note: string; closed: string }

export type ReviewMetric = { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }
export type MockResponse = { title: string; takeaway: string; body: string; metrics: ReviewMetric[]; table?: { headers: string[]; rows: string[][] }; chart?: 'cumulative' | 'daily' | 'strategy' | 'direction'; followUps: string[]; caveat?: string }

const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`
const pct = (n: number) => `${n.toFixed(1)}%`

export function createMockResponse(question: string, trades: ReviewTrade[]): MockResponse {
  const q = question.toLowerCase()
  const net = trades.reduce((sum, t) => sum + t.pnl - t.fees, 0)
  const gross = trades.reduce((sum, t) => sum + t.pnl, 0)
  const fees = trades.reduce((sum, t) => sum + t.fees, 0)
  const wins = trades.filter(t => t.pnl > 0)
  const losses = trades.filter(t => t.pnl < 0)
  const winRate = trades.length ? wins.length / trades.length * 100 : 0

  if (!trades.length) return { title: 'No matching journal data', takeaway: 'There are no demo records in the current scope.', body: 'Try widening the date range or removing a filter. I will not infer performance from records that are not present.', metrics: [], followUps: ['Summarize my recent trading performance.'] }

  if (q.includes('strategy') || q.includes('strategies')) {
    const names = [...new Set(trades.map(t => t.strategy))]
    const rows = names.map(name => { const set = trades.filter(t => t.strategy === name); const p = set.reduce((s, t) => s + t.pnl - t.fees, 0); return [name, String(set.length), pct(set.filter(t => t.pnl > 0).length / set.length * 100), money(p)] })
    return { title: 'Strategy comparison', takeaway: `${rows.sort((a, b) => Number(b[3].replace(/[^0-9.-]/g, '')) - Number(a[3].replace(/[^0-9.-]/g, '')))[0][0]} leads this small sample by net P&L.`, body: 'This is a descriptive comparison of the records in the current demo journal. It does not establish that one strategy will outperform in the future.', metrics: [{ label: 'Strategies', value: String(names.length) }, { label: 'Best net P&L', value: rows[0][3], tone: 'positive' }], table: { headers: ['Strategy', 'Trades', 'Win rate', 'Net P&L'], rows }, chart: 'strategy', followUps: ['Show my daily P&L.', 'What patterns appear in my losing trades?'], caveat: 'The sample is small and some strategies have only one linked trade.' }
  }

  if (q.includes('long') || q.includes('short') || q.includes('direction')) {
    const rows = ['Long', 'Short'].map(side => { const set = trades.filter(t => t.side === side); return [side, String(set.length), pct(set.filter(t => t.pnl > 0).length / Math.max(1, set.length) * 100), money(set.reduce((s, t) => s + t.pnl - t.fees, 0))] })
    return { title: 'Long versus short', takeaway: 'The direction split is based only on closed demo trades.', body: 'Use this view to review whether one direction has been more consistent in the journal. It is not a signal for future positioning.', metrics: [{ label: 'Long net', value: rows[0][3], tone: 'positive' }, { label: 'Short net', value: rows[1][3], tone: 'positive' }], table: { headers: ['Direction', 'Trades', 'Win rate', 'Net P&L'], rows }, chart: 'direction', followUps: ['Review my most recent trades.', 'What is hurting my P&L the most?'] }
  }

  if (q.includes('losing') || q.includes('mistake') || q.includes('discipline')) {
    const documented = losses.filter(t => t.note).map(t => `${t.symbol}: ${t.note}`)
    return { title: 'Review of losing trades', takeaway: `${losses.length} losing trade${losses.length === 1 ? '' : 's'} contributed ${money(losses.reduce((s, t) => s + t.pnl - t.fees, 0))} net.`, body: documented.length ? `The journal documents these observations: ${documented.join(' ')}` : 'The demo records do not contain notes on the losing trades, so I cannot identify a documented mistake pattern.', metrics: [{ label: 'Losing trades', value: String(losses.length), tone: 'negative' }, { label: 'Losses after fees', value: money(losses.reduce((s, t) => s + t.pnl - t.fees, 0)), tone: 'negative' }], followUps: ['Create a review checklist for my next session.', 'Compare my profitable and losing days.'], caveat: 'P&L alone does not establish a psychological cause or discipline issue.' }
  }

  if (q.includes('fee') || q.includes('cost')) return { title: 'Fees and net P&L', takeaway: `Fees reduced gross P&L by ${money(fees)} in the current demo scope.`, body: 'Net P&L is calculated as gross realized P&L minus recorded fees. Fees are subtracted once in this response.', metrics: [{ label: 'Gross P&L', value: money(gross), tone: gross >= 0 ? 'positive' : 'negative' }, { label: 'Fees', value: `-$${fees.toFixed(2)}`, tone: 'negative' }, { label: 'Net P&L', value: money(net), tone: net >= 0 ? 'positive' : 'negative' }], chart: 'cumulative', followUps: ['Summarize my recent trading performance.', 'Show my daily P&L.'] }

  if ((q.includes('recent') && !q.includes('performance')) || q.includes('review')) return { title: 'Recent trade review', takeaway: `The latest ${Math.min(3, trades.length)} records are available for a quick journal review.`, body: trades.slice(0, 3).map(t => `${t.symbol} ${t.side}: ${money(t.pnl - t.fees)} net.${t.note ? ` Note: ${t.note}` : ''}`).join(' '), metrics: [{ label: 'Recent records', value: String(Math.min(3, trades.length)) }, { label: 'Current net', value: money(net), tone: net >= 0 ? 'positive' : 'negative' }], followUps: ['What patterns appear in my losing trades?', 'Help me write a daily trading review.'] }

  if (q.includes('daily') || q.includes('weekly') || q.includes('performance') || q.includes('p&l') || q.includes('pnl') || q.includes('summarize')) return { title: 'Performance summary', takeaway: `The journal is ${net >= 0 ? 'positive' : 'negative'} at ${money(net)} net after fees across ${trades.length} closed records.`, body: `Gross realized P&L is ${money(gross)} and recorded fees are $${fees.toFixed(2)}. ${wins.length} trades closed green and ${losses.length} closed red, for a ${pct(winRate)} win rate.`, metrics: [{ label: 'Net P&L', value: money(net), tone: net >= 0 ? 'positive' : 'negative' }, { label: 'Win rate', value: pct(winRate) }, { label: 'Closed trades', value: String(trades.length) }], chart: 'cumulative', followUps: ['Compare my strategies.', 'Show my daily P&L.', 'Review my losing trades.'], caveat: trades.length < 10 ? 'This demo sample is small, so treat the result as directional rather than reliable evidence.' : undefined }

  return { title: 'Supported journal review', takeaway: 'I can answer questions about the records available in this demo workspace.', body: 'Try asking about performance, strategies, long versus short results, recent trades, fees, losing-trade notes, daily reviews, or a P&L chart. I will only use data present in the journal.', metrics: [{ label: 'Records available', value: String(trades.length) }, { label: 'Strategies', value: String(new Set(trades.map(t => t.strategy)).size) }], followUps: ['Summarize my recent trading performance.', 'Which strategy has performed best?'] }
}
