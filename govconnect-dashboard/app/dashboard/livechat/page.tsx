"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Bot,
  Hand,
  ArrowLeft,
  Check,
  CheckCheck,
  Image as ImageIcon,
  ChevronDown,
  Trash2,
  Loader2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react"

interface Conversation {
  id: string
  wa_user_id: string | null
  channel: "WHATSAPP" | "WEBCHAT"
  channel_identifier: string
  user_name: string | null
  user_phone: string | null  // Collected phone number (for webchat)
  last_message: string | null
  last_message_at: string
  unread_count: number
  is_takeover: boolean
  ai_status: string | null // null | "processing" | "error"
  ai_error_message: string | null
  pending_message_id: string | null
}

interface ProcessingStatus {
  stage: 'receiving' | 'reading' | 'searching' | 'thinking' | 'preparing' | 'sending' | 'completed' | 'error'
  message: string
  progress: number
}

interface Message {
  id: string
  message_text: string
  direction: "IN" | "OUT"
  source: string
  timestamp: string
  is_read?: boolean
}

export default function LiveChatPage() {
  const { toast } = useToast()

  // State
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messageInput, setMessageInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"all" | "takeover" | "bot">("all")

  // Loading states - only for initial load
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isInitialMessagesLoading, setIsInitialMessagesLoading] = useState(false)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isTogglingTakeover, setIsTogglingTakeover] = useState(false)

  // Dialog states
  const [showTakeoverDialog, setShowTakeoverDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [takeoverReason, setTakeoverReason] = useState("")
  const [takeoverReasonTemplate, setTakeoverReasonTemplate] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRetryingAI, setIsRetryingAI] = useState(false)

  // Processing status state
  const [processingStatuses, setProcessingStatuses] = useState<Record<string, ProcessingStatus>>({})

  // Takeover reason templates
  const takeoverReasonTemplates = [
    { value: "", label: "Pilih template atau tulis manual..." },
    { value: "Pertanyaan kompleks memerlukan penjelasan detail", label: "Pertanyaan kompleks" },
    { value: "Pengguna membutuhkan bantuan teknis", label: "Bantuan teknis" },
    { value: "Keluhan yang perlu eskalasi manual", label: "Keluhan/Eskalasi" },
    { value: "Verifikasi data pengguna", label: "Verifikasi data" },
    { value: "Transaksi bermasalah memerlukan penanganan khusus", label: "Masalah transaksi" },
    { value: "Pengguna meminta berbicara dengan manusia", label: "Request bicara manusia" },
    { value: "AI tidak dapat menjawab pertanyaan dengan tepat", label: "AI tidak dapat menjawab" },
    { value: "Follow-up dari layanan sebelumnya", label: "Follow-up layanan" },
    { value: "Lainnya", label: "Lainnya (tulis manual)" },
  ]

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const selectedConversationRef = useRef<Conversation | null>(null)
  const previousMessagesLengthRef = useRef<number>(0)

  // Smart scroll state
  const [isUserScrollingUp, setIsUserScrollingUp] = useState(false)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const lastScrollTopRef = useRef<number>(0)
  const isNearBottomRef = useRef<boolean>(true)

  const getConversationKey = (conv?: Conversation | null) =>
    conv?.wa_user_id || conv?.channel_identifier || ""

  const isWebchatConversation = (conv?: Conversation | null) => {
    const key = getConversationKey(conv)
    return conv?.channel === "WEBCHAT" || key.startsWith("web_")
  }

  // Keep ref in sync with state
  useEffect(() => {
    selectedConversationRef.current = selectedConversation
  }, [selectedConversation])

  // Dedupe messages by ID (prevent duplicate display)
  const dedupeMessages = (msgs: Message[]): Message[] => {
    const seen = new Set<string>()
    return msgs.filter(msg => {
      if (seen.has(msg.id)) return false
      seen.add(msg.id)
      return true
    })
  }

  // Check if user is near bottom
  const checkIfNearBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      const threshold = 150 // pixels from bottom
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold
      isNearBottomRef.current = isNearBottom
      return isNearBottom
    }
    return true
  }, [])

  // Scroll to bottom
  const scrollToBottom = useCallback((force = false) => {
    if (messagesContainerRef.current) {
      if (force || isNearBottomRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: force ? "auto" : "smooth" })
        setHasNewMessages(false)
        setNewMessageCount(0)
        setIsUserScrollingUp(false)
      }
    }
  }, [])

  // Handle scroll event to detect user scrolling up
  const handleScroll = useCallback(() => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      const currentScrollTop = container.scrollTop
      const isNearBottom = checkIfNearBottom()

      // User scrolled up
      if (currentScrollTop < lastScrollTopRef.current && !isNearBottom) {
        setIsUserScrollingUp(true)
      }

      // User scrolled to bottom
      if (isNearBottom) {
        setIsUserScrollingUp(false)
        setHasNewMessages(false)
        setNewMessageCount(0)
      }

      lastScrollTopRef.current = currentScrollTop
    }
  }, [checkIfNearBottom])

  // Scroll when messages change (smart behavior)
  useEffect(() => {
    const newMessagesCount = messages.length - previousMessagesLengthRef.current

    if (newMessagesCount > 0 && previousMessagesLengthRef.current > 0) {
      // Only apply smart scroll for incremental updates, not initial load
      if (isUserScrollingUp) {
        // User is scrolling up, show new message indicator
        setHasNewMessages(true)
        setNewMessageCount(prev => prev + newMessagesCount)
      } else {
        // Auto scroll to bottom with slight delay to ensure render
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
        }, 50)
      }
    }

    previousMessagesLengthRef.current = messages.length
  }, [messages, isUserScrollingUp])

  // Reset scroll state when changing conversation
  useEffect(() => {
    setIsUserScrollingUp(false)
    setHasNewMessages(false)
    setNewMessageCount(0)
    isNearBottomRef.current = true
  }, [getConversationKey(selectedConversation)])

  // Fetch processing statuses for all active conversations
  const fetchProcessingStatuses = useCallback(async () => {
    try {
      const token = localStorage.getItem("token")
      const response = await fetch('/api/livechat/processing-status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) return

      const data = await response.json()
      if (data.success && data.data?.statuses) {
        const statusMap: Record<string, ProcessingStatus> = {}
        for (const status of data.data.statuses) {
          statusMap[status.userId] = {
            stage: status.stage,
            message: status.message,
            progress: status.progress,
          }
        }
        setProcessingStatuses(statusMap)
      }
    } catch (error) {
      console.error("Error fetching processing statuses:", error)
    }
  }, [])

  // Fetch conversations silently (no loading state)
  const fetchConversationsSilent = useCallback(async () => {
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/livechat/conversations?status=${activeTab}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) return

      const data = await response.json()
      if (data.success) {
        setConversations(data.data || [])

        // Update selected conversation if it exists in the new data
        if (selectedConversationRef.current) {
          const updated = (data.data || []).find(
            (c: Conversation) => getConversationKey(c) === getConversationKey(selectedConversationRef.current)
          )
          if (updated) {
            setSelectedConversation(updated)
          }
        }
      }
    } catch (error) {
      console.error("Error fetching conversations:", error)
    }
  }, [activeTab])

  // Fetch messages silently (no loading state for polling)
  const fetchMessagesSilent = useCallback(async (conversationKey: string) => {
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/livechat/conversations/${encodeURIComponent(conversationKey)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) return

      const data = await response.json()
      if (data.success) {
        setMessages(dedupeMessages(data.data?.messages || []))
      }
    } catch (error) {
      console.error("Error fetching messages:", error)
    }
  }, [])

  // Fetch messages with loading (for initial selection)
  const fetchMessagesWithLoading = useCallback(async (conversationKey: string) => {
    setIsInitialMessagesLoading(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/livechat/conversations/${encodeURIComponent(conversationKey)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) throw new Error("Gagal mengambil pesan")

      const data = await response.json()
      if (data.success) {
        setMessages(dedupeMessages(data.data?.messages || []))
        previousMessagesLengthRef.current = 0 // Reset so it scrolls

        // Mark as read
        await fetch(`/api/livechat/conversations/${encodeURIComponent(conversationKey)}/read`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        // Refresh conversations to update unread count
        fetchConversationsSilent()

        // Force scroll to bottom on initial load
        setTimeout(() => scrollToBottom(true), 100)
      }
    } catch (error) {
      console.error("Error fetching messages:", error)
    } finally {
      setIsInitialMessagesLoading(false)
    }
  }, [fetchConversationsSilent, scrollToBottom])

  // Initial load
  useEffect(() => {
    const loadData = async () => {
      setIsInitialLoading(true)
      await fetchConversationsSilent()
      setIsInitialLoading(false)
    }
    loadData()
  }, [fetchConversationsSilent])

  // Polling for real-time updates - only when page is visible
  useEffect(() => {
    const startPolling = () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
      pollingRef.current = setInterval(() => {
        fetchConversationsSilent()
        fetchProcessingStatuses()
        if (selectedConversationRef.current) {
          fetchMessagesSilent(getConversationKey(selectedConversationRef.current))
        }
      }, 3000) // Poll every 3 seconds
    }

    const stopPolling = () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Immediately fetch when becoming visible, then start polling
        fetchConversationsSilent()
        fetchProcessingStatuses()
        startPolling()
      } else {
        stopPolling()
      }
    }

    // Start polling only if page is currently visible
    if (document.visibilityState === "visible") {
      startPolling()
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [fetchConversationsSilent, fetchMessagesSilent, fetchProcessingStatuses])

  // Re-fetch when tab changes and close current conversation
  useEffect(() => {
    setSelectedConversation(null)
    setMessages([])
    previousMessagesLengthRef.current = 0
    fetchConversationsSilent()
  }, [activeTab, fetchConversationsSilent])

  // Select conversation
  const handleSelectConversation = async (conv: Conversation) => {
    setSelectedConversation(conv)
    previousMessagesLengthRef.current = 0
    await fetchMessagesWithLoading(getConversationKey(conv))
  }

  // Send message
  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedConversation) return

    const messageToSend = messageInput
    setMessageInput("") // Clear immediately for better UX
    setIsSendingMessage(true)

    try {
      const token = localStorage.getItem("token")
      const response = await fetch(
        `/api/livechat/conversations/${encodeURIComponent(getConversationKey(selectedConversation))}/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: messageToSend }),
        }
      )

      const data = await response.json()
      if (data.success) {
        // Fetch messages to get the new one
        await fetchMessagesSilent(getConversationKey(selectedConversation))
        toast({
          title: "Pesan Terkirim",
          description: "Pesan berhasil dikirim ke pengguna.",
        })
      } else {
        setMessageInput(messageToSend) // Restore on error
        throw new Error(data.error || "Gagal mengirim pesan")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal mengirim pesan",
        variant: "destructive",
      })
    } finally {
      setIsSendingMessage(false)
    }
  }

  // Start takeover
  const handleStartTakeover = async () => {
    if (!selectedConversation) return

    setIsTogglingTakeover(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(
        `/api/livechat/takeover/${encodeURIComponent(getConversationKey(selectedConversation))}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: takeoverReason }),
        }
      )

      const data = await response.json()
      if (data.success) {
        setShowTakeoverDialog(false)
        setTakeoverReason("")
        setTakeoverReasonTemplate("")

        // Update selected conversation immediately
        setSelectedConversation(prev => prev ? { ...prev, is_takeover: true } : null)

        // Refresh conversations
        fetchConversationsSilent()

        toast({
          title: "Ambil Alih Aktif",
          description: "Anda sekarang menangani percakapan ini. AI tidak akan membalas.",
        })
      } else {
        throw new Error(data.error || "Gagal mengambil alih percakapan")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal mengambil alih percakapan",
        variant: "destructive",
      })
    } finally {
      setIsTogglingTakeover(false)
    }
  }

  // End takeover
  const handleEndTakeover = async () => {
    if (!selectedConversation) return

    setIsTogglingTakeover(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(
        `/api/livechat/takeover/${encodeURIComponent(getConversationKey(selectedConversation))}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      const data = await response.json()
      if (data.success) {
        // Update selected conversation immediately
        setSelectedConversation(prev => prev ? { ...prev, is_takeover: false } : null)

        // Refresh conversations
        fetchConversationsSilent()

        toast({
          title: "Ambil Alih Selesai",
          description: "AI Bot akan kembali menangani percakapan ini.",
        })
      } else {
        throw new Error(data.error || "Gagal mengakhiri ambil alih")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal mengakhiri ambil alih",
        variant: "destructive",
      })
    } finally {
      setIsTogglingTakeover(false)
    }
  }

  // Delete conversation history
  const handleDeleteConversation = async () => {
    if (!selectedConversation) return

    setIsDeleting(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(
        `/api/livechat/conversations/${encodeURIComponent(getConversationKey(selectedConversation))}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      const data = await response.json()
      if (data.success) {
        setShowDeleteDialog(false)
        setSelectedConversation(null)
        setMessages([])

        // Refresh conversations list
        fetchConversationsSilent()

        toast({
          title: "Riwayat Dihapus",
          description: "Riwayat chat berhasil dihapus.",
        })
      } else {
        throw new Error(data.error || "Gagal menghapus riwayat")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal menghapus riwayat",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  // Retry AI processing
  const handleRetryAI = async (conversationKey: string) => {
    setIsRetryingAI(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(
        `/api/livechat/conversations/${encodeURIComponent(conversationKey)}/retry`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      const data = await response.json()
      if (data.success) {
        toast({
          title: "Proses Ulang AI",
          description: "Pesan sedang diproses ulang oleh AI.",
        })

        // Refresh conversations to update status
        fetchConversationsSilent()
      } else {
        throw new Error(data.error || "Gagal memproses ulang")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal memproses ulang AI",
        variant: "destructive",
      })
    } finally {
      setIsRetryingAI(false)
    }
  }

  // Filter conversations by search
  const filteredConversations = conversations.filter((conv) => {
    const searchLower = searchQuery.toLowerCase()
    const key = getConversationKey(conv).toLowerCase()
    return (
      key.includes(searchLower) ||
      conv.user_name?.toLowerCase().includes(searchLower) ||
      conv.last_message?.toLowerCase().includes(searchLower)
    )
  })

  // Format timestamp
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
      return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    }
    return date.toLocaleDateString("id-ID", { day: "numeric", month: "short" })
  }

  // Get initials for avatar
  const getInitials = (name: string | null, phone: string) => {
    if (name) {
      return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    }
    return phone ? phone.slice(-2) : "??"
  }

  // Get display name for conversation (prioritize collected name over session ID)
  const getDisplayName = (conv: Conversation) => {
    // For webchat: use collected name if available, otherwise use session ID
    // For WA: use collected name > WA push name > phone number
    if (conv.user_name) {
      return conv.user_name
    }
    // If no name, show channel identifier (phone for WA, session ID for webchat)
    return getConversationKey(conv)
  }

  // Format phone number for display (add leading +)
  const formatPhoneDisplay = (phone: string | null) => {
    if (!phone) return null
    // Remove non-digits
    const cleaned = phone.replace(/\D/g, '')
    // Format with +
    if (cleaned.startsWith('62')) {
      return `+${cleaned}`
    }
    if (cleaned.startsWith('08')) {
      return `+62${cleaned.substring(1)}`
    }
    return cleaned
  }

  // Check if message contains image URL
  const isImageUrl = (text: string) => {
    return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(text) ||
      text.includes('/uploads/') ||
      text.startsWith('http') && (text.includes('image') || text.includes('/media/'))
  }

  // Extract image URL from message
  const extractImageUrl = (text: string) => {
    // Check if it's a direct image URL
    if (isImageUrl(text)) {
      return text.trim()
    }

    // Try to find URL in text
    const urlMatch = text.match(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?)/i)
    if (urlMatch) {
      return urlMatch[1]
    }

    return null
  }

  // Render message content (handle images)
  const renderMessageContent = (msg: Message) => {
    const imageUrl = extractImageUrl(msg.message_text)

    if (imageUrl) {
      // Get caption (text without the URL)
      const caption = msg.message_text.replace(imageUrl, '').trim()

      return (
        <div className="space-y-2">
          <div className="relative rounded-lg overflow-hidden max-w-[280px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Media"
              className="w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => window.open(imageUrl, '_blank')}
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.parentElement!.innerHTML = `
                  <div class="flex items-center gap-2 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <svg class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span class="text-sm">Gambar tidak dapat dimuat</span>
                  </div>
                `
              }}
            />
          </div>
          {caption && (
            <p className="text-sm whitespace-pre-wrap wrap-break-word">{caption}</p>
          )}
        </div>
      )
    }

    // Check if message mentions it has an image but URL not directly visible
    if (msg.message_text.includes('[Gambar]') || msg.message_text.includes('[Image]')) {
      return (
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4" />
          <p className="text-sm whitespace-pre-wrap wrap-break-word">{msg.message_text}</p>
        </div>
      )
    }

    return (
      <p className="text-sm whitespace-pre-wrap wrap-break-word">{msg.message_text}</p>
    )
  }

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Main Content - Full Height WhatsApp Web Style */}
      <div className="flex-1 flex border rounded-lg overflow-hidden bg-card">
        {/* Left Panel - Conversation List */}
        <div className={`w-full md:w-96 border-r flex flex-col ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
          {/* Tabs */}
          <div className="p-3 border-b shrink-0">
            <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as any)}>
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1 text-xs">
                  Semua
                </TabsTrigger>
                <TabsTrigger value="takeover" className="flex-1 text-xs">
                  <Hand className="h-3 w-3 mr-1" />
                  Ambil Alih
                </TabsTrigger>
                <TabsTrigger value="bot" className="flex-1 text-xs">
                  <Bot className="h-3 w-3 mr-1" />
                  AI Bot
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Search */}
          <div className="p-3 border-b shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari percakapan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9"
              />
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Tidak ada percakapan</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredConversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv)}
                    className={`w-full p-3 text-left hover:bg-accent transition-colors ${selectedConversation?.id === conv.id ? "bg-accent" : ""
                      }`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback className={`text-xs ${conv.is_takeover ? "bg-orange-500 text-white" : "bg-green-500 text-white"}`}>
                          {getInitials(conv.user_name, getConversationKey(conv))}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">
                              {getDisplayName(conv)}
                            </p>
                            {/* Show phone number for webchat users if available */}
                            {isWebchatConversation(conv) && conv.user_phone && (
                              <span className="text-xs text-muted-foreground shrink-0">
                                {formatPhoneDisplay(conv.user_phone)}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 ml-2">
                            {formatTime(conv.last_message_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-muted-foreground truncate pr-2">
                            {conv.last_message || "Tidak ada pesan"}
                          </p>
                          {conv.unread_count > 0 && (
                            <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center text-xs shrink-0">
                              {conv.unread_count}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          {/* Channel Badge */}
                          {isWebchatConversation(conv) ? (
                            <Badge variant="outline" className="text-purple-600 border-purple-300 text-xs py-0">
                              <MessageCircle className="h-3 w-3 mr-1" />
                              Webchat
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs py-0">
                              <MessageCircle className="h-3 w-3 mr-1" />
                              WhatsApp
                            </Badge>
                          )}
                          {/* Status Badge */}
                          {conv.is_takeover ? (
                            <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs py-0">
                              <Hand className="h-3 w-3 mr-1" />
                              Ambil Alih
                            </Badge>
                          ) : processingStatuses[getConversationKey(conv)] && processingStatuses[getConversationKey(conv)].stage !== 'completed' && processingStatuses[getConversationKey(conv)].stage !== 'error' ? (
                            <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs py-0 animate-pulse">
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              {processingStatuses[getConversationKey(conv)].message}
                            </Badge>
                          ) : conv.ai_status === 'processing' ? (
                            <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs py-0 animate-pulse">
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              AI Memproses...
                            </Badge>
                          ) : conv.ai_status === 'error' || processingStatuses[getConversationKey(conv)]?.stage === 'error' ? (
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-red-600 border-red-300 text-xs py-0">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                AI Error
                              </Badge>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleRetryAI(getConversationKey(conv))
                                }}
                                disabled={isRetryingAI}
                                className="inline-flex items-center text-xs text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50"
                              >
                                <RotateCcw className={`h-3 w-3 mr-0.5 ${isRetryingAI ? 'animate-spin' : ''}`} />
                                Retry
                              </button>
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-green-600 border-green-300 text-xs py-0">
                              <Bot className="h-3 w-3 mr-1" />
                              AI Bot
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Chat View */}
        <div className={`flex-1 flex flex-col ${!selectedConversation ? 'hidden md:flex' : 'flex'}`}>
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <div className="p-3 border-b flex items-center justify-between bg-card shrink-0">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden h-8 w-8"
                    onClick={() => setSelectedConversation(null)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className={`text-xs ${selectedConversation.is_takeover ? "bg-orange-500 text-white" : "bg-green-500 text-white"}`}>
                      {getInitials(selectedConversation.user_name, getConversationKey(selectedConversation))}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">
                        {getDisplayName(selectedConversation)}
                      </p>
                      {/* Show phone for webchat users */}
                      {isWebchatConversation(selectedConversation) && selectedConversation.user_phone && (
                        <span className="text-xs text-muted-foreground">
                          {formatPhoneDisplay(selectedConversation.user_phone)}
                        </span>
                      )}
                      {isWebchatConversation(selectedConversation) && (
                        <Badge variant="outline" className="text-purple-600 border-purple-300 text-xs py-0">
                          Webchat
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isWebchatConversation(selectedConversation) 
                        ? `Session: ${selectedConversation.channel_identifier.substring(4, 16)}...`
                        : getConversationKey(selectedConversation)
                      }
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Delete History Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowDeleteDialog(true)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Hapus riwayat chat"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>

                  {selectedConversation.is_takeover ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleEndTakeover}
                      disabled={isTogglingTakeover}
                    >
                      <Bot className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">Kembalikan ke AI</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => setShowTakeoverDialog(true)}
                      disabled={isTogglingTakeover}
                    >
                      <Hand className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">Ambil Alih</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Messages Container - Fixed Height with Scroll */}
              <div className="relative flex-1">
                <div
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                  className="absolute inset-0 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900"
                >
                  {isInitialMessagesLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <MessageCircle className="h-12 w-12 mb-2 opacity-50" />
                      <p>Tidak ada pesan</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.direction === "OUT" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[75%] rounded-lg p-3 shadow-sm ${msg.direction === "OUT"
                                ? "bg-green-500 text-white"
                                : "bg-white dark:bg-gray-800 border"
                              }`}
                          >
                            {renderMessageContent(msg)}
                            <div className={`flex items-center gap-1 mt-1.5 text-xs ${msg.direction === "OUT" ? "text-green-100" : "text-muted-foreground"
                              }`}>
                              <span>{formatTime(msg.timestamp)}</span>
                              {msg.direction === "OUT" && (
                                <>
                                  <span className="mx-0.5">•</span>
                                  <span className="capitalize text-[10px]">
                                    {msg.source === 'ADMIN' ? 'Admin' : msg.source === 'AI' ? 'AI' : 'Sistem'}
                                  </span>
                                  {/* Read status indicator */}
                                  {msg.is_read !== false ? (
                                    <CheckCheck className="h-3.5 w-3.5 ml-1 text-blue-300" />
                                  ) : (
                                    <Check className="h-3.5 w-3.5 ml-1" />
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                {/* New Message Indicator Button */}
                {hasNewMessages && (
                  <button
                    onClick={() => scrollToBottom(true)}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-all animate-bounce z-10"
                  >
                    <ChevronDown className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      {newMessageCount} Pesan Baru
                    </span>
                  </button>
                )}
              </div>

              {/* AI Processing Status Indicator */}
              {selectedConversation && processingStatuses[getConversationKey(selectedConversation)] &&
                processingStatuses[getConversationKey(selectedConversation)].stage !== 'completed' &&
                processingStatuses[getConversationKey(selectedConversation)].stage !== 'error' && (
                  <div className="px-3 py-2 border-t bg-blue-50 dark:bg-blue-950 shrink-0">
                    <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm font-medium">
                        {processingStatuses[getConversationKey(selectedConversation)].message}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${processingStatuses[getConversationKey(selectedConversation)].progress}%` }}
                      />
                    </div>
                  </div>
                )}

              {/* Message Input - Fixed at Bottom */}
              <div className="p-3 border-t bg-card shrink-0">
                {selectedConversation.is_takeover ? (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ketik pesan..."
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          handleSendMessage()
                        }
                      }}
                      disabled={isSendingMessage}
                      className="h-10"
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={isSendingMessage || !messageInput.trim()}
                      className="h-10 px-4"
                    >
                      {isSendingMessage ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-2 bg-muted/50 rounded-lg">
                    <Bot className="h-5 w-5 mx-auto mb-1" />
                    <p className="text-sm">AI Bot sedang menangani percakapan ini.</p>
                    <p className="text-xs">Klik "Ambil Alih" untuk mengambil alih.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center text-muted-foreground">
                <MessageCircle className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium">Pilih Percakapan</h3>
                <p className="text-sm mt-1">
                  Pilih percakapan dari daftar di sebelah kiri untuk mulai membalas.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Takeover Confirmation Dialog */}
      <Dialog open={showTakeoverDialog} onOpenChange={setShowTakeoverDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ambil Alih Percakapan</DialogTitle>
            <DialogDescription>
              Dengan mengambil alih percakapan ini, AI Bot tidak akan membalas pesan dari pengguna ini hingga Anda mengakhiri ambil alih.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-sm font-medium">Template Alasan</label>
              <Select
                value={takeoverReasonTemplate}
                onValueChange={(value: string) => {
                  setTakeoverReasonTemplate(value)
                  if (value && value !== "Lainnya") {
                    setTakeoverReason(value)
                  } else if (value === "Lainnya") {
                    setTakeoverReason("")
                  }
                }}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Pilih template alasan..." />
                </SelectTrigger>
                <SelectContent>
                  {takeoverReasonTemplates.map((template) => (
                    <SelectItem key={template.value || "empty"} value={template.value || "empty"}>
                      {template.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">
                Alasan {takeoverReasonTemplate === "Lainnya" ? "(wajib)" : "(bisa diedit)"}
              </label>
              <Input
                placeholder="Tulis alasan ambil alih..."
                value={takeoverReason}
                onChange={(e) => setTakeoverReason(e.target.value)}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowTakeoverDialog(false)
              setTakeoverReason("")
              setTakeoverReasonTemplate("")
            }}>
              Batal
            </Button>
            <Button
              onClick={handleStartTakeover}
              disabled={isTogglingTakeover || (takeoverReasonTemplate === "Lainnya" && !takeoverReason.trim())}
            >
              {isTogglingTakeover ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Memproses...
                </>
              ) : (
                <>
                  <Hand className="h-4 w-4 mr-2" />
                  Ambil Alih
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Riwayat Chat</DialogTitle>
            <DialogDescription>
              Apakah Anda yakin ingin menghapus semua riwayat chat dengan pengguna ini? Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Pengguna: <span className="font-medium text-foreground">{selectedConversation?.user_name || getConversationKey(selectedConversation)}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConversation}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Menghapus...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Hapus Riwayat
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
