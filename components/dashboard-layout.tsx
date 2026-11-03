'use client'

import { Sidebar } from '@/components/sidebar'

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="lg:pl-[238px]">{children}</main>
    </div>
  )
}
