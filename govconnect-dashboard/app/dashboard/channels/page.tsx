'use client'

import { useEffect, useState } from 'react'

interface ChannelSettings {
  id: string
  channel_type: 'WHATSAPP' | 'WEBCHAT'
  is_enabled: boolean
  phone_number?: string
  webhook_url?: string
  api_key?: string
  welcome_message?: string
  fallback_message?: string
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelSettings[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingChannel, setEditingChannel] = useState<ChannelSettings | null>(null)

  useEffect(() => {
    fetchChannels()
  }, [])

  const fetchChannels = async () => {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/village/channels', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    if (data.success) {
      setChannels(data.data)
    }
    setLoading(false)
  }

  const handleToggle = async (channel: ChannelSettings) => {
    const token = localStorage.getItem('token')
    await fetch(`/api/village/channels/${channel.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: !channel.is_enabled })
    })
    fetchChannels()
  }

  const handleSave = async () => {
    if (!editingChannel) return
    setSaving(true)
    const token = localStorage.getItem('token')
    
    const res = await fetch(`/api/village/channels/${editingChannel.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(editingChannel)
    })
    
    if ((await res.json()).success) {
      setEditingChannel(null)
      fetchChannels()
    }
    setSaving(false)
  }

  const handleCreateChannel = async (type: 'WHATSAPP' | 'WEBCHAT') => {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/village/channels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_type: type,
        is_enabled: false,
        welcome_message: type === 'WHATSAPP' 
          ? 'Halo! Selamat datang di layanan WhatsApp Desa kami. Silakan ketik pertanyaan Anda atau pilih menu di bawah.'
          : 'Halo! Ada yang bisa kami bantu?',
        fallback_message: 'Maaf, saya tidak mengerti pertanyaan Anda. Silakan hubungi kantor desa untuk informasi lebih lanjut.'
      })
    })
    if ((await res.json()).success) {
      fetchChannels()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const whatsappChannel = channels.find(c => c.channel_type === 'WHATSAPP')
  const webchatChannel = channels.find(c => c.channel_type === 'WEBCHAT')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Channel Integration</h1>
        <p className="text-muted-foreground">Kelola integrasi WhatsApp dan Webchat</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* WhatsApp Channel */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">💬</span>
              <div>
                <h2 className="font-semibold">WhatsApp Business</h2>
                <p className="text-sm text-muted-foreground">Layanan chatbot via WhatsApp</p>
              </div>
            </div>
            {whatsappChannel ? (
              <button
                onClick={() => handleToggle(whatsappChannel)}
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  whatsappChannel.is_enabled 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {whatsappChannel.is_enabled ? 'Aktif' : 'Nonaktif'}
              </button>
            ) : null}
          </div>

          {!whatsappChannel ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">WhatsApp belum dikonfigurasi</p>
              <button
                onClick={() => handleCreateChannel('WHATSAPP')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Aktifkan WhatsApp
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nomor WhatsApp</label>
                <p className="text-muted-foreground">{whatsappChannel.phone_number || 'Belum diatur'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Status Webhook</label>
                <p className={`text-sm ${whatsappChannel.webhook_url ? 'text-green-600' : 'text-yellow-600'}`}>
                  {whatsappChannel.webhook_url ? '✓ Terhubung' : '⚠ Belum dikonfigurasi'}
                </p>
              </div>
              <button
                onClick={() => setEditingChannel(whatsappChannel)}
                className="text-sm text-blue-600 hover:underline"
              >
                Konfigurasi →
              </button>
            </div>
          )}
        </div>

        {/* Webchat Channel */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🌐</span>
              <div>
                <h2 className="font-semibold">Webchat Widget</h2>
                <p className="text-sm text-muted-foreground">Chat widget untuk website</p>
              </div>
            </div>
            {webchatChannel ? (
              <button
                onClick={() => handleToggle(webchatChannel)}
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  webchatChannel.is_enabled 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {webchatChannel.is_enabled ? 'Aktif' : 'Nonaktif'}
              </button>
            ) : null}
          </div>

          {!webchatChannel ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">Webchat belum dikonfigurasi</p>
              <button
                onClick={() => handleCreateChannel('WEBCHAT')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Aktifkan Webchat
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">API Key</label>
                <p className="font-mono text-sm text-muted-foreground">
                  {webchatChannel.api_key ? `${webchatChannel.api_key.slice(0, 8)}...` : 'Belum diatur'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Embed Code</label>
                <p className="text-sm text-muted-foreground">Tersedia setelah konfigurasi</p>
              </div>
              <button
                onClick={() => setEditingChannel(webchatChannel)}
                className="text-sm text-blue-600 hover:underline"
              >
                Konfigurasi →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Configuration Modal */}
      {editingChannel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              Konfigurasi {editingChannel.channel_type === 'WHATSAPP' ? 'WhatsApp' : 'Webchat'}
            </h3>
            
            <div className="space-y-4">
              {editingChannel.channel_type === 'WHATSAPP' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Nomor WhatsApp</label>
                    <input
                      type="tel"
                      value={editingChannel.phone_number || ''}
                      onChange={(e) => setEditingChannel(c => c ? { ...c, phone_number: e.target.value } : null)}
                      className="w-full border rounded-lg p-2"
                      placeholder="628123456789"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Format: 628xxxxxxxxxx (tanpa +)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Webhook URL</label>
                    <input
                      type="url"
                      value={editingChannel.webhook_url || ''}
                      onChange={(e) => setEditingChannel(c => c ? { ...c, webhook_url: e.target.value } : null)}
                      className="w-full border rounded-lg p-2"
                      placeholder="https://..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">API Key</label>
                    <input
                      type="password"
                      value={editingChannel.api_key || ''}
                      onChange={(e) => setEditingChannel(c => c ? { ...c, api_key: e.target.value } : null)}
                      className="w-full border rounded-lg p-2"
                      placeholder="API Key dari provider"
                    />
                  </div>
                </>
              )}

              {editingChannel.channel_type === 'WEBCHAT' && (
                <div>
                  <label className="block text-sm font-medium mb-1">API Key</label>
                  <input
                    type="text"
                    value={editingChannel.api_key || ''}
                    onChange={(e) => setEditingChannel(c => c ? { ...c, api_key: e.target.value } : null)}
                    className="w-full border rounded-lg p-2 font-mono"
                    placeholder="Generate otomatis jika kosong"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Pesan Selamat Datang</label>
                <textarea
                  value={editingChannel.welcome_message || ''}
                  onChange={(e) => setEditingChannel(c => c ? { ...c, welcome_message: e.target.value } : null)}
                  className="w-full border rounded-lg p-2"
                  rows={3}
                  placeholder="Pesan yang ditampilkan saat user pertama kali memulai chat..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Pesan Fallback</label>
                <textarea
                  value={editingChannel.fallback_message || ''}
                  onChange={(e) => setEditingChannel(c => c ? { ...c, fallback_message: e.target.value } : null)}
                  className="w-full border rounded-lg p-2"
                  rows={3}
                  placeholder="Pesan jika AI tidak dapat menjawab pertanyaan..."
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_enabled"
                  checked={editingChannel.is_enabled}
                  onChange={(e) => setEditingChannel(c => c ? { ...c, is_enabled: e.target.checked } : null)}
                  className="rounded"
                />
                <label htmlFor="is_enabled" className="text-sm">Aktifkan channel ini</label>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingChannel(null)}
                className="flex-1 py-2 border rounded-lg hover:bg-muted/50"
              >
                Batal
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Webchat Embed Code */}
      {webchatChannel?.is_enabled && webchatChannel?.api_key && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <h3 className="font-semibold mb-4">Embed Code Webchat</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Salin kode berikut dan taruh di website Anda sebelum tag &lt;/body&gt;:
          </p>
          <pre className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg overflow-x-auto text-sm">
{`<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/widget/chat.js"></script>
<script>
  GovConnectChat.init({
    apiKey: '${webchatChannel.api_key}',
    position: 'bottom-right'
  });
</script>`}
          </pre>
          <button
            onClick={() => {
              const code = `<script src="${window.location.origin}/widget/chat.js"></script>\n<script>\n  GovConnectChat.init({\n    apiKey: '${webchatChannel.api_key}',\n    position: 'bottom-right'\n  });\n</script>`
              navigator.clipboard.writeText(code)
              alert('Kode berhasil disalin!')
            }}
            className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            Salin Kode
          </button>
        </div>
      )}
    </div>
  )
}
