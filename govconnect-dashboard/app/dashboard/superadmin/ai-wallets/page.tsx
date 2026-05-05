"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, Minus, Plus, Search, Ticket, Wallet } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

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
  redeemed_by_village_id?: string | null
  redeemed_by_admin_id?: string | null
  redeemed_at?: string | null
  created_by_admin_id?: string | null
  created_at: string
  redeem_ledger_entry?: {
    id: string
    village_id: string
    amount_usd: number
    balance_before_usd: number
    balance_after_usd: number
    created_at: string
    created_by_admin_id?: string | null
  } | null
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

type ConfirmAction = {
  title: string
  description: string
  actionLabel: string
  onConfirm: () => Promise<void> | void
}

function formatDateTime(value?: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
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
    const router = useRouter()
  const { toast } = useToast()
  const [wallets, setWallets] = useState<WalletRow[]>([])
  const [vouchers, setVouchers] = useState<VoucherRow[]>([])
  const [villages, setVillages] = useState<VillageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [topupOpen, setTopupOpen] = useState(false)
  const [voucherOpen, setVoucherOpen] = useState(false)
  const [topupVillageId, setTopupVillageId] = useState("")
  const [topupVillageSearch, setTopupVillageSearch] = useState("")
  const [topupVillageOpen, setTopupVillageOpen] = useState(false)
  const [walletSearch, setWalletSearch] = useState("")
  const [topupAmount, setTopupAmount] = useState("")
  const [topupReason, setTopupReason] = useState("")
  const [reduceOpen, setReduceOpen] = useState(false)
  const [reduceWallet, setReduceWallet] = useState<WalletRow | null>(null)
  const [reduceAmount, setReduceAmount] = useState("")
  const [reduceReason, setReduceReason] = useState("")
  const [voucherCode, setVoucherCode] = useState("")
  const [voucherAmount, setVoucherAmount] = useState("")
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction | null>(null)

  useEffect(() => {
    if (user && user.role !== "superadmin") router.replace("/dashboard")
  }, [user, router])

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
  const reduceVillage = reduceWallet ? villageMap.get(reduceWallet.village_id) : undefined
  const topupAmountNumber = Number(topupAmount)
  const reduceAmountNumber = Number(reduceAmount)
  const voucherAmountNumber = Number(voucherAmount)
  const isTopupDirty = !!topupVillageId || topupAmount.trim() !== "" || topupReason.trim() !== ""
  const isReduceDirty = !!reduceWallet || reduceAmount.trim() !== "" || reduceReason.trim() !== ""
  const isVoucherDirty = voucherCode.trim() !== "" || voucherAmount.trim() !== ""
  const isTopupAmountValid = Number.isFinite(topupAmountNumber) && topupAmountNumber > 0
  const isReduceAmountValid = Number.isFinite(reduceAmountNumber) && reduceAmountNumber > 0
  const isVoucherAmountValid = Number.isFinite(voucherAmountNumber) && voucherAmountNumber > 0

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

  const resetTopupForm = () => {
    setTopupAmount("")
    setTopupReason("")
    setTopupVillageId("")
    setTopupVillageSearch("")
    setTopupVillageOpen(false)
  }

  const resetReduceForm = () => {
    setReduceWallet(null)
    setReduceAmount("")
    setReduceReason("")
  }

  const resetVoucherForm = () => {
    setVoucherCode("")
    setVoucherAmount("")
  }

  const requestTopup = () => {
    if (!topupVillageId.trim()) {
      toast({ title: "Gagal", description: "Desa wajib dipilih", variant: "destructive" })
      return
    }
    if (!isTopupAmountValid) {
      toast({ title: "Gagal", description: "Amount harus lebih dari 0", variant: "destructive" })
      return
    }
    if (!isTopupDirty) return

    setPendingConfirm({
      title: "Simpan topup manual?",
      description: `Saldo ${villageLabel(selectedVillage)} akan ditambah ${formatUsd(topupAmountNumber)}.${topupReason.trim() ? ` Keterangan: ${topupReason.trim()}` : ""}`,
      actionLabel: "Simpan Topup",
      onConfirm: handleTopup,
    })
  }

  const requestReduce = () => {
    if (!reduceWallet) {
      toast({ title: "Gagal", description: "Wallet desa wajib dipilih", variant: "destructive" })
      return
    }
    if (!isReduceAmountValid) {
      toast({ title: "Gagal", description: "Amount harus lebih dari 0", variant: "destructive" })
      return
    }
    if (reduceAmountNumber > reduceWallet.balance_usd) {
      toast({ title: "Gagal", description: "Pengurangan tidak boleh melebihi saldo saat ini", variant: "destructive" })
      return
    }
    if (!isReduceDirty) return

    setPendingConfirm({
      title: "Kurangi saldo AI?",
      description: `Saldo ${villageLabel(reduceVillage)} akan dikurangi ${formatUsd(reduceAmountNumber)}.${reduceReason.trim() ? ` Keterangan: ${reduceReason.trim()}` : ""}`,
      actionLabel: "Kurangi Saldo",
      onConfirm: handleReduce,
    })
  }

  const requestCreateVoucher = () => {
    if (!voucherCode.trim()) {
      toast({ title: "Gagal", description: "Kode voucher wajib diisi", variant: "destructive" })
      return
    }
    if (!isVoucherAmountValid) {
      toast({ title: "Gagal", description: "Nominal voucher harus lebih dari 0", variant: "destructive" })
      return
    }
    if (!isVoucherDirty) return

    setPendingConfirm({
      title: "Buat voucher topup?",
      description: `Voucher ${voucherCode.trim()} dengan nominal ${formatUsd(voucherAmountNumber)} akan dibuat.`,
      actionLabel: "Buat Voucher",
      onConfirm: handleCreateVoucher,
    })
  }

  const handleTopup = async () => {
    if (!topupVillageId.trim() || !isTopupAmountValid) {
      toast({ title: "Gagal", description: "Desa dan amount valid wajib diisi", variant: "destructive" })
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/superadmin/ai-wallets/${encodeURIComponent(topupVillageId.trim())}/adjust`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amount_usd: topupAmountNumber,
          direction: "credit",
          reason: topupReason.trim() || undefined,
          metadata: topupReason.trim() ? { reason: topupReason.trim() } : undefined,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || "Gagal topup saldo")
      }

      toast({ title: "Berhasil", description: `Topup saldo ${villageLabel(selectedVillage)} berhasil disimpan.` })
      resetTopupForm()
      setTopupOpen(false)
      await loadData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || "Gagal topup saldo", variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const handleReduce = async () => {
    if (!reduceWallet || !isReduceAmountValid) {
      toast({ title: "Gagal", description: "Wallet dan amount valid wajib diisi", variant: "destructive" })
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/superadmin/ai-wallets/${encodeURIComponent(reduceWallet.village_id)}/adjust`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amount_usd: reduceAmountNumber,
          direction: "debit",
          reason: reduceReason.trim() || undefined,
          metadata: reduceReason.trim() ? { reason: reduceReason.trim() } : undefined,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || "Gagal mengurangi saldo")
      }

      toast({ title: "Berhasil", description: `Saldo ${villageLabel(reduceVillage)} berhasil dikurangi.` })
      resetReduceForm()
      setReduceOpen(false)
      await loadData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || "Gagal mengurangi saldo", variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }
  const handleCreateVoucher = async () => {
    if (!voucherCode.trim() || !isVoucherAmountValid) {
      toast({ title: "Gagal", description: "Kode voucher dan nominal valid wajib diisi", variant: "destructive" })
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      const token = localStorage.getItem("token")
      const response = await fetch("/api/superadmin/vouchers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code: voucherCode.trim(), amount_usd: voucherAmountNumber }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || "Gagal membuat voucher")
      }

      toast({ title: "Berhasil", description: "Voucher topup berhasil dibuat." })
      resetVoucherForm()
      setVoucherOpen(false)
      await loadData()
    } catch (err: any) {
      toast({ title: "Gagal", description: err?.message || "Gagal membuat voucher", variant: "destructive" })
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">AI Wallets</h1>
          <p className="mt-2 text-muted-foreground">Kelola saldo desa dan voucher topup dari panel superadmin.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { resetVoucherForm(); setVoucherOpen(true) }}><Ticket className="mr-2 h-4 w-4" />Buat Voucher</Button>
          <Button onClick={() => { resetTopupForm(); setTopupOpen(true) }}><Wallet className="mr-2 h-4 w-4" />Topup Manual</Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Terjadi kesalahan</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Dialog open={topupOpen} onOpenChange={(open) => { setTopupOpen(open); if (!open) resetTopupForm() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> Topup Manual</DialogTitle>
            <DialogDescription>Cari dan pilih desa, lalu masukkan nominal USD untuk menambah saldo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
            <div className="space-y-2">
              <Label htmlFor="topup-reason">Status/Keterangan</Label>
              <Input id="topup-reason" value={topupReason} onChange={(e) => setTopupReason(e.target.value)} placeholder="Contoh: kompensasi error sistem" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTopupOpen(false)} disabled={submitting}>Batal</Button>
            <Button onClick={requestTopup} disabled={submitting || !isTopupDirty}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Simpan Topup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reduceOpen} onOpenChange={(open) => { setReduceOpen(open); if (!open) resetReduceForm() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Minus className="h-5 w-5" /> Kurangi Saldo AI</DialogTitle>
            <DialogDescription>Pengurangan saldo masuk ke transaksi dan bisa dilihat admin desa.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">{reduceWallet ? villageLabel(reduceVillage) : "Wallet belum dipilih"}</div>
              <div className="text-muted-foreground">Saldo saat ini: {formatUsd(reduceWallet?.balance_usd)}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reduce-amount">Amount (USD)</Label>
              <Input id="reduce-amount" type="number" min="0" step="0.01" value={reduceAmount} onChange={(e) => setReduceAmount(e.target.value)} placeholder="10" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reduce-reason">Status/Keterangan</Label>
              <Input id="reduce-reason" value={reduceReason} onChange={(e) => setReduceReason(e.target.value)} placeholder="Contoh: koreksi saldo karena error" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReduceOpen(false)} disabled={submitting}>Batal</Button>
            <Button onClick={requestReduce} disabled={submitting || !isReduceDirty} variant="destructive">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Minus className="mr-2 h-4 w-4" />}
              Kurangi Saldo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voucherOpen} onOpenChange={(open) => { setVoucherOpen(open); if (!open) resetVoucherForm() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Ticket className="h-5 w-5" /> Buat Voucher</DialogTitle>
            <DialogDescription>Voucher ini bisa diredeem oleh admin desa lewat halaman saldo AI.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="voucher-code">Kode Voucher</Label>
              <Input id="voucher-code" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} placeholder="TOPUP-APRIL-50" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voucher-amount">Amount (USD)</Label>
              <Input id="voucher-amount" type="number" min="0" step="0.01" value={voucherAmount} onChange={(e) => setVoucherAmount(e.target.value)} placeholder="25" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVoucherOpen(false)} disabled={submitting}>Batal</Button>
            <Button onClick={requestCreateVoucher} disabled={submitting || !isVoucherDirty}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Buat Voucher
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingConfirm} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingConfirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const action = pendingConfirm
                setPendingConfirm(null)
                await action?.onConfirm()
              }}
            >
              {pendingConfirm?.actionLabel || "Lanjutkan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredWallets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">Belum ada wallet desa.</TableCell>
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
                    <TableCell>{formatDateTime(wallet.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={wallet.balance_usd <= 0}
                        onClick={() => {
                          setReduceWallet(wallet)
                          setReduceOpen(true)
                        }}
                      >
                        <Minus className="mr-1 h-3 w-3" /> Kurangi
                      </Button>
                    </TableCell>
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
                <TableHead>Redeem</TableHead>
                <TableHead>Ledger</TableHead>
                <TableHead>Kedaluwarsa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vouchers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">Belum ada voucher.</TableCell>
                </TableRow>
              ) : vouchers.map((voucher) => (
                <TableRow key={voucher.id}>
                  <TableCell>
                    <div className="font-medium">{voucher.code}</div>
                    <div className="text-xs text-muted-foreground">Dibuat: {formatDateTime(voucher.created_at)}</div>
                  </TableCell>
                  <TableCell>{voucher.status}</TableCell>
                  <TableCell>{formatUsd(voucher.amount_usd)}</TableCell>
                  <TableCell>
                    {voucher.redeemed_at ? (
                      <div className="text-xs">
                        <div>{formatDateTime(voucher.redeemed_at)}</div>
                        <div className="text-muted-foreground">{villageLabel(villageMap.get(voucher.redeemed_by_village_id || ""))}</div>
                        <div className="font-mono text-muted-foreground">{voucher.redeemed_by_admin_id || "-"}</div>
                      </div>
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    {voucher.redeem_ledger_entry ? (
                      <div className="text-xs">
                        <div className="font-mono">{voucher.redeem_ledger_entry.id}</div>
                        <div className="text-muted-foreground">{formatUsd(voucher.redeem_ledger_entry.balance_before_usd)} → {formatUsd(voucher.redeem_ledger_entry.balance_after_usd)}</div>
                      </div>
                    ) : "-"}
                  </TableCell>
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
