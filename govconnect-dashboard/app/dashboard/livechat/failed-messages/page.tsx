"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/components/auth/AuthContext"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { fetchApi, fetchApiRaw } from "@/lib/frontend-api"
import { formatDateTime } from "@/lib/utils"
import { RefreshCw, AlertTriangle, RotateCcw, Inbox } from "lucide-react"

interface FailedMessage {
  message_id: string
  wa_user_id: string | null
  village_id: string | null
  channel: string | null
  attempts: number
  status: string
  lastError: string | null
  firstAttempt: string
  lastAttempt: string
  resolvedAt: string | null
  originalMessage: string | null
}

interface FailedListResponse {
  count: number
  messages: FailedMessage[]
}

interface Stats {
  totalPending: number
  byStatus: Record<string, number>
  byVillage: Array<{ village_id: string; count: number }>
}

interface RetryAllResult {
  status: string
  results: { total: number; success: number; failed: number }
}

export default function FailedMessagesPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [messages, setMessages] = useState<FailedMessage[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [retryingAll, setRetryingAll] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchApi<FailedListResponse>("/api/admin/failed-messages")
      setMessages(list.messages || [])
      const s = await fetchApi<Stats>("/api/admin/failed-messages/stats").catch(() => null)
      setStats(s)
    } catch (err: any) {
      toast({ title: "Gagal memuat pesan gagal", description: err?.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const retryOne = async (messageId: string) => {
    setRetryingId(messageId)
    try {
      const res = await fetchApiRaw(`/api/admin/failed-messages/${encodeURIComponent(messageId)}/retry`, {
        method: "POST",
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.status === "success") {
        toast({ title: "Pesan berhasil diproses ulang" })
      } else {
        toast({ title: "Pesan masih gagal", description: json?.message || json?.error, variant: "destructive" })
      }
    } catch (err: any) {
      toast({ title: "Gagal memproses ulang", description: err?.message, variant: "destructive" })
    } finally {
      setRetryingId(null)
      load()
    }
  }

  const retryAll = async () => {
    setRetryingAll(true)
    try {
      const res = await fetchApiRaw("/api/admin/failed-messages/retry-all", { method: "POST" })
      const json: RetryAllResult | null = await res.json().catch(() => null)
      toast({
        title: "Reproses selesai",
        description: `${json?.results?.success ?? 0} berhasil, ${json?.results?.failed ?? 0} gagal dari ${json?.results?.total ?? 0}`,
      })
    } catch (err: any) {
      toast({ title: "Gagal reproses semua", description: err?.message, variant: "destructive" })
    } finally {
      setRetryingAll(false)
      load()
    }
  }

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            Pesan Gagal / Tertunda
          </h1>
          <p className="text-sm text-muted-foreground">
            Pesan yang gagal diproses AI (timeout/limit/error). Di-cache di DB — tahan maintenance.
            Warga tidak dikirimi balasan palsu; admin bisa reproses.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Muat Ulang
          </Button>
          <Button onClick={retryAll} disabled={retryingAll || messages.length === 0}>
            <RotateCcw className={`h-4 w-4 mr-2 ${retryingAll ? "animate-spin" : ""}`} />
            {retryingAll ? "Memproses..." : "Reproses Semua"}
          </Button>
        </div>
      </div>

      {stats && (
        <Card className="p-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div><span className="text-muted-foreground">Total tertunda:</span> <b>{stats.totalPending}</b></div>
            {Object.entries(stats.byStatus).map(([s, c]) => (
              <div key={s}><span className="text-muted-foreground">{s}:</span> <b>{c}</b></div>
            ))}
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground">Memuat...</p>
      ) : messages.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Inbox className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Tidak ada pesan gagal. Semua pesan warga terproses.
        </Card>
      ) : (
        <div className="space-y-2">
          {messages.map((m) => (
            <Card key={m.message_id} className="p-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <Badge variant={m.channel === "webchat" ? "secondary" : "outline"}>{m.channel || "?"}</Badge>
                  <span className="font-mono text-xs text-muted-foreground truncate">{m.wa_user_id || m.message_id}</span>
                  <Badge variant="outline">percobaan: {m.attempts}</Badge>
                  {m.village_id && <Badge variant="outline">desa: {m.village_id.slice(-6)}</Badge>}
                </div>
                <p className="text-sm mt-1 line-clamp-2">{m.originalMessage || <i className="text-muted-foreground">(tanpa teks)</i>}</p>
                {m.lastError && <p className="text-xs text-red-500 mt-1 line-clamp-1">{m.lastError}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  Terakhir gagal: {formatDateTime(m.lastAttempt, user?.village_timezone)}
                </p>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={() => retryOne(m.message_id)}
                disabled={retryingId === m.message_id}
              >
                {retryingId === m.message_id ? "..." : "Reproses"}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
