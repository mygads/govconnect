"use client"

import { useEffect, useState, useCallback } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/components/auth/AuthContext"
import {
  Activity, RefreshCcw, CheckCircle2, XCircle, AlertTriangle,
  Clock, Server, Wifi, WifiOff, HelpCircle
} from "lucide-react"

interface ServiceHealth {
  name: string
  url: string
  status: "healthy" | "unhealthy" | "unknown"
  responseTime: number
  details?: any
  error?: string
}

interface HealthData {
  overall: "healthy" | "degraded" | "down"
  timestamp: string
  services: ServiceHealth[]
  summary: { total: number; healthy: number; unhealthy: number; unknown: number }
}

export default function SystemHealthPage() {
  const { user } = useAuth()
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (user && user.role !== "superadmin") redirect("/dashboard")
  }, [user])

  const fetchHealth = useCallback(async () => {
    try {
      setChecking(true)
      const res = await fetch("/api/superadmin/system-health", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      if (res.ok) setData(await res.json())
    } catch (e) {
      console.error("Failed to fetch health:", e)
    } finally {
      setLoading(false)
      setChecking(false)
    }
  }, [])

  useEffect(() => { fetchHealth() }, [fetchHealth])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy": return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case "unhealthy": return <XCircle className="h-5 w-5 text-red-500" />
      default: return <HelpCircle className="h-5 w-5 text-gray-400" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "healthy": return <Badge className="bg-green-100 text-green-800 border-green-200">Healthy</Badge>
      case "unhealthy": return <Badge className="bg-red-100 text-red-800 border-red-200">Unhealthy</Badge>
      default: return <Badge variant="secondary">Unknown</Badge>
    }
  }

  const getOverallBadge = (overall: string) => {
    switch (overall) {
      case "healthy": return <Badge className="bg-green-100 text-green-800 text-lg px-4 py-1">Semua Sehat</Badge>
      case "degraded": return <Badge className="bg-yellow-100 text-yellow-800 text-lg px-4 py-1">Sebagian Bermasalah</Badge>
      default: return <Badge className="bg-red-100 text-red-800 text-lg px-4 py-1">Sistem Down</Badge>
    }
  }

  const getResponseTimeColor = (ms: number) => {
    if (ms === 0) return "text-muted-foreground"
    if (ms < 200) return "text-green-600"
    if (ms < 1000) return "text-yellow-600"
    return "text-red-600"
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-40" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">System Health</h1>
          <p className="text-muted-foreground mt-2">
            Status seluruh microservice Tanggapin AI
          </p>
        </div>
        <Button onClick={fetchHealth} variant="outline" disabled={checking}>
          <RefreshCcw className={`h-4 w-4 mr-2 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Memeriksa..." : "Refresh"}
        </Button>
      </div>

      {/* Overall Status */}
      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="mb-2">{getOverallBadge(data.overall)}</div>
                <p className="text-xs text-muted-foreground mt-2">
                  Terakhir dicek: {new Date(data.timestamp).toLocaleTimeString("id-ID")}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-green-600">{data.summary.healthy}</div>
                <p className="text-sm text-muted-foreground">Service Healthy</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-red-600">{data.summary.unhealthy + data.summary.unknown}</div>
                <p className="text-sm text-muted-foreground">Service Bermasalah</p>
              </CardContent>
            </Card>
          </div>

          {/* Service Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.services.map((service, idx) => (
              <Card key={idx} className={
                service.status === "healthy" ? "border-green-200" :
                service.status === "unhealthy" ? "border-red-200" : ""
              }>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {getStatusIcon(service.status)}
                      {service.name}
                    </CardTitle>
                    {getStatusBadge(service.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Response Time
                    </span>
                    <span className={`font-mono font-medium ${getResponseTimeColor(service.responseTime)}`}>
                      {service.responseTime}ms
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Server className="h-3 w-3" /> URL
                    </span>
                    <span className="font-mono text-xs truncate max-w-[180px]">
                      {service.url ? service.url.replace(/https?:\/\//, '') : '-'}
                    </span>
                  </div>
                  {service.error && (
                    <div className="rounded-md bg-red-50 dark:bg-red-950 p-2 text-xs text-red-700 dark:text-red-300">
                      {service.error}
                    </div>
                  )}
                  {service.details?.version && (
                    <div className="text-xs text-muted-foreground">
                      Version: {service.details.version}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
