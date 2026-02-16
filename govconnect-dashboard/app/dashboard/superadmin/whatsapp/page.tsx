"use client"

import { useEffect, useState, useCallback } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/components/auth/AuthContext"
import {
  RefreshCcw, CheckCircle2, XCircle, Wifi, WifiOff, MessageSquare,
  Users, Activity, AlertTriangle
} from "lucide-react"

interface WaSupportUser {
  id: string
  source_service: string
  status: string
  created_at: string
  subscription: {
    id: number
    provider: string
    max_sessions: number
    max_messages: number
    expires_at: string
    status: string
  } | null
  session_count: number
  local_session?: {
    village_id: string
    instance_name: string | null
    wa_number: string | null
    status: string | null
    wa_support_session_id: string | null
    last_connected_at: string | null
    created_at: string
  } | null
}

interface SummaryData {
  total: number
  items: WaSupportUser[]
}

interface HealthData {
  configured: boolean
  status: string
  detail?: any
}

export default function WaSupportPage() {
  const { user } = useAuth()
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true)
      const token = localStorage.getItem("token")
      const headers = { Authorization: `Bearer ${token}` }

      const [summaryRes, healthRes] = await Promise.all([
        fetch("/api/superadmin/whatsapp/summary", { headers }),
        fetch("/api/superadmin/whatsapp/health", { headers }),
      ])

      if (summaryRes.ok) {
        const data = await summaryRes.json()
        setSummary(data.data)
      }
      if (healthRes.ok) {
        const data = await healthRes.json()
        setHealth(data.data)
      }
    } catch (e) {
      console.error("Failed to fetch WA Support data:", e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "connected":
        return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Connected</Badge>
      case "disconnected":
        return <Badge className="bg-red-100 text-red-800 border-red-200"><XCircle className="w-3 h-3 mr-1" />Disconnected</Badge>
      default:
        return <Badge variant="secondary">{status || "Unknown"}</Badge>
    }
  }

  const getHealthBadge = () => {
    if (!health) return <Badge variant="secondary">Loading...</Badge>
    if (!health.configured) return <Badge className="bg-yellow-100 text-yellow-800">Not Configured</Badge>
    if (health.status === "connected") return <Badge className="bg-green-100 text-green-800">Connected</Badge>
    return <Badge className="bg-red-100 text-red-800">Error</Badge>
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  const items = summary?.items || []
  const connectedCount = items.filter(u => u.local_session?.status === "connected").length
  const totalSessions = items.reduce((acc, u) => acc + u.session_count, 0)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">WA Support V2</h1>
          <p className="text-muted-foreground mt-2">
            Kelola user dan session WhatsApp via wa-support-v2
          </p>
        </div>
        <div className="flex items-center gap-3">
          {getHealthBadge()}
          <Button onClick={fetchData} variant="outline" disabled={refreshing}>
            <RefreshCcw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary?.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Registered on wa-support-v2</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Sessions</CardTitle>
            <Wifi className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{connectedCount}</div>
            <p className="text-xs text-muted-foreground mt-1">of {totalSessions} total sessions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Sessions</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalSessions}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all villages</p>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            WA Support Users
          </CardTitle>
          <CardDescription>
            Daftar user govconnect yang terdaftar di wa-support-v2 beserta status session
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <WifiOff className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Belum ada user WA Support terdaftar</p>
              <p className="text-xs mt-1">User akan otomatis terdaftar saat admin membuat session WhatsApp</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User ID (Village)</TableHead>
                  <TableHead>Instance Name</TableHead>
                  <TableHead>WA Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sessions</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Last Connected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">{item.id}</TableCell>
                    <TableCell>{item.local_session?.instance_name || "-"}</TableCell>
                    <TableCell className="font-mono">
                      {item.local_session?.wa_number || "-"}
                    </TableCell>
                    <TableCell>{getStatusBadge(item.local_session?.status || null)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.session_count} / {item.subscription?.max_sessions || "∞"}</Badge>
                    </TableCell>
                    <TableCell>
                      {item.subscription ? (
                        <Badge className={
                          item.subscription.status === "active"
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800"
                        }>
                          {item.subscription.status}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">No sub</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.local_session?.last_connected_at
                        ? new Date(item.local_session.last_connected_at).toLocaleString("id-ID", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
                          })
                        : "-"
                      }
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
