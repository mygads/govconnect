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
          Uji respons AI langsung tanpa masuk ke riwayat chat.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">✨ Form Uji AI</CardTitle>
          <CardDescription>
            Masukkan pertanyaan untuk mengetes jawaban AI seperti alur WhatsApp/Web.
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
                    <div>Sentimen: {result.data.metadata.sentiment || "-"}</div>
                    <div>Bahasa: {result.data.metadata.language || "-"}</div>
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
