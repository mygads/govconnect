"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { redirect } from "next/navigation"
import { CheckCircle2, Loader2, Plus, Search, Ticket, Wallet } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface WalletRow {
  id: string
  village_id: string
  balance_usd: number
  status: string
  updated_at: string
}

interface VoucherRow {
  id: string
  code: string
  amount_usd: number
  status: string
  expires_at?: string | null
  redeemed_at?: string | null
}

interface VillageRow {
  id: string
  name: string
  slug: string
  is_active: boolean
  profile?: {
    short_name?: string | null
    address?: string | null
  } | null
}

function formatUsd(value?: number | null) {
  return `$${(value ?? 0).toFixed(2)}`
}

function villageLabel(village?: VillageRow) {
  if (!village) return "Desa tidak ditemukan"
  return village.profile?.short_name || village.name || village.slug || village.id
}

export default function SuperadminAIWalletsPage() {
  const { user } = useAuth()
  const [wallets, setWallets] = useState<WalletRow[]>([])
  const [vouchers, setVouchers] = useState<VoucherRow[]>([])
  const [villages, setVillages] = useState<VillageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [topupVillageId, setTopupVillageId] = useState("")
  const [topupVillageSearch, setTopupVillageSearch] = useState("")
  const [topupVillageOpen, setTopupVillageOpen] = useState(false)
  const [walletSearch, setWalletSearch] = useState("")
  const [topupAmount, setTopupAmount] = useState("")
  const [voucherCode, setVoucherCode] = useState("")
  const [voucherAmount, setVoucherAmount] = useState("")

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

      const [walletsRes, vouchersRes, villagesRes] = await Promise.all([
        fetch("/api/superadmin/ai-wallets", { headers }),
        fetch("/api/superadmin/vouchers", { headers }),
        fetch("/api/superadmin/villages", { headers }),
      ])

      const walletsPayload = await walletsRes.json()
      const vouchersPayload = await vouchersRes.json()
      const villagesPayload = await villagesRes.json()

      if (!walletsRes.ok) {
        throw new Error(walletsPayload?.error || "Gagal memuat AI wallets")
      }
      if (!vouchersRes.ok) {
        throw new Error(vouchersPayload?.error || "Gagal memuat AI vouchers")
      }
      if (!villagesRes.ok) {
        throw new Error(villagesPayload?.error || "Gagal memuat daftar desa")
      }

      setWallets(Array.isArray(walletsPayload?.data) ? walletsPayload.data : [])
      setVouchers(Array.isArray(vouchersPayload?.data) ? vouchersPayload.data : [])
      setVillages(Array.isArray(villagesPayload?.data) ? villagesPayload.data : [])
    } catch (err: any) {
      setError(err?.message || "Gagal memuat AI wallets")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const villageMap = useMemo(() => {
    return new Map(villages.map((village) => [village.id, village]))
  }, [villages])

  const selectedVillage = topupVillageId ? villageMap.get(topupVillageId) : undefined

  const filteredVillages = useMemo(() => {
    const q = topupVillageSearch.trim().toLowerCase()
    const rows = q
      ? villages.filter((village) => [village.name, village.slug, village.profile?.short_name, village.id].some((value) => value?.toLowerCase().includes(q)))
      : villages
    return rows
  }, [topupVillageSearch, villages])

  const filteredWallets = useMemo(() => {
    const q = walletSearch.trim().toLowerCase()
    if (!q) return wallets
    return wallets.filter((wallet) => {
      const village = villageMap.get(wallet.village_id)
      return [wallet.village_id, wallet.status, village?.name, village?.slug, village?.profile?.short_name]
        .some((value) => value?.toLowerCase().includes(q))
    })
  }, [walletSearch, wallets, villageMap])

  const handleTopup = async () => {
    if (!topupVillageId.trim() || !topupAmount.trim()) {
      setError("Desa dan amount wajib diisi")
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setMessage(null)
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/superadmin/ai-wallets/${encodeURIComponent(topupVillageId.trim())}/topup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ amount_usd: Number(topupAmount), entry_type: "manual_adjustment" }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || "Gagal topup saldo")
      }

      setMessage(`Topup saldo ${villageLabel(selectedVillage)} berhasil disimpan.`)
      setTopupAmount("")
      setTopupVillageId("")
      setTopupVillageSearch("")
      setTopupVillageOpen(false)
      await loadData()
    } catch (err: any) {
      setError(err?.message || "Gagal topup saldo")
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateVoucher = async () => {
    if (!voucherCode.trim() || !voucherAmount.trim()) {
      setError("Kode voucher dan nominal wajib diisi")
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setMessage(null)
      const token = localStorage.getItem("token")
      const response = await fetch("/api/superadmin/vouchers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code: voucherCode.trim(), amount_usd: Number(voucherAmount) }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || "Gagal membuat voucher")
      }

      setMessage("Voucher topup berhasil dibuat.")
      setVoucherCode("")
      setVoucherAmount("")
      await loadData()
    } catch (err: any) {
      setError(err?.message || "Gagal membuat voucher")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat AI wallets...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">AI Wallets</h1>
        <p className="mt-2 text-muted-foreground">Kelola saldo desa dan voucher topup dari panel superadmin.</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Terjadi kesalahan</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <AlertTitle>Berhasil</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> Topup Manual</CardTitle>
            <CardDescription>Cari dan pilih desa, lalu masukkan nominal USD untuk menambah saldo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Pilih Desa</Label>
              <Popover open={topupVillageOpen} onOpenChange={setTopupVillageOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal">
                    {selectedVillage ? (
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{villageLabel(selectedVillage)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{selectedVillage.slug} · {selectedVillage.id}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Pilih desa</span>
                    )}
                    <Search className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <div className="border-b p-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input value={topupVillageSearch} onChange={(e) => setTopupVillageSearch(e.target.value)} className="pl-9" placeholder="Cari nama desa, slug, atau ID" autoFocus />
                    </div>
                  </div>
                  <div className="max-h-60 overflow-auto">
                    {filteredVillages.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">Tidak ada desa yang cocok.</div>
                    ) : filteredVillages.map((village) => (
                      <button
                        key={village.id}
                        type="button"
                        onClick={() => {
                          setTopupVillageId(village.id)
                          setTopupVillageSearch("")
                          setTopupVillageOpen(false)
                        }}
                        className={`flex w-full items-start justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted ${topupVillageId === village.id ? "bg-primary/10" : ""}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{villageLabel(village)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{village.slug} · {village.id}</span>
                        </span>
                        {topupVillageId === village.id && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label htmlFor="topup-amount">Amount (USD)</Label>
              <Input id="topup-amount" type="number" min="0" step="0.01" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} placeholder="50" />
            </div>
            <Button onClick={handleTopup} disabled={submitting || !topupVillageId}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Simpan Topup
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Ticket className="h-5 w-5" /> Buat Voucher</CardTitle>
            <CardDescription>Voucher ini bisa diredeem oleh admin desa lewat halaman saldo AI.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="voucher-code">Kode Voucher</Label>
              <Input id="voucher-code" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} placeholder="TOPUP-APRIL-50" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voucher-amount">Amount (USD)</Label>
              <Input id="voucher-amount" type="number" min="0" step="0.01" value={voucherAmount} onChange={(e) => setVoucherAmount(e.target.value)} placeholder="25" />
            </div>
            <Button onClick={handleCreateVoucher} disabled={submitting}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Buat Voucher
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Saldo per Desa</CardTitle>
          <CardDescription>Snapshot saldo AI terbaru dari semua desa yang sudah punya wallet.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={walletSearch} onChange={(e) => setWalletSearch(e.target.value)} className="pl-9" placeholder="Cari desa, slug, village ID, atau status" />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Desa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Saldo</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredWallets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">Belum ada wallet desa.</TableCell>
                </TableRow>
              ) : filteredWallets.map((wallet) => {
                const village = villageMap.get(wallet.village_id)
                return (
                  <TableRow key={wallet.id}>
                    <TableCell>
                      <div className="font-medium">{village ? villageLabel(village) : wallet.village_id}</div>
                      <div className="font-mono text-xs text-muted-foreground">{village?.slug ? `${village.slug} · ` : ""}{wallet.village_id}</div>
                    </TableCell>
                    <TableCell>{wallet.status}</TableCell>
                    <TableCell>{formatUsd(wallet.balance_usd)}</TableCell>
                    <TableCell>{new Date(wallet.updated_at).toLocaleString("id-ID")}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voucher Topup</CardTitle>
          <CardDescription>Daftar voucher aktif dan riwayat redeem terbaru.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Nominal</TableHead>
                <TableHead>Kedaluwarsa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">Belum ada voucher.</TableCell>
                </TableRow>
              ) : vouchers.map((voucher) => (
                <TableRow key={voucher.id}>
                  <TableCell className="font-medium">{voucher.code}</TableCell>
                  <TableCell>{voucher.status}</TableCell>
                  <TableCell>{formatUsd(voucher.amount_usd)}</TableCell>
                  <TableCell>{voucher.expires_at ? new Date(voucher.expires_at).toLocaleDateString("id-ID") : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
