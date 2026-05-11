"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { fetchApi } from "@/lib/frontend-api"

interface TestResult {
  success: boolean
  data?: {
    response: string
    guidanceText?: string
    intent: string
    error?: string
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

function getTestErrorMessage(data: TestResult | null) {
  const responseText = data?.data?.response?.trim()

  return responseText || data?.data?.error || data?.error || "Gagal memproses pertanyaan"
}

export default function TestingKnowledgePage() {
  const { toast } = useToast()
  const [query, setQuery] = useState("")
  const [history, setHistory] = useState<TestHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const handleResetContext = async () => {
    setResetting(true)
    try {
      await fetchApi('/api/testing-knowledge/reset', {
        method: 'POST',
      })

      setHistory([])
      setResult(null)
      toast({ title: 'Konteks uji direset', description: 'Riwayat lokal dan konteks AI server-side sudah dibersihkan.' })
    } catch (error: any) {
      toast({
        title: 'Reset gagal',
        description: error.message || 'Gagal mereset konteks server-side',
        variant: 'destructive',
      })
    } finally {
      setResetting(false)
    }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!query.trim()) {
      toast({ title: "Error", description: "Pertanyaan wajib diisi", variant: "destructive" })
      return
    }

    setLoading(true)
    try {
      const data = await fetchApi<TestResult>("/api/testing-knowledge", {
        method: "POST",
        body: JSON.stringify({
          query,
          conversationHistory: [...history, { role: "user", content: query.trim() }],
        }),
      })

      if (data?.success === false) {
        throw new Error(getTestErrorMessage(data))
      }

      if (!data?.data) {
        throw new Error("Respons AI tidak lengkap")
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
            Riwayat pada sesi uji ini ikut dikirim sebagai konteks multi-turn sampai di-reset.
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

            <div className="flex flex-col gap-2 md:flex-row">
              <Button type="submit" disabled={loading} className="w-full md:w-auto">
                {loading ? (
                  <>Memproses...</>
                ) : (
                  <>Uji AI</>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={loading || resetting}
                onClick={handleResetContext}
                className="w-full md:w-auto"
              >
                {resetting ? 'Mereset...' : 'Reset Konteks'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Konteks Percakapan Uji</CardTitle>
          <CardDescription>
            {history.length === 0
              ? 'Belum ada konteks tersimpan. Pertanyaan pertama akan diproses sebagai turn awal.'
              : `${history.length} turn tersimpan dan akan ikut dipakai pada uji berikutnya.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-sm text-muted-foreground">Belum ada riwayat percakapan.</div>
          ) : (
            <div className="space-y-3">
              {history.map((item, index) => (
                <div key={`${item.role}-${index}`} className="rounded-lg border p-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    {item.role === 'user' ? 'Warga' : 'AI'}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground">{item.content}</p>
                </div>
              ))}
            </div>
          )}
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
