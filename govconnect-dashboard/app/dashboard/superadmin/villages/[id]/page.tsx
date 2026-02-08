"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/components/auth/AuthContext"
import { formatDate, formatStatus, getStatusColor } from "@/lib/utils"
import {
  ArrowLeft, FileText, Settings2, Brain, BarChart3,
  Users, MapPin, AlertCircle, BookOpen, Globe, MessageSquare
} from "lucide-react"

interface VillageDetail {
  village: {
    id: string
    name: string
    slug: string
    is_active: boolean
    created_at: string
    profile: { short_name?: string; address?: string; google_maps_url?: string } | null
    admins: Array<{ id: string; name: string; username: string; role: string; is_active: boolean }>
  }
  complaints: Array<{
    id: string; complaint_id: string; kategori: string; deskripsi: string;
    status: string; channel?: string; reporter_name?: string; created_at: string
  }>
  serviceRequests: Array<{
    id: string; request_number: string; service_name: string; status: string;
    requester_name?: string; created_at: string
  }>
  knowledgeItems: Array<{
    id: string; title: string; category: string; is_embedded: boolean;
    priority: number; updated_at: string
  }>
  documents: Array<{
    id: string; filename: string; status: string; chunk_count: number; created_at: string
  }>
  statistics: {
    complaints?: { total: number; open: number; process: number; done: number; reject: number; canceled: number }
    serviceRequests?: { total: number; open: number; process: number; done: number }
  } | null
}

export default function SuperadminVillageDetailPage() {
  const { user } = useAuth()
  const params = useParams()
  const router = useRouter()
  const [data, setData] = useState<VillageDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
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
    if (params.id) fetchData()
  }, [params.id])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Card className="w-full max-w-md border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" /> Gagal Memuat Data
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.back()} variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Kembali
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { village, complaints, serviceRequests, knowledgeItems, documents, statistics } = data
  const stats = statistics?.complaints || { total: 0, open: 0, process: 0, done: 0, reject: 0, canceled: 0 }
  const srStats = statistics?.serviceRequests || { total: 0, open: 0, process: 0, done: 0 }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/superadmin/villages")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Kembali
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{village.name}</h1>
            <Badge variant={village.is_active ? "default" : "secondary"}>
              {village.is_active ? "Aktif" : "Nonaktif"}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            {village.profile?.address || village.slug} · {village.admins.length} admin terdaftar
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Pengaduan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.total}</div>
            <div className="flex gap-2 mt-2 text-xs">
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700">Baru: {stats.open}</Badge>
              <Badge variant="outline" className="bg-blue-50 text-blue-700">Proses: {stats.process}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Selesai / Ditolak</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{stats.done}</div>
            <div className="flex gap-2 mt-2 text-xs">
              <Badge variant="outline" className="bg-red-50 text-red-700">Ditolak: {stats.reject}</Badge>
              <Badge variant="outline" className="bg-gray-50 text-gray-700">Batal: {stats.canceled}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Permohonan Layanan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{srStats.total}</div>
            <div className="flex gap-2 mt-2 text-xs">
              <Badge variant="outline" className="bg-yellow-50 text-yellow-700">Baru: {srStats.open}</Badge>
              <Badge variant="outline" className="bg-green-50 text-green-700">Selesai: {srStats.done}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Knowledge Base</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{knowledgeItems.length}</div>
            <div className="flex gap-2 mt-2 text-xs">
              <Badge variant="outline" className="bg-green-50 text-green-700">
                Embedded: {knowledgeItems.filter(k => k.is_embedded).length}
              </Badge>
              <Badge variant="outline" className="bg-purple-50 text-purple-700">
                Dokumen: {documents.length}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Admin List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Admin Desa</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {village.admins.map(admin => (
              <div key={admin.id} className="flex items-center gap-2 rounded-lg border p-3">
                <div>
                  <p className="font-medium text-sm">{admin.name}</p>
                  <p className="text-xs text-muted-foreground">@{admin.username}</p>
                </div>
                <Badge variant={admin.is_active ? "default" : "secondary"} className="text-xs">
                  {admin.is_active ? "Aktif" : "Nonaktif"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="complaints">
        <TabsList>
          <TabsTrigger value="complaints" className="gap-2">
            <FileText className="h-4 w-4" /> Pengaduan ({complaints.length})
          </TabsTrigger>
          <TabsTrigger value="services" className="gap-2">
            <Settings2 className="h-4 w-4" /> Layanan ({serviceRequests.length})
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-2">
            <Brain className="h-4 w-4" /> Knowledge ({knowledgeItems.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="complaints" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {complaints.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Belum ada pengaduan</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Pengaduan</TableHead>
                      <TableHead>Pelapor</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tanggal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {complaints.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-sm">{c.complaint_id}</TableCell>
                        <TableCell>{c.reporter_name || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            c.channel === "WHATSAPP"
                              ? "bg-green-50 text-green-700 border-green-200"
                              : "bg-blue-50 text-blue-700 border-blue-200"
                          }>
                            {c.channel === "WHATSAPP" ? "WA" : "Web"}
                          </Badge>
                        </TableCell>
                        <TableCell><Badge variant="outline">{c.kategori?.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="max-w-xs truncate">{c.deskripsi}</TableCell>
                        <TableCell><Badge className={getStatusColor(c.status)}>{formatStatus(c.status)}</Badge></TableCell>
                        <TableCell className="text-sm">{formatDate(c.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {serviceRequests.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Belum ada permohonan layanan</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Permohonan</TableHead>
                      <TableHead>Layanan</TableHead>
                      <TableHead>Pemohon</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tanggal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serviceRequests.map(sr => (
                      <TableRow key={sr.id}>
                        <TableCell className="font-mono text-sm">{sr.request_number}</TableCell>
                        <TableCell>{sr.service_name}</TableCell>
                        <TableCell>{sr.requester_name || "-"}</TableCell>
                        <TableCell><Badge className={getStatusColor(sr.status)}>{formatStatus(sr.status)}</Badge></TableCell>
                        <TableCell className="text-sm">{formatDate(sr.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="knowledge" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {knowledgeItems.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Belum ada knowledge base</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Judul</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Prioritas</TableHead>
                      <TableHead>Embedded</TableHead>
                      <TableHead>Diperbarui</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {knowledgeItems.map(k => (
                      <TableRow key={k.id}>
                        <TableCell className="font-medium">{k.title}</TableCell>
                        <TableCell><Badge variant="outline">{k.category}</Badge></TableCell>
                        <TableCell>{k.priority}</TableCell>
                        <TableCell>
                          <Badge variant={k.is_embedded ? "default" : "secondary"}>
                            {k.is_embedded ? "✓ Ya" : "✗ Belum"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(k.updated_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {documents.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <BookOpen className="h-4 w-4" /> Dokumen ({documents.length})
                  </h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama File</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Chunks</TableHead>
                        <TableHead>Tanggal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map(d => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-sm">{d.filename}</TableCell>
                          <TableCell>
                            <Badge variant={d.status === "completed" ? "default" : "secondary"}>
                              {d.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{d.chunk_count}</TableCell>
                          <TableCell className="text-sm">{formatDate(d.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
