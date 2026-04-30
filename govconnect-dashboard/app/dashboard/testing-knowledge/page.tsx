"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"

interface TestResult {
  success: boolean
  data?: {
    response: string
    guidanceText?: string
    intent: string
    fields?: Record<string, any>
    metadata?: {
      processingTimeMs: number
      model?: string
      hasKnowledge: boolean
      knowledgeConfidence?: string
      sentiment?: string
      language?: string
      agentMode?: string
      sideEffectMode?: string
      toolsUsed?: string[]
      allowedTools?: string[]
      heuristicTools?: string[]
      learnedTools?: string[]
      traceId?: string
      toolTrace?: Array<{
        tool: string
        success: boolean
        durationMs: number
        trustLevel: string
        sourceKind?: string
      }>
    }
  }
  error?: string
}

export default function TestingKnowledgePage() {
  const { toast } = useToast()
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!query.trim()) {
      toast({ title: "Error", description: "Pertanyaan wajib diisi", variant: "destructive" })
      return
    }

    setLoading(true)
    try {
      const response = await fetch("/api/testing-knowledge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          query,
        }),
      })

      const data = (await response.json()) as TestResult
      if (!response.ok) {
        throw new Error(data?.error || "Gagal memproses pertanyaan")
      }

      setResult(data)
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal memproses pertanyaan",
        variant: "destructive",
      })
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Uji Pengetahuan</h1>
        <p className="text-muted-foreground mt-2">
          Uji pipeline AI knowledge/RAG yang sama dengan WhatsApp dan Webchat, tanpa memasukkan chat ke inbox.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">✨ Form Uji AI</CardTitle>
          <CardDescription>
            Masukkan pertanyaan knowledge untuk menguji RAG, rewrite, dan orchestrator. Workflow laporan, layanan, cek status, pembatalan, dan riwayat tidak dijalankan dari halaman ini.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="query">Pertanyaan *</Label>
              <Textarea
                id="query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Contoh: Jam operasional kantor kelurahan?"
                rows={4}
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full md:w-auto">
              {loading ? (
                <>Memproses...</>
              ) : (
                <>Uji AI</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hasil Uji AI</CardTitle>
          <CardDescription>
            Hasil akan muncul setelah pertanyaan diproses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="text-muted-foreground">Memuat...</div>
            </div>
          ) : !result?.data ? (
            <div className="text-center text-muted-foreground py-8">
              Belum ada hasil.
            </div>
          ) : (
            <Card className="border">
              <CardContent className="pt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-primary text-primary-foreground">AI Response</Badge>
                  <Badge className="border border-border bg-background text-foreground">
                    Intent: {result.data.intent}
                  </Badge>
                  {result.data.metadata?.hasKnowledge && (
                    <Badge className="border border-border bg-background text-foreground">
                      Knowledge: Ya
                    </Badge>
                  )}
                  {result.data.metadata?.sideEffectMode && (
                    <Badge className="border border-border bg-background text-foreground">
                      Mode: {result.data.metadata.sideEffectMode}
                    </Badge>
                  )}
                  {result.data.metadata?.traceId && (
                    <Badge className="border border-border bg-background text-foreground">
                      Trace: {result.data.metadata.traceId}
                    </Badge>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Jawaban</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">
                    {result.data.response}
                  </p>
                </div>
                {result.data.guidanceText && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Tindak Lanjut</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-line">
                      {result.data.guidanceText}
                    </p>
                  </div>
                )}
                {result.data.metadata && (
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>Waktu Proses: {result.data.metadata.processingTimeMs} ms</div>
                    <div>Model: {result.data.metadata.model || "-"}</div>
                    <div>Agent Mode: {result.data.metadata.agentMode || "-"}</div>
                    <div>Confidence: {result.data.metadata.knowledgeConfidence || "-"}</div>
                    <div>Sentimen: {result.data.metadata.sentiment || "-"}</div>
                    <div>Bahasa: {result.data.metadata.language || "-"}</div>
                  </div>
                )}
                {result.data.metadata && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Tools Dipakai</p>
                      <pre className="text-xs bg-muted/60 rounded-md p-3 overflow-auto">
                        {JSON.stringify(result.data.metadata.toolsUsed || [], null, 2)}
                      </pre>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Tools Diizinkan</p>
                      <pre className="text-xs bg-muted/60 rounded-md p-3 overflow-auto">
                        {JSON.stringify(result.data.metadata.allowedTools || [], null, 2)}
                      </pre>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Tools Heuristik</p>
                      <pre className="text-xs bg-muted/60 rounded-md p-3 overflow-auto">
                        {JSON.stringify(result.data.metadata.heuristicTools || [], null, 2)}
                      </pre>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">Tools Learned Policy</p>
                      <pre className="text-xs bg-muted/60 rounded-md p-3 overflow-auto">
                        {JSON.stringify(result.data.metadata.learnedTools || [], null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
                {result.data.metadata?.toolTrace && result.data.metadata.toolTrace.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Tool Trace</p>
                    <pre className="text-xs bg-muted/60 rounded-md p-3 overflow-auto">
                      {JSON.stringify(result.data.metadata.toolTrace, null, 2)}
                    </pre>
                  </div>
                )}
                {result.data.fields && Object.keys(result.data.fields).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Ekstraksi</p>
                    <pre className="text-xs bg-muted/60 rounded-md p-3 overflow-auto">
                      {JSON.stringify(result.data.fields, null, 2)}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
