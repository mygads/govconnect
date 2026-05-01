"use client"

import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"

type ServiceHealth = {
  name: string
  ok: boolean
  status: number | null
  error?: string
}

export function ServiceHealthBanner() {
  const [services, setServices] = useState<ServiceHealth[]>([])

  useEffect(() => {
    let cancelled = false

    const fetchHealth = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        const data = await response.json().catch(() => null)
        if (!cancelled) setServices(Array.isArray(data?.services) ? data.services : [])
      } catch {
        if (!cancelled) setServices([{ name: 'dashboard', ok: false, status: null, error: 'unreachable' }])
      }
    }

    fetchHealth()
    const interval = setInterval(fetchHealth, 60000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const down = services.filter((service) => !service.ok)
  if (down.length === 0) return null

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          Data dashboard mungkin tidak fresh. Service bermasalah: {down.map((service) => service.name).join(', ')}.
        </span>
      </div>
    </div>
  )
}
