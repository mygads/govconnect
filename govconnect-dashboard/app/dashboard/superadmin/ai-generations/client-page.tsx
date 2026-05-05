"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Eye, RefreshCw, Search, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface GenerationRow {
  id: string
  village_id: string | null
  village?: { id: string; name: string; slug: string } | null
  provider: string | null
  provider_info?: { name: string; slug: string; provider_kind: string } | null
  model: string
  model_info?: { display_name: string; upstream_model_name: string } | null
  gateway_source: string | null
  lane_type: string | null
  layer_type: string | null
  call_type: string | null
  input_tokens: number
  output_tokens: number
  total_tokens: number
  actual_cost_usd: number
  adjusted_cost_usd: number
  duration_ms: number | null
  finish_reason: string | null
  status: string
  created_at: string
  has_raw_payload: boolean
}

interface GenerationResponse {
  total: number
  limit: number
  offset: number
  data: GenerationRow[]
}

interface DetailResponse {
  data: {
    log: any | null
    token_usage: any | null
    billing: any | null
    provider: any | null
    model: any | null
    village: { id: string; name: string; slug: string } | null
    has_raw_payload: boolean
  }
}

const USD_TO_IDR = 18_000
const defaultStart = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16)
const defaultEnd = () => new Date().toISOString().slice(0, 16)

function formatDate(value: string) {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })
}

function formatNumber(value: number) {
  return (value || 0).toLocaleString("id-ID")
}

function formatUSD(usd: number) {
  const amount = usd || 0
  const minimumFractionDigits = amount > 0 && amount < 0.000001 ? 8 : 4
  const maximumFractionDigits = amount > 0 && amount < 0.000001 ? 8 : 6
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits, maximumFractionDigits }).format(amount)
}

function formatIDR(usd: number) {
  const amount = (usd || 0) * USD_TO_IDR
  const minimumFractionDigits = amount > 0 && amount < 0.01 ? 8 : 0
  const maximumFractionDigits = amount > 0 && amount < 0.01 ? 8 : 2
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits, maximumFractionDigits }).format(amount)
}

function formatCost(usd: number) {
  return `${formatUSD(usd)} / ${formatIDR(usd)}`
}

function gatewayLabel(value?: string | null) {
  const labels: Record<string, string> = {
    gateway_llm: "AI Gateway · LLM",
    gateway_embed: "AI Gateway · Embed",
    gateway_rerank: "AI Gateway · Rerank",
    gateway_rag: "AI Gateway · RAG Rewrite",
    llm: "LLM",
    embed: "Embedding",
    rerank: "Rerank",
    rewrite: "RAG Rewrite",
  }
  return value ? labels[value] || value.replace(/_/g, " ") : "-"
}

function speed(row: GenerationRow) {
  if (!row.duration_ms) return "-"
  const seconds = row.duration_ms / 1000
  const tokensPerSecond = seconds > 0 ? row.output_tokens / seconds : 0
  return `${tokensPerSecond.toFixed(1)} tok/s · ${row.duration_ms} ms`
}

function toCsv(rows: GenerationRow[]) {
  const header = ["Date", "Desa", "Gateway/Provider", "Model", "Input", "Output", "Cost", "Speed", "Finish Reason", "Status"]
  const lines = rows.map((row) => [
    formatDate(row.created_at),
    row.village?.name || row.village_id || "-",
    row.provider_info?.name || row.provider || row.gateway_source || "-",
    row.model_info?.display_name || row.model,
    row.input_tokens,
    row.output_tokens,
    formatCost(row.actual_cost_usd),
    speed(row),
    row.finish_reason || "-",
    row.status,
  ])
  return [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n")
}

function JsonBlock({ value }: { value: any }) {
  if (!value) return <p className="text-sm text-muted-foreground">Tidak ada data raw untuk row ini.</p>
  return <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
}

export default function AIGenerationLogsPageContent() {
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const [status, setStatus] = useState("all")
  const [lane, setLane] = useState("all")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<GenerationRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResponse["data"] | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const params = useMemo(() => {
    const result: Record<string, string> = { start: new Date(start).toISOString(), end: new Date(end).toISOString(), limit: "100" }
    if (status !== "all") result.status = status
    if (lane !== "all") result.lane_type = lane
    if (search.trim()) result.search = search.trim()
    return result
  }, [start, end, status, lane, search])

  const loadRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/superadmin/ai-generations?${new URLSearchParams(params)}`, { cache: "no-store" })
      const payload: GenerationResponse = await response.json()
      if (!response.ok) throw new Error((payload as any).error || "Gagal memuat log AI")
      setRows(payload.data || [])
      setTotal(payload.total || 0)
    } catch (err: any) {
      setError(err?.message || "Gagal memuat log AI")
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { loadRows() }, [loadRows])

  const openDetail = async (id: string) => {
    setSelectedId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const response = await fetch(`/api/superadmin/ai-generations/${encodeURIComponent(id)}`, { cache: "no-store" })
      const payload: DetailResponse = await response.json()
      if (!response.ok) throw new Error((payload as any).error || "Gagal memuat detail")
      setDetail(payload.data)
    } finally {
      setDetailLoading(false)
    }
  }

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `govconnect-ai-generations-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectedRow = rows.find((row) => row.id === selectedId)

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold">AI Generation Logs</h1>
          </div>
          <p className="text-muted-foreground">Log real dari gateway/provider AI GovConnect. Zona waktu tampilan: GMT+7.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="mr-2 h-4 w-4" /> Export</Button>
          <Button onClick={loadRows} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Default menampilkan Past 24 hours.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <Input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
          <Input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
          <Select value={lane} onValueChange={setLane}>
            <SelectTrigger><SelectValue placeholder="Lane" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua lane</SelectItem>
              <SelectItem value="llm">LLM</SelectItem>
              <SelectItem value="embed">Embed</SelectItem>
              <SelectItem value="rerank">Rerank</SelectItem>
              <SelectItem value="rewrite">Rewrite</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Trace, message, user, session" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </CardContent>
      </Card>

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardHeader>
          <CardTitle>Generations</CardTitle>
          <CardDescription>{formatNumber(total)} total row · {formatNumber(rows.length)} ditampilkan · export mengikuti row yang sedang dimuat</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Desa</TableHead>
                <TableHead>Gateway / Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Input</TableHead>
                <TableHead>Output</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Speed</TableHead>
                <TableHead>Finish Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={11} className="py-10 text-center text-muted-foreground">Memuat log AI...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="py-10 text-center text-muted-foreground">Belum ada log pada filter ini.</TableCell></TableRow>
              ) : rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => openDetail(row.id)}>
                  <TableCell className="whitespace-nowrap">{formatDate(row.created_at)}</TableCell>
                  <TableCell>{row.village?.name || row.village_id || "-"}</TableCell>
                  <TableCell>
                    <div className="font-medium">{row.provider_info?.name || row.provider || "-"}</div>
                    <div className="text-xs text-muted-foreground">{gatewayLabel(row.gateway_source || row.lane_type)}</div>
                  </TableCell>
                  <TableCell>{row.model_info?.display_name || row.model}</TableCell>
                  <TableCell>{formatNumber(row.input_tokens)}</TableCell>
                  <TableCell>{formatNumber(row.output_tokens)}</TableCell>
                  <TableCell>{formatCost(row.actual_cost_usd)}</TableCell>
                  <TableCell className="whitespace-nowrap">{speed(row)}</TableCell>
                  <TableCell>{row.finish_reason || "-"}</TableCell>
                  <TableCell><Badge variant={row.status === "success" ? "default" : "destructive"}>{row.status}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="ghost"><Eye className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>Generation Detail</SheetTitle>
            <SheetDescription>{selectedRow ? `${selectedRow.village?.name || selectedRow.village_id || "Unknown desa"} · ${formatDate(selectedRow.created_at)}` : "Detail panggilan AI"}</SheetDescription>
          </SheetHeader>
          {detailLoading ? <p className="p-4 text-sm text-muted-foreground">Memuat detail...</p> : detail && (
            <div className="space-y-4 p-4">
              {!detail.has_raw_payload && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Raw prompt/response tidak tersedia untuk row historis ini karena belum dipersist saat call dibuat.</div>}
              <div className="grid gap-3 md:grid-cols-2">
                <Card><CardHeader><CardTitle>Provider</CardTitle></CardHeader><CardContent className="text-sm">{detail.provider?.name || detail.token_usage?.key_tier || detail.log?.provider || "-"}<br /><span className="text-muted-foreground">{detail.provider?.base_url || gatewayLabel(detail.token_usage?.key_source || detail.log?.gateway_source)}</span></CardContent></Card>
                <Card><CardHeader><CardTitle>Model</CardTitle></CardHeader><CardContent className="text-sm">{detail.model?.display_name || detail.token_usage?.model || detail.log?.model || "-"}<br /><span className="text-muted-foreground">{detail.model?.upstream_model_name || "-"}</span></CardContent></Card>
                <Card><CardHeader><CardTitle>Tokens</CardTitle></CardHeader><CardContent className="text-sm">Input {formatNumber(detail.token_usage?.input_tokens ?? detail.log?.input_tokens ?? 0)} · Output {formatNumber(detail.token_usage?.output_tokens ?? detail.log?.output_tokens ?? 0)} · Total {formatNumber(detail.token_usage?.total_tokens ?? detail.log?.total_tokens ?? 0)}</CardContent></Card>
                <Card><CardHeader><CardTitle>Cost & Latency</CardTitle></CardHeader><CardContent className="text-sm">{formatCost(detail.token_usage?.actual_cost_usd ?? detail.log?.actual_cost_usd ?? 0)} · {detail.token_usage?.duration_ms ?? detail.log?.duration_ms ?? "-"} ms</CardContent></Card>
              </div>
              <Card><CardHeader><CardTitle>Billing / Message Context</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm md:grid-cols-2"><div>Trace: {detail.token_usage?.trace_id || detail.log?.trace_id || "-"}</div><div>Message: {detail.token_usage?.message_id || detail.log?.message_id || "-"}</div><div>Billing Group: {detail.token_usage?.billing_group_id || detail.log?.billing_group_id || "-"}</div><div>WA User: {detail.token_usage?.wa_user_id || detail.log?.wa_user_id || "-"}</div></CardContent></Card>
              <Card><CardHeader><CardTitle>Prompt / Request</CardTitle></CardHeader><CardContent className="space-y-3"><p className="whitespace-pre-wrap text-sm">{detail.log?.prompt_preview || "Tidak ada prompt preview."}</p><JsonBlock value={detail.log?.request_json} /></CardContent></Card>
              <Card><CardHeader><CardTitle>Completion / Response</CardTitle></CardHeader><CardContent className="space-y-3"><p className="whitespace-pre-wrap text-sm">{detail.log?.completion_preview || "Tidak ada completion preview."}</p><JsonBlock value={detail.log?.response_json} /></CardContent></Card>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

