"use client"

import { useEffect, useState, useCallback } from "react"
import { redirect } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/components/auth/AuthContext"
import {
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Server,
  HelpCircle,
  Database,
  RadioTower,
  HardDrive,
  MessageCircle,
  Activity,
} from "lucide-react"

type HealthStatus = "healthy" | "unhealthy" | "unknown"

interface HealthCheck {
  name: string
  url: string
  path?: string
  status: HealthStatus
  responseTime: number
  details?: any
  error?: string
}

interface ServiceHealth {
  name: string
  url: string
  status: HealthStatus
  responseTime: number
  checks: Record<string, HealthCheck>
  errors: string[]
}

interface HealthData {
  overall: "healthy" | "degraded" | "down"
  timestamp: string
  services: ServiceHealth[]
  summary: { total: number; healthy: number; unhealthy: number; unknown: number }
}

const checkLabels: Record<string, string> = {
  api: "API",
  database: "Database",
  rabbitmq: "RabbitMQ",
  objectStorage: "S3/R2 Storage",
  genfityWa: "Genfity WA",
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

  const getStatusIcon = (status: string, className = "h-5 w-5") => {
    switch (status) {
      case "healthy": return <CheckCircle2 className={`${className} text-green-500`} />
      case "unhealthy": return <XCircle className={`${className} text-red-500`} />
      default: return <HelpCircle className={`${className} text-amber-500`} />
    }
  }

  const getCheckIcon = (name: string) => {
    switch (name) {
      case "database": return <Database className="h-4 w-4" />
      case "rabbitmq": return <RadioTower className="h-4 w-4" />
      case "objectStorage": return <HardDrive className="h-4 w-4" />
      case "genfityWa": return <MessageCircle className="h-4 w-4" />
      default: return <Activity className="h-4 w-4" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "healthy": return <Badge className="bg-green-100 text-green-800 border-green-200">Healthy</Badge>
      case "unhealthy": return <Badge className="bg-red-100 text-red-800 border-red-200">Unhealthy</Badge>
      default: return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Unknown</Badge>
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

  const formatCheckDetail = (check: HealthCheck) => {
    const details = check.details || {}
    if (check.name === "objectStorage") {
      const parts = [
        details.provider,
        details.bucket ? `bucket: ${details.bucket}` : null,
        typeof details.usageMb === "number" ? `${details.usageMb} MB terpakai` : null,
      ].filter(Boolean)
      return parts.join(" · ") || (details.configured === false ? "S3/R2 belum dikonfigurasi" : "Tidak ada detail storage")
    }

    if (check.name === "genfityWa") {
      return details?.data?.status || details?.status || details?.message || "Ping layanan WhatsApp"
    }

    if (check.name === "database") return details.database || details.status || "Database check"
    if (check.name === "rabbitmq") return details.rabbitmq || details.status || "RabbitMQ check"
    return details.service || details.status || check.path || "Service check"
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-72" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">System Health</h1>
          <p className="text-muted-foreground mt-2">
            Status API, database, RabbitMQ, Genfity WA, dan S3/R2 setiap microservice.
          </p>
        </div>
        <Button onClick={fetchHealth} variant="outline" disabled={checking}>
          <RefreshCcw className={`h-4 w-4 mr-2 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Memeriksa..." : "Refresh"}
        </Button>
      </div>

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="mb-2">{getOverallBadge(data.overall)}</div>
                <p className="text-xs text-muted-foreground mt-2">
                  Terakhir dicek: {new Date(data.timestamp).toLocaleString("id-ID")}
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
                <p className="text-sm text-muted-foreground">Service Perlu Perhatian</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {data.services.map((service) => (
              <Card key={service.name} className={
                service.status === "healthy" ? "border-green-200" :
                service.status === "unhealthy" ? "border-red-200" : "border-amber-200"
              }>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {getStatusIcon(service.status)}
                      {service.name}
                    </CardTitle>
                    {getStatusBadge(service.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Response Time
                      </span>
                      <span className={`font-mono font-medium ${getResponseTimeColor(service.responseTime)}`}>
                        {service.responseTime}ms
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Server className="h-3 w-3" /> URL
                      </span>
                      <span className="font-mono text-xs truncate max-w-[180px]">
                        {service.url ? service.url.replace(/https?:\/\//, "") : "-"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {Object.values(service.checks || {}).map((check) => (
                      <div key={check.name} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span className="text-muted-foreground">{getCheckIcon(check.name)}</span>
                            {checkLabels[check.name] || check.name}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-mono ${getResponseTimeColor(check.responseTime)}`}>{check.responseTime}ms</span>
                            {getStatusIcon(check.status, "h-4 w-4")}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground break-words">{formatCheckDetail(check)}</p>
                        {check.error && (
                          <div className="rounded-md bg-red-50 dark:bg-red-950 p-2 text-xs text-red-700 dark:text-red-300 break-words">
                            {check.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {service.errors.length > 0 && (
                    <div className="rounded-md bg-red-50 dark:bg-red-950 p-3 text-xs text-red-700 dark:text-red-300 space-y-1">
                      {service.errors.map((error) => <div key={error}>{error}</div>)}
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
