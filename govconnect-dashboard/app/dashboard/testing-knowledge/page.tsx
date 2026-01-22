"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"

interface KnowledgeCategory {
  id: string
  name: string
}

interface SearchResult {
  id: string
  content: string
  score: number
  source: string
  sourceType: "knowledge" | "document"
  metadata?: {
    category?: string
    keywords?: string[]
    documentId?: string
    sectionTitle?: string
    pageNumber?: number
    qualityScore?: number
  }
}

export default function TestingKnowledgePage() {
  const { toast } = useToast()
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [categoryId, setCategoryId] = useState<string>("all")
  const [query, setQuery] = useState("")
  const [includeKnowledge, setIncludeKnowledge] = useState(true)
  const [includeDocuments, setIncludeDocuments] = useState(true)
  const [topK, setTopK] = useState(5)
  const [minScore, setMinScore] = useState(0.6)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchTimeMs, setSearchTimeMs] = useState<number | null>(null)

  const fetchCategories = async () => {
    try {
      const response = await fetch("/api/knowledge/categories", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      if (response.ok) {
        const data = await response.json()
        setCategories(Array.isArray(data.data) ? data.data : [])
      }
    } catch {
      toast({
        title: "Error",
        description: "Gagal memuat kategori",
        variant: "destructive",
      })
    }
  }

  useEffect(() => {
    fetchCategories()
  }, [])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!query.trim()) {
      toast({ title: "Error", description: "Pertanyaan wajib diisi", variant: "destructive" })
      return
    }

    if (!includeKnowledge && !includeDocuments) {
      toast({ title: "Error", description: "Pilih minimal satu sumber data", variant: "destructive" })
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
          category_id: categoryId !== "all" ? categoryId : undefined,
          include_knowledge: includeKnowledge,
          include_documents: includeDocuments,
          top_k: topK,
          min_score: minScore,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || "Gagal melakukan pencarian")
      }

      setResults(Array.isArray(data.data) ? data.data : [])
      setSearchTimeMs(typeof data.searchTimeMs === "number" ? data.searchTimeMs : null)
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal melakukan pencarian",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const formatScore = (score: number) => `${(score * 100).toFixed(1)}%`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Uji Pengetahuan</h1>
        <p className="text-muted-foreground mt-2">
          Uji relevansi knowledge base dan dokumen sebelum dipakai AI.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">✨ Form Uji Pengetahuan</CardTitle>
          <CardDescription>
            Masukkan pertanyaan untuk melihat hasil pencarian RAG.
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Kategori</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Jumlah Hasil</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-2">
                <Label>Skor Minimum</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-3">
                <Label>Sumber Data</Label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Knowledge Base</p>
                      <p className="text-xs text-muted-foreground">Ambil dari entri pengetahuan</p>
                    </div>
                    <Switch checked={includeKnowledge} onCheckedChange={setIncludeKnowledge} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Dokumen</p>
                      <p className="text-xs text-muted-foreground">Ambil dari dokumen terindeks</p>
                    </div>
                    <Switch checked={includeDocuments} onCheckedChange={setIncludeDocuments} />
                  </div>
                </div>
              </div>
            </div>

            <Button type="submit" disabled={loading} className="w-full md:w-auto">
              {loading ? (
                <>Mencari...</>
              ) : (
                <>Uji Pengetahuan</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hasil Pencarian</CardTitle>
          <CardDescription>
            {searchTimeMs !== null
              ? `Waktu pencarian: ${searchTimeMs} ms`
              : "Hasil akan muncul setelah melakukan pencarian."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="text-muted-foreground">Memuat...</div>
            </div>
          ) : results.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Belum ada hasil.
            </div>
          ) : (
            results.map((result) => (
              <Card key={result.id} className="border">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      className={
                        result.sourceType === "knowledge"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground"
                      }
                    >
                      {result.sourceType === "knowledge" ? "Knowledge" : "Dokumen"}
                    </Badge>
                    <Badge className="border border-border bg-background text-foreground">
                      Skor {formatScore(result.score)}
                    </Badge>
                    {result.metadata?.category && (
                      <Badge className="border border-border bg-background text-foreground">
                        {result.metadata.category}
                      </Badge>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold">{result.source}</p>
                    {result.metadata?.sectionTitle && (
                      <p className="text-xs text-muted-foreground">Bagian: {result.metadata.sectionTitle}</p>
                    )}
                    {typeof result.metadata?.pageNumber === "number" && (
                      <p className="text-xs text-muted-foreground">Halaman: {result.metadata.pageNumber}</p>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">
                    {result.content}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
