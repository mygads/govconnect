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

interface TestHistoryItem {
  role: "user" | "assistant"
  content: string
}

export default function TestingKnowledgePage() {
  const { toast } = useToast()
  const [query, setQuery] = useState("")
  const [history, setHistory] = useState<TestHistoryItem[]>([])
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
          conversationHistory: [...history, { role: "user", content: query.trim() }],
        }),
      })

      const data = (await response.json()) as TestResult
      if (!response.ok) {
        throw new Error(data?.error || "Gagal memproses pertanyaan")
      }

      setResult(data)
      const resultData = data.data
      const assistantTurn = [resultData?.response, resultData?.guidanceText].filter(Boolean).join("\n\n")
      if (assistantTurn) {
        setHistory((items) => {
          const next: TestHistoryItem[] = [
            ...items,
            { role: "user", content: query.trim() },
            { role: "assistant", content: assistantTurn },
          ]
          return next.slice(-30)
        })
      }
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
          Uji jawaban AI untuk pertanyaan warga tanpa membuat chat masuk ke inbox.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">✨ Form Uji AI</CardTitle>
          <CardDescription>
            Tulis pertanyaan seperti warga. Halaman ini hanya mengecek jawaban AI; tidak membuat laporan, layanan, pembatalan, atau riwayat.
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
                  <Badge className="bg-primary text-primary-foreground">Jawaban AI</Badge>
                  <Badge className="border border-border bg-background text-foreground">
                    Kategori: {result.data.intent}
                  </Badge>
                  {result.data.metadata?.hasKnowledge && (
                    <Badge className="border border-border bg-background text-foreground">
                      Knowledge: Ya
                    </Badge>
                  )}
                  {result.data.metadata?.sideEffectMode && (
                    <Badge className="border border-border bg-background text-foreground">
                      Mode uji aman
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
                    <div>Waktu jawab: {result.data.metadata.processingTimeMs} ms</div>
                    <div>Sumber jawaban: {result.data.metadata.hasKnowledge ? "Knowledge base" : "AI umum"}</div>
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
