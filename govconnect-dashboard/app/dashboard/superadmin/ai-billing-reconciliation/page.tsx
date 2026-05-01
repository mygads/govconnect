"use client"

import { useCallback, useEffect, useState } from "react"
import { redirect } from "next/navigation"
import { AlertTriangle, CheckCircle2, Eye, Loader2, RefreshCw, RotateCcw } from "lucide-react"

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

function DebugJson({ value }: { value: unknown }) {
  return <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
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
  if (user.role !== "superadmin") redirect("/dashboard")

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
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billingRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Tidak ada billing.</TableCell></TableRow>
              ) : billingRows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => loadBillingDetail(row.id)}>
                  <TableCell>
                    <div className="font-mono text-xs">{row.id}</div>
                    <div className="text-xs text-muted-foreground">{row.message_id || row.village_id || "-"}</div>
                  </TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell className="font-mono text-xs">{row.ledger_entry_id || "-"}</TableCell>
                  <TableCell className="text-right">{row.call_count}</TableCell>
                  <TableCell className="text-right">{formatUsd(row.adjusted_cost_usd)}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{row.error_message || "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
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
            <CardTitle>Billing Drilldown</CardTitle>
            <CardDescription>Ledger wallet dan token usage per call untuk billing yang dipilih.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {detailLoading ? (
              <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Memuat detail billing...</div>
            ) : billingDetail ? (
              <>
                <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-5">
                  <div><div className="text-muted-foreground">Billing</div><div className="font-mono text-xs">{billingDetail.billing.id}</div></div>
                  <div><div className="text-muted-foreground">Group</div><div className="font-mono text-xs">{billingDetail.billing.billing_group_id || "-"}</div></div>
                  <div><div className="text-muted-foreground">Status</div><div>{billingDetail.billing.status}</div></div>
                  <div><div className="text-muted-foreground">Adjusted</div><div>{formatUsd(billingDetail.billing.adjusted_cost_usd)}</div></div>
                  <div className="flex items-end"><Button size="sm" variant="outline" disabled={!billingDetail.billing.trace_id || traceLoading} onClick={() => loadAITrace(billingDetail.billing.trace_id)}>{traceLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Trace</Button></div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ledger</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Before</TableHead>
                      <TableHead className="text-right">After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingDetail.ledger_entry ? (
                      <TableRow>
                        <TableCell className="font-mono text-xs">{billingDetail.ledger_entry.id}</TableCell>
                        <TableCell className="text-right">{formatUsd(billingDetail.ledger_entry.amount_usd)}</TableCell>
                        <TableCell className="text-right">{formatUsd(billingDetail.ledger_entry.balance_before_usd)}</TableCell>
                        <TableCell className="text-right">{formatUsd(billingDetail.ledger_entry.balance_after_usd)}</TableCell>
                      </TableRow>
                    ) : (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Tidak ada ledger entry.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Call</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Adjusted</TableHead>
                      <TableHead className="text-right">Latency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingDetail.token_usage.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Tidak ada token usage.</TableCell></TableRow>
                    ) : billingDetail.token_usage.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell><div className="font-mono text-xs">{row.layer_type}</div><div className="text-xs text-muted-foreground">{row.call_type}</div></TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs">{row.model}</TableCell>
                        <TableCell>{row.billing_status}{row.success ? "" : " / failed"}</TableCell>
                        <TableCell className="text-right">{row.total_tokens}</TableCell>
                        <TableCell className="text-right">{formatUsd(row.adjusted_cost_usd)}</TableCell>
                        <TableCell className="text-right">{row.duration_ms ?? "-"} ms</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Pilih billing row untuk melihat detail.</div>
            )}
          </CardContent>
        </Card>
      )}
      {aiTrace && (
        <Card>
          <CardHeader>
            <CardTitle>AI Pipeline Trace</CardTitle>
            <CardDescription>Trace {aiTrace.trace_id}: billing, token usage, RAG, memory, guardrail, dan tool policy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-sm md:grid-cols-3 lg:grid-cols-6">
              <div><div className="text-muted-foreground">Billing</div><div>{aiTrace.billings.length}</div></div>
              <div><div className="text-muted-foreground">Calls</div><div>{aiTrace.token_usage.length}</div></div>
              <div><div className="text-muted-foreground">RAG</div><div>{aiTrace.retrieval.length}</div></div>
              <div><div className="text-muted-foreground">Memory</div><div>{aiTrace.memory.length}</div></div>
              <div><div className="text-muted-foreground">Guardrails</div><div>{aiTrace.guardrails.length}</div></div>
              <div><div className="text-muted-foreground">Tools</div><div>{aiTrace.tool_policy.length}</div></div>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium">Stage Timeline</h3>
              <Table>
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Stage</TableHead><TableHead>Detail</TableHead><TableHead className="text-right">Adjusted</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Latency</TableHead></TableRow></TableHeader>
                <TableBody>
                  {traceStages.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Tidak ada event trace.</TableCell></TableRow>
                  ) : traceStages.map((stage) => (
                    <TableRow key={`${stage.stage}-${stage.id}`}>
                      <TableCell className="text-xs text-muted-foreground">{new Date(stage.created_at).toLocaleString("id-ID")}</TableCell>
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

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2"><h3 className="font-medium">RAG Debug</h3>{aiTrace.retrieval.length ? aiTrace.retrieval.map((row) => <DebugJson key={row.id} value={row} />) : <div className="text-sm text-muted-foreground">Tidak ada retrieval trace.</div>}</div>
              <div className="space-y-2"><h3 className="font-medium">Memory Debug</h3>{aiTrace.memory.length ? aiTrace.memory.map((row) => <DebugJson key={row.id} value={row} />) : <div className="text-sm text-muted-foreground">Tidak ada memory trace.</div>}</div>
              <div className="space-y-2"><h3 className="font-medium">Guardrail Events</h3>{aiTrace.guardrails.length ? aiTrace.guardrails.map((row) => <DebugJson key={row.id} value={row} />) : <div className="text-sm text-muted-foreground">Tidak ada guardrail event.</div>}</div>
              <div className="space-y-2"><h3 className="font-medium">Tool Policy Trace</h3>{aiTrace.tool_policy.length ? aiTrace.tool_policy.map((row) => <DebugJson key={row.id} value={row} />) : <div className="text-sm text-muted-foreground">Tidak ada tool trace.</div>}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
