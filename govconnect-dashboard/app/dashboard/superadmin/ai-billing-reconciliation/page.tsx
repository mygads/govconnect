"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Eye, Loader2, RefreshCw, RotateCcw } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { formatJakartaDateTime, formatUSD } from "@/lib/utils"

interface BillingRow {
  id: string
  village_id?: string | null
  message_id?: string | null
  trace_id?: string | null
  billing_group_id?: string | null
  status: string
  ledger_entry_id?: string | null
  call_count: number
  adjusted_cost_usd: number
  actual_cost_usd: number
  margin_usd: number
  error_message?: string | null
  created_at: string
}

interface TokenUsageRow {
  id: string
  model: string
  layer_type: string
  call_type: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  actual_cost_usd: number
  adjusted_cost_usd: number
  margin_usd: number
  billing_status: string
  success: boolean
  duration_ms?: number | null
  created_at: string
}

interface LedgerEntryRow {
  id: string
  amount_usd: number
  balance_before_usd: number
  balance_after_usd: number
  adjusted_cost_usd: number
  actual_cost_usd: number
  margin_usd: number
  created_at: string
}

interface BillingDetail {
  billing: BillingRow
  ledger_entry?: LedgerEntryRow | null
  token_usage: TokenUsageRow[]
}

interface ReconciliationData {
  healthy: boolean
  filters: { village_id: string | null; from: string | null; to: string | null }
  counts: Record<string, number>
  totals: Record<string, number>
  mismatches: Record<string, number>
  recent_billings?: BillingRow[]
}

interface RetryBillingResult {
  id: string
  status: string
  error?: string
}

interface RetryBillingResponse {
  village_id: string
  attempted: number
  results: RetryBillingResult[]
}

interface AITraceStage {
  id: string
  stage: string
  title: string
  detail: string
  latency_ms?: number | null
  adjusted_cost_usd?: number | null
  actual_cost_usd?: number | null
  margin_usd?: number | null
  created_at: string
}

interface AITraceData {
  trace_id: string
  billings: BillingRow[]
  token_usage: TokenUsageRow[]
  retrieval: any[]
  memory: any[]
  guardrails: any[]
  tool_policy: any[]
}

function buildTraceStages(trace: AITraceData): AITraceStage[] {
  return [
    ...trace.guardrails.map((row) => ({
      id: row.id,
      stage: "guard",
      title: `${row.guard_stage || "guard"}: ${row.action || "-"}`,
      detail: row.reason || row.guard_type || "-",
      created_at: row.created_at,
    })),
    ...trace.memory.map((row) => ({
      id: row.id,
      stage: "memory",
      title: `${row.source || "memory"} (${row.result_count ?? 0})`,
      detail: row.query || row.summary_text || "-",
      created_at: row.created_at,
    })),
    ...trace.retrieval.map((row) => ({
      id: row.id,
      stage: "retrieval",
      title: `${row.retrieval_mode || "rag"}: ${row.confidence || "-"}`,
      detail: `${row.result_count ?? 0} result, top ${row.top_score ?? "-"}`,
      latency_ms: row.search_time_ms,
      created_at: row.created_at,
    })),
    ...trace.tool_policy.map((row) => ({
      id: row.id,
      stage: "tools",
      title: row.policy_key || row.policy_source || "tool policy",
      detail: JSON.stringify(row.actual_tools_json || row.allowed_tools_json || []),
      created_at: row.created_at,
    })),
    ...trace.token_usage.map((row) => ({
      id: row.id,
      stage: row.layer_type || "llm",
      title: `${row.call_type}: ${row.model}`,
      detail: `${row.total_tokens} tokens · ${row.billing_status}${row.success ? "" : " · failed"}`,
      latency_ms: row.duration_ms,
      adjusted_cost_usd: row.adjusted_cost_usd,
      actual_cost_usd: row.actual_cost_usd,
      margin_usd: row.margin_usd,
      created_at: row.created_at,
    })),
    ...trace.billings.map((row) => ({
      id: row.id,
      stage: "billing",
      title: row.status,
      detail: `${row.call_count} calls · ${row.billing_group_id || row.message_id || "-"}`,
      adjusted_cost_usd: row.adjusted_cost_usd,
      actual_cost_usd: row.actual_cost_usd,
      margin_usd: row.margin_usd,
      created_at: row.created_at,
    })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

const COUNT_LABELS: Record<string, string> = {
  token_usage_rows: "Usage token",
  message_billings: "Billing pesan",
  ledger_usage_debits: "Debit ledger",
  unbilled_usage: "Usage belum tertagih",
  stale_unbilled_usage: "Usage lama belum tertagih",
  missing_billing_group_usage: "Usage tanpa grup billing",
  failed_billings: "Billing gagal",
  pending_billings: "Billing pending",
  duplicate_billing_groups: "Grup billing duplikat",
  billed_without_ledger: "Billing tanpa ledger",
  ledger_without_billing: "Ledger tanpa billing",
}

const TOTAL_LABELS: Record<string, string> = {
  token_usage_adjusted_usd: "Token usage adjusted",
  token_usage_actual_usd: "Token usage actual",
  token_usage_margin_usd: "Margin token usage",
  message_billing_adjusted_usd: "Message billing adjusted",
  message_billing_actual_usd: "Message billing actual",
  message_billing_margin_usd: "Margin message billing",
  ledger_adjusted_usd: "Ledger adjusted",
  ledger_debit_amount_usd: "Debit ledger",
}

const MISMATCH_LABELS: Record<string, string> = {
  token_vs_billing_usd: "Token usage vs message billing",
  billing_vs_ledger_adjusted_usd: "Billing vs ledger adjusted",
  billing_vs_ledger_amount_usd: "Billing vs debit ledger",
}

const METRIC_DESCRIPTIONS: Record<string, string> = {
  unbilled_usage: "Panggilan AI yang belum masuk message billing.",
  stale_unbilled_usage: "Unbilled usage yang sudah terlalu lama tertahan.",
  failed_billings: "Billing yang gagal dibuat atau gagal debit wallet.",
  pending_billings: "Billing yang masih menunggu proses debit.",
  billed_without_ledger: "Message billing sukses tapi tidak punya ledger debit.",
  ledger_without_billing: "Ada ledger debit yang tidak ketemu billing asalnya.",
  duplicate_billing_groups: "Satu billing group muncul lebih dari sekali.",
  token_vs_billing_usd: "Selisih biaya dari token usage ke message billing.",
  billing_vs_ledger_adjusted_usd: "Selisih adjusted billing dengan ledger.",
  billing_vs_ledger_amount_usd: "Selisih nominal debit ledger dengan billing.",
}

function metricLabel(key: string, group?: "count" | "total" | "mismatch") {
  const source = group === "count" ? COUNT_LABELS : group === "total" ? TOTAL_LABELS : group === "mismatch" ? MISMATCH_LABELS : {}
  return source[key] || key.replace(/_/g, " ")
}

function metricDescription(key: string) {
  return METRIC_DESCRIPTIONS[key] || "Metrik teknis untuk audit rekonsiliasi."
}

function formatNumber(value?: number | null) {
  return (value ?? 0).toLocaleString("id-ID")
}

function formatDateTime(value?: string | null) {
  return value ? formatJakartaDateTime(value, { dateStyle: "medium", timeStyle: "short" }) : "-"
}

function shortId(value?: string | null) {
  if (!value) return "-"
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    billed: "Sudah ditagihkan",
    success: "Berhasil",
    completed: "Selesai",
    pending: "Pending",
    failed: "Gagal",
    failed_insufficient_balance: "Saldo kurang",
  }
  return status ? labels[status] || status.replace(/_/g, " ") : "-"
}

function statusBadgeVariant(status?: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (["billed", "success", "completed"].includes(status || "")) return "default"
  if (["failed", "failed_insufficient_balance"].includes(status || "")) return "destructive"
  if (status === "pending") return "secondary"
  return "outline"
}

function anomalyCount(data: ReconciliationData | null) {
  if (!data) return 0
  return [
    "unbilled_usage",
    "stale_unbilled_usage",
    "missing_billing_group_usage",
    "failed_billings",
    "pending_billings",
    "duplicate_billing_groups",
    "billed_without_ledger",
    "ledger_without_billing",
  ].reduce((sum, key) => sum + (data.counts[key] || 0), 0)
}

function totalMismatchUsd(data: ReconciliationData | null) {
  if (!data) return 0
  return Object.values(data.mismatches || {}).reduce((sum, value) => sum + Math.abs(value || 0), 0)
}

function DebugJson({ value }: { value: unknown }) {
  return <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
}

function formatUsd(value?: number | null) {
  return formatUSD(value, { preciseSmall: true, minimumFractionDigits: 4, maximumFractionDigits: 8 })
}

function SummaryMetricCard({ title, value, description, tone = "default" }: { title: string; value: string; description: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const toneClass = tone === "success" ? "text-emerald-600" : tone === "warning" ? "text-amber-600" : tone === "danger" ? "text-destructive" : "text-foreground"
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function TechnicalMetricTable({ rows, group, currency = false }: { rows: [string, number][]; group: "count" | "total" | "mismatch"; currency?: boolean }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Metrik</TableHead><TableHead>Keterangan</TableHead><TableHead className="text-right">Nilai</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map(([key, value]) => (
          <TableRow key={key}>
            <TableCell className="font-medium">{metricLabel(key, group)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{metricDescription(key)}</TableCell>
            <TableCell className="text-right font-mono text-xs">{currency ? formatUsd(value) : formatNumber(value)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function AIBillingReconciliationPage() {
    const { user } = useAuth()
    const router = useRouter()
  const [data, setData] = useState<ReconciliationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryVillageId, setRetryVillageId] = useState("")
  const [retrying, setRetrying] = useState(false)
  const [selectedBillingId, setSelectedBillingId] = useState<string | null>(null)
  const [billingDetail, setBillingDetail] = useState<BillingDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [aiTrace, setAiTrace] = useState<AITraceData | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [retryResult, setRetryResult] = useState<RetryBillingResponse | null>(null)
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

  const loadBillingDetail = useCallback(async (billingId: string) => {
    setSelectedBillingId(billingId)
    setDetailLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/superadmin/ai-billing/reconciliation/${encodeURIComponent(billingId)}`, { cache: "no-store" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal memuat detail billing")
      setBillingDetail(payload.data)
    } catch (err: any) {
      setBillingDetail(null)
      setError(err?.message || "Gagal memuat detail billing")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const loadAITrace = useCallback(async (traceId?: string | null) => {
    if (!traceId) return
    setTraceLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/superadmin/ai-billing/trace/${encodeURIComponent(traceId)}`, { cache: "no-store" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal memuat trace AI")
      setAiTrace(payload.data)
    } catch (err: any) {
      setAiTrace(null)
      setError(err?.message || "Gagal memuat trace AI")
    } finally {
      setTraceLoading(false)
    }
  }, [])

  const retryPending = useCallback(async (villageIdOverride?: string | null) => {
    const targetVillageId = (villageIdOverride || retryVillageId).trim()
    if (!targetVillageId) {
      setError("Village ID wajib diisi untuk retry billing")
      return
    }
    setRetrying(true)
    setRetryResult(null)
    setError(null)
    try {
      const response = await fetch(`/api/superadmin/ai-wallets/${encodeURIComponent(targetVillageId)}/retry-pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Gagal retry billing pending")
      setRetryVillageId(targetVillageId)
      setRetryResult(payload.data)
      await loadData()
      if (selectedBillingId) await loadBillingDetail(selectedBillingId)
      if (aiTrace?.trace_id) await loadAITrace(aiTrace.trace_id)
    } catch (err: any) {
      setError(err?.message || "Gagal retry billing pending")
    } finally {
      setRetrying(false)
    }
  }, [aiTrace?.trace_id, loadAITrace, loadBillingDetail, loadData, retryVillageId, selectedBillingId])


  useEffect(() => {
    loadData()
  }, [loadData])

  if (!user) return null
  if (user.role !== "superadmin") router.replace("/dashboard")

  const mismatchRows = Object.entries(data?.mismatches || {})
  const countRows = Object.entries(data?.counts || {})
  const totalRows = Object.entries(data?.totals || {})
  const billingRows = data?.recent_billings || []

  const traceStages = aiTrace ? buildTraceStages(aiTrace) : []

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

      {retryResult && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Retry billing selesai</AlertTitle>
          <AlertDescription>
            Desa {retryResult.village_id}: {retryResult.attempted} billing dicoba. {retryResult.results.map((row) => `${row.id}: ${row.status}${row.error ? ` (${row.error})` : ""}`).join("; ") || "Tidak ada billing pending/failed."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SummaryMetricCard
          title="Status Rekonsiliasi"
          value={data?.healthy ? "Sehat" : "Perlu dicek"}
          description={data?.healthy ? "Tidak ada anomali penting pada billing, usage, dan ledger." : `${formatNumber(anomalyCount(data))} anomali perlu ditinjau.`}
          tone={data?.healthy ? "success" : "danger"}
        />
        <SummaryMetricCard
          title="Usage Belum Tertagih"
          value={formatNumber((data?.counts.unbilled_usage || 0) + (data?.counts.stale_unbilled_usage || 0))}
          description={`${formatNumber(data?.counts.unbilled_usage || 0)} baru · ${formatNumber(data?.counts.stale_unbilled_usage || 0)} lama`}
          tone={(data?.counts.unbilled_usage || 0) + (data?.counts.stale_unbilled_usage || 0) > 0 ? "warning" : "success"}
        />
        <SummaryMetricCard
          title="Billing Bermasalah"
          value={formatNumber((data?.counts.failed_billings || 0) + (data?.counts.pending_billings || 0))}
          description={`${formatNumber(data?.counts.failed_billings || 0)} gagal · ${formatNumber(data?.counts.pending_billings || 0)} pending`}
          tone={(data?.counts.failed_billings || 0) > 0 ? "danger" : (data?.counts.pending_billings || 0) > 0 ? "warning" : "success"}
        />
        <SummaryMetricCard
          title="Relasi Billing vs Ledger"
          value={formatNumber((data?.counts.billed_without_ledger || 0) + (data?.counts.ledger_without_billing || 0))}
          description={`${formatNumber(data?.counts.billed_without_ledger || 0)} tanpa ledger · ${formatNumber(data?.counts.ledger_without_billing || 0)} tanpa billing`}
          tone={(data?.counts.billed_without_ledger || 0) + (data?.counts.ledger_without_billing || 0) > 0 ? "warning" : "success"}
        />
        <SummaryMetricCard
          title="Total Billed Adjusted"
          value={formatUsd(data?.totals.message_billing_adjusted_usd || 0)}
          description="Total biaya billed yang tercatat di message billing."
        />
        <SummaryMetricCard
          title="Total Mismatch"
          value={formatUsd(totalMismatchUsd(data))}
          description="Akumulasi absolut selisih nominal antar sumber data."
          tone={totalMismatchUsd(data) > 0 ? "danger" : "success"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Retry Failed/Pending Billing</CardTitle>
          <CardDescription>Masukkan village_id lalu retry semua billing pending/failed untuk desa itu.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input value={retryVillageId} onChange={(event) => setRetryVillageId(event.target.value)} placeholder="village_id" />
          <Button onClick={() => retryPending()} disabled={retrying || !retryVillageId.trim()}>
            {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            Retry
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing Terbaru</CardTitle>
          <CardDescription>Baris billing yang paling relevan untuk dicek cepat dan ditelusuri detailnya.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Billing</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ledger</TableHead>
                <TableHead className="text-right">Jumlah Call</TableHead>
                <TableHead className="text-right">Biaya</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billingRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Belum ada billing yang perlu ditampilkan.</TableCell></TableRow>
              ) : billingRows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => loadBillingDetail(row.id)}>
                  <TableCell>
                    <div className="font-mono text-xs" title={row.id}>{shortId(row.id)}</div>
                    <div className="text-xs text-muted-foreground" title={row.message_id || row.village_id || "-"}>{shortId(row.message_id || row.village_id || "-")}</div>
                  </TableCell>
                  <TableCell><Badge variant={statusBadgeVariant(row.status)}>{statusLabel(row.status)}</Badge></TableCell>
                  <TableCell className="font-mono text-xs" title={row.ledger_entry_id || "-"}>{shortId(row.ledger_entry_id)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.call_count)}</TableCell>
                  <TableCell className="text-right">{formatUsd(row.adjusted_cost_usd)}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={row.error_message || "-"}>{row.error_message || "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); loadBillingDetail(row.id) }}>Detail</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={traceLoading || !row.trace_id}
                        onClick={(event) => {
                          event.stopPropagation()
                          loadAITrace(row.trace_id)
                        }}
                      >
                        {traceLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                        Trace
                      </Button>
                      {row.village_id && ["pending", "failed", "failed_insufficient_balance"].includes(row.status) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retrying}
                          onClick={(event) => {
                            event.stopPropagation()
                            retryPending(row.village_id)
                          }}
                        >
                          Retry Desa
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {(selectedBillingId || detailLoading) && (
        <Card>
          <CardHeader>
            <CardTitle>Detail Billing Terpilih</CardTitle>
            <CardDescription>Ringkasan billing, ledger wallet, dan token usage per call.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {detailLoading ? (
              <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Memuat detail billing...</div>
            ) : billingDetail ? (
              <>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                  <SummaryMetricCard title="Billing ID" value={shortId(billingDetail.billing.id)} description={billingDetail.billing.id} />
                  <SummaryMetricCard title="Billing Group" value={shortId(billingDetail.billing.billing_group_id)} description={billingDetail.billing.billing_group_id || "-"} />
                  <SummaryMetricCard title="Status" value={statusLabel(billingDetail.billing.status)} description={formatDateTime(billingDetail.billing.created_at)} tone={statusBadgeVariant(billingDetail.billing.status) === "destructive" ? "danger" : statusBadgeVariant(billingDetail.billing.status) === "secondary" ? "warning" : "success"} />
                  <SummaryMetricCard title="Biaya Adjusted" value={formatUsd(billingDetail.billing.adjusted_cost_usd)} description={`Actual ${formatUsd(billingDetail.billing.actual_cost_usd)}`} />
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Trace AI</CardTitle></CardHeader>
                    <CardContent><Button size="sm" variant="outline" disabled={!billingDetail.billing.trace_id || traceLoading} onClick={() => loadAITrace(billingDetail.billing.trace_id)}>{traceLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Trace</Button></CardContent>
                  </Card>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ledger</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Saldo Sebelum</TableHead>
                      <TableHead className="text-right">Saldo Sesudah</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingDetail.ledger_entry ? (
                      <TableRow>
                        <TableCell className="font-mono text-xs" title={billingDetail.ledger_entry.id}>{shortId(billingDetail.ledger_entry.id)}</TableCell>
                        <TableCell className="text-right">{formatUsd(billingDetail.ledger_entry.amount_usd)}</TableCell>
                        <TableCell className="text-right">{formatUsd(billingDetail.ledger_entry.balance_before_usd)}</TableCell>
                        <TableCell className="text-right">{formatUsd(billingDetail.ledger_entry.balance_after_usd)}</TableCell>
                      </TableRow>
                    ) : (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Belum ada ledger entry untuk billing ini.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Call AI</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Adjusted</TableHead>
                      <TableHead className="text-right">Latency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingDetail.token_usage.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Tidak ada token usage pada billing ini.</TableCell></TableRow>
                    ) : billingDetail.token_usage.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell><div className="font-mono text-xs">{row.layer_type}</div><div className="text-xs text-muted-foreground">{row.call_type}</div></TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs">{row.model}</TableCell>
                        <TableCell><Badge variant={statusBadgeVariant(row.success ? row.billing_status : "failed")}>{row.success ? statusLabel(row.billing_status) : "Call gagal"}</Badge></TableCell>
                        <TableCell className="text-right">{formatNumber(row.total_tokens)}</TableCell>
                        <TableCell className="text-right">{formatUsd(row.adjusted_cost_usd)}</TableCell>
                        <TableCell className="text-right">{row.duration_ms ?? "-"} ms</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Pilih billing untuk melihat detailnya.</div>
            )}
          </CardContent>
        </Card>
      )}
      {aiTrace && (
        <Card>
          <CardHeader>
            <CardTitle>Diagnostik Trace AI</CardTitle>
            <CardDescription>Trace {aiTrace.trace_id}: billing, token usage, RAG, memory, guardrail, dan tool policy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-sm md:grid-cols-3 lg:grid-cols-6">
              <div><div className="text-muted-foreground">Billing</div><div>{formatNumber(aiTrace.billings.length)}</div></div>
              <div><div className="text-muted-foreground">Calls</div><div>{formatNumber(aiTrace.token_usage.length)}</div></div>
              <div><div className="text-muted-foreground">RAG</div><div>{formatNumber(aiTrace.retrieval.length)}</div></div>
              <div><div className="text-muted-foreground">Memory</div><div>{formatNumber(aiTrace.memory.length)}</div></div>
              <div><div className="text-muted-foreground">Guardrails</div><div>{formatNumber(aiTrace.guardrails.length)}</div></div>
              <div><div className="text-muted-foreground">Tools</div><div>{formatNumber(aiTrace.tool_policy.length)}</div></div>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium">Timeline Tahapan</h3>
              <Table>
                <TableHeader><TableRow><TableHead>Waktu</TableHead><TableHead>Tahap</TableHead><TableHead>Detail</TableHead><TableHead className="text-right">Adjusted</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Latency</TableHead></TableRow></TableHeader>
                <TableBody>
                  {traceStages.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Tidak ada event trace.</TableCell></TableRow>
                  ) : traceStages.map((stage) => (
                    <TableRow key={`${stage.stage}-${stage.id}`}>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(stage.created_at)}</TableCell>
                      <TableCell><div className="font-medium">{stage.stage}</div><div className="text-xs text-muted-foreground">{stage.title}</div></TableCell>
                      <TableCell className="max-w-[520px] truncate text-xs">{stage.detail}</TableCell>
                      <TableCell className="text-right">{stage.adjusted_cost_usd == null ? "-" : formatUsd(stage.adjusted_cost_usd)}</TableCell>
                      <TableCell className="text-right">{stage.actual_cost_usd == null ? "-" : formatUsd(stage.actual_cost_usd)}</TableCell>
                      <TableCell className="text-right">{stage.margin_usd == null ? "-" : formatUsd(stage.margin_usd)}</TableCell>
                      <TableCell className="text-right">{stage.latency_ms == null ? "-" : `${stage.latency_ms} ms`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Accordion type="multiple" className="w-full">
              <AccordionItem value="trace-rag">
                <AccordionTrigger>RAG Debug</AccordionTrigger>
                <AccordionContent>{aiTrace.retrieval.length ? aiTrace.retrieval.map((row) => <DebugJson key={row.id} value={row} />) : <div className="text-sm text-muted-foreground">Tidak ada retrieval trace.</div>}</AccordionContent>
              </AccordionItem>
              <AccordionItem value="trace-memory">
                <AccordionTrigger>Memory Debug</AccordionTrigger>
                <AccordionContent>{aiTrace.memory.length ? aiTrace.memory.map((row) => <DebugJson key={row.id} value={row} />) : <div className="text-sm text-muted-foreground">Tidak ada memory trace.</div>}</AccordionContent>
              </AccordionItem>
              <AccordionItem value="trace-guardrail">
                <AccordionTrigger>Guardrail Events</AccordionTrigger>
                <AccordionContent>{aiTrace.guardrails.length ? aiTrace.guardrails.map((row) => <DebugJson key={row.id} value={row} />) : <div className="text-sm text-muted-foreground">Tidak ada guardrail event.</div>}</AccordionContent>
              </AccordionItem>
              <AccordionItem value="trace-tools">
                <AccordionTrigger>Tool Policy Trace</AccordionTrigger>
                <AccordionContent>{aiTrace.tool_policy.length ? aiTrace.tool_policy.map((row) => <DebugJson key={row.id} value={row} />) : <div className="text-sm text-muted-foreground">Tidak ada tool trace.</div>}</AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Detail Metrik Teknis</CardTitle>
          <CardDescription>Semua angka teknis tetap tersedia untuk audit, tetapi disembunyikan agar tampilan utama lebih ringkas.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="metrics-counts">
              <AccordionTrigger>Counts</AccordionTrigger>
              <AccordionContent><TechnicalMetricTable rows={countRows} group="count" /></AccordionContent>
            </AccordionItem>
            <AccordionItem value="metrics-totals">
              <AccordionTrigger>Totals</AccordionTrigger>
              <AccordionContent><TechnicalMetricTable rows={totalRows} group="total" currency /></AccordionContent>
            </AccordionItem>
            <AccordionItem value="metrics-mismatches">
              <AccordionTrigger>Mismatches</AccordionTrigger>
              <AccordionContent><TechnicalMetricTable rows={mismatchRows} group="mismatch" currency /></AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  )
}
