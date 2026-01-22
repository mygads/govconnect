"use client"

import React, { useState, useEffect } from 'react'
import { 
  Bell, 
  Volume2, 
  VolumeX, 
  Phone, 
  AlertTriangle,
  Save,
  TestTube,
  CheckCircle2,
  Loader2,
  Sparkles,
  MessageSquare,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { 
  getNotificationSettings, 
  saveNotificationSettings, 
  URGENT_CATEGORIES,
  playNotificationSound,
  showBrowserNotification,
  requestNotificationPermission,
  NotificationSettings 
} from '@/lib/notification-settings'

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings>(getNotificationSettings())
  const [saving, setSaving] = useState(false)
  const [hasPermission, setHasPermission] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if ('Notification' in window) {
      setHasPermission(Notification.permission === 'granted')
    }
  }, [])

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
    showBrowserNotification('Test Notifikasi', 'Ini adalah test notifikasi dari GovConnect', { urgent: false })
  }

  const handleTestUrgent = () => {
    playNotificationSound('urgent')
    showBrowserNotification('🚨 Test Notifikasi Darurat', 'Ini adalah test notifikasi darurat', { urgent: true })
  }

  const toggleCategory = (categoryId: string) => {
    setSettings(prev => ({
      ...prev,
      urgentCategories: prev.urgentCategories.includes(categoryId)
        ? prev.urgentCategories.filter(id => id !== categoryId)
        : [...prev.urgentCategories, categoryId]
    }))
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

        {/* WhatsApp Admin Card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-500" />
              Notifikasi WhatsApp Admin
            </CardTitle>
            <CardDescription>
              Nomor WhatsApp untuk menerima notifikasi laporan darurat
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="adminWhatsApp">Nomor WhatsApp Admin</Label>
              <Input
                id="adminWhatsApp"
                type="tel"
                placeholder="628123456789"
                value={settings.adminWhatsApp}
                onChange={(e) => setSettings({ ...settings, adminWhatsApp: e.target.value })}
                disabled={!settings.enabled}
                className="max-w-md"
              />
              <p className="text-xs text-muted-foreground">
                Format: kode negara + nomor (tanpa + atau spasi). Contoh: 628123456789
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Urgent Categories Card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Kategori Darurat
            </CardTitle>
            <CardDescription>
              Pilih kategori yang dianggap sebagai laporan darurat dan memerlukan penanganan segera
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {URGENT_CATEGORIES.map((category) => (
                <div 
                  key={category.id} 
                  className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    id={category.id}
                    checked={settings.urgentCategories.includes(category.id)}
                    onCheckedChange={() => toggleCategory(category.id)}
                    disabled={!settings.enabled}
                  />
                  <Label htmlFor={category.id} className="text-sm cursor-pointer flex-1">
                    {category.label}
                  </Label>
                </div>
              ))}
            </div>
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
