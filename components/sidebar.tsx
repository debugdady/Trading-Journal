'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  Activity, BarChart3, BookOpen, CalendarDays, ChevronDown,
  ClipboardList, LayoutDashboard, Moon, Settings2, ShieldAlert,
  Sparkles, Sun, Wallet, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

const nav = [
  ['Overview', '/overview', LayoutDashboard],
  ['Portfolio', '/portfolio', Wallet],
  ['Trades', '/trades', Activity],
  ['Orders & Executions', '/orders', ClipboardList],
  ['Positions & Risk', '/positions', ShieldAlert],
  ['Analytics', '/analytics', BarChart3],
  ['Calendar', '/calendar', CalendarDays],
  ['Playbook', '/playbook', BookOpen],
  ['AI Review', '/ai-review', Sparkles],
] as const

export function Sidebar() {
  const pathname = usePathname()
  const { resolvedTheme, setTheme } = useTheme()
  const [mobileNav, setMobileNav] = useState(false)
  const [accountMenu, setAccountMenu] = useState(false)

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href + '/'))

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[238px] flex-col border-r border-border bg-sidebar p-4 transition-transform lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-2">
          <div className="grid size-6 place-items-center border border-foreground">
            <span className="text-[10px] font-bold">J</span>
          </div>
          <span className="text-[13px] font-semibold tracking-[0.25em]">JOURNAL</span>
        </div>
        <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close navigation">
          <X />
        </Button>
      </div>

      <div className="relative mt-8">
        <button onClick={() => setAccountMenu((v) => !v)} className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left text-xs hover:bg-muted" aria-expanded={accountMenu}>
          <span>
            <span className="block font-medium">Personal account</span>
            <span className="font-mono text-[10px] text-muted-foreground">BINANCE · DEMO</span>
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
        {accountMenu && (
          <div className="absolute left-0 right-0 top-12 z-50 rounded-md border border-border bg-popover p-1 shadow-lg animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-2 rounded px-2 py-2 text-xs">
              <span className="size-1.5 rounded-full bg-muted-foreground" /> Personal account{' '}
              <span className="ml-auto text-[10px] text-muted-foreground">Demo</span>
            </div>
            <Link href="/settings" onClick={() => setAccountMenu(false)} className="w-full rounded px-2 py-2 text-left text-xs hover:bg-muted">
              Manage Connections
            </Link>
            <button onClick={() => toggleTheme()} className="w-full rounded px-2 py-2 text-left text-xs hover:bg-muted">
              {resolvedTheme === 'dark' ? <Sun className="mr-2 size-4" /> : <Moon className="mr-2 size-4" />}
              {resolvedTheme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            </button>
          </div>
        )}
      </div>

      <nav className="mt-7 flex flex-1 flex-col gap-1" aria-label="Primary navigation">
        <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Workspace</p>
        {nav.map(([label, href, Icon]) => (
          <Link key={label} href={href} onClick={() => setMobileNav(false)} className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${isActive(href) ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            <Icon className="size-4" /> {label}
          </Link>
        ))}
        <div className="my-5 border-t border-border" />
        <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">System</p>
        <Link href="/settings" onClick={() => setMobileNav(false)} className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${isActive('/settings') ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
          <Settings2 className="size-4" /> Data & Settings
        </Link>
      </nav>

      <div className="border-t border-border pt-4">
        <div className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-foreground" /> Demo environment
        </div>
        <div className="mt-3 flex items-center justify-between px-2">
          <span className="font-mono text-[10px] text-muted-foreground">v0.1.0 · local</span>
        </div>
      </div>
    </aside>
  )
}
