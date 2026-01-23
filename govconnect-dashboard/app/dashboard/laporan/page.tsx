"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, Eye, Search, ImageIcon } from "lucide-react"
import { laporan } from "@/lib/frontend-api"
import { formatDate, formatStatus, getStatusColor } from "@/lib/utils"

interface Complaint {
  id: string
  complaint_id: string
  wa_user_id: string
  kategori: string
  deskripsi: string
  alamat?: string
  status: string
  foto_url?: string
  created_at: string
}

export default function LaporanListPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  useEffect(() => {
    fetchComplaints()
  }, [])

  const fetchComplaints = async () => {
    try {
      setLoading(true)
      const data = await laporan.getAll()
      setComplaints(data.data || [])
      setError(null)
    } catch (err: any) {
      setError(err.message || "Gagal memuat pengaduan")
    } finally {
      setLoading(false)
    }
  }

  const filteredComplaints = complaints.filter((complaint) => {
    const matchSearch =
      search === "" ||
      complaint.complaint_id.toLowerCase().includes(search.toLowerCase()) ||
      complaint.wa_user_id.includes(search) ||
      complaint.kategori.toLowerCase().includes(search.toLowerCase())

    const matchStatus = statusFilter === "all" || complaint.status === statusFilter

    return matchSearch && matchStatus
  })

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Card className="w-full max-w-md border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Gagal Memuat Data
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={fetchComplaints} variant="outline">
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Pengaduan Warga</h1>
          <p className="text-muted-foreground mt-2">
            Kelola semua laporan masuk dari warga
          </p>
        </div>
        <Button onClick={fetchComplaints} variant="outline">
          Muat Ulang
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter & Pencarian</CardTitle>
          <div className="flex gap-4 mt-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari nomor pengaduan, WA, atau kategori..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("all")}
              >
                Semua
              </Button>
              <Button
                variant={statusFilter === "baru" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("baru")}
              >
                Baru
              </Button>
              <Button
                variant={statusFilter === "proses" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("proses")}
              >
                Proses
              </Button>
              <Button
                variant={statusFilter === "selesai" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("selesai")}
              >
                Selesai
              </Button>
              <Button
                variant={statusFilter === "ditolak" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("ditolak")}
              >
                Ditolak
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredComplaints.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Belum ada pengaduan masuk</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. Pengaduan</TableHead>
                    <TableHead>WhatsApp</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Deskripsi</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredComplaints.map((complaint) => (
                    <TableRow key={complaint.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {complaint.foto_url && (
                            <span title="Laporan dengan foto">
                              <ImageIcon className="h-4 w-4 text-blue-500" />
                            </span>
                          )}
                          {complaint.complaint_id}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {complaint.wa_user_id}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {complaint.kategori.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {complaint.deskripsi}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(complaint.status)}>
                          {formatStatus(complaint.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(complaint.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/dashboard/laporan/${complaint.id}`}>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4 mr-1" />
                            Detail
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="mt-4 text-sm text-muted-foreground">
            Menampilkan {filteredComplaints.length} dari {complaints.length} pengaduan
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
