"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { 
  Smartphone, RefreshCw, Trash2, QrCode, CheckCircle2, 
  AlertCircle, Loader2, WifiOff, Wifi, Power
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

type WhatsappStatusData = {
  connected: boolean;
  loggedIn: boolean;
  jid?: string;
  qrcode?: string;
  wa_number?: string | null;
  name?: string;
  events?: string;
  webhook?: string;
};

export default function WhatsAppSessionPage() {
  const [status, setStatus] = useState<WhatsappStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // QR Modal state
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<string>("Generating QR...");
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const clearMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const fetchStatus = useCallback(async () => {
    try {
      clearMessages();
      const response = await fetch("/api/whatsapp/status", { cache: "no-store" });
      const result: any = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          // Session not created yet
          setStatus(null);
          return;
        }
        throw new Error(result.error || result.message || "Gagal mengambil status WhatsApp");
      }

      if (result?.success === false) {
        throw new Error(result.error || result.message || "Gagal mengambil status WhatsApp");
      }

      setStatus((result?.data as WhatsappStatusData) || null);
    } catch (e: any) {
      console.error("[WHATSAPP_SESSION_FETCH]", e);
      setError(e.message || "Gagal mengambil status WhatsApp");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await fetchStatus();
      setIsLoading(false);
    })();
  }, [fetchStatus]);

  const createSession = async () => {
    setIsCreating(true);
    clearMessages();
    
    try {
      const response = await fetch("/api/whatsapp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const result: any = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || "Gagal membuat sesi WhatsApp");
      }

      if (result?.success === false) {
        throw new Error(result.error || result.message || "Gagal membuat sesi WhatsApp");
      }

      await fetchStatus();
      const existing = Boolean(result?.data?.existing);
      setSuccess(existing ? "Sesi WhatsApp sudah ada." : "Sesi WhatsApp berhasil dibuat. Silakan koneksikan WhatsApp." );
    } catch (e: any) {
      console.error("[WHATSAPP_SESSION_CREATE]", e);
      setError(e.message || "Gagal membuat sesi WhatsApp");
    } finally {
      setIsCreating(false);
    }
  };

  const deleteSession = async () => {
    const confirmed = window.confirm(
      "Hapus sesi WhatsApp? Anda perlu scan QR lagi untuk konek."
    );
    if (!confirmed) return;

    setIsDeleting(true);
    clearMessages();

    try {
      const response = await fetch("/api/whatsapp/session", {
        method: "DELETE",
      });

      const result: any = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.message || "Gagal menghapus sesi");
      }

      if (result?.success === false) {
        throw new Error(result.error || result.message || "Gagal menghapus sesi");
      }

      setStatus(null);
      setSuccess("Sesi WhatsApp berhasil dihapus");
    } catch (e: any) {
      console.error("[WHATSAPP_SESSION_DELETE]", e);
      setError(e.message || "Gagal menghapus sesi");
    } finally {
      setIsDeleting(false);
    }
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const startPollingStatus = async () => {
    stopPolling(); // Clear any existing interval

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch("/api/whatsapp/status", { cache: "no-store" });
        const result: any = await response.json();

        if (response.ok && result?.success !== false && result?.data) {
          const { connected, loggedIn, jid } = result.data as WhatsappStatusData;

          if (connected && loggedIn && jid) {
            // Successfully connected!
            setQrStatus("✓ Connected! WhatsApp is now active.");
            await fetchStatus(); // Refresh status data
            
            // Auto close modal after 2 seconds
            setTimeout(() => {
              stopPolling();
              setShowQrModal(false);
              setSuccess("WhatsApp berhasil terhubung!");
            }, 2000);
          } else if (connected && !loggedIn) {
            setQrStatus("Waiting for QR scan...");
          } else {
            setQrStatus("Connecting...");
          }
        }
      } catch (e) {
        console.error("[POLLING_STATUS]", e);
      }
    }, 3000); // Poll every 3 seconds
  };

  const connectSession = async () => {
    if (!status) return;

    setIsConnecting(true);
    clearMessages();
    setShowQrModal(true);
    setQrCode(null);
    setQrStatus("Connecting to WhatsApp...");

    try {
      // Step 1: Connect session
      const connectResponse = await fetch("/api/whatsapp/connect", {
        method: "POST",
      });

      const connectResult: any = await connectResponse.json();

      if (!connectResponse.ok) {
        throw new Error(connectResult.error || connectResult.message || "Gagal menghubungkan sesi");
      }

      if (connectResult?.success === false) {
        throw new Error(connectResult.error || connectResult.message || "Gagal menghubungkan sesi");
      }

      // Step 2: Get QR code
      setQrStatus("Generating QR code...");
      
      const qrResponse = await fetch("/api/whatsapp/qr", { cache: "no-store" });
      const qrResult: any = await qrResponse.json();

      if (!qrResponse.ok) {
        throw new Error(qrResult.error || qrResult.message || "Gagal mengambil QR code");
      }

      if (qrResult?.success === false) {
        throw new Error(qrResult.error || qrResult.message || "Gagal mengambil QR code");
      }

      if (qrResult.data?.alreadyLoggedIn) {
        setQrStatus("✓ Already connected!");
        await fetchStatus();
        setTimeout(() => {
          setShowQrModal(false);
          setSuccess("WhatsApp sudah terhubung!");
        }, 1500);
        return;
      }

      if (qrResult.data?.QRCode) {
        setQrCode(qrResult.data.QRCode);
        setQrStatus("Scan QR code with WhatsApp mobile app");
        
        // Start polling for connection status
        await startPollingStatus();
      } else {
        throw new Error("No QR code received");
      }
    } catch (e: any) {
      console.error("[WHATSAPP_SESSION_CONNECT]", e);
      setError(e.message || "Gagal menghubungkan sesi");
      setShowQrModal(false);
      stopPolling();
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectSessionNow = async () => {
    if (!status) return;
    setIsDisconnecting(true);
    clearMessages();
    try {
      const response = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
      const result: any = await response.json();
      if (!response.ok || result?.success === false) {
        throw new Error(result.error || result.message || 'Gagal memutuskan koneksi');
      }
      await fetchStatus();
      setSuccess('WhatsApp berhasil diputuskan');
    } catch (e: any) {
      console.error('[WHATSAPP_SESSION_DISCONNECT]', e);
      setError(e.message || 'Gagal memutuskan koneksi');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const logoutSessionNow = async () => {
    if (!status) return;
    const confirmed = window.confirm('Logout WhatsApp? Anda perlu scan QR lagi untuk konek.');
    if (!confirmed) return;

    setIsLoggingOut(true);
    clearMessages();
    try {
      const response = await fetch('/api/whatsapp/logout', { method: 'POST' });
      const result: any = await response.json();
      if (!response.ok || result?.success === false) {
        throw new Error(result.error || result.message || 'Gagal logout WhatsApp');
      }
      await fetchStatus();
      setSuccess('WhatsApp berhasil logout. Silakan konek ulang.');
    } catch (e: any) {
      console.error('[WHATSAPP_SESSION_LOGOUT]', e);
      setError(e.message || 'Gagal logout WhatsApp');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleModalClose = () => {
    stopPolling();
    setShowQrModal(false);
    setQrCode(null);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="rounded-lg bg-green-500/10 p-2 text-green-600">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Sesi WhatsApp</h1>
            <p className="text-sm text-muted-foreground">
              Kelola koneksi WhatsApp untuk GovConnect
            </p>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mb-4 border-green-500 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {!status ? (
        <Card>
          <CardHeader>
            <CardTitle>Belum Ada Sesi WhatsApp</CardTitle>
            <CardDescription>
              Buat sesi WhatsApp untuk mulai menerima dan membalas pesan melalui GovConnect.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={createSession} disabled={isCreating} size="lg" className="w-full sm:w-auto">
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Power className="mr-2 h-4 w-4" />
                  Buat Sesi WhatsApp
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    WhatsApp
                    {status.connected && status.loggedIn ? (
                      <Badge className="bg-green-500 hover:bg-green-600">
                        <Wifi className="mr-1 h-3 w-3" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <WifiOff className="mr-1 h-3 w-3" />
                        Disconnected
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>Satu sesi per desa</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <p className="font-medium capitalize">{status.connected ? "connected" : "disconnected"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Connected:</span>
                    <p className="font-medium">{status.connected ? "Ya" : "Tidak"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Logged In:</span>
                    <p className="font-medium">{status.loggedIn ? "Ya" : "Tidak"}</p>
                  </div>
                  {(status.wa_number || status.jid) && (
                    <div>
                      <span className="text-muted-foreground">Phone Number:</span>
                      <p className="font-medium font-mono text-xs">
                        {(status.wa_number || status.jid || "").toString().split("@")[0]}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-4 border-t">
                  {!status.connected || !status.loggedIn ? (
                    <Button onClick={connectSession} disabled={isConnecting} size="lg">
                      {isConnecting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <QrCode className="mr-2 h-4 w-4" />
                          Konek WhatsApp
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button onClick={fetchStatus} size="lg" variant="outline">
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh Status
                    </Button>
                  )}

                  <Button onClick={disconnectSessionNow} disabled={isDisconnecting} size="lg" variant="outline">
                    {isDisconnecting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      <>
                        <WifiOff className="mr-2 h-4 w-4" />
                        Disconnect
                      </>
                    )}
                  </Button>

                  <Button onClick={logoutSessionNow} disabled={isLoggingOut} size="lg" variant="outline">
                    {isLoggingOut ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Logging out...
                      </>
                    ) : (
                      <>
                        <Power className="mr-2 h-4 w-4" />
                        Logout
                      </>
                    )}
                  </Button>

                  <Button onClick={deleteSession} disabled={isDeleting} size="lg" variant="destructive">
                    {isDeleting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 className="mr-2 h-4 w-4" />
                          Hapus Sesi
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Informasi</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <p>• Satu sesi WhatsApp per desa</p>
              <p>• Pesan masuk/keluar diproses sesuai desa</p>
              <p>• QR harus discan dari aplikasi WhatsApp di HP</p>
              <p>• Status koneksi akan diperbarui otomatis</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* QR Code Modal */}
      <Dialog open={showQrModal} onOpenChange={handleModalClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Konek WhatsApp</DialogTitle>
            <DialogDescription>{qrStatus}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center space-y-4 py-4">
            {qrCode ? (
              <>
                <div className="relative border-4 border-primary/20 rounded-lg p-2 bg-white">
                  <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
                </div>
                <p className="text-sm text-center text-muted-foreground max-w-xs">
                  Buka WhatsApp di HP → Perangkat Tertaut → Tautkan Perangkat → Scan QR ini
                </p>
              </>
            ) : (
              <div className="w-64 h-64 flex items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
