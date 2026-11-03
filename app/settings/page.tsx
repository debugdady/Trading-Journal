'use client'

import { SettingsCenter } from '@/components/settings-center'
import { useTheme } from 'next-themes'
import { demoTrades } from '@/lib/demo/trades'

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  return <SettingsCenter theme={theme} setTheme={setTheme} trades={demoTrades} />
}
