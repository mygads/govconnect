"use client"

import React, { useState, useRef, useEffect } from 'react'
import { Bell, Check, CheckCheck, Trash2, ExternalLink, AlertTriangle, FileText, Info, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useRealtime } from './RealtimeProvider'
import { cn } from '@/lib/utils'
import Link from 'next/link'

export function NotificationCenter() {
  const { 
    notifications, 
    unreadCount, 
    markAsRead, 
    markAllAsRead, 
    clearNotifications 
  } = useRealtime()
  
  const [open, setOpen] = useState(false)

  const getIcon = (type: string) => {
    switch (type) {
      case 'urgent':
        return <AlertTriangle className="h-4 w-4 text-red-500" />
      case 'new_complaint':
        return <FileText className="h-4 w-4 text-blue-500" />
      case 'status_change':
        return <Info className="h-4 w-4 text-green-500" />
      default:
        return <Bell className="h-4 w-4 text-gray-500" />
    }
  }

  const formatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (minutes < 1) return 'Baru saja'
    if (minutes < 60) return `${minutes} menit lalu`
    if (hours < 24) return `${hours} jam lalu`
    return `${days} hari lalu`
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <h3 className="text-sm font-semibold">Notifikasi</h3>
            <p className="text-[11px] text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}
            </p>
          </div>
          <div className="flex gap-0.5">
            {unreadCount > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={markAllAsRead}
                className="text-[11px] h-6 px-2"
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Dibaca
              </Button>
            )}
            {notifications.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearNotifications}
                className="text-[11px] h-6 px-1.5 text-red-500 hover:text-red-600"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
        
        {/* Notifications List */}
        <ScrollArea className="h-[320px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-20" />
              <p className="text-xs">Tidak ada notifikasi</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={cn(
                    "flex gap-2 px-3 py-2 hover:bg-muted/50 transition-colors cursor-pointer",
                    !notification.read && "bg-blue-50 dark:bg-blue-950/20",
                    notification.type === 'urgent' && !notification.read && "bg-red-50 dark:bg-red-950/20"
                  )}
                  onClick={() => markAsRead(notification.id)}
                >
                  <div className="shrink-0 mt-0.5">
                    {getIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className={cn(
                        "text-xs font-medium leading-tight",
                        notification.type === 'urgent' && "text-red-600 dark:text-red-400"
                      )}>
                        {notification.title}
                      </p>
                      {!notification.read && (
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0 mt-1" />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                      {notification.message}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-muted-foreground">
                        {formatTime(new Date(notification.timestamp))}
                      </span>
                      {notification.complaint && (
                        <Link 
                          href={`/dashboard/laporan/${notification.complaint.id}`}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation()
                            setOpen(false)
                          }}
                        >
                          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]">
                            Lihat <ExternalLink className="h-2.5 w-2.5 ml-0.5" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

// Urgent Alert Banner Component
export function UrgentAlertBanner() {
  const { urgentComplaints, settings } = useRealtime()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  
  // Filter: only show complaints that are still "baru" and not dismissed
  // urgentComplaints from RealtimeProvider already filters by status === 'baru'
  const activeUrgent = urgentComplaints
    .filter(c => !dismissed.has(c.id))
    // Sort by created_at ascending (oldest first - FIFO)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  
  // Maximum 2 banners at a time
  const visibleUrgent = activeUrgent.slice(0, 2)
  
  // Clear dismissed set when complaint is no longer in urgentComplaints
  // (meaning status changed from 'baru')
  useEffect(() => {
    if (dismissed.size > 0) {
      const currentIds = new Set(urgentComplaints.map(c => c.id))
      const toRemove: string[] = []
      
      dismissed.forEach(id => {
        if (!currentIds.has(id)) {
          toRemove.push(id)
        }
      })
      
      if (toRemove.length > 0) {
        setDismissed(prev => {
          const next = new Set(prev)
          toRemove.forEach(id => next.delete(id))
          return next
        })
      }
    }
  }, [urgentComplaints, dismissed])
  
  if (!settings.enabled || visibleUrgent.length === 0) {
    return null
  }
  
  return (
    <div className="fixed top-0 left-0 right-0 z-50 animate-in slide-in-from-top duration-300">
      {visibleUrgent.map((complaint, index) => (
        <div 
          key={complaint.id}
          className={cn(
            "text-white px-4 py-2 flex items-center justify-between",
            index === 0 ? "bg-red-600" : "bg-red-500"
          )}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 animate-pulse" />
            <div>
              <span className="font-bold">LAPORAN DARURAT: </span>
              <span>{complaint.complaint_id} - {complaint.kategori.replace(/_/g, ' ')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/dashboard/laporan/${complaint.id}`}>
              <Button size="sm" variant="secondary" className="h-7">
                Tangani Sekarang
              </Button>
            </Link>
            <Button 
              size="icon" 
              variant="ghost" 
              className="h-7 w-7 text-white hover:text-white hover:bg-red-700"
              onClick={() => setDismissed(prev => new Set([...prev, complaint.id]))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      {/* Show indicator if there are more urgent reports waiting */}
      {activeUrgent.length > 2 && (
        <div className="bg-red-800 text-white text-center text-xs py-1">
          +{activeUrgent.length - 2} laporan darurat lainnya menunggu
        </div>
      )}
    </div>
  )
}
