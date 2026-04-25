"use client"

import { useCallback, useEffect, useState } from "react"
import { redirect } from "next/navigation"
import { Loader2, Plus, Ticket, Wallet } from "lucide-react"

import { useAuth } from "@/components/auth/AuthContext"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

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

function formatUsd(value?: number | null) {
  return `$${(value ?? 0).toFixed(2)}`
}

export default function SuperadminAIWalletsPage() {
  const { user } = useAuth()
  const [wallets, setWallets] = useState<WalletRow[]>([])
  const [vouchers, setVouchers] = useState<VoucherRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [topupVillageId, setTopupVillageId] = useState("")
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

      const [walletsRes, vouchersRes] = await Promise.all([
        fetch("/api/superadmin/ai-wallets", { headers }),
        fetch("/api/superadmin/vouchers", { headers }),
      ])

      const walletsPayload = await walletsRes.json()
      const vouchersPayload = await vouchersRes.json()

      if (!walletsRes.ok) {
        throw new Error(walletsPayload?.error || "Gagal memuat AI wallets")
      }
      if (!vouchersRes.ok) {
        throw new Error(vouchersPayload?.error || "Gagal memuat AI vouchers")
      }

      setWallets(Array.isArray(walletsPayload?.data) ? walletsPayload.data : [])
      setVouchers(Array.isArray(vouchersPayload?.data) ? vouchersPayload.data : [])
    } catch (err: any) {
      setError(err?.message || "Gagal memuat AI wallets")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleTopup = async () => {
    if (!topupVillageId.trim() || !topupAmount.trim()) {
      setError("Village ID dan amount wajib diisi")
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

      setMessage("Topup saldo berhasil disimpan.")
      setTopupAmount("")
      setTopupVillageId("")
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
            <CardDescription>Masukkan village ID dan nominal USD untuk menambah saldo desa.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="village-id">Village ID</Label>
              <Input id="village-id" value={topupVillageId} onChange={(e) => setTopupVillageId(e.target.value)} placeholder="UUID desa" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="topup-amount">Amount (USD)</Label>
              <Input id="topup-amount" type="number" min="0" step="0.01" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} placeholder="50" />
            </div>
            <Button onClick={handleTopup} disabled={submitting}>
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
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Village ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Saldo</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wallets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">Belum ada wallet desa.</TableCell>
                </TableRow>
              ) : wallets.map((wallet) => (
                <TableRow key={wallet.id}>
                  <TableCell className="font-mono text-xs">{wallet.village_id}</TableCell>
                  <TableCell>{wallet.status}</TableCell>
                  <TableCell>{formatUsd(wallet.balance_usd)}</TableCell>
                  <TableCell>{new Date(wallet.updated_at).toLocaleString("id-ID")}</TableCell>
                </TableRow>
              ))}
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
