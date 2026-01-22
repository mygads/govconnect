"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  FileText,
  Calendar,
  BarChart3,
  Printer,
  RefreshCw,
  CheckCircle,
  Clock,
  XCircle,
  FileWarning,
} from "lucide-react"
import { laporan, statistics } from "@/lib/frontend-api"
import { format, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import {
  exportToExcel,
  exportToPDF,
  generateReport,
  exportReportToPDF,
} from "@/lib/export-utils"
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
  updated_at?: string
}

interface Stats {
  total: number
  baru: number
  proses: number
  selesai: number
  ditolak: number
}

type DateRange = "today" | "week" | "month" | "quarter" | "year" | "custom"

export default function ExportLaporanPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [filteredComplaints, setFilteredComplaints] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)

  // Filter states
  const [dateRange, setDateRange] = useState<DateRange>("month")
  const [customStartDate, setCustomStartDate] = useState("")
  const [customEndDate, setCustomEndDate] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")

  // Stats
  const [stats, setStats] = useState<Stats>({
    total: 0,
    baru: 0,
    proses: 0,
    selesai: 0,
    ditolak: 0,
  })

  // Categories
  const [categories, setCategories] = useState<string[]>([])

  useEffect(() => {
    fetchComplaints()
  }, [])

  useEffect(() => {
    applyFilters()
  }, [complaints, dateRange, customStartDate, customEndDate, statusFilter, categoryFilter])

  const fetchComplaints = async () => {
    try {
      setLoading(true)
      const data = await laporan.getAll()
      const complaintsData = data.data || []
      setComplaints(complaintsData)

      // Extract unique categories
      const uniqueCategories = [...new Set(complaintsData.map((c: Complaint) => c.kategori))] as string[]
      setCategories(uniqueCategories)

      setError(null)
    } catch (err: any) {
      setError(err.message || "Failed to load complaints")
    } finally {
      setLoading(false)
    }
  }

  const getDateRangeFilter = (): { start: Date; end: Date } => {
    const now = new Date()
    
    switch (dateRange) {
      case "today":
        const todayStart = new Date(now)
        todayStart.setHours(0, 0, 0, 0)
        const todayEnd = new Date(now)
        todayEnd.setHours(23, 59, 59, 999)
        return { start: todayStart, end: todayEnd }
      
      case "week":
        return {
          start: startOfWeek(now, { weekStartsOn: 1 }),
          end: endOfWeek(now, { weekStartsOn: 1 }),
        }
      
      case "month":
        return {
          start: startOfMonth(now),
          end: endOfMonth(now),
        }
      
      case "quarter":
        const quarterStart = new Date(now)
        quarterStart.setMonth(Math.floor(now.getMonth() / 3) * 3, 1)
        quarterStart.setHours(0, 0, 0, 0)
        const quarterEnd = new Date(quarterStart)
        quarterEnd.setMonth(quarterEnd.getMonth() + 3, 0)
        quarterEnd.setHours(23, 59, 59, 999)
        return { start: quarterStart, end: quarterEnd }
      
      case "year":
        return {
          start: new Date(now.getFullYear(), 0, 1),
          end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
        }
      
      case "custom":
        return {
          start: customStartDate ? new Date(customStartDate) : subDays(now, 30),
          end: customEndDate ? new Date(customEndDate + "T23:59:59") : now,
        }
      
      default:
        return { start: subDays(now, 30), end: now }
    }
  }

  const applyFilters = () => {
    let filtered = [...complaints]

    // Date filter
    const { start, end } = getDateRangeFilter()
    filtered = filtered.filter((c) => {
      const createdAt = new Date(c.created_at)
      return createdAt >= start && createdAt <= end
    })

    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((c) => c.status === statusFilter)
    }

    // Category filter
    if (categoryFilter !== "all") {
      filtered = filtered.filter((c) => c.kategori === categoryFilter)
    }

    // Sort by date (newest first)
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    setFilteredComplaints(filtered)

    // Calculate stats
    setStats({
      total: filtered.length,
      baru: filtered.filter((c) => c.status === "baru").length,
      proses: filtered.filter((c) => c.status === "proses").length,
      selesai: filtered.filter((c) => c.status === "selesai").length,
      ditolak: filtered.filter((c) => c.status === "ditolak").length,
    })
  }

  const handleExportExcel = async () => {
    setExporting(true)
    setExportSuccess(null)
    try {
      const { start, end } = getDateRangeFilter()
      const filename = exportToExcel(filteredComplaints, {
        title: "Laporan Pengaduan Masyarakat",
        dateRange: { start, end },
      })
      setExportSuccess(`File ${filename} berhasil diunduh!`)
    } catch (err) {
      console.error("Export error:", err)
    } finally {
      setExporting(false)
    }
  }

  const handleExportPDF = async () => {
    setExporting(true)
    setExportSuccess(null)
    try {
      const { start, end } = getDateRangeFilter()
      const filename = exportToPDF(filteredComplaints, {
        title: "Laporan Pengaduan Masyarakat",
        dateRange: { start, end },
      })
      setExportSuccess(`File ${filename} berhasil diunduh!`)
    } catch (err) {
      console.error("Export error:", err)
    } finally {
      setExporting(false)
    }
  }

  const handleGenerateWeeklyReport = () => {
    setExporting(true)
    setExportSuccess(null)
    try {
      const report = generateReport(complaints, "weekly")
      const filename = exportReportToPDF(report)
      setExportSuccess(`Laporan Mingguan ${filename} berhasil diunduh!`)
    } catch (err) {
      console.error("Report error:", err)
    } finally {
      setExporting(false)
    }
  }

  const handleGenerateMonthlyReport = () => {
    setExporting(true)
    setExportSuccess(null)
    try {
      const report = generateReport(complaints, "monthly")
      const filename = exportReportToPDF(report)
      setExportSuccess(`Laporan Bulanan ${filename} berhasil diunduh!`)
    } catch (err) {
      console.error("Report error:", err)
    } finally {
      setExporting(false)
    }
  }

  const getDateRangeLabel = () => {
    const { start, end } = getDateRangeFilter()
    return `${format(start, "d MMM yyyy", { locale: idLocale })} - ${format(end, "d MMM yyyy", { locale: idLocale })}`
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Error Loading Data
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={fetchComplaints} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Export & Laporan</h1>
          <p className="text-muted-foreground mt-2">
            Export data dan generate laporan otomatis
          </p>
        </div>
        <Button onClick={fetchComplaints} variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh Data
        </Button>
      </div>

      {/* Success Message */}
      {exportSuccess && (
        <Card className="border-green-500 bg-green-50 dark:bg-green-950">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <span className="text-green-700 dark:text-green-300">{exportSuccess}</span>
          </CardContent>
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Laporan</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">{getDateRangeLabel()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Baru</CardTitle>
            <FileWarning className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.baru}</div>
            <p className="text-xs text-muted-foreground">Menunggu tindakan</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Proses</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.proses}</div>
            <p className="text-xs text-muted-foreground">Sedang ditangani</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Selesai</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.selesai}</div>
            <p className="text-xs text-muted-foreground">Terselesaikan</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ditolak</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.ditolak}</div>
            <p className="text-xs text-muted-foreground">Tidak valid</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="export" className="space-y-4">
        <TabsList>
          <TabsTrigger value="export">
            <Download className="h-4 w-4 mr-2" />
            Export Data
          </TabsTrigger>
          <TabsTrigger value="reports">
            <FileText className="h-4 w-4 mr-2" />
            Laporan Otomatis
          </TabsTrigger>
        </TabsList>

        {/* Export Tab */}
        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Filter Data</CardTitle>
              <CardDescription>
                Pilih periode dan filter data yang ingin di-export
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <Label>Periode</Label>
                  <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Hari Ini</SelectItem>
                      <SelectItem value="week">Minggu Ini</SelectItem>
                      <SelectItem value="month">Bulan Ini</SelectItem>
                      <SelectItem value="quarter">Kuartal Ini</SelectItem>
                      <SelectItem value="year">Tahun Ini</SelectItem>
                      <SelectItem value="custom">Kustom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {dateRange === "custom" && (
                  <>
                    <div className="space-y-2">
                      <Label>Dari Tanggal</Label>
                      <Input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sampai Tanggal</Label>
                      <Input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                      />
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Status</SelectItem>
                      <SelectItem value="baru">Baru</SelectItem>
                      <SelectItem value="proses">Proses</SelectItem>
                      <SelectItem value="selesai">Selesai</SelectItem>
                      <SelectItem value="ditolak">Ditolak</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Kategori</Label>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Kategori</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Export Buttons */}
          <Card>
            <CardHeader>
              <CardTitle>Export Data</CardTitle>
              <CardDescription>
                Download {filteredComplaints.length} data laporan dalam format pilihan
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <Button
                  onClick={handleExportExcel}
                  disabled={exporting || filteredComplaints.length === 0}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {exporting ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                  )}
                  Export ke Excel
                </Button>
                <Button
                  onClick={handleExportPDF}
                  disabled={exporting || filteredComplaints.length === 0}
                  variant="destructive"
                >
                  {exporting ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  Export ke PDF
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Preview Table */}
          <Card>
            <CardHeader>
              <CardTitle>Preview Data ({filteredComplaints.length} laporan)</CardTitle>
              <CardDescription>
                Data yang akan di-export berdasarkan filter yang dipilih
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredComplaints.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Tidak ada data untuk periode dan filter yang dipilih
                </div>
              ) : (
                <div className="rounded-md border max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>No</TableHead>
                        <TableHead>ID Laporan</TableHead>
                        <TableHead>Kategori</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Tanggal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredComplaints.slice(0, 20).map((complaint, index) => (
                        <TableRow key={complaint.id}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell className="font-mono">{complaint.complaint_id}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {complaint.kategori.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(complaint.status)}>
                              {formatStatus(complaint.status)}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDate(complaint.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {filteredComplaints.length > 20 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Menampilkan 20 dari {filteredComplaints.length} data. Semua data akan di-export.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Weekly Report */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Laporan Mingguan
                </CardTitle>
                <CardDescription>
                  Generate laporan ringkasan untuk minggu ini
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium">Periode:</p>
                  <p className="text-lg">
                    {format(startOfWeek(new Date(), { weekStartsOn: 1 }), "d MMM", { locale: idLocale })} -{" "}
                    {format(endOfWeek(new Date(), { weekStartsOn: 1 }), "d MMM yyyy", { locale: idLocale })}
                  </p>
                </div>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>✓ Ringkasan statistik laporan</li>
                  <li>✓ Breakdown per kategori</li>
                  <li>✓ Daftar lengkap laporan</li>
                  <li>✓ Tingkat penyelesaian</li>
                </ul>
                <Button
                  onClick={handleGenerateWeeklyReport}
                  disabled={exporting}
                  className="w-full"
                >
                  {exporting ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Generate Laporan Mingguan
                </Button>
              </CardContent>
            </Card>

            {/* Monthly Report */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Laporan Bulanan
                </CardTitle>
                <CardDescription>
                  Generate laporan ringkasan untuk bulan ini
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium">Periode:</p>
                  <p className="text-lg">
                    {format(new Date(), "MMMM yyyy", { locale: idLocale })}
                  </p>
                </div>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>✓ Ringkasan statistik laporan</li>
                  <li>✓ Breakdown per kategori</li>
                  <li>✓ Daftar lengkap laporan</li>
                  <li>✓ Tingkat penyelesaian</li>
                </ul>
                <Button
                  onClick={handleGenerateMonthlyReport}
                  disabled={exporting}
                  className="w-full"
                >
                  {exporting ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Generate Laporan Bulanan
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Info Card */}
          <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200">
            <CardContent className="flex items-start gap-4 pt-6">
              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <BarChart3 className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-blue-900 dark:text-blue-100">
                  Laporan Otomatis
                </h3>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  Laporan yang dihasilkan mencakup statistik lengkap, breakdown per kategori,
                  dan daftar semua laporan dalam periode tersebut. File PDF siap untuk
                  di-print atau dibagikan.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
