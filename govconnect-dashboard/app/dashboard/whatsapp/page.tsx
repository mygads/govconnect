"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function WhatsAppPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/dashboard/channel-settings")
  }, [router])

  return null
      })

      const data = await response.json()
      if (data.success) {
        toast({
          title: "Berhasil",
          description: "Sesi WhatsApp terhubung. Silakan scan QR code untuk login.",
        })
        
        // Show QR dialog and start polling
        setShowQrDialog(true)
        await fetchQrCode()
        
        // Start status polling
        const statusInterval = setInterval(async () => {
          const status = await fetchSessionStatus()
          if (status?.loggedIn) {
            clearInterval(statusInterval)
            setStatusPolling(null)
            setShowQrDialog(false)
            toast({
              title: "Login Berhasil!",
              description: "WhatsApp berhasil terhubung.",
            })
          }
        }, 2000)
        setStatusPolling(statusInterval)
        
        // Start QR polling
        const qrInterval = setInterval(fetchQrCode, 3000)
        setQrPolling(qrInterval)
        
        await fetchSessionStatus()
      } else {
        throw new Error(data.error || "Gagal menghubungkan sesi")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal menghubungkan sesi WhatsApp",
        variant: "destructive",
      })
    } finally {
      setIsConnecting(false)
    }
  }

  // Fetch QR Code
  const fetchQrCode = async () => {
    try {
      const token = localStorage.getItem("token")
      const response = await fetch("/api/whatsapp/qr", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json()
      if (data.success) {
        if (data.data.alreadyLoggedIn) {
          // Session is already logged in, no need for QR
          setShowQrDialog(false)
          toast({
            title: "Sudah Login",
            description: "Sesi WhatsApp sudah terhubung dan login.",
          })
          await fetchSessionStatus()
          return
        }
        if (data.data.QRCode) {
          setQrCode(data.data.QRCode)
        }
      }
    } catch (error) {
      console.error("Error fetching QR code:", error)
    }
  }

  // Show QR Code (for sessions that are connected but not logged in)
  const handleShowQr = async () => {
    setShowQrDialog(true)
    await fetchQrCode()
    
    // Start polling for status updates
    const statusInterval = setInterval(async () => {
      const status = await fetchSessionStatus()
      if (status?.loggedIn) {
        clearInterval(statusInterval)
        setStatusPolling(null)
        if (qrPolling) {
          clearInterval(qrPolling)
          setQrPolling(null)
        }
        setShowQrDialog(false)
        toast({
          title: "Login Berhasil!",
          description: "WhatsApp berhasil terhubung.",
        })
      }
    }, 2000)
    setStatusPolling(statusInterval)
    
    // Start QR polling
    const qrInterval = setInterval(fetchQrCode, 3000)
    setQrPolling(qrInterval)
  }

  // Pair phone
  const handlePairPhone = async () => {
    if (!pairPhoneNumber) {
      toast({
        title: "Error",
        description: "Masukkan nomor telepon",
        variant: "destructive",
      })
      return
    }
    
    setIsPairingPhone(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch("/api/whatsapp/pairphone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ Phone: pairPhoneNumber }),
      })

      const data = await response.json()
      if (data.success) {
        setLinkingCode(data.data.LinkingCode || "")
        toast({
          title: "Berhasil",
          description: "Kode pairing berhasil dibuat. Masukkan kode di WhatsApp Anda.",
        })
        
        // Start status polling for phone pairing
        const statusInterval = setInterval(async () => {
          const status = await fetchSessionStatus()
          if (status?.loggedIn) {
            clearInterval(statusInterval)
            setStatusPolling(null)
            setShowPairPhoneDialog(false)
            setLinkingCode("")
            toast({
              title: "Pairing Berhasil!",
              description: "WhatsApp berhasil terhubung via phone pairing.",
            })
          }
        }, 2000)
        setStatusPolling(statusInterval)
      } else {
        throw new Error(data.error || "Gagal membuat kode pairing")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal melakukan phone pairing",
        variant: "destructive",
      })
    } finally {
      setIsPairingPhone(false)
    }
  }

  // Disconnect session
  const handleDisconnect = async () => {
    setIsDisconnecting(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch("/api/whatsapp/disconnect", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json()
      if (data.success) {
        toast({
          title: "Berhasil",
          description: "Sesi WhatsApp terputus.",
        })
        await fetchSessionStatus()
      } else {
        throw new Error(data.error || "Gagal memutuskan sesi")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal memutuskan sesi WhatsApp",
        variant: "destructive",
      })
    } finally {
      setIsDisconnecting(false)
    }
  }

  // Logout session (clear stored session)
  const handleLogout = async () => {
    setIsDisconnecting(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch("/api/whatsapp/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json()
      if (data.success) {
        toast({
          title: "Berhasil",
          description: "Berhasil logout dari WhatsApp. Sesi akan memerlukan scan QR ulang.",
        })
        await fetchSessionStatus()
      } else {
        throw new Error(data.error || "Gagal logout")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal logout dari WhatsApp",
        variant: "destructive",
      })
    } finally {
      setIsDisconnecting(false)
    }
  }

  // Update settings
  const handleUpdateSettings = async (key: keyof SessionSettings, value: boolean) => {
    setIsUpdatingSettings(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch("/api/whatsapp/settings", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ [key]: value }),
      })

      const data = await response.json()
      if (data.success) {
        setSessionSettings(prev => ({ ...prev, [key]: value }))
        toast({
          title: "Berhasil",
          description: "Pengaturan berhasil diperbarui.",
        })
      } else {
        throw new Error(data.error || "Gagal memperbarui pengaturan")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal memperbarui pengaturan",
        variant: "destructive",
      })
    } finally {
      setIsUpdatingSettings(false)
    }
  }

  // Close QR dialog
  const handleCloseQrDialog = () => {
    setShowQrDialog(false)
    setQrCode("")
    if (qrPolling) {
      clearInterval(qrPolling)
      setQrPolling(null)
    }
    if (statusPolling) {
      clearInterval(statusPolling)
      setStatusPolling(null)
    }
  }

  // Close pair phone dialog
  const handleClosePairPhoneDialog = () => {
    setShowPairPhoneDialog(false)
    setPairPhoneNumber("")
    setLinkingCode("")
    if (statusPolling) {
      clearInterval(statusPolling)
      setStatusPolling(null)
    }
  }

  // Get phone number from JID
  const getPhoneFromJid = (jid?: string) => {
    if (!jid) return "-"
    return jid.split("@")[0].split(":")[0]
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">WhatsApp Device</h1>
          <p className="text-muted-foreground mt-2">
            Kelola koneksi dan pengaturan WhatsApp untuk layanan GovConnect
          </p>
          {lastSyncTime && (
            <p className="text-xs text-muted-foreground mt-1">
              Terakhir sync: {lastSyncTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          onClick={handleSync}
          disabled={isSyncing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Menyinkronkan...' : 'Sync dengan Server'}
        </Button>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Status Koneksi
          </CardTitle>
          <CardDescription>
            Status sesi WhatsApp yang digunakan untuk layanan GovConnect
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Connection Status */}
          <div className="grid gap-4 md:grid-cols-3">
            {/* Connected Status */}
            <div className="flex items-center gap-4 p-4 rounded-lg border bg-card">
              <div className={`p-3 rounded-full ${sessionStatus?.connected ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'}`}>
                {sessionStatus?.connected ? (
                  <Wifi className="h-6 w-6 text-green-600 dark:text-green-400" />
                ) : (
                  <WifiOff className="h-6 w-6 text-red-600 dark:text-red-400" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Koneksi</p>
                <div className="flex items-center gap-2">
                  <Badge variant={sessionStatus?.connected ? "default" : "destructive"}>
                    {sessionStatus?.connected ? "Terhubung" : "Terputus"}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Logged In Status */}
            <div className="flex items-center gap-4 p-4 rounded-lg border bg-card">
              <div className={`p-3 rounded-full ${sessionStatus?.loggedIn ? 'bg-green-100 dark:bg-green-900' : 'bg-yellow-100 dark:bg-yellow-900'}`}>
                {sessionStatus?.loggedIn ? (
                  <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
                ) : (
                  <QrCode className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status Login</p>
                <div className="flex items-center gap-2">
                  <Badge variant={sessionStatus?.loggedIn ? "default" : "secondary"}>
                    {sessionStatus?.loggedIn ? "Logged In" : "Perlu Scan QR"}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Phone Number */}
            <div className="flex items-center gap-4 p-4 rounded-lg border bg-card">
              <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900">
                <Phone className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nomor WhatsApp</p>
                <p className="font-mono font-medium">
                  {sessionStatus?.loggedIn ? getPhoneFromJid(sessionStatus.jid) : "-"}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            {!sessionStatus?.connected ? (
              <Button
                onClick={handleConnect}
                disabled={isConnecting}
              >
                <Zap className="h-4 w-4 mr-2" />
                {isConnecting ? "Menghubungkan..." : "Hubungkan"}
              </Button>
            ) : (
              <>
                {!sessionStatus?.loggedIn && (
                  <>
                    <Button onClick={handleShowQr}>
                      <QrCode className="h-4 w-4 mr-2" />
                      Tampilkan QR Code
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowPairPhoneDialog(true)}
                    >
                      <Phone className="h-4 w-4 mr-2" />
                      Pair via Nomor
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  {isDisconnecting ? "Memutuskan..." : "Putuskan Koneksi"}
                </Button>
                {sessionStatus?.loggedIn && (
                  <Button
                    variant="destructive"
                    onClick={handleLogout}
                    disabled={isDisconnecting}
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Logout WhatsApp
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Warning for not logged in */}
          {sessionStatus?.connected && !sessionStatus?.loggedIn && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-yellow-800 dark:text-yellow-200">
                    Scan QR Code Diperlukan
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                    Sesi terhubung tapi belum login. Silakan scan QR code atau gunakan phone pairing untuk mengaktifkan layanan.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Pengaturan Sesi
          </CardTitle>
          <CardDescription>
            Konfigurasi perilaku sesi WhatsApp
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Auto Read Messages */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <Label htmlFor="auto-read" className="text-base font-medium">
                  Auto Read Messages
                </Label>
                <p className="text-sm text-muted-foreground">
                  Otomatis tandai pesan sebagai sudah dibaca
                </p>
              </div>
            </div>
            <Switch
              id="auto-read"
              checked={sessionSettings.autoReadMessages}
              onCheckedChange={(checked) => handleUpdateSettings("autoReadMessages", checked)}
              disabled={isUpdatingSettings || !sessionStatus?.loggedIn}
            />
          </div>

          <Separator />

          {/* Typing Indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
                <Keyboard className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <Label htmlFor="typing" className="text-base font-medium">
                  Typing Indicator
                </Label>
                <p className="text-sm text-muted-foreground">
                  Tampilkan indikator &quot;sedang mengetik&quot; saat AI membalas
                </p>
              </div>
            </div>
            <Switch
              id="typing"
              checked={sessionSettings.typingIndicator}
              onCheckedChange={(checked) => handleUpdateSettings("typingIndicator", checked)}
              disabled={isUpdatingSettings || !sessionStatus?.loggedIn}
            />
          </div>

          {!sessionStatus?.loggedIn && (
            <div className="bg-muted/50 rounded-lg p-4 text-center text-sm text-muted-foreground">
              Pengaturan hanya dapat diubah setelah sesi WhatsApp login.
            </div>
          )}
        </CardContent>
      </Card>

      {/* QR Code Dialog */}
      <Dialog open={showQrDialog} onOpenChange={handleCloseQrDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Scan QR Code
            </DialogTitle>
            <DialogDescription>
              Buka WhatsApp di ponsel Anda, lalu scan QR code ini untuk login.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center p-4">
            {qrCode ? (
              <div className="bg-white p-4 rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrCode}
                  alt="WhatsApp QR Code"
                  className="w-64 h-64"
                />
              </div>
            ) : (
              <div className="flex items-center justify-center w-64 h-64 border rounded-lg bg-muted">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-4 text-center">
              QR code akan otomatis diperbarui setiap 3 detik.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseQrDialog}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pair Phone Dialog */}
      <Dialog open={showPairPhoneDialog} onOpenChange={handleClosePairPhoneDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Phone Pairing
            </DialogTitle>
            <DialogDescription>
              Masukkan nomor telepon WhatsApp Anda untuk mendapatkan kode pairing.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {!linkingCode ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="phone">Nomor Telepon</Label>
                  <input
                    id="phone"
                    type="tel"
                    value={pairPhoneNumber}
                    onChange={(e) => setPairPhoneNumber(e.target.value)}
                    placeholder="628123456789"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Masukkan dengan kode negara (contoh: 628123456789)
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={handlePairPhone}
                  disabled={isPairingPhone || !pairPhoneNumber}
                >
                  {isPairingPhone ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Memproses...
                    </>
                  ) : (
                    "Dapatkan Kode Pairing"
                  )}
                </Button>
              </>
            ) : (
              <div className="text-center space-y-4">
                <div className="bg-muted rounded-lg p-6">
                  <p className="text-sm text-muted-foreground mb-2">Kode Pairing:</p>
                  <p className="text-3xl font-mono font-bold tracking-widest">
                    {linkingCode}
                  </p>
                </div>
                <div className="text-sm text-muted-foreground">
                  <p>Masukkan kode di atas pada WhatsApp Anda:</p>
                  <ol className="text-left mt-2 space-y-1 list-decimal list-inside">
                    <li>Buka WhatsApp di ponsel</li>
                    <li>Ketuk Menu &gt; Perangkat Tertaut</li>
                    <li>Ketuk &quot;Tautkan Perangkat&quot;</li>
                    <li>Pilih &quot;Tautkan dengan nomor telepon&quot;</li>
                    <li>Masukkan kode di atas</li>
                  </ol>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClosePairPhoneDialog}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
