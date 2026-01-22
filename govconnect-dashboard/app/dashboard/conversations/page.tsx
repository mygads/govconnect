'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Conversation {
  id: string
  session_id: string
  channel_type: 'WHATSAPP' | 'WEBCHAT'
  user_phone?: string
  user_name?: string
  status: string
  created_at: string
  updated_at: string
  _count?: { messages: number }
  messages?: {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    created_at: string
  }[]
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [channelFilter, setChannelFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    fetchConversations()
  }, [channelFilter, page])

  const fetchConversations = async () => {
    setLoading(true)
    const token = localStorage.getItem('token')
    const params = new URLSearchParams()
    if (channelFilter) params.append('channel', channelFilter)
    params.append('page', page.toString())
    params.append('limit', '20')

    const res = await fetch(`/api/village/conversations?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    if (data.success) {
      setConversations(data.data)
      setTotalPages(Math.ceil((data.pagination?.total || 0) / 20))
    }
    setLoading(false)
  }

  const fetchConversationDetail = async (id: string) => {
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/village/conversations/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    if (data.success) {
      setSelectedConversation(data.data)
    }
  }

  const formatDate = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    
    if (hours < 1) return 'Baru saja'
    if (hours < 24) return `${hours} jam lalu`
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
  }

  if (loading && conversations.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Riwayat Percakapan</h1>
        <p className="text-muted-foreground">Lihat riwayat chat AI dengan masyarakat</p>
      </div>

      <div className="flex gap-3">
        <select
          value={channelFilter}
          onChange={(e) => { setChannelFilter(e.target.value); setPage(1) }}
          className="border rounded-lg px-3 py-2"
        >
          <option value="">Semua Channel</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="WEBCHAT">Webchat</option>
        </select>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Conversation List */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-lg border overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Percakapan</h2>
          </div>
          
          {conversations.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Belum ada percakapan
            </div>
          ) : (
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => fetchConversationDetail(conv.id)}
                  className={`w-full p-4 text-left hover:bg-muted/50 transition-colors ${
                    selectedConversation?.id === conv.id ? 'bg-muted/50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium truncate">
                      {conv.user_name || conv.user_phone || 'Anonymous'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(conv.updated_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      conv.channel_type === 'WHATSAPP' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {conv.channel_type === 'WHATSAPP' ? '💬 WA' : '🌐 Web'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {conv._count?.messages || 0} pesan
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-4 border-t flex justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 border rounded text-sm disabled:opacity-50"
              >
                ←
              </button>
              <span className="px-2 py-1 text-sm">{page}/{totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2 py-1 border rounded text-sm disabled:opacity-50"
              >
                →
              </button>
            </div>
          )}
        </div>

        {/* Conversation Detail */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg border overflow-hidden">
          {!selectedConversation ? (
            <div className="flex items-center justify-center h-[600px] text-muted-foreground">
              <div className="text-center">
                <span className="text-4xl mb-4 block">💬</span>
                <p>Pilih percakapan untuk melihat detail</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-4 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">
                      {selectedConversation.user_name || selectedConversation.user_phone || 'Anonymous'}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedConversation.channel_type === 'WHATSAPP' ? 'WhatsApp' : 'Webchat'} • 
                      Session: {selectedConversation.session_id.slice(0, 8)}...
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs ${
                    selectedConversation.status === 'ACTIVE' 
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {selectedConversation.status}
                  </span>
                </div>
              </div>

              {/* Messages */}
              <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto">
                {selectedConversation.messages?.map((msg) => (
                  <div 
                    key={msg.id} 
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] p-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : msg.role === 'system'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-muted'
                    }`}>
                      {msg.role !== 'user' && (
                        <p className="text-xs font-medium mb-1 opacity-70">
                          {msg.role === 'assistant' ? '🤖 AI' : '⚙️ System'}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-xs mt-1 ${
                        msg.role === 'user' ? 'text-blue-200' : 'text-muted-foreground'
                      }`}>
                        {new Date(msg.created_at).toLocaleTimeString('id-ID', { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer Info */}
              <div className="p-4 border-t bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  Dimulai: {new Date(selectedConversation.created_at).toLocaleString('id-ID')} • 
                  Update terakhir: {new Date(selectedConversation.updated_at).toLocaleString('id-ID')}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
