"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, Wallet } from "lucide-react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/components/auth/AuthContext"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { isSuperadmin } from "@/lib/rbac"

type WalletStatus = "active" | "warning" | "exhausted"

interface WalletSummaryResponse {
  success?: boolean
  data?: {
    wallet: {
      balance_usd: number
      status: WalletStatus
      warning_threshold_usd: number
    }
    todayUsageUsd: number
    avgDailyUsageUsd: number
    runwayDays: number | null
  }
}

function formatUsd(value?: number | null) {
  return `$${(value ?? 0).toFixed(2)}`
}

function formatRunway(days?: number | null) {
  if (days == null || !Number.isFinite(days)) return "Belum cukup data"
  if (days > 999) return "> 999 hari"
  if (days < 1) return "< 1 hari"
  return `${days.toFixed(1)} hari`
}

function getStatusTone(status: WalletStatus | undefined) {
  if (status === "exhausted") {
    return {
      button: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
      dot: "bg-red-500",
      badge: "Habis",
    }
  }

  if (status === "warning") {
    return {
      button: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
      dot: "bg-amber-500",
      badge: "Warning",
    }
  }

  return {
    button: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
    badge: "Aman",
  }
}

export function useVillageWalletSummary() {
  const { user } = useAuth()
  const [data, setData] = useState<WalletSummaryResponse["data"] | null>(null)
  const [loading, setLoading] = useState(false)

  const enabled = !!user && !isSuperadmin(user.role)

  const fetchSummary = useCallback(async () => {
    if (!enabled) return

    try {
      setLoading(true)
      const token = localStorage.getItem("token")
      const response = await fetch("/api/ai-balance", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (!response.ok) return

      const payload: WalletSummaryResponse = await response.json()
      setData(payload.data ?? null)
    } catch (error) {
      console.error("Failed to fetch AI wallet summary:", error)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  return { data, loading, refresh: fetchSummary, enabled }
}

export function AIWalletNavbarControl() {
  const router = useRouter()
  const { data, loading, enabled } = useVillageWalletSummary()

  const tone = useMemo(() => getStatusTone(data?.wallet.status), [data?.wallet.status])

  if (!enabled) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-8 gap-2 rounded-lg px-3 text-xs font-medium", tone.button)}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
          <span>{formatUsd(data?.wallet.balance_usd)}</span>
          <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Saldo AI Desa</span>
          <span className="text-xs text-muted-foreground">{tone.badge}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="space-y-3 p-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Saldo</p>
              <p className="mt-1 font-semibold">{formatUsd(data?.wallet.balance_usd)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Usage Hari Ini</p>
              <p className="mt-1 font-semibold">{formatUsd(data?.todayUsageUsd)}</p>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Perkiraan Runway</p>
            <p className="mt-1 font-semibold">{formatRunway(data?.runwayDays)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Rata-rata 7 hari: {formatUsd(data?.avgDailyUsageUsd)}/hari
            </p>
          </div>

          <Button className="w-full" onClick={() => router.push("/dashboard/ai-balance")}>See Detail</Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AIWalletExhaustedBanner() {
  const router = useRouter()
  const { data, enabled } = useVillageWalletSummary()

  if (!enabled || data?.wallet.status !== "exhausted") return null

  return (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Saldo AI desa habis</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>Pesan baru akan tertahan sampai saldo diisi ulang, tetapi human takeover tetap bisa berjalan.</span>
        <Button size="sm" variant="destructive" onClick={() => router.push("/dashboard/ai-balance")}>
          Topup Saldo
        </Button>
      </AlertDescription>
    </Alert>
  )
}
