"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { laporan, statistics } from '@/lib/frontend-api'
import { 
  getNotificationSettings, 
  playNotificationSound,
  showBrowserNotification,
  requestNotificationPermission,
  NotificationSettings,
} from '@/lib/notification-settings'

interface Complaint {
  id: string
  complaint_id: string
  wa_user_id: string
  kategori: string
  deskripsi: string
  status: string
  is_urgent?: boolean
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
  const [settings, setSettings] = useState<NotificationSettings>(getNotificationSettings())
  
  const previousComplaintsRef = useRef<Set<string>>(new Set())
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isInitialLoadRef = useRef(true)

  // Fetch all data
  const fetchData = useCallback(async () => {
    try {
      // Fetch statistics
      const statsData = await statistics.getOverview()
      
      // Fetch recent complaints (limit to 100 most recent for performance)
      const complaintsData = await laporan.getAll({ limit: '100' })
      const allComplaints: Complaint[] = complaintsData.data || []
      
      // Filter urgent complaints - is_urgent is set from database via ComplaintType.is_urgent
      const urgent = allComplaints.filter(c => {
        return c.is_urgent === true && (c.status === 'OPEN' || c.status === 'baru')
      })
      
      // Get recent (last 10)
      const recent = allComplaints
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)
      
      // Calculate today's count
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayCount = allComplaints.filter(c => 
        new Date(c.created_at) >= today
      ).length
      
      // Calculate last hour count
      const lastHour = new Date(Date.now() - 60 * 60 * 1000)
      const lastHourCount = allComplaints.filter(c => 
        new Date(c.created_at) >= lastHour
      ).length
      
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
              playNotificationSound(isUrgent ? 'urgent' : 'normal')
              showBrowserNotification(
                notification.title,
                notification.message,
                {
                  urgent: isUrgent,
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
        todayCount,
        lastHourCount,
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
  }, [settings.enabled])

  // Initial load and polling
  useEffect(() => {
    // Request notification permission
    requestNotificationPermission()
    
    // Initial fetch
    fetchData()
    
    // Start polling (every 30 seconds)
    pollingIntervalRef.current = setInterval(fetchData, 30000)
    
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [fetchData])

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
    // Settings are saved in the component that updates them
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
