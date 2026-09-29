"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Brain, RefreshCw, Loader2, Eye, Power, PowerOff, Search } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface SkillIndexEntry {
  slug: string
  title: string
  description: string
}

interface SkillDetail {
  slug: string
  title: string
  description: string
  content?: string
  content_md?: string
  version?: number
  isActive?: boolean
  is_active?: boolean
}

export default function SkillsPage() {
  const { toast } = useToast()
  const [skills, setSkills] = useState<SkillIndexEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState<any>(null)

  const [slugQuery, setSlugQuery] = useState("")
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/skills")
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal memuat")
      setSkills(data.skills ?? [])
    } catch (err: any) {
      toast({ title: "Gagal memuat skills", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const build = async () => {
    setBuilding(true)
    setBuilt(null)
    try {
      const res = await fetch("/api/skills/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal membuat draft")
      setBuilt(data.skill)
      toast({ title: "Draft skill dibuat", description: "Tersimpan NONAKTIF — aktifkan eksplisit setelah review." })
      setTitle("")
      setText("")
    } catch (err: any) {
      toast({ title: "Gagal membuat draft", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setBuilding(false)
    }
  }

  const lookup = async (slug: string) => {
    if (!slug.trim()) return
    setDetailLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(slug.trim().toLowerCase())}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "tidak ditemukan")
      setDetail(data.skill)
    } catch (err: any) {
      toast({ title: "Skill tidak ditemukan", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setDetailLoading(false)
    }
  }

  const toggle = async (slug: string, action: "activate" | "deactivate") => {
    setToggling(`${action}:${slug}`)
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/${action}`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "gagal")
      toast({ title: action === "activate" ? "Skill diaktifkan" : "Skill dinonaktifkan", description: slug })
      setDetail((d) => (d && d.slug === slug ? { ...d, isActive: action === "activate", is_active: action === "activate" } : d))
      load()
    } catch (err: any) {
      toast({ title: "Aksi gagal", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setToggling(null)
    }
  }

  const isActive = (d: SkillDetail) => d.isActive ?? d.is_active ?? false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-6 w-6" /> Skills Agen
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Prosedur langkah-demi-langkah untuk agen (R4) — format SKILL.md, disclosure progresif, scope per desa.
          Draft baru selalu <strong>nonaktif</strong> sampai diaktifkan eksplisit.
        </p>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Skill Aktif</TabsTrigger>
          <TabsTrigger value="build">Buat Draft Baru</TabsTrigger>
          <TabsTrigger value="review">Review Draft</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Skill aktif</CardTitle>
                  <CardDescription>Indeks yang dilihat agen (L1 disclosure).</CardDescription>
                </div>
                <Button variant="outline" size="icon" onClick={load} title="Muat ulang">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : skills.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8 text-center">Belum ada skill aktif.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Slug</TableHead>
                      <TableHead>Judul</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skills.map((s) => (
                      <TableRow key={s.slug}>
                        <TableCell className="font-mono text-xs">{s.slug}</TableCell>
                        <TableCell className="font-medium">{s.title}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-80">
                          <div className="truncate" title={s.description}>{s.description}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => lookup(s.slug)}>
                              <Eye className="h-3.5 w-3.5 mr-1" /> Detail
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              disabled={toggling === `deactivate:${s.slug}`}
                              onClick={() => toggle(s.slug, "deactivate")}
                            >
                              <PowerOff className="h-3.5 w-3.5 mr-1" /> Nonaktifkan
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="build" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Buat draft skill</CardTitle>
              <CardDescription>
                Tempel teks prosedural (mis. dari dokumen SOP) — sistem menyusun draft SKILL.md otomatis.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="skill-title">Judul</Label>
                <Input
                  id="skill-title"
                  placeholder="Contoh: Prosedur penerbitan surat domisili"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="skill-text">Teks prosedural</Label>
                <Textarea
                  id="skill-text"
                  rows={8}
                  placeholder={"1. Warga membawa KTP dan KK asli\n2. Mengisi formulir F-1.06 di loket pelayanan\n3. …"}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
              <Button onClick={build} disabled={building || !title.trim() || !text.trim()}>
                {building && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Buat draft (nonaktif)
              </Button>

              {built && (
                <Card className="border-amber-300">
                  <CardHeader>
                    <CardTitle className="text-base">Draft dibuat: <span className="font-mono">{built.slug}</span></CardTitle>
                    <CardDescription>
                      <Badge variant="outline">NONAKTIF</Badge> — review dulu, lalu aktifkan eksplisit.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm font-medium">{built.title}</p>
                    <p className="text-sm text-muted-foreground">{built.description}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => lookup(built.slug)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> Review isi
                      </Button>
                      <Button size="sm" onClick={() => toggle(built.slug, "activate")} disabled={toggling === `activate:${built.slug}`}>
                        <Power className="h-3.5 w-3.5 mr-1" /> Aktifkan sekarang
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Review draft by slug</CardTitle>
              <CardDescription>
                Backend belum menyediakan daftar semua draft nonaktif — cari draft berdasarkan slug-nya
                (slug ditampilkan setelah Anda membuat draft).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="contoh: prosedur-surat-domisili"
                  value={slugQuery}
                  onChange={(e) => setSlugQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && lookup(slugQuery)}
                />
                <Button onClick={() => lookup(slugQuery)} disabled={detailLoading}>
                  <Search className="h-4 w-4 mr-2" /> Cari
                </Button>
              </div>
              {detailLoading && <Skeleton className="h-24 w-full" />}
              {detail && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-mono">{detail.slug}</CardTitle>
                    <CardDescription>
                      {detail.title} — <Badge variant={isActive(detail) ? "default" : "outline"}>{isActive(detail) ? "AKTIF" : "NONAKTIF"}</Badge>
                      {detail.version != null && <span className="ml-2 text-xs">v{detail.version}</span>}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">{detail.description}</p>
                    {(detail.content_md ?? detail.content) && (
                      <pre className="whitespace-pre-wrap text-sm bg-muted rounded-md p-3 max-h-96 overflow-y-auto">
                        {detail.content_md ?? detail.content}
                      </pre>
                    )}
                    <div className="flex gap-2">
                      {isActive(detail) ? (
                        <Button size="sm" variant="ghost" onClick={() => toggle(detail.slug, "deactivate")} disabled={toggling === `deactivate:${detail.slug}`}>
                          <PowerOff className="h-3.5 w-3.5 mr-1" /> Nonaktifkan
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => toggle(detail.slug, "activate")} disabled={toggling === `activate:${detail.slug}`}>
                          <Power className="h-3.5 w-3.5 mr-1" /> Aktifkan
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

    </div>
  )
}
