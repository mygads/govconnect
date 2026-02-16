"use client"

import React, { useState, useEffect } from 'react'
import { 
  Bell, 
  Volume2, 
  VolumeX, 
  AlertTriangle,
  Save,
  TestTube,
  CheckCircle2,
  Loader2,
  Sparkles,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { 
  getNotificationSettings, 
  saveNotificationSettings, 
  playNotificationSound,
  showBrowserNotification,
  requestNotificationPermission,
  NotificationSettings 
} from '@/lib/notification-settings'

// Urgent types from database
interface UrgentType {
  id: string
  name: string
  category_name?: string
}

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings>(getNotificationSettings())
  const [urgentTypes, setUrgentTypes] = useState<UrgentType[]>([])
  const [saving, setSaving] = useState(false)
  const [hasPermission, setHasPermission] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if ('Notification' in window) {
      setHasPermission(Notification.permission === 'granted')
    }
    // Fetch urgent types from database
    fetchUrgentTypes()
  }, [])

  const fetchUrgentTypes = async () => {
    try {
      const res = await fetch('/api/complaints/types?is_urgent=true')
      if (res.ok) {
        const data = await res.json()
        setUrgentTypes(data.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch urgent types:', error)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      saveNotificationSettings(settings)
      toast({ title: 'Berhasil', description: 'Pengaturan notifikasi berhasil disimpan' })
    } catch (error) {
      toast({ title: 'Gagal', description: 'Gagal menyimpan pengaturan', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission()
    setHasPermission(granted)
    toast({
      title: granted ? 'Berhasil' : 'Ditolak',
      description: granted ? 'Izin notifikasi browser diberikan' : 'Izin notifikasi browser ditolak',
      variant: granted ? 'default' : 'destructive',
    })
  }

  const handleTestNotification = () => {
    playNotificationSound('normal')
    showBrowserNotification('Test Notifikasi', 'Ini adalah test notifikasi dari Tanggapin AI', { urgent: false })
  }

  const handleTestUrgent = () => {
    playNotificationSound('urgent')
    showBrowserNotification('🚨 Test Notifikasi Darurat', 'Ini adalah test notifikasi darurat', { urgent: true })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          <Bell className="h-8 w-8 text-primary" />
          Pengaturan Notifikasi
        </h1>
        <p className="text-muted-foreground mt-2">
          Kelola notifikasi dan alert untuk laporan darurat
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Notification Status Card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-yellow-500" />
              Status Notifikasi
            </CardTitle>
            <CardDescription>
              Aktifkan atau nonaktifkan notifikasi untuk laporan masuk
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
              <div className="space-y-1">
                <Label className="text-base font-medium">Aktifkan Notifikasi</Label>
                <p className="text-sm text-muted-foreground">
                  Terima notifikasi untuk laporan baru dan darurat secara real-time
                </p>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked: boolean) => setSettings({ ...settings, enabled: checked })}
                className="scale-125"
              />
            </div>
            
            <div className="mt-4 flex items-center gap-2">
              <div className={`h-3 w-3 rounded-full ${settings.enabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              <span className={`text-sm font-medium ${settings.enabled ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                {settings.enabled ? 'Notifikasi Aktif' : 'Notifikasi Nonaktif'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Sound & Browser Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {settings.soundEnabled ? <Volume2 className="h-5 w-5 text-blue-500" /> : <VolumeX className="h-5 w-5 text-gray-500" />}
              Suara Notifikasi
            </CardTitle>
            <CardDescription>
              Pengaturan suara untuk notifikasi
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm font-medium">Aktifkan Suara</Label>
                <p className="text-xs text-muted-foreground">Putar suara saat ada notifikasi baru</p>
              </div>
              <Switch
                checked={settings.soundEnabled}
                onCheckedChange={(checked: boolean) => setSettings({ ...settings, soundEnabled: checked })}
                disabled={!settings.enabled}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={handleTestNotification} disabled={!settings.enabled}>
                <TestTube className="h-4 w-4 mr-2" />Test Normal
              </Button>
              <Button variant="outline" size="sm" onClick={handleTestUrgent} disabled={!settings.enabled}>
                <AlertTriangle className="h-4 w-4 mr-2" />Test Darurat
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Browser Permission Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-purple-500" />
              Izin Browser
            </CardTitle>
            <CardDescription>
              Izin notifikasi desktop dari browser
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
              <div className="space-y-1">
                <Label className="text-sm font-medium">Notifikasi Browser</Label>
                <p className="text-xs text-muted-foreground">
                  {hasPermission ? 'Notifikasi browser telah diizinkan' : 'Diperlukan untuk notifikasi desktop'}
                </p>
              </div>
              {hasPermission ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm">Diizinkan</span>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={handleRequestPermission}>
                  Minta Izin
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Urgent Categories Card - Read-only from database */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Kategori Darurat (dari Database)
            </CardTitle>
            <CardDescription>
              Jenis pengaduan yang ditandai sebagai darurat di database. Ubah di menu Kategori Pengaduan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {urgentTypes.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {urgentTypes.map((type) => (
                  <div 
                    key={type.id} 
                    className="flex items-center gap-3 p-3 rounded-lg border bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900"
                  >
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium">{type.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Info className="h-4 w-4" />
                <span className="text-sm">Tidak ada jenis pengaduan yang ditandai sebagai darurat.</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-4">
              Untuk mengubah kategori darurat, edit jenis pengaduan di menu &quot;Kategori Pengaduan&quot; dan centang opsi &quot;Darurat&quot;.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button 
          onClick={handleSave} 
          disabled={saving}
          size="lg"
          className="min-w-[200px]"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Menyimpan...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Simpan Pengaturan
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
