"use client"

import { useCallback, useEffect, useState } from "react"
import { redirect } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"

interface BillingRow {
  id: string
  village_id?: string | null
  message_id?: string | null
  status: string
  ledger_entry_id?: string | null
  call_count: number
  adjusted_cost_usd: number
  actual_cost_usd: number
  margin_usd: number
  error_message?: string | null
  created_at: string
}

interface ReconciliationData {
  healthy: boolean
  filters: { village_id: string | null; from: string | null; to: string | null }
  counts: Record<string, number>
  totals: Record<string, number>
  mismatches: Record<string, number>
  recent_billings?: BillingRow[]
}

function formatUsd(value?: number | null) {
  return `$${(value ?? 0).toFixed(8)}`
}

export default function AIBillingReconciliationPage() {
  const { user } = useAuth()
  const [data, setData] = useState<ReconciliationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryVillageId, setRetryVillageId] = useState("")
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/superadmin/ai-billing/reconciliation", { cache: "no-store" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal memuat rekonsiliasi billing AI")
      setData(payload.data)
    } catch (err: any) {
      setError(err?.message || "Gagal memuat rekonsiliasi billing AI")
    } finally {
      setLoading(false)
    }
  }, [])

  const retryPending = useCallback(async () => {
    if (!retryVillageId.trim()) {
      setError("Village ID wajib diisi untuk retry billing")
      return
    }
    setRetrying(true)
    setError(null)
    try {
      const response = await fetch(`/api/superadmin/ai-wallets/${encodeURIComponent(retryVillageId.trim())}/retry-pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal retry billing pending")
      await loadData()
    } catch (err: any) {
      setError(err?.message || "Gagal retry billing pending")
    } finally {
      setRetrying(false)
    }
  }, [loadData, retryVillageId])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (!user) return null
  if (user.role !== "superadmin") redirect("/dashboard")

  const mismatchRows = Object.entries(data?.mismatches || {})
  const countRows = Object.entries(data?.counts || {})
  const totalRows = Object.entries(data?.totals || {})
  const billingRows = data?.recent_billings || []

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rekonsiliasi Billing AI</h1>
          <p className="text-sm text-muted-foreground">Bandingkan token usage, message billing, ledger wallet, dan mismatch nominal.</p>
        </div>
        <Button onClick={loadData} disabled={loading} variant="outline">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Gagal memuat data</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data && (
        <Alert variant={data.healthy ? "default" : "destructive"}>
          {data.healthy ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <AlertTitle>{data.healthy ? "Rekonsiliasi sehat" : "Ada mismatch billing"}</AlertTitle>
          <AlertDescription>
            {data.healthy ? "Tidak ada unbilled usage, failed billing, atau mismatch nominal." : "Periksa tabel mismatch dan count anomali di bawah."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Retry Failed/Pending Billing</CardTitle>
          <CardDescription>Masukkan village_id lalu retry semua billing pending/failed untuk desa itu.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input value={retryVillageId} onChange={(event) => setRetryVillageId(event.target.value)} placeholder="village_id" />
          <Button onClick={retryPending} disabled={retrying || !retryVillageId.trim()}>
            {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            Retry
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Counts</CardTitle>
            <CardDescription>Jumlah row penting.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
              <TableBody>{countRows.map(([key, value]) => <TableRow key={key}><TableCell>{key}</TableCell><TableCell className="text-right">{value}</TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
            <CardDescription>Total biaya historical.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead className="text-right">USD</TableHead></TableRow></TableHeader>
              <TableBody>{totalRows.map(([key, value]) => <TableRow key={key}><TableCell>{key}</TableCell><TableCell className="text-right">{formatUsd(value)}</TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mismatches</CardTitle>
            <CardDescription>Selisih antar sumber truth.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead className="text-right">USD</TableHead></TableRow></TableHeader>
              <TableBody>{mismatchRows.map(([key, value]) => <TableRow key={key}><TableCell>{key}</TableCell><TableCell className="text-right">{formatUsd(value)}</TableCell></TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Message Billings</CardTitle>
          <CardDescription>Drilldown ringkas billing terbaru: status, ledger, call count, dan biaya.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Billing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ledger</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Adjusted</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billingRows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Tidak ada billing.</TableCell></TableRow>
              ) : billingRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-mono text-xs">{row.id}</div>
                    <div className="text-xs text-muted-foreground">{row.message_id || row.village_id || "-"}</div>
                  </TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell className="font-mono text-xs">{row.ledger_entry_id || "-"}</TableCell>
                  <TableCell className="text-right">{row.call_count}</TableCell>
                  <TableCell className="text-right">{formatUsd(row.adjusted_cost_usd)}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{row.error_message || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
