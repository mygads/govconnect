"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useAuth } from "@/components/auth/AuthContext"
import { formatDate, formatStatus, getStatusColor } from "@/lib/utils"
import { ArrowLeft, FileText, Settings2, Brain, Users, AlertCircle, BookOpen, Loader2, Power, PowerOff, Phone, ListChecks } from "lucide-react"

interface VillageDetail {
  village: {
    id: string
    name: string
    slug: string
    is_active: boolean
    created_at: string
    profile: { short_name?: string; address?: string; gmaps_url?: string; operating_hours?: any } | null
    admins: Array<{ id: string; name: string; username: string; role: string; is_active: boolean }>
  }
  partial_errors?: Array<{ source: string; message: string; status?: number }>
  complaints: Array<{ id: string; complaint_id: string; kategori: string; deskripsi: string; status: string; channel?: string; reporter_name?: string; created_at: string }>
  complaintCategories: Array<{ id: string; name: string; is_active: boolean; types_count: number; urgent_count: number }>
  complaintStatusBreakdown: Array<{ status: string; total: number }>
  serviceRequests: Array<{ id: string; request_number: string; service_name: string; status: string; requester_name?: string; created_at: string }>
  serviceCatalog: Array<{ id: string; name: string; slug: string; mode: string; is_active: boolean; category_name: string; requirements_count: number; estimated_processing_time?: string | null }>
  serviceRequestStatusBreakdown: Array<{ status: string; total: number }>
  importantContactCategories: Array<{ id: string; name: string; contacts: Array<{ id: string; name: string; phone: string; description?: string | null }> }>
  knowledgeItems: Array<{ id: string; title: string; category: string; is_embedded: boolean; priority: number; updated_at: string; last_embedded_at?: string | null; last_edited_at?: string | null; needs_reembed?: boolean }>
  documents: Array<{ id: string; filename: string; original_name?: string; title?: string | null; category?: string | null; status: string; chunk_count: number; total_tokens?: number | null; created_at: string }>
  statistics: {
    complaints?: { total: number; open: number; process: number; done: number; reject: number; canceled: number }
    serviceRequests?: { total: number; open: number; process: number; done: number }
  } | null
}

function statusTotal(rows: Array<{ status: string; total: number }>, status: string) {
  return rows.find((row) => row.status?.toLowerCase() === status.toLowerCase())?.total || 0
}

export default function SuperadminVillageDetailPage() {
  const { user } = useAuth()
  const params = useParams()
  const router = useRouter()
  const [data, setData] = useState<VillageDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  useEffect(() => {
    if (user && user.role !== "superadmin") router.replace("/dashboard")
  }, [user, router])

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/superadmin/villages/${params.id}/detail`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!res.ok) throw new Error("Gagal memuat data desa")
      setData(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (params.id) void fetchData()
  }, [params.id])

  const updateVillageStatus = async (isActive: boolean) => {
    if (!data) return
    if (!isActive && !confirm(`Nonaktifkan ${data.village.name}? Admin desa tidak bisa login sampai desa diaktifkan lagi.`)) return

    try {
      setUpdatingStatus(true)
      const res = await fetch(`/api/superadmin/villages/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ is_active: isActive }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Gagal memperbarui status desa")
      await fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUpdatingStatus(false)
    }
  }

  if (loading) {
    return <div className="space-y-6"><Skeleton className="h-8 w-64" /><div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-96" /></div>
  }

  if (error || !data) {
    return <div className="flex h-[60vh] items-center justify-center"><Card className="w-full max-w-md border-destructive"><CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><AlertCircle className="h-5 w-5" /> Gagal Memuat Data</CardTitle><CardDescription>{error}</CardDescription></CardHeader><CardContent><Button onClick={() => router.back()} variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Kembali</Button></CardContent></Card></div>
  }

  const { village, complaints, serviceRequests, knowledgeItems, documents, statistics, serviceCatalog, importantContactCategories, complaintCategories } = data
  const stats = statistics?.complaints || { total: 0, open: 0, process: 0, done: 0, reject: 0, canceled: 0 }
  const srStats = statistics?.serviceRequests || { total: 0, open: 0, process: 0, done: 0 }
  const contactCount = importantContactCategories.reduce((sum, category) => sum + category.contacts.length, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/superadmin/villages")}><ArrowLeft className="mr-2 h-4 w-4" /> Kembali</Button>
        <div className="flex-1">
          <div className="flex items-center gap-3"><h1 className="text-3xl font-bold">{village.name}</h1><Badge variant={village.is_active ? "default" : "secondary"}>{village.is_active ? "Aktif" : "Nonaktif"}</Badge></div>
          <p className="mt-1 text-muted-foreground">{village.slug} · {village.profile?.short_name || "Tanpa alias"} · {village.admins.length} admin</p>
          <p className="text-sm text-muted-foreground">{village.profile?.address || "Alamat belum diisi"}</p>
        </div>
        <Button variant={village.is_active ? "outline" : "default"} size="sm" disabled={updatingStatus} onClick={() => updateVillageStatus(!village.is_active)}>
          {updatingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : village.is_active ? <PowerOff className="mr-2 h-4 w-4" /> : <Power className="mr-2 h-4 w-4" />}
          {village.is_active ? "Nonaktifkan Desa" : "Aktifkan Desa"}
        </Button>
      </div>

      {Array.isArray(data.partial_errors) && data.partial_errors.length > 0 && <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Sebagian data tidak tersedia</AlertTitle><AlertDescription>{data.partial_errors.map((item) => item.source).join(", ")} sedang bermasalah.</AlertDescription></Alert>}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total Pengaduan</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{stats.total}</div><div className="mt-2 flex flex-wrap gap-2 text-xs"><Badge variant="outline">Baru: {stats.open || statusTotal(data.complaintStatusBreakdown, "OPEN")}</Badge><Badge variant="outline">Proses: {stats.process || statusTotal(data.complaintStatusBreakdown, "PROCESS")}</Badge><Badge variant="outline">Selesai: {stats.done || statusTotal(data.complaintStatusBreakdown, "DONE")}</Badge></div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Permohonan Layanan</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{srStats.total}</div><div className="mt-2 flex flex-wrap gap-2 text-xs"><Badge variant="outline">Baru: {srStats.open || statusTotal(data.serviceRequestStatusBreakdown, "OPEN")}</Badge><Badge variant="outline">Proses: {srStats.process || statusTotal(data.serviceRequestStatusBreakdown, "PROCESS")}</Badge><Badge variant="outline">Selesai: {srStats.done || statusTotal(data.serviceRequestStatusBreakdown, "DONE")}</Badge></div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Master Data</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{serviceCatalog.length}</div><div className="mt-2 flex flex-wrap gap-2 text-xs"><Badge variant="outline">Kategori pengaduan: {complaintCategories.length}</Badge><Badge variant="outline">Kontak: {contactCount}</Badge></div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Knowledge Base</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{knowledgeItems.length}</div><div className="mt-2 flex flex-wrap gap-2 text-xs"><Badge variant="outline">Embedded: {knowledgeItems.filter(k => k.is_embedded).length}</Badge><Badge variant="outline">Dokumen: {documents.length}</Badge></div></CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Admin Desa</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-3">{village.admins.map(admin => <div key={admin.id} className="rounded-lg border p-3"><p className="font-medium text-sm">{admin.name}</p><p className="text-xs text-muted-foreground">@{admin.username}</p><Badge variant={admin.is_active ? "default" : "secondary"} className="mt-2 text-xs">{admin.is_active ? "Aktif" : "Nonaktif"}</Badge></div>)}</div></CardContent></Card>

      <Tabs defaultValue="catalog">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="catalog" className="gap-2"><Settings2 className="h-4 w-4" /> Layanan ({serviceCatalog.length})</TabsTrigger>
          <TabsTrigger value="contacts" className="gap-2"><Phone className="h-4 w-4" /> Nomor Penting ({contactCount})</TabsTrigger>
          <TabsTrigger value="complaint-categories" className="gap-2"><ListChecks className="h-4 w-4" /> Kategori Pengaduan ({complaintCategories.length})</TabsTrigger>
          <TabsTrigger value="complaints" className="gap-2"><FileText className="h-4 w-4" /> Pengaduan ({complaints.length})</TabsTrigger>
          <TabsTrigger value="requests" className="gap-2"><Settings2 className="h-4 w-4" /> Permohonan ({serviceRequests.length})</TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-2"><Brain className="h-4 w-4" /> Knowledge ({knowledgeItems.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4"><Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Layanan</TableHead><TableHead>Kategori</TableHead><TableHead>Slug</TableHead><TableHead>Mode</TableHead><TableHead>Persyaratan</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{serviceCatalog.map(s => <TableRow key={s.id}><TableCell className="font-medium">{s.name}</TableCell><TableCell>{s.category_name}</TableCell><TableCell className="font-mono text-xs">{s.slug}</TableCell><TableCell>{s.mode}</TableCell><TableCell>{s.requirements_count}</TableCell><TableCell><Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Aktif" : "Nonaktif"}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>

        <TabsContent value="contacts" className="mt-4"><Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Kategori</TableHead><TableHead>Nama</TableHead><TableHead>Telepon</TableHead><TableHead>Keterangan</TableHead></TableRow></TableHeader><TableBody>{importantContactCategories.flatMap(cat => cat.contacts.map(contact => <TableRow key={contact.id}><TableCell>{cat.name}</TableCell><TableCell className="font-medium">{contact.name}</TableCell><TableCell>{contact.phone}</TableCell><TableCell>{contact.description || "-"}</TableCell></TableRow>))}</TableBody></Table></CardContent></Card></TabsContent>

        <TabsContent value="complaint-categories" className="mt-4"><Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Kategori</TableHead><TableHead>Jenis</TableHead><TableHead>Urgent</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{complaintCategories.map(c => <TableRow key={c.id}><TableCell className="font-medium">{c.name}</TableCell><TableCell>{c.types_count}</TableCell><TableCell>{c.urgent_count}</TableCell><TableCell><Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Aktif" : "Nonaktif"}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>

        <TabsContent value="complaints" className="mt-4"><Card><CardContent className="pt-6">{complaints.length === 0 ? <p className="py-8 text-center text-muted-foreground">Belum ada pengaduan</p> : <Table><TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Pelapor</TableHead><TableHead>Kategori</TableHead><TableHead>Status</TableHead><TableHead>Tanggal</TableHead></TableRow></TableHeader><TableBody>{complaints.map(c => <TableRow key={c.id}><TableCell className="font-mono text-sm">{c.complaint_id}</TableCell><TableCell>{c.reporter_name || "-"}</TableCell><TableCell>{c.kategori?.replace(/_/g, " ")}</TableCell><TableCell><Badge className={getStatusColor(c.status)}>{formatStatus(c.status)}</Badge></TableCell><TableCell className="text-sm">{formatDate(c.created_at)}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card></TabsContent>

        <TabsContent value="requests" className="mt-4"><Card><CardContent className="pt-6">{serviceRequests.length === 0 ? <p className="py-8 text-center text-muted-foreground">Belum ada permohonan layanan</p> : <Table><TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Layanan</TableHead><TableHead>Pemohon</TableHead><TableHead>Status</TableHead><TableHead>Tanggal</TableHead></TableRow></TableHeader><TableBody>{serviceRequests.map(sr => <TableRow key={sr.id}><TableCell className="font-mono text-sm">{sr.request_number}</TableCell><TableCell>{sr.service_name}</TableCell><TableCell>{sr.requester_name || "-"}</TableCell><TableCell><Badge className={getStatusColor(sr.status)}>{formatStatus(sr.status)}</Badge></TableCell><TableCell className="text-sm">{formatDate(sr.created_at)}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card></TabsContent>

        <TabsContent value="knowledge" className="mt-4"><Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Judul</TableHead><TableHead>Kategori</TableHead><TableHead>Prioritas</TableHead><TableHead>Embedded</TableHead><TableHead>Diperbarui</TableHead></TableRow></TableHeader><TableBody>{knowledgeItems.map(k => <TableRow key={k.id}><TableCell className="font-medium">{k.title}</TableCell><TableCell><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{k.category}</Badge>{k.needs_reembed && <Badge variant="secondary">Perlu re-embed</Badge>}</div></TableCell><TableCell>{k.priority}</TableCell><TableCell><Badge variant={k.is_embedded ? "default" : "secondary"}>{k.is_embedded ? "Ya" : "Belum"}</Badge></TableCell><TableCell className="text-sm">{formatDate(k.updated_at)}</TableCell></TableRow>)}</TableBody></Table>{documents.length > 0 && <div className="mt-6"><h3 className="font-semibold mb-3 flex items-center gap-2"><BookOpen className="h-4 w-4" /> Dokumen ({documents.length})</h3><Table><TableHeader><TableRow><TableHead>Nama File</TableHead><TableHead>Kategori</TableHead><TableHead>Status</TableHead><TableHead>Chunks</TableHead><TableHead>Tanggal</TableHead></TableRow></TableHeader><TableBody>{documents.map(d => <TableRow key={d.id}><TableCell className="font-mono text-sm">{d.original_name || d.filename}</TableCell><TableCell>{d.category || "-"}</TableCell><TableCell><Badge variant={d.status === "completed" ? "default" : "secondary"}>{d.status}</Badge></TableCell><TableCell>{d.chunk_count}</TableCell><TableCell className="text-sm">{formatDate(d.created_at)}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card></TabsContent>
      </Tabs>
    </div>
  )
}
