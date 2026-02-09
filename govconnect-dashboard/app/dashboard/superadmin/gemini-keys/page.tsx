"use client"

import { useEffect, useState, useCallback } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import {
  RefreshCcw,
  Plus,
  Trash2,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Zap,
  Activity,
  Loader2,
} from "lucide-react"

// ==================== Types ====================

interface GeminiKey {
  id: number
  name: string
  api_key: string // masked
  gmail_account: string
  tier: string
  is_active: boolean
  is_valid: boolean
  invalid_reason: string | null
  last_error: string | null
  consecutive_failures: number
  priority: number
  last_used_at: string | null
  last_validated_at: string | null
  created_at: string
  updated_at: string
  tier_label: string
  tier_limits: Record<string, { rpm: number; tpm: number; rpd: number }>
  period_usage: Array<{ model: string; request_count: number; input_tokens: number; total_tokens: number }>
  today_usage: Array<{ model: string; rpd_used: number; tokens_used: number }>
  total_period_requests: number
  total_period_tokens: number
}

interface TierLimits {
  [tier: string]: {
    label: string
    models: Record<string, { rpm: number; tpm: number; rpd: number }>
  }
}

// ==================== Helpers ====================

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

function getCapacityColor(used: number, limit: number): string {
  if (limit === 0) return 'bg-gray-200'
  const pct = (used / limit) * 100
  if (pct >= 80) return 'bg-red-500'
  if (pct >= 50) return 'bg-yellow-500'
  return 'bg-green-500'
}

function getCapacityPct(used: number, limit: number): number {
  if (limit === 0) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

// ==================== Component ====================

export default function GeminiKeysPage() {
  const { user } = useAuth()
  const { toast } = useToast()

  // State
  const [loading, setLoading] = useState(true)
  const [keys, setKeys] = useState<GeminiKey[]>([])
  const [tierLimits, setTierLimits] = useState<TierLimits>({})
  const [envKeyConfigured, setEnvKeyConfigured] = useState(false)
  const [period, setPeriod] = useState<string>("day")

  // Add key form
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addForm, setAddForm] = useState({ name: "", api_key: "", gmail_account: "", tier: "free" })
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<GeminiKey | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Detail view
  const [detailKey, setDetailKey] = useState<GeminiKey | null>(null)

  // Auth guard
  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  // Fetch keys
  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/superadmin/gemini-keys?period=${period}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (!response.ok) throw new Error("Failed to fetch keys")
      const data = await response.json()
      setKeys(data.keys || [])
      setTierLimits(data.tier_limits || {})
      setEnvKeyConfigured(data.env_key_configured || false)
    } catch (error) {
      console.error("Fetch keys error:", error)
      toast({ title: "Error", description: "Gagal memuat data API keys.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [period, toast])

  useEffect(() => {
    if (user?.role === "superadmin") fetchKeys()
  }, [user, fetchKeys])

  // Validate key
  const handleValidate = async () => {
    if (!addForm.api_key) return
    setValidating(true)
    setValidationResult(null)
    try {
      const res = await fetch("/api/superadmin/gemini-keys/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ api_key: addForm.api_key }),
      })
      const data = await res.json()
      setValidationResult({ valid: data.valid, message: data.message })
    } catch {
      setValidationResult({ valid: false, message: "Gagal memvalidasi" })
    } finally {
      setValidating(false)
    }
  }

  // Add key
  const handleAddKey = async () => {
    if (!addForm.name || !addForm.api_key || !addForm.gmail_account) {
      toast({ title: "Error", description: "Semua field wajib diisi.", variant: "destructive" })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/superadmin/gemini-keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(addForm),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Gagal", description: data.error || "Gagal menambahkan key.", variant: "destructive" })
        return
      }
      toast({ title: "Berhasil", description: data.message })
      setShowAddDialog(false)
      setAddForm({ name: "", api_key: "", gmail_account: "", tier: "free" })
      setValidationResult(null)
      fetchKeys()
    } catch {
      toast({ title: "Error", description: "Gagal menambahkan key.", variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  // Toggle active
  const handleToggleActive = async (key: GeminiKey) => {
    try {
      const res = await fetch(`/api/superadmin/gemini-keys/${key.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ is_active: !key.is_active }),
      })
      if (!res.ok) throw new Error("Failed")
      toast({
        title: "Berhasil",
        description: `Key "${key.name}" ${!key.is_active ? "diaktifkan" : "dinonaktifkan"}.`,
      })
      fetchKeys()
    } catch {
      toast({ title: "Error", description: "Gagal mengubah status key.", variant: "destructive" })
    }
  }

  // Reactivate invalid key
  const handleReactivate = async (key: GeminiKey) => {
    try {
      const res = await fetch(`/api/superadmin/gemini-keys/${key.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ is_valid: true }),
      })
      if (!res.ok) throw new Error("Failed")
      toast({
        title: "Berhasil",
        description: `Key "${key.name}" berhasil direaktivasi. Failure counter direset.`,
      })
      fetchKeys()
    } catch {
      toast({ title: "Error", description: "Gagal mereaktivasi key.", variant: "destructive" })
    }
  }

  // Delete key
  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/superadmin/gemini-keys/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: "Berhasil", description: data.message })
      setDeleteTarget(null)
      fetchKeys()
    } catch {
      toast({ title: "Error", description: "Gagal menghapus key.", variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  if (user?.role !== "superadmin") return null

  // Summary stats
  const totalKeys = keys.length
  const activeKeys = keys.filter(k => k.is_active && k.is_valid).length
  const invalidKeys = keys.filter(k => !k.is_valid).length
  const totalRequests = keys.reduce((s, k) => s + k.total_period_requests, 0)
  const totalTokens = keys.reduce((s, k) => s + k.total_period_tokens, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Gemini BYOK Keys</h1>
          <p className="text-muted-foreground mt-2">
            Kelola API key Gemini dari berbagai akun Google. Key BYOK diprioritaskan, .env sebagai fallback.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchKeys} variant="outline" disabled={loading}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Tambah Key
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Tambah Gemini API Key</DialogTitle>
                <DialogDescription>
                  Tambahkan API key Gemini dari akun Google yang berbeda. Key akan divalidasi terlebih dahulu.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="keyName">Nama Key</Label>
                  <Input
                    id="keyName"
                    placeholder="e.g. Akun Pribadi, Akun Kantor"
                    value={addForm.name}
                    onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gmailAccount">Gmail / Google Account</Label>
                  <Input
                    id="gmailAccount"
                    placeholder="user@gmail.com"
                    type="email"
                    value={addForm.gmail_account}
                    onChange={(e) => setAddForm({ ...addForm, gmail_account: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="apiKey"
                      placeholder="AIzaSy..."
                      value={addForm.api_key}
                      onChange={(e) => {
                        setAddForm({ ...addForm, api_key: e.target.value })
                        setValidationResult(null)
                      }}
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleValidate}
                      disabled={validating || !addForm.api_key}
                    >
                      {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validasi"}
                    </Button>
                  </div>
                  {validationResult && (
                    <div className={`flex items-center gap-2 text-sm ${validationResult.valid ? "text-green-600" : "text-red-600"}`}>
                      {validationResult.valid ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                      {validationResult.message}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tier">Tier Akun</Label>
                  <Select value={addForm.tier} onValueChange={(v) => setAddForm({ ...addForm, tier: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free (Tanpa billing)</SelectItem>
                      <SelectItem value="tier1">Tier 1 (Billing aktif)</SelectItem>
                      <SelectItem value="tier2">Tier 2 (&gt;$250 spend)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Free: limit rendah tapi gratis. Tier 1: billing aktif, limit lebih tinggi. Tier 2: sudah spend &gt;$250, limit tertinggi.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                  Batal
                </Button>
                <Button onClick={handleAddKey} disabled={submitting}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Tambahkan
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Keys</CardDescription>
            <CardTitle className="text-2xl">{totalKeys}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {activeKeys} aktif, {totalKeys - activeKeys} nonaktif
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Keys Aktif & Valid</CardDescription>
            <CardTitle className="text-2xl text-green-600">{activeKeys}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Siap digunakan</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Keys Invalid</CardDescription>
            <CardTitle className="text-2xl text-red-600">{invalidKeys}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Perlu dicek / diganti</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Request</CardDescription>
            <CardTitle className="text-2xl">{formatNumber(totalRequests)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Periode: {period === "day" ? "Hari ini" : period === "week" ? "7 hari" : "30 hari"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Token</CardDescription>
            <CardTitle className="text-2xl">{formatNumber(totalTokens)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              .env fallback: {envKeyConfigured ? (
                <span className="text-green-600">Aktif</span>
              ) : (
                <span className="text-red-600">Tidak ada</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Period Filter */}
      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">Filter periode:</Label>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Hari ini</SelectItem>
            <SelectItem value="week">7 hari terakhir</SelectItem>
            <SelectItem value="month">30 hari terakhir</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Keys Table */}
      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys">Daftar Keys</TabsTrigger>
          <TabsTrigger value="limits">Rate Limits per Tier</TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>API Keys</CardTitle>
              <CardDescription>
                Urutan prioritas: key BYOK free terlebih dahulu, lalu tier1, tier2. Jika semua habis, fallback ke .env.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : keys.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <KeyRound className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p className="text-lg font-medium">Belum ada BYOK key</p>
                  <p className="text-sm mt-1">Klik &quot;Tambah Key&quot; untuk menambahkan API key Gemini.</p>
                  {envKeyConfigured && (
                    <p className="text-sm mt-2 text-yellow-600">
                      Saat ini menggunakan .env key sebagai satu-satunya key.
                    </p>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead>Gmail</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Request</TableHead>
                      <TableHead>Token</TableHead>
                      <TableHead>Kapasitas Hari Ini</TableHead>
                      <TableHead>Terakhir Digunakan</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((key, index) => {
                      // Calculate worst capacity across models for today
                      const todayCapacities = key.today_usage.map(u => {
                        const limits = key.tier_limits[u.model]
                        if (!limits) return 0
                        return getCapacityPct(u.rpd_used, limits.rpd)
                      })
                      const worstCapacity = todayCapacities.length > 0 ? Math.max(...todayCapacities) : 0

                      return (
                        <TableRow key={key.id} className={!key.is_active ? "opacity-50" : ""}>
                          <TableCell className="font-mono text-muted-foreground">{key.priority + 1}</TableCell>
                          <TableCell>
                            <div className="font-medium">{key.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{key.api_key}</div>
                          </TableCell>
                          <TableCell className="text-sm">{key.gmail_account}</TableCell>
                          <TableCell>
                            <Badge variant={key.tier === "free" ? "secondary" : key.tier === "tier1" ? "default" : "outline"}>
                              {key.tier_label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge className={key.is_active ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"}>
                                {key.is_active ? "Aktif" : "Nonaktif"}
                              </Badge>
                              {!key.is_valid && (
                                <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                                  Invalid
                                </Badge>
                              )}
                              {key.consecutive_failures > 0 && key.is_valid && (
                                <span className="text-xs text-yellow-600">{key.consecutive_failures} fail</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{formatNumber(key.total_period_requests)}</TableCell>
                          <TableCell className="font-mono text-sm">{formatNumber(key.total_period_tokens)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${getCapacityColor(worstCapacity, 100)}`}
                                  style={{ width: `${worstCapacity}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">{worstCapacity}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {key.last_used_at ? new Date(key.last_used_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDetailKey(key)}
                                title="Detail"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {!key.is_valid && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-green-600 hover:text-green-700"
                                  onClick={() => handleReactivate(key)}
                                  title="Reaktivasi key (reset status invalid)"
                                >
                                  <ShieldCheck className="h-4 w-4" />
                                </Button>
                              )}
                              <Switch
                                checked={key.is_active}
                                onCheckedChange={() => handleToggleActive(key)}
                                title={key.is_active ? "Nonaktifkan" : "Aktifkan"}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700"
                                onClick={() => setDeleteTarget(key)}
                                title="Hapus"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limits" className="mt-4">
          <div className="grid gap-4 md:grid-cols-3">
            {Object.entries(tierLimits).map(([tier, config]) => (
              <Card key={tier}>
                <CardHeader>
                  <CardTitle className="text-lg">{config.label}</CardTitle>
                  <CardDescription>
                    {tier === "free" ? "Tanpa billing, limit rendah" : tier === "tier1" ? "Billing aktif, limit menengah" : "Spend >$250, limit tertinggi"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Model</TableHead>
                        <TableHead className="text-xs text-right">RPM</TableHead>
                        <TableHead className="text-xs text-right">TPM</TableHead>
                        <TableHead className="text-xs text-right">RPD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(config.models).map(([model, limits]: [string, any]) => (
                        <TableRow key={model}>
                          <TableCell className="text-xs font-mono">{model.replace("gemini-", "")}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{formatNumber(limits.rpm)}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{formatNumber(limits.tpm)}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{formatNumber(limits.rpd)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!detailKey} onOpenChange={(open) => { if (!open) setDetailKey(null) }}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          {detailKey && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5" />
                  {detailKey.name}
                </DialogTitle>
                <DialogDescription>{detailKey.gmail_account} — {detailKey.tier_label}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {/* Key Info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">API Key:</span>
                    <span className="ml-2 font-mono">{detailKey.api_key}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Priority:</span>
                    <span className="ml-2 font-mono">#{detailKey.priority + 1}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <span className="ml-2">
                      {detailKey.is_active ? (
                        <Badge className="bg-green-100 text-green-800">Aktif</Badge>
                      ) : (
                        <Badge variant="secondary">Nonaktif</Badge>
                      )}
                      {" "}
                      {detailKey.is_valid ? (
                        <Badge className="bg-blue-100 text-blue-800">Valid</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">Invalid</Badge>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Consecutive Failures:</span>
                    <span className="ml-2 font-mono">{detailKey.consecutive_failures}</span>
                  </div>
                  {detailKey.invalid_reason && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Alasan Invalid:</span>
                      <span className="ml-2 text-red-600">{detailKey.invalid_reason}</span>
                    </div>
                  )}
                  {detailKey.last_error && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Error Terakhir:</span>
                      <span className="ml-2 text-yellow-600 text-xs">{detailKey.last_error}</span>
                    </div>
                  )}
                  {!detailKey.is_valid && (
                    <div className="col-span-2">
                      <Button
                        size="sm"
                        onClick={() => { handleReactivate(detailKey); setDetailKey(null); }}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Reaktivasi Key
                      </Button>
                      <span className="ml-2 text-xs text-muted-foreground">
                        Reset status invalid dan failure counter
                      </span>
                    </div>
                  )}
                </div>

                {/* Usage per Model (Today) */}
                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Penggunaan Hari Ini vs Limit
                  </h4>
                  {detailKey.today_usage.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Belum ada penggunaan hari ini.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Model</TableHead>
                          <TableHead className="text-xs text-right">RPD Used</TableHead>
                          <TableHead className="text-xs text-right">RPD Limit</TableHead>
                          <TableHead className="text-xs text-right">RPM Limit</TableHead>
                          <TableHead className="text-xs text-right">TPM Limit</TableHead>
                          <TableHead className="text-xs text-right">Token Used</TableHead>
                          <TableHead className="text-xs text-right">Sisa RPD</TableHead>
                          <TableHead className="text-xs">Kapasitas RPD</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailKey.today_usage.map(u => {
                          const limits = detailKey.tier_limits[u.model]
                          const rpdLimit = limits?.rpd || 0
                          const rpmLimit = limits?.rpm || 0
                          const tpmLimit = limits?.tpm || 0
                          const rpdRemaining = Math.max(0, rpdLimit - u.rpd_used)
                          const pct = getCapacityPct(u.rpd_used, rpdLimit)
                          return (
                            <TableRow key={u.model}>
                              <TableCell className="text-xs font-mono">{u.model.replace("gemini-", "")}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{u.rpd_used}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{rpdLimit >= 999_999 ? "∞" : formatNumber(rpdLimit)}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{formatNumber(rpmLimit)}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{formatNumber(tpmLimit)}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{formatNumber(u.tokens_used)}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{rpdLimit >= 999_999 ? "∞" : formatNumber(rpdRemaining)}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${getCapacityColor(u.rpd_used, rpdLimit)}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="text-xs">{pct}%</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* Period Usage */}
                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Penggunaan Periode ({period === "day" ? "Hari ini" : period === "week" ? "7 hari" : "30 hari"})
                  </h4>
                  {detailKey.period_usage.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Belum ada penggunaan.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Model</TableHead>
                          <TableHead className="text-xs text-right">Requests</TableHead>
                          <TableHead className="text-xs text-right">Input Tokens</TableHead>
                          <TableHead className="text-xs text-right">Total Tokens</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailKey.period_usage.map(u => (
                          <TableRow key={u.model}>
                            <TableCell className="text-xs font-mono">{u.model.replace("gemini-", "")}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatNumber(u.request_count)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatNumber(u.input_tokens)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatNumber(u.total_tokens)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {/* Timestamps */}
                <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground border-t pt-4">
                  <div>Dibuat: {new Date(detailKey.created_at).toLocaleString("id-ID")}</div>
                  <div>Diupdate: {new Date(detailKey.updated_at).toLocaleString("id-ID")}</div>
                  <div>Terakhir digunakan: {detailKey.last_used_at ? new Date(detailKey.last_used_at).toLocaleString("id-ID") : "-"}</div>
                  <div>Terakhir divalidasi: {detailKey.last_validated_at ? new Date(detailKey.last_validated_at).toLocaleString("id-ID") : "-"}</div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Hapus API Key
            </DialogTitle>
            <DialogDescription>
              Anda yakin ingin menghapus key &quot;{deleteTarget?.name}&quot; ({deleteTarget?.gmail_account})?
              Semua data penggunaan key ini juga akan dihapus. Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fallback Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Cara Kerja BYOK
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p><strong>Prioritas:</strong> Key BYOK (free dulu, lalu tier1/tier2) → .env fallback jika semua habis</p>
          <p><strong>Auto-switch:</strong> Saat kapasitas key mencapai 80%, otomatis pindah ke key/model berikutnya</p>
          <p><strong>Model fallback (free):</strong> 2.0-flash-lite → 2.5-flash-lite → 2.0-flash → 2.5-flash → 3-flash-preview</p>
          <p><strong>Model fallback (tier1/2):</strong> 2.0-flash-lite → 2.5-flash-lite → 2.0-flash → 2.5-flash → 3-flash-preview</p>
          <p><strong>Retry:</strong> 2x retry per model, lalu pindah ke model berikutnya</p>
          <p><strong>429 rate limit:</strong> Jika model terkena rate limit, langsung skip ke model lain (tidak menambah failure counter)</p>
          <p><strong>Auto-invalid:</strong> Key otomatis ditandai invalid setelah 10 kegagalan non-rate-limit berturut-turut</p>
          <p><strong>Reaktivasi:</strong> Key invalid bisa direaktivasi manual via tombol hijau (🛡️) di tabel</p>
          <p><strong>Rate limit reset:</strong> RPM reset tiap menit, RPD reset tiap hari (UTC midnight)</p>
        </CardContent>
      </Card>
    </div>
  )
}
