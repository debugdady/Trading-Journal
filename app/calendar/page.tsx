import { CalendarPage } from '@/components/calendar-page'
import { demoTrades } from '@/lib/demo/trades'

export default function CalendarPageRoute() {
  return <CalendarPage trades={demoTrades} />
}
