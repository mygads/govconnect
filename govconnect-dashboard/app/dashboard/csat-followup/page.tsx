"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Star, RefreshCw, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export default function CsatFollowupPage() {
  const { toast } = useToast()
  const [state, setState] = useState<{ status: "loading" } | { status: "blocked"; message: string; backend_needed: string }>({ status: "loading" })

  const load = async () => {
    setState({ status: "loading" })
    try {
      const res = await fetch("/api/csat-followups")
      const data = await res.json()
      if (res.status === 501) {
        setState({ status: "blocked", message: data?.message ?? "Backend belum tersedia.", backend_needed: data?.backend_needed ?? "" })
      } else if (!res.ok) {
        throw new Error(data?.error ?? "gagal memuat")
      }
    } catch (err: any) {
      toast({ title: "Gagal memuat", description: String(err?.message ?? err), variant: "destructive" })
      setState({ status: "blocked", message: String(err?.message ?? err), backend_needed: "" })
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Star className="h-6 w-6" /> Tindak Lanjut CSAT
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Warga yang memberi rating ≤ 2 otomatis dibuatkan tiket follow-up (SLA &lt; 24 jam) —
            daftarnya seharusnya tampil di sini (R12).
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={load} title="Muat ulang">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tiket follow-up rating rendah</CardTitle>
          <CardDescription>reason = csat_low_rating, dari pipeline_fallback_tickets.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.status === "loading" ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Backend belum menyediakan data</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{state.message}</p>
                {state.backend_needed && (
                  <p className="font-mono text-xs bg-muted rounded p-2">{state.backend_needed}</p>
                )}
                <p className="text-xs">
                  UI halaman ini sudah siap — daftar tiket akan otomatis tampil setelah tim backend
                  menambahkan endpoint di atas. Sementara itu, tiket follow-up tetap tercatat di
                  database dan masuk hitungan laporan bulanan.
                </p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
