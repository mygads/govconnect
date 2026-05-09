"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Gift, Loader2, Wallet } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { isSuperadmin } from "@/lib/rbac"
import { formatJakartaDateTime, formatUSD } from "@/lib/utils"

type WalletStatus = "active" | "warning" | "exhausted"

interface WalletSummaryPayload {
  success?: boolean
  error?: string
  data?: {
    wallet: {
      balance_usd: number
      status: WalletStatus
      warning_threshold_usd: number
    }
    todayUsageUsd: number
    avgDailyUsageUsd: number
    runwayDays: number | null
    recentLedger: LedgerEntry[]
  }
}

interface LedgerEntry {
  id: string
  entry_type: string
  amount_usd: number
  balance_before_usd: number
  balance_after_usd: number
  adjusted_cost_usd?: number
  created_at: string
  metadata_json?: {
    reason?: string
    status_text?: string
    adjustment_type?: string
    billing_group_id?: string | null
    message_id?: string | null
    trace_id?: string | null
    call_count?: number | null
    channel?: string | null
    session_id?: string | null
    wa_user_id?: string | null
  } | null
}

function formatDateTime(value: string) {
  return formatJakartaDateTime(value)
}

function formatUsd(value?: number | null, options?: { preciseSmall?: boolean; signed?: boolean }) {
  return formatUSD(value, { preciseSmall: options?.preciseSmall, signed: options?.signed, minimumFractionDigits: 2, maximumFractionDigits: 8 })
}

function formatRunway(days?: number | null) {
  if (days == null || !Number.isFinite(days)) return "Belum cukup data"
  if (days > 999) return "> 999 hari"
  if (days < 1) return "< 1 hari"
  return `${days.toFixed(1)} hari`
}

function formatTinyDelta(value?: number | null) {
  const amount = Math.abs(value ?? 0)
  if (amount === 0) return "Tidak ada perubahan saldo"
  if (amount < 0.000001) return "Perubahan sangat kecil (< $0.000001)"
  return `Perubahan saldo ${formatUsd(value, { preciseSmall: true })}`
}

function getEntryTone(entry: LedgerEntry) {
  if (entry.amount_usd < 0) return "text-red-600"
  if (entry.amount_usd > 0) return "text-emerald-600"
  return "text-muted-foreground"
}

function formatEntryLabel(entry: LedgerEntry) {
  const traceId = entry.metadata_json?.trace_id || ""
  const messageId = entry.metadata_json?.message_id || ""
  const billingGroupId = entry.metadata_json?.billing_group_id || ""
  const channel = entry.metadata_json?.channel || ""
  const note = `${entry.metadata_json?.reason || ""} ${entry.metadata_json?.status_text || ""}`.toLowerCase()

  if (entry.entry_type === "usage_debit") {
    if (traceId.startsWith("document-reprocess-") || messageId.startsWith("ingest:") || billingGroupId.startsWith("ingest:")) {
      return "Embedding Dokumen"
    }
    if (messageId.startsWith("webchat:") || billingGroupId.startsWith("webchat:") || channel === "webchat") {
      return "AI Webchat"
    }
    if (messageId.startsWith("wa:") || billingGroupId.startsWith("wa:") || channel === "whatsapp") {
      return "AI WhatsApp"
    }
    if (note.includes("knowledge") || note.includes("dokumen")) {
      return "Embedding Knowledge"
    }
    return "Pemakaian AI"
  }

  const map: Record<string, string> = {
    topup: "Topup",
    topup_credit: "Topup Kredit",
    voucher_redeem: "Redeem Voucher",
    manual_adjustment: "Penyesuaian Manual",
    refund: "Refund",
    refund_credit: "Refund Kredit",
    seed: "Seed",
  }
  return map[entry.entry_type] || entry.entry_type
}

function getEntryNote(entry: LedgerEntry) {
  if (entry.entry_type === "usage_debit") {
    const traceId = entry.metadata_json?.trace_id || ""
    const messageId = entry.metadata_json?.message_id || ""
    const channel = entry.metadata_json?.channel || ""
    const sessionId = entry.metadata_json?.session_id || ""
    const waUserId = entry.metadata_json?.wa_user_id || ""
    const callCount = entry.metadata_json?.call_count

    if (traceId.startsWith("document-reprocess-") || messageId.startsWith("ingest:")) {
      return `${callCount || 0} call embedding untuk proses dokumen/knowledge base.`
    }
    if (messageId.startsWith("webchat:") || channel === "webchat") {
      return `${callCount || 0} call AI dari percakapan webchat${sessionId ? ` (${sessionId})` : ""}.`
    }
    if (messageId.startsWith("wa:") || channel === "whatsapp") {
      return `${callCount || 0} call AI dari percakapan WhatsApp${waUserId ? ` (${waUserId})` : ""}.`
    }
    if (traceId) {
      return `${callCount || 0} call AI yang sudah ditagihkan ke wallet desa.`
    }
  }

  if (!entry.metadata_json || typeof entry.metadata_json !== "object") return "-"
  return entry.metadata_json.reason || entry.metadata_json.status_text || "-"
}

export default function AIBalancePageContent() {
    const { user } = useAuth()

    const router = useRouter()
  const [summary, setSummary] = useState<WalletSummaryPayload["data"] | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [redeemCode, setRedeemCode] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ledgerError, setLedgerError] = useState<string | null>(null)

  useEffect(() => {
    if (user && isSuperadmin(user.role)) router.replace("/dashboard")
  }, [user, router])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setLedgerError(null)
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

      const [summaryRes, ledgerRes] = await Promise.all([
        fetch("/api/ai-balance", { headers }),
        fetch("/api/ai-balance/ledger?limit=50", { headers }),
      ])

      const summaryPayload: WalletSummaryPayload = await summaryRes.json()
      const ledgerPayload = await ledgerRes.json()

      if (!summaryRes.ok) {
        throw new Error(summaryPayload?.error || "Gagal memuat saldo AI")
      }

      setSummary(summaryPayload.data ?? null)
      if (ledgerRes.ok) {
        setLedger(Array.isArray(ledgerPayload?.data) ? ledgerPayload.data : [])
      } else {
        setLedger(Array.isArray(summaryPayload?.data?.recentLedger) ? summaryPayload.data.recentLedger : [])
        setLedgerError(ledgerPayload?.error || "Riwayat ledger gagal dimuat")
      }
    } catch (err: any) {
      console.error("Failed to load AI balance page:", err)
      setError(err?.message || "Gagal memuat saldo AI")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const wallet = summary?.wallet

  const statusLabel = useMemo(() => {
    if (wallet?.status === "exhausted") return "Habis"
    if (wallet?.status === "warning") return "Warning"
    return "Aman"
  }, [wallet?.status])

  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      setError("Kode voucher wajib diisi")
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setMessage(null)
      const token = localStorage.getItem("token")
      const response = await fetch("/api/ai-balance/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code: redeemCode.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || "Gagal redeem voucher")
      }

      setMessage("Voucher berhasil diredeem dan saldo sudah diperbarui.")
      setRedeemCode("")
      await fetchData()
    } catch (err: any) {
      setError(err?.message || "Gagal redeem voucher")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-60 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat saldo AI...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Saldo AI Desa</h1>
        <p className="mt-2 text-muted-foreground">
          Pantau saldo aktif dalam USD, pemakaian AI terbaru, dan redeem voucher untuk melanjutkan pemrosesan AI.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Gagal memuat data</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {ledgerError && (
        <Alert>
          <AlertTitle>Riwayat saldo belum tersedia</AlertTitle>
          <AlertDescription>{ledgerError}</AlertDescription>
        </Alert>
      )}

      {message && (
        <Alert>
          <AlertTitle>Berhasil</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
              <Wallet className="h-4 w-4" /> Saldo Tersisa
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatUsd(wallet?.balance_usd, { preciseSmall: true })}</p>
            <p className="mt-2 text-xs text-muted-foreground">Status: {statusLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Pemakaian AI Hari Ini</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatUsd(summary?.todayUsageUsd, { preciseSmall: true })}</p>
            <p className="mt-2 text-xs text-muted-foreground">Biaya AI yang sudah terdebit hari ini dalam USD.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Rata-rata 7 Hari</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatUsd(summary?.avgDailyUsageUsd, { preciseSmall: true })}</p>
            <p className="mt-2 text-xs text-muted-foreground">Estimasi pemakaian USD harian berdasarkan 7 hari terakhir.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Perkiraan Runway</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatRunway(summary?.runwayDays)}</p>
            <p className="mt-2 text-xs text-muted-foreground">Perkiraan sampai saldo habis berdasarkan rata-rata pemakaian 7 hari.</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="ledger" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ledger">Riwayat Saldo</TabsTrigger>
          <TabsTrigger value="redeem">Redeem Voucher</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          <Card>
            <CardHeader>
              <CardTitle>Riwayat Ledger</CardTitle>
              <CardDescription>Topup, redeem voucher, dan debit pemakaian AI terbaru. Menampilkan riwayat yang sedang dimuat saja (maks 50 row).</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead>Nominal</TableHead>
                    <TableHead>Saldo Sebelum</TableHead>
                    <TableHead>Saldo Akhir</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        Belum ada riwayat saldo.
                      </TableCell>
                    </TableRow>
                  ) : (
                    ledger.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{formatDateTime(entry.created_at)}</TableCell>
                        <TableCell>{formatEntryLabel(entry)}</TableCell>
                        <TableCell className="max-w-60 truncate text-muted-foreground" title={getEntryNote(entry)}>{getEntryNote(entry)}</TableCell>
                        <TableCell className={getEntryTone(entry)}>
                          <div>{formatUsd(entry.amount_usd, { preciseSmall: true, signed: entry.amount_usd > 0 })}</div>
                          <div className="text-xs text-muted-foreground">{formatTinyDelta(entry.amount_usd)}</div>
                        </TableCell>
                        <TableCell>{formatUsd(entry.balance_before_usd, { preciseSmall: true })}</TableCell>
                        <TableCell>{formatUsd(entry.balance_after_usd, { preciseSmall: true })}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="redeem">
          <Card>
            <CardHeader>
              <CardTitle>Redeem Voucher Topup</CardTitle>
              <CardDescription>Masukkan kode voucher dari superadmin untuk menambah saldo AI desa.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-xl">
              <div className="space-y-2">
                <Label htmlFor="voucher-code">Kode Voucher</Label>
                <Input
                  id="voucher-code"
                  value={redeemCode}
                  onChange={(event) => setRedeemCode(event.target.value.toUpperCase())}
                  placeholder="Contoh: TOPUP-APRIL-50"
                />
              </div>
              <Button onClick={handleRedeem} disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
                Redeem Voucher
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

