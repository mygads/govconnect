"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { dashboard, statistics } from '@/lib/frontend-api'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  fetchNotificationSettings,
  getNotificationSettings,
  playNotificationSound,
  saveNotificationSettings,
  showBrowserNotification,
  requestNotificationPermission,
  NotificationSettings,
} from '@/lib/notification-settings'

type DashboardSseEvent =
  | { type: 'complaint_created' | 'complaint_updated' | 'urgent_alert'; village_id: string; complaint_id: string; at: number }
  | { type: 'connected'; village_id: string; at: number }
  | { type: 'heartbeat'; at: number }

interface DashboardSseStatusEvent {
  type: 'processing_status'
  stage: string
  message?: string
  progress?: number
  done?: boolean
  at: number
}

interface Complaint {
  id: string
  complaint_id: string
  wa_user_id: string
  kategori: string
  deskripsi: string
  status: string
  is_urgent?: boolean
  deleted_at?: string | null
  created_at: string
}

interface Notification {
  id: string
  type: 'new_complaint' | 'urgent' | 'status_change' | 'info'
  title: string
  message: string
  complaint?: Complaint
  timestamp: Date
  read: boolean
}

interface RealtimeStats {
  complaints: {
    total: number
    open: number
    process: number
    done: number
    canceled: number
    reject: number
    urgent: number
  }
  services?: {
    total: number
    open: number
    process: number
    done: number
    canceled: number
    reject: number
  }
  todayCount: number
  lastHourCount: number
}

interface RealtimeContextType {
  stats: RealtimeStats | null
  notifications: Notification[]
  unreadCount: number
  urgentComplaints: Complaint[]
  recentComplaints: Complaint[]
  loading: boolean
  error: string | null
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearNotifications: () => void
  refreshData: () => Promise<void>
  settings: NotificationSettings
  updateSettings: (settings: NotificationSettings) => void
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined)

export function useRealtime() {
  const context = useContext(RealtimeContext)
  if (context === undefined) {
    throw new Error('useRealtime must be used within a RealtimeProvider')
  }
  return context
}

interface RealtimeProviderProps {
  children: ReactNode
}

export function RealtimeProvider({ children }: RealtimeProviderProps) {
  const [stats, setStats] = useState<RealtimeStats | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [urgentComplaints, setUrgentComplaints] = useState<Complaint[]>([])
  const [recentComplaints, setRecentComplaints] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS)

  const previousComplaintsRef = useRef<Set<string>>(new Set())
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isInitialLoadRef = useRef(true)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptRef = useRef(0)
  const isUnmountingRef = useRef(false)
  const fallbackPollingRef = useRef<NodeJS.Timeout | null>(null)
  const isFallbackModeRef = useRef(false)
  const consecutiveSseFailuresRef = useRef(0)
  const fetchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  const SSE_FAILURE_THRESHOLD = 3
  const MAX_RECONNECT_DELAY_MS = 15000
  const FALLBACK_POLL_INTERVAL_MS = 30000
  const RETRY_SSE_WHILE_FALLBACK_MS = 60000
  const FETCH_DEBOUNCE_MS = 500

  const getReconnectDelay = (attempt: number) => Math.min(1000 * 2 ** Math.max(attempt, 0), MAX_RECONNECT_DELAY_MS)

  const clearTimer = (ref: React.MutableRefObject<NodeJS.Timeout | null>) => {
    if (ref.current) {
      clearTimeout(ref.current)
      ref.current = null
    }
  }

  const clearIntervalRef = (ref: React.MutableRefObject<NodeJS.Timeout | null>) => {
    if (ref.current) {
      clearInterval(ref.current)
      ref.current = null
    }
  }

  const closeEventSource = (ref: React.MutableRefObject<EventSource | null>) => {
    if (ref.current) {
      ref.current.close()
      ref.current = null
    }
  }

  const parseSseEvent = <T,>(event: MessageEvent<string>): T | null => {
    try {
      return JSON.parse(event.data) as T
    } catch {
      return null
    }
  }

  // Fetch all data - defined first as it's used by other functions
  const fetchData = useCallback(async () => {
    try {
      const [statsData, realtimeData] = await Promise.all([
        statistics.getOverview(),
        dashboard.getRealtimeSummary(),
      ])
      const summary = realtimeData.data
      const urgent: Complaint[] = (summary.urgentComplaints || []).filter((complaint: Complaint) => ['OPEN', 'baru'].includes(complaint.status))
      const recent: Complaint[] = summary.recentComplaints || []
      const allComplaints = Array.from(new Map([...recent, ...urgent].map((complaint) => [complaint.id, complaint])).values())

      // Check for new complaints (not on initial load)
      if (!isInitialLoadRef.current) {
        const currentIds = new Set(allComplaints.map(c => c.id))

        allComplaints.forEach(complaint => {
          if (!previousComplaintsRef.current.has(complaint.id)) {
            // New complaint detected - is_urgent from database
            const isUrgent = complaint.is_urgent === true

            // Create notification
            const notification: Notification = {
              id: `notif-${complaint.id}-${Date.now()}`,
              type: isUrgent ? 'urgent' : 'new_complaint',
              title: isUrgent ? '🚨 LAPORAN DARURAT!' : 'Laporan Baru',
              message: `${complaint.complaint_id}: ${complaint.kategori.replace(/_/g, ' ')}`,
              complaint,
              timestamp: new Date(),
              read: false,
            }

            setNotifications(prev => [notification, ...prev].slice(0, 50))

            // Play sound and show browser notification
            if (settings.enabled) {
              playNotificationSound(isUrgent ? 'urgent' : 'normal', settings)
              showBrowserNotification(
                notification.title,
                notification.message,
                {
                  urgent: isUrgent,
                  settings,
                  onClick: () => {
                    window.focus()
                    window.location.href = `/dashboard/laporan/${complaint.id}`
                  }
                }
              )
            }
          }
        })

        previousComplaintsRef.current = currentIds
      } else {
        // Initial load - populate recent activity notifications (last 24 hours)
        const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000)
        const recentActivity = allComplaints
          .filter(c => new Date(c.created_at) >= last24Hours)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 10)

        const initialNotifications: Notification[] = recentActivity.map(complaint => {
          const isUrgent = complaint.is_urgent === true
          return {
            id: `notif-${complaint.id}`,
            type: isUrgent ? 'urgent' : 'new_complaint',
            title: isUrgent ? '🚨 LAPORAN DARURAT!' : 'Laporan Masuk',
            message: `${complaint.complaint_id}: ${complaint.kategori.replace(/_/g, ' ')}`,
            complaint,
            timestamp: new Date(complaint.created_at),
            read: true, // Mark as read for initial load
          }
        })

        setNotifications(initialNotifications)
        previousComplaintsRef.current = new Set(allComplaints.map(c => c.id))
        isInitialLoadRef.current = false
      }

      // Update state
      setStats({
        complaints: {
          ...statsData.complaints,
          urgent: urgent.length,
        },
        services: statsData.services,
        todayCount: summary.todayCount || 0,
        lastHourCount: summary.lastHourCount || 0,
      })

      setUrgentComplaints(urgent)
      setRecentComplaints(recent)
      setError(null)

    } catch (err: any) {
      console.error('Failed to fetch realtime data:', err)
      setError(err.message || 'Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [settings])

  // Debounced fetch: batches multiple SSE events into a single API call
  const debouncedFetchData = useCallback(() => {
    if (fetchDebounceRef.current) {
      clearTimeout(fetchDebounceRef.current)
    }
    fetchDebounceRef.current = setTimeout(() => {
      fetchDebounceRef.current = null
      if (!isUnmountingRef.current) {
        void fetchData()
      }
    }, FETCH_DEBOUNCE_MS)
  }, [fetchData])

  const stopFallbackPolling = useCallback(() => {
    clearIntervalRef(fallbackPollingRef)
    clearTimer(reconnectTimeoutRef)
  }, [])

  // SSE event handlers - uses debouncedFetchData to batch events
  const openSse = useCallback(() => {
    closeEventSource(eventSourceRef)
    clearTimer(reconnectTimeoutRef)

    const url = '/api/dashboard/events'
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      consecutiveSseFailuresRef.current = 0
      reconnectAttemptRef.current = 0
      isFallbackModeRef.current = false
      stopFallbackPolling()
    }

    eventSource.onerror = () => {
      closeEventSource(eventSourceRef)
      const failures = consecutiveSseFailuresRef.current + 1
      consecutiveSseFailuresRef.current = failures

      if (failures >= SSE_FAILURE_THRESHOLD) {
        isFallbackModeRef.current = true
        // Start fallback polling when SSE fails
        clearIntervalRef(fallbackPollingRef)
        const poll = () => {
          if (isUnmountingRef.current) return
          void fetchData()
        }
        void poll()
        fallbackPollingRef.current = setInterval(poll, FALLBACK_POLL_INTERVAL_MS)

        // Retry SSE while in fallback mode
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isUnmountingRef.current || !isFallbackModeRef.current) return
          openSse()
        }, RETRY_SSE_WHILE_FALLBACK_MS)
        return
      }

      const delay = getReconnectDelay(reconnectAttemptRef.current)
      reconnectAttemptRef.current += 1

      clearTimer(reconnectTimeoutRef)
      reconnectTimeoutRef.current = setTimeout(() => {
        if (isUnmountingRef.current) return
        openSse()
      }, delay)
    }

    eventSource.addEventListener('complaint_created', (event: MessageEvent<string>) => {
      const payload = parseSseEvent<DashboardSseEvent>(event)
      if (!payload || payload.type !== 'complaint_created') return

      // Incremental update: increment total count immediately
      setStats(prev => {
        if (!prev) return prev
        return {
          ...prev,
          complaints: {
            ...prev.complaints,
            total: prev.complaints.total + 1,
            open: prev.complaints.open + 1,
          },
          todayCount: prev.todayCount + 1,
          lastHourCount: prev.lastHourCount + 1,
        }
      })

      // Debounced fetch to get complaint details for notification
      debouncedFetchData()
    })

    eventSource.addEventListener('complaint_updated', (event: MessageEvent<string>) => {
      const payload = parseSseEvent<DashboardSseEvent>(event)
      if (!payload || payload.type !== 'complaint_updated') return

      // Debounced fetch to get accurate status counts
      debouncedFetchData()
    })

    eventSource.addEventListener('urgent_alert', (event: MessageEvent<string>) => {
      const payload = parseSseEvent<DashboardSseEvent>(event)
      if (!payload || payload.type !== 'urgent_alert') return

      // Incremental update: increment urgent count immediately
      setStats(prev => {
        if (!prev) return prev
        return {
          ...prev,
          complaints: {
            ...prev.complaints,
            urgent: prev.complaints.urgent + 1,
          },
        }
      })

      // Debounced fetch for urgent complaint details
      debouncedFetchData()
    })
  }, [stopFallbackPolling, debouncedFetchData, fetchData])

  useEffect(() => {
    const localSettings = getNotificationSettings()
    setSettings(localSettings)

    fetchNotificationSettings()
      .then((nextSettings) => {
        setSettings(nextSettings)
        saveNotificationSettings(nextSettings, nextSettings.villageId)
      })
      .catch(() => {
        setSettings(localSettings)
      })
  }, [])

  // Initial load and SSE connection
  useEffect(() => {
    // Request notification permission
    requestNotificationPermission()

    // Initial fetch
    fetchData()

    // Start SSE connection
    openSse()

    return () => {
      isUnmountingRef.current = true
      closeEventSource(eventSourceRef)
      clearTimer(reconnectTimeoutRef)
      clearIntervalRef(fallbackPollingRef)
      clearIntervalRef(pollingIntervalRef)
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current)
      }
    }
  }, [fetchData, openSse])

  // Notification actions
  const markAsRead = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    )
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const clearNotifications = useCallback(() => {
    setNotifications([])
  }, [])

  const refreshData = useCallback(async () => {
    setLoading(true)
    await fetchData()
  }, [fetchData])

  const updateSettings = useCallback((newSettings: NotificationSettings) => {
    setSettings(newSettings)
    saveNotificationSettings(newSettings, newSettings.villageId)
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  const value: RealtimeContextType = {
    stats,
    notifications,
    unreadCount,
    urgentComplaints,
    recentComplaints,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    refreshData,
    settings,
    updateSettings,
  }

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  )
}
