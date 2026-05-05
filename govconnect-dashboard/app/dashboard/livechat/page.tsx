"use client"

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  Paperclip,
  X,
  FileText,
  Video,
  Volume2,
  Reply,
  MapPin,
  UserRound,
  ListChecks,
  Pencil,
  Smile,
  BarChart3,
  Sticker,
  SmilePlus,
  Clock3,
} from "lucide-react"

interface Conversation {
  id: string
  wa_user_id: string | null
  channel: "WHATSAPP" | "WEBCHAT"
  channel_identifier: string
  user_name: string | null
  user_phone: string | null  // Collected phone number (for webchat)
  profile_name?: string | null
  profile_avatar_url?: string | null
  profile_is_whatsapp?: boolean | null
  profile_synced_at?: string | null
  last_message: string | null
  last_message_at: string
  unread_count: number
  is_takeover: boolean
  ai_status: string | null // null | "processing" | "error"
  ai_error_message: string | null
  pending_message_id: string | null
}

interface TakeoverSession {
  admin_id: string
  admin_name: string | null
  started_at: string
  reason?: string | null
}

interface ProcessingStatus {
  stage: 'receiving' | 'reading' | 'searching' | 'thinking' | 'preparing' | 'sending' | 'completed' | 'error'
  message: string
  progress: number
  elapsedMs?: number
  lastUpdate?: number
}

type WaSessionStatus = 'connected' | 'qr' | 'logged_out' | 'disconnected' | 'error' | 'replaced'

type LivechatMediaType = 'image' | 'audio' | 'document' | 'video' | 'sticker'
type DeliveryStatus = 'received' | 'sent' | 'delivered' | 'read' | 'failed'
type MessageKind = 'text' | 'media' | 'location' | 'contact' | 'buttons' | 'list' | 'sticker' | 'poll' | 'reaction' | 'edit' | 'delete' | 'system'

interface Message {
  id: string
  message_id?: string
  message_text: string
  media_type?: LivechatMediaType | null
  media_url?: string | null
  media_public_url?: string | null
  mime_type?: string | null
  file_name?: string | null
  file_size?: number | null
  storage_key?: string | null
  message_kind?: MessageKind | null
  quoted_message_id?: string | null
  quoted_stanza_id?: string | null
  quoted_participant?: string | null
  quoted_text?: string | null
  location_latitude?: number | null
  location_longitude?: number | null
  location_name?: string | null
  location_address?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  contact_vcard?: string | null
  interactive_payload?: any
  direction: "IN" | "OUT"
  source: string
  delivery_status?: DeliveryStatus | null
  sent_at?: string | null
  delivered_at?: string | null
  read_at?: string | null
  failed_at?: string | null
  status_error?: string | null
  admin_read_at?: string | null
  timestamp: string
  createdAt?: string
  is_read?: boolean
}

interface UploadedLivechatMedia {
  type: Exclude<LivechatMediaType, 'sticker'>
  url: string
  internal_url?: string
  mime_type?: string
  file_name?: string
  size?: number
  storage_key?: string
}

interface LightboxMedia {
  url: string
  alt: string
}

interface VillageProfileLocation {
  name?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
}

interface ImportantContact {
  id: string
  name: string
  phone: string
  description?: string | null
  category?: { name?: string | null }
}

interface WaProviderContact {
  id: string
  name: string
  phone: string
  pushName?: string | null
  source: 'wa'
}

type SendableContact = ImportantContact | WaProviderContact
type AdvancedDialog = {
  type: 'sticker' | 'poll' | 'emoji' | 'reaction' | 'edit' | 'delete' | null
  targetMessage?: Message | null
}

const quickEmojis = ['👍', '🙏', '✅', '😊', '📍', '📄', '⏳', '❗', '❤️', '🎉', '📞', '🏢']

export default function LiveChatPage() {
  const { toast } = useToast()

  // State
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [currentTakeover, setCurrentTakeover] = useState<TakeoverSession | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messageInput, setMessageInput] = useState("")
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"all" | "takeover" | "bot">("all")
  const [conversationError, setConversationError] = useState<string | null>(null)
  const [messageError, setMessageError] = useState<string | null>(null)
  const [villageProfileError, setVillageProfileError] = useState<string | null>(null)
  const [importantContactsError, setImportantContactsError] = useState<string | null>(null)
  const [waSessionAlert, setWaSessionAlert] = useState<{ status: WaSessionStatus; message: string } | null>(null)
  const [conversationPagination, setConversationPagination] = useState({ total: 0, limit: 50, offset: 0 })

  // Loading states - only for initial load
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isInitialMessagesLoading, setIsInitialMessagesLoading] = useState(false)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)
  const [mediaUploadProgress, setMediaUploadProgress] = useState(0)
  const [selectedMedia, setSelectedMedia] = useState<UploadedLivechatMedia | null>(null)
  const [villageProfileLocation, setVillageProfileLocation] = useState<VillageProfileLocation | null>(null)
  const [importantContacts, setImportantContacts] = useState<ImportantContact[]>([])
  const [waProviderContacts, setWaProviderContacts] = useState<WaProviderContact[]>([])
  const [contactSearchQuery, setContactSearchQuery] = useState("")
  const [showContactDialog, setShowContactDialog] = useState(false)
  const [isSendingLocation, setIsSendingLocation] = useState(false)
  const [isSendingContact, setIsSendingContact] = useState(false)
  const [isSendingMenu, setIsSendingMenu] = useState(false)
  const [isSendingAdvancedAction, setIsSendingAdvancedAction] = useState(false)
  const [retryingMediaMessageId, setRetryingMediaMessageId] = useState<string | null>(null)
  const [retryingFailedMessageId, setRetryingFailedMessageId] = useState<string | null>(null)
  const [isSyncingWaContacts, setIsSyncingWaContacts] = useState(false)
  const [isRefreshingProfile, setIsRefreshingProfile] = useState(false)
  const [isTogglingTakeover, setIsTogglingTakeover] = useState(false)

  // Dialog states
  const [showTakeoverDialog, setShowTakeoverDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [advancedDialog, setAdvancedDialog] = useState<AdvancedDialog>({ type: null })
  const [stickerUrl, setStickerUrl] = useState("")
  const [pollQuestion, setPollQuestion] = useState("")
  const [pollOptionsText, setPollOptionsText] = useState("Ya\nTidak")
  const [emojiText, setEmojiText] = useState("")
  const [selectedEmoji, setSelectedEmoji] = useState("👍")
  const [editMessageText, setEditMessageText] = useState("")
  const [reactionEmoji, setReactionEmoji] = useState("👍")
  const [takeoverReason, setTakeoverReason] = useState("")
  const [takeoverReasonTemplate, setTakeoverReasonTemplate] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRetryingAI, setIsRetryingAI] = useState(false)
  const [failedMedia, setFailedMedia] = useState<Record<string, boolean>>({})
  const [lightboxMedia, setLightboxMedia] = useState<LightboxMedia | null>(null)

  // Processing status state
  const [processingStatuses, setProcessingStatuses] = useState<Record<string, ProcessingStatus>>({})
  const [typingByConversation, setTypingByConversation] = useState<Record<string, { actor: 'user' | 'admin' | 'ai'; until: number }>>({})

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
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const realtimeFailureCountRef = useRef(0)
  const typingPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastTypingStateRef = useRef<'composing' | 'paused' | null>(null)
  const lastTypingSentAtRef = useRef(0)
  const typingInFlightRef = useRef(false)
  const pendingTypingStateRef = useRef<{ state: 'composing' | 'paused'; force: boolean } | null>(null)
  const selectedConversationRef = useRef<Conversation | null>(null)
  const previousMessagesLengthRef = useRef<number>(0)
  const lastWaSessionStatusRef = useRef<WaSessionStatus | null>(null)
  const lastWaSessionToastAtRef = useRef(0)
  const lastPresenceStateRef = useRef<'available' | 'unavailable' | null>(null)
  const hasLoadedConversationsRef = useRef(false)

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

  const formatTakeoverReason = (reason?: string | null) => {
    if (!reason) return ""
    const labels: Record<string, string> = {
      user_requested_human_agent: "Warga meminta dibantu petugas",
      user_requested_human_agent_wallet_exhausted: "Warga meminta petugas karena saldo AI habis",
      agent_error: "AI mengalami kendala menjawab",
      negative_sentiment_escalation: "Percakapan perlu eskalasi ke petugas",
      conversation_stuck: "Percakapan perlu ditangani petugas",
    }
    return labels[reason] || reason.replace(/_/g, " ")
  }

  const formatTakeoverStartedAt = (startedAt?: string | null) => {
    if (!startedAt) return ""
    const date = new Date(startedAt)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleString("id-ID", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getActiveTyping = (conversationKey: string) => {
    const typing = typingByConversation[conversationKey]
    return typing && typing.until > Date.now() ? typing : null
  }

  const getTypingLabel = (typing: { actor: 'user' | 'admin' | 'ai'; until: number } | null, compact = false) => {
    if (!typing || typing.actor === 'admin') return null
    if (typing.actor === 'ai') return compact ? 'AI sedang mengetik...' : 'AI sedang mengetik...'
    return compact ? 'warga sedang mengetik...' : 'Warga sedang mengetik...'
  }

  const patchMessageStatus = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      if (!data.message_id) return
      setMessages((current) => current.map((message) => {
        const matchesId = message.id === data.message_id || message.message_id === data.message_id
        return matchesId ? { ...message, ...data } : message
      }))
    } catch {
      return
    }
  }

  const applyTypingEvent = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      if (!data.channel_identifier || !data.actor) return
      setTypingByConversation((current) => {
        if (data.typing_state === 'paused') {
          const next = { ...current }
          delete next[data.channel_identifier]
          return next
        }
        return {
          ...current,
          [data.channel_identifier]: { actor: data.actor, until: Date.now() + 4000 },
        }
      })
    } catch {
      return
    }
  }

  const applyWaSessionStatusEvent = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data)
      const status = typeof data.wa_session_status === 'string' ? data.wa_session_status as WaSessionStatus : null
      if (!status) return

      const previousStatus = lastWaSessionStatusRef.current
      lastWaSessionStatusRef.current = status
      syncLivechat()

      const alertMessages: Record<Exclude<WaSessionStatus, 'connected' | 'qr'>, string> = {
        disconnected: 'Koneksi WhatsApp sedang offline. Pesan baru bisa tertunda sampai session di-reconnect.',
        logged_out: 'Sesi WhatsApp logout. Hubungkan ulang dari pengaturan channel.',
        error: 'Provider WhatsApp melaporkan error pada session. Periksa channel settings untuk recovery.',
        replaced: 'Session WhatsApp digantikan oleh koneksi lain. Pastikan hanya satu koneksi aktif.',
      }

      if (status === 'connected') {
        setWaSessionAlert(null)
        return
      }

      if (status === 'qr') {
        setWaSessionAlert({ status, message: 'Session WhatsApp menunggu scan QR untuk melanjutkan login.' })
        return
      }

      const message = alertMessages[status as keyof typeof alertMessages]
      if (!message) return

      setWaSessionAlert({ status, message })

      if (status === previousStatus) return

      const now = Date.now()
      if (now - lastWaSessionToastAtRef.current < 120_000) return
      lastWaSessionToastAtRef.current = now

      toast({
        title:
          status === 'logged_out'
            ? 'WhatsApp Logout'
            : status === 'disconnected'
              ? 'WhatsApp Offline'
              : status === 'replaced'
                ? 'Session Digantikan'
                : 'WhatsApp Bermasalah',
        description: message,
        variant: status === 'disconnected' ? 'default' : 'destructive',
      })
    } catch {
      return
    }
  }

  // Keep ref in sync with state
  useEffect(() => {
    selectedConversationRef.current = selectedConversation
  }, [selectedConversation])

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setTypingByConversation((current) => {
        const active = Object.fromEntries(Object.entries(current).filter(([, value]) => value.until > now))
        return Object.keys(active).length === Object.keys(current).length ? current : active
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const getMessageSortTimes = (msg: Message) => {
    const createdAt = msg.createdAt ? new Date(msg.createdAt).getTime() : NaN
    const timestamp = new Date(msg.timestamp).getTime()
    return {
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    }
  }

  // Dedupe messages by ID and keep room chat oldest-to-newest like WhatsApp
  const normalizeMessages = (msgs: Message[]): Message[] => {
    const seen = new Set<string>()
    return msgs
      .filter(msg => {
        if (seen.has(msg.id)) return false
        seen.add(msg.id)
        return true
      })
      .sort((a, b) => {
        const timeA = getMessageSortTimes(a)
        const timeB = getMessageSortTimes(b)
        if (timeA.createdAt !== timeB.createdAt) return timeA.createdAt - timeB.createdAt
        if (timeA.timestamp !== timeB.timestamp) return timeA.timestamp - timeB.timestamp
        return a.id.localeCompare(b.id)
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
    setFailedMedia({})
    setMessageError(null)
    isNearBottomRef.current = true
  }, [getConversationKey(selectedConversation)])

  const isActiveProcessingStatus = (status?: ProcessingStatus | null) => {
    if (!status || status.stage === 'completed' || status.stage === 'error') return false
    if (typeof status.elapsedMs === 'number' && status.elapsedMs > 5 * 60 * 1000) return false
    return true
  }

  const hasFreshConversationProcessing = (conv?: Conversation | null) => {
    if (conv?.ai_status !== 'processing') return false
    const lastMessageAt = new Date(conv.last_message_at).getTime()
    return Number.isFinite(lastMessageAt) && Date.now() - lastMessageAt < 5 * 60 * 1000
  }

  const getNaturalProcessingLabel = (status?: ProcessingStatus | null, compact = false) => {
    if (!status) return compact ? 'AI memproses...' : 'AI sedang memproses pesan...'
    const labels: Record<ProcessingStatus['stage'], string> = {
      receiving: 'AI sedang menerima pesan...',
      reading: 'AI sedang membaca pesan...',
      searching: 'AI sedang mencari informasi...',
      thinking: 'AI sedang memahami kebutuhan warga...',
      preparing: 'AI sedang menyiapkan jawaban...',
      sending: 'AI sedang mengirim jawaban...',
      completed: 'AI selesai menjawab',
      error: 'AI perlu diproses ulang',
    }
    const compactLabels: Record<ProcessingStatus['stage'], string> = {
      receiving: 'AI membaca...',
      reading: 'AI membaca...',
      searching: 'AI mencari...',
      thinking: 'AI memahami...',
      preparing: 'AI menyiapkan...',
      sending: 'AI mengirim...',
      completed: 'AI selesai',
      error: 'AI error',
    }
    return compact ? compactLabels[status.stage] : labels[status.stage]
  }

  // Fetch processing statuses for all active conversations
  const fetchProcessingStatuses = useCallback(async () => {
    try {
      const token = localStorage.getItem("token")
      const response = await fetch('/api/livechat/processing-status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        setProcessingStatuses({})
        return
      }

      const data = await response.json()
      if (data.success && data.data?.statuses) {
        const statusMap: Record<string, ProcessingStatus> = {}
        for (const status of data.data.statuses) {
          const normalizedStatus: ProcessingStatus = {
            stage: status.stage,
            message: getNaturalProcessingLabel(status),
            progress: status.progress,
            elapsedMs: status.elapsedMs,
            lastUpdate: status.lastUpdate,
          }
          if (isActiveProcessingStatus(normalizedStatus)) {
            statusMap[status.userId] = normalizedStatus
          }
        }
        setProcessingStatuses(statusMap)
      } else {
        setProcessingStatuses({})
      }
    } catch (error) {
      console.error("Error fetching processing statuses:", error)
    }
  }, [])

  // Fetch conversations silently (no loading state)
  const fetchConversationsSilent = useCallback(async () => {
    try {
      const token = localStorage.getItem("token")
      const params = new URLSearchParams({
        status: activeTab,
        limit: String(conversationPagination.limit),
        offset: String(conversationPagination.offset),
      })
      if (searchQuery.trim()) params.set('search', searchQuery.trim())
      const response = await fetch(`/api/livechat/conversations?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) throw new Error(`Gagal memuat percakapan (${response.status})`)

      const data = await response.json()
      if (data.success) {
        setConversationError(null)
        setConversations(data.data || [])
        setConversationPagination((current) => ({
          ...current,
          total: data.pagination?.total ?? data.count ?? 0,
          limit: data.pagination?.limit ?? current.limit,
          offset: data.pagination?.offset ?? current.offset,
        }))

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
    } catch (error: any) {
      console.error("Error fetching conversations:", error)
      setConversationError(error?.message || "Gagal memuat percakapan")
    }
  }, [activeTab, searchQuery, conversationPagination.limit, conversationPagination.offset])

  // Fetch messages silently (no loading state for polling)
  const fetchMessagesSilent = useCallback(async (conversationKey: string) => {
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/livechat/conversations/${encodeURIComponent(conversationKey)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessageError(data?.error || `Gagal memuat pesan (${response.status})`)
        return
      }

      if (data?.success) {
        setMessageError(null)
        setMessages(normalizeMessages(data.data?.messages || []))
        setCurrentTakeover(data.data?.takeover_session || null)
      }
    } catch (error: any) {
      setMessageError(error?.message || "Gagal memuat pesan")
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

      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Gagal mengambil pesan")

      if (data?.success) {
        setMessageError(null)
        setMessages(normalizeMessages(data.data?.messages || []))
        setCurrentTakeover(data.data?.takeover_session || null)
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
    } catch (error: any) {
      setMessageError(error?.message || "Gagal mengambil pesan")
      console.error("Error fetching messages:", error)
    } finally {
      setIsInitialMessagesLoading(false)
    }
  }, [fetchConversationsSilent, scrollToBottom])

  // Initial load and subsequent list refreshes
  useEffect(() => {
    const loadData = async () => {
      if (!hasLoadedConversationsRef.current) {
        setIsInitialLoading(true)
        await fetchConversationsSilent()
        hasLoadedConversationsRef.current = true
        setIsInitialLoading(false)
        return
      }

      await fetchConversationsSilent()
    }
    loadData()
  }, [fetchConversationsSilent])

  useEffect(() => {
    setConversationPagination((current) => current.offset === 0 ? current : { ...current, offset: 0 })
  }, [activeTab, searchQuery])

  useEffect(() => {
    const loadVillageProfileLocation = async () => {
      try {
        const response = await fetch('/api/village-profile', {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          setVillageProfileError(data?.error || `Gagal memuat profil desa (${response.status})`)
          setVillageProfileLocation(null)
          return
        }
        setVillageProfileError(null)
        setVillageProfileLocation(data?.data || null)
      } catch (error: any) {
        setVillageProfileError(error?.message || 'Gagal memuat profil desa')
        setVillageProfileLocation(null)
      }
    }
    loadVillageProfileLocation()
  }, [])

  const loadImportantContacts = useCallback(async () => {
    try {
      const response = await fetch('/api/important-contacts', {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setImportantContactsError(data?.error || `Gagal memuat kontak penting (${response.status})`)
        setImportantContacts([])
        return
      }
      setImportantContactsError(null)
      setImportantContacts(Array.isArray(data?.data) ? data.data : [])
    } catch (error: any) {
      setImportantContactsError(error?.message || 'Gagal memuat kontak penting')
      setImportantContacts([])
    }
  }, [])

  const syncLivechat = useCallback(() => {
    fetchConversationsSilent()
    fetchProcessingStatuses()
    if (selectedConversationRef.current) {
      fetchMessagesSilent(getConversationKey(selectedConversationRef.current))
    }
  }, [fetchConversationsSilent, fetchMessagesSilent, fetchProcessingStatuses])

  // SSE realtime first, 3s polling fallback when realtime fails
  useEffect(() => {
    const stopPolling = () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }

    const startPollingFallback = () => {
      if (!pollingRef.current) {
        pollingRef.current = setInterval(syncLivechat, 3000)
      }
      scheduleRealtimeRetry()
    }

    const scheduleRealtimeRetry = () => {
      if (reconnectTimeoutRef.current || document.visibilityState !== 'visible') return
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null
        realtimeFailureCountRef.current = 0
        startRealtime()
      }, 45000)
    }

    const stopRealtime = () => {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }

    const startRealtime = () => {
      stopRealtime()
      if (document.visibilityState !== 'visible') return

      const source = new EventSource('/api/livechat/events')
      eventSourceRef.current = source

      source.addEventListener('open', () => {
        realtimeFailureCountRef.current = 0
        stopPolling()
        syncLivechat()
      })

      const handleLivechatEvent = () => syncLivechat()
      source.addEventListener('connected', handleLivechatEvent)
      source.addEventListener('message', handleLivechatEvent)
      source.addEventListener('conversation', handleLivechatEvent)
      source.addEventListener('takeover', handleLivechatEvent)
      source.addEventListener('delete', handleLivechatEvent)
      source.addEventListener('message_status', patchMessageStatus)
      source.addEventListener('typing', applyTypingEvent)
      source.addEventListener('wa_session_status', applyWaSessionStatusEvent)

      source.addEventListener('error', () => {
        source.close()
        eventSourceRef.current = null

        realtimeFailureCountRef.current += 1
        if (realtimeFailureCountRef.current >= 3) {
          startPollingFallback()
          return
        }

        const delay = Math.min(1000 * 2 ** realtimeFailureCountRef.current, 15000)
        reconnectTimeoutRef.current = setTimeout(startRealtime, delay)
      })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncLivechat()
        if (realtimeFailureCountRef.current >= 3) {
          startPollingFallback()
        } else {
          startRealtime()
        }
      } else {
        stopRealtime()
        stopPolling()
      }
    }

    if (document.visibilityState === 'visible') {
      startRealtime()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopRealtime()
      stopPolling()
      if (typingPauseTimeoutRef.current) clearTimeout(typingPauseTimeoutRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [syncLivechat])

  // Re-fetch when tab changes and close current conversation
  useEffect(() => {
    setSelectedConversation(null)
    setCurrentTakeover(null)
    setReplyingToMessage(null)
    setMessages([])
    previousMessagesLengthRef.current = 0
    fetchConversationsSilent()
  }, [activeTab, fetchConversationsSilent])

  // Select conversation
  const handleSelectConversation = async (conv: Conversation) => {
    setSelectedConversation(conv)
    setReplyingToMessage(null)
    previousMessagesLengthRef.current = 0
    lastTypingStateRef.current = null
    lastTypingSentAtRef.current = 0
    pendingTypingStateRef.current = null
    if (typingPauseTimeoutRef.current) clearTimeout(typingPauseTimeoutRef.current)
    await fetchMessagesWithLoading(getConversationKey(conv))
  }

  const sendPresenceState = useCallback(async (state: 'available' | 'unavailable', force = false) => {
    const conversation = selectedConversationRef.current
    if (!conversation?.is_takeover || isWebchatConversation(conversation)) return
    if (!force && lastPresenceStateRef.current === state) return
    lastPresenceStateRef.current = state

    try {
      await fetch('/api/whatsapp/presence', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state }),
      })
    } catch {
      return
    }
  }, [])

  useEffect(() => {
    const syncPresence = () => {
      const conversation = selectedConversationRef.current
      if (!conversation?.is_takeover || isWebchatConversation(conversation)) return
      sendPresenceState(document.visibilityState === 'visible' ? 'available' : 'unavailable')
    }

    syncPresence()
    document.addEventListener('visibilitychange', syncPresence)
    window.addEventListener('focus', syncPresence)
    window.addEventListener('blur', syncPresence)
    return () => {
      document.removeEventListener('visibilitychange', syncPresence)
      window.removeEventListener('focus', syncPresence)
      window.removeEventListener('blur', syncPresence)
      sendPresenceState('unavailable', true)
    }
  }, [selectedConversation?.id, selectedConversation?.is_takeover, sendPresenceState])

  const sendTypingState = useCallback(async (state: 'composing' | 'paused', force = false) => {
    const conversation = selectedConversationRef.current
    if (!conversation?.is_takeover) return

    if (typingInFlightRef.current) {
      pendingTypingStateRef.current = { state, force }
      return
    }

    const now = Date.now()
    const sameState = lastTypingStateRef.current === state
    const minInterval = state === 'composing' ? 1800 : 1200
    if (!force && sameState && now - lastTypingSentAtRef.current < minInterval) return

    lastTypingStateRef.current = state
    lastTypingSentAtRef.current = now
    typingInFlightRef.current = true

    try {
      const token = localStorage.getItem("token")
      await fetch(`/api/livechat/conversations/${encodeURIComponent(getConversationKey(conversation))}/typing`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state, actor: 'admin' }),
      })
    } catch {
      return
    } finally {
      typingInFlightRef.current = false
      const pending = pendingTypingStateRef.current
      pendingTypingStateRef.current = null
      if (pending) setTimeout(() => sendTypingState(pending.state, pending.force), 0)
    }
  }, [])

  const handleMessageInputChange = (value: string) => {
    setMessageInput(value)
    if (!selectedConversationRef.current?.is_takeover) return
    sendTypingState('composing')
    if (typingPauseTimeoutRef.current) clearTimeout(typingPauseTimeoutRef.current)
    typingPauseTimeoutRef.current = setTimeout(() => sendTypingState('paused', true), 2200)
  }

  const createOptimisticMessage = (text: string, media: UploadedLivechatMedia | null, replyTo: Message | null): Message => {
    const now = new Date().toISOString()
    return {
      id: `optimistic-${Date.now()}`,
      message_id: undefined,
      message_text: text || (media ? media.file_name || '[Media]' : ''),
      media_type: media?.type || null,
      media_url: media?.internal_url || media?.url || null,
      media_public_url: media?.url || null,
      mime_type: media?.mime_type || null,
      file_name: media?.file_name || null,
      file_size: media?.size || null,
      storage_key: media?.storage_key || null,
      quoted_message_id: replyTo?.message_id || null,
      quoted_text: replyTo?.message_text || null,
      message_kind: media ? 'media' : 'text',
      direction: 'OUT',
      source: 'ADMIN',
      delivery_status: null,
      timestamp: now,
      createdAt: now,
    }
  }

  const replaceOptimisticMessage = (optimisticId: string, data: any, fallback: Message) => {
    setMessages((current) => normalizeMessages(current.map((message) => (
      message.id === optimisticId
        ? {
            ...fallback,
            id: data?.local_id || data?.id || optimisticId,
            message_id: data?.message_id || fallback.message_id,
            delivery_status: data?.delivery_status || 'sent',
            status_error: null,
          }
        : message
    ))))
  }

  const sendLivechatPayload = async (payload: Record<string, unknown>) => {
    if (!selectedConversation) return null
    const token = localStorage.getItem("token")
    const response = await fetch(
      `/api/livechat/conversations/${encodeURIComponent(getConversationKey(selectedConversation))}/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    )
    return response.json()
  }

  const handleSendMessage = async () => {
    if ((!messageInput.trim() && !selectedMedia) || !selectedConversation) return

    const messageToSend = messageInput.trim()
    const mediaToSend = selectedMedia
    const replyToSend = replyingToMessage
    const payload = mediaToSend ? { message: messageToSend, media: mediaToSend } : { message: messageToSend }
    if (replyToSend?.message_id) {
      Object.assign(payload, { reply_to_message_id: replyToSend.message_id })
    }
    const optimisticMessage = createOptimisticMessage(messageToSend, mediaToSend, replyToSend)
    setMessageInput("")
    setSelectedMedia(null)
    setReplyingToMessage(null)
    setMessages((current) => normalizeMessages([...current, optimisticMessage]))
    setTimeout(() => scrollToBottom(true), 0)
    if (typingPauseTimeoutRef.current) clearTimeout(typingPauseTimeoutRef.current)
    sendTypingState('paused', true)
    setIsSendingMessage(true)

    try {
      const data = await sendLivechatPayload(payload)
      if (!data) return
      if (data.success) {
        replaceOptimisticMessage(optimisticMessage.id, data, optimisticMessage)
        await fetchMessagesSilent(getConversationKey(selectedConversation))
      } else {
        setMessages((current) => current.map((message) => message.id === optimisticMessage.id ? { ...message, delivery_status: 'failed', status_error: data.error || 'Gagal mengirim pesan' } : message))
        setMessageInput(messageToSend)
        setSelectedMedia(mediaToSend)
        setReplyingToMessage(replyToSend)
        throw new Error(data.error || "Gagal mengirim pesan")
      }
    } catch (error: any) {
      setMessages((current) => current.map((message) => message.id === optimisticMessage.id ? { ...message, delivery_status: 'failed', status_error: error.message || 'Gagal mengirim pesan' } : message))
      toast({
        title: "Error",
        description: error.message || "Gagal mengirim pesan",
        variant: "destructive",
      })
    } finally {
      setIsSendingMessage(false)
    }
  }

  const normalizeWaProviderContact = (raw: any, index: number): WaProviderContact | null => {
    const jid = raw?.jid || raw?.JID || raw?.id || raw?.phone || raw?.Phone || raw?.number || raw?.Number || ''
    const phone = String(jid).split('@')[0]?.split(':')[0]?.replace(/\D/g, '') || ''
    if (!phone) return null
    const name = String(raw?.name || raw?.Name || raw?.notify || raw?.Notify || raw?.pushName || raw?.PushName || raw?.displayName || raw?.DisplayName || phone).trim()
    const pushName = raw?.pushName || raw?.PushName || raw?.notify || raw?.Notify || null
    return {
      id: `wa-${phone}-${index}`,
      name: name || phone,
      phone,
      pushName: typeof pushName === 'string' ? pushName : null,
      source: 'wa',
    }
  }

  const filteredImportantContacts = importantContacts.filter((contact) => {
    const query = contactSearchQuery.toLowerCase().trim()
    if (!query) return true
    return [contact.name, contact.phone, contact.description || '', contact.category?.name || '']
      .some((value) => value.toLowerCase().includes(query))
  })

  const filteredWaProviderContacts = waProviderContacts.filter((contact) => {
    const query = contactSearchQuery.toLowerCase().trim()
    if (!query) return true
    return [contact.name, contact.phone, contact.pushName || '']
      .some((value) => value.toLowerCase().includes(query))
  })

  const buildContactVCard = (contact: SendableContact) => {
    const categoryName = 'category' in contact ? contact.category?.name : undefined
    const description = 'source' in contact ? contact.pushName : contact.description
    return [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${contact.name}`,
      `TEL;type=CELL;type=pref:${contact.phone}`,
      categoryName ? `ORG:${categoryName};` : null,
      description ? `TITLE:${description}` : null,
      'END:VCARD',
    ].filter(Boolean).join('\n')
  }

  const handleSendVillageLocation = async () => {
    if (!selectedConversation) return
    if (villageProfileLocation?.latitude == null || villageProfileLocation?.longitude == null) {
      toast({
        title: 'Lokasi belum lengkap',
        description: villageProfileError || 'Isi koordinat kantor di Profil Desa terlebih dahulu.',
        variant: 'destructive',
      })
      return
    }
    setIsSendingLocation(true)
    const replyToSend = replyingToMessage
    try {
      const payload: Record<string, unknown> = {
        location: {
          latitude: villageProfileLocation.latitude,
          longitude: villageProfileLocation.longitude,
          name: villageProfileLocation.name || 'Kantor Desa',
          address: villageProfileLocation.address || undefined,
        },
      }
      if (replyToSend?.message_id) payload.reply_to_message_id = replyToSend.message_id
      setReplyingToMessage(null)
      const data = await sendLivechatPayload(payload)
      if (!data?.success) {
        setReplyingToMessage(replyToSend)
        throw new Error(data?.error || 'Gagal mengirim lokasi')
      }
      await fetchMessagesSilent(getConversationKey(selectedConversation))
      toast({ title: 'Lokasi Terkirim', description: 'Lokasi kantor desa berhasil dikirim.' })
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Gagal mengirim lokasi', variant: 'destructive' })
    } finally {
      setIsSendingLocation(false)
    }
  }

  const openAdvancedDialog = (type: AdvancedDialog['type'], targetMessage?: Message | null) => {
    if (type === 'sticker') setStickerUrl('')
    if (type === 'poll') {
      setPollQuestion('')
      setPollOptionsText('Ya\nTidak')
    }
    if (type === 'emoji') {
      setSelectedEmoji('👍')
      setEmojiText('')
    }
    if (type === 'reaction') setReactionEmoji('👍')
    if (type === 'edit') setEditMessageText(targetMessage?.message_text || '')
    setAdvancedDialog({ type, targetMessage })
  }

  const closeAdvancedDialog = () => setAdvancedDialog({ type: null })

  const submitMessageAction = async (type: 'reaction' | 'edit' | 'delete', msg: Message, extra: Record<string, unknown> = {}) => {
    if (!selectedConversation || !msg.message_id) return
    setIsSendingAdvancedAction(true)
    try {
      const data = await sendLivechatPayload({ action: { type, message_id: msg.message_id, ...extra } })
      if (!data?.success) throw new Error(data?.error || 'Aksi pesan gagal')
      closeAdvancedDialog()
      await fetchMessagesSilent(getConversationKey(selectedConversation))
      toast({ title: 'Aksi Terkirim', description: 'Aksi pesan berhasil dikirim ke WhatsApp.' })
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Aksi pesan gagal', variant: 'destructive' })
    } finally {
      setIsSendingAdvancedAction(false)
    }
  }

  const submitSticker = async () => {
    if (!selectedConversation || !stickerUrl.trim()) return
    setIsSendingAdvancedAction(true)
    const replyToSend = replyingToMessage
    try {
      const payload: Record<string, unknown> = { sticker: { url: stickerUrl.trim(), mime_type: 'image/webp' } }
      if (replyToSend?.message_id) payload.reply_to_message_id = replyToSend.message_id
      setReplyingToMessage(null)
      const data = await sendLivechatPayload(payload)
      if (!data?.success) {
        setReplyingToMessage(replyToSend)
        throw new Error(data?.error || 'Gagal mengirim sticker')
      }
      closeAdvancedDialog()
      await fetchMessagesSilent(getConversationKey(selectedConversation))
      toast({ title: 'Sticker Terkirim', description: 'Sticker berhasil dikirim ke WhatsApp.' })
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Gagal mengirim sticker', variant: 'destructive' })
    } finally {
      setIsSendingAdvancedAction(false)
    }
  }

  const submitPoll = async () => {
    if (!selectedConversation) return
    const header = pollQuestion.trim()
    const options = pollOptionsText.split('\n').map((option) => option.trim()).filter(Boolean)
    if (!header || options.length < 2) {
      toast({ title: 'Poll tidak valid', description: 'Isi pertanyaan dan minimal 2 pilihan.', variant: 'destructive' })
      return
    }
    setIsSendingAdvancedAction(true)
    try {
      const data = await sendLivechatPayload({ poll: { header, options } })
      if (!data?.success) throw new Error(data?.error || 'Gagal mengirim poll')
      closeAdvancedDialog()
      await fetchMessagesSilent(getConversationKey(selectedConversation))
      toast({ title: 'Poll Terkirim', description: 'Poll berhasil dikirim ke WhatsApp.' })
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Gagal mengirim poll', variant: 'destructive' })
    } finally {
      setIsSendingAdvancedAction(false)
    }
  }

  const submitEmojiMessage = async () => {
    const text = `${selectedEmoji}${emojiText.trim() ? ` ${emojiText.trim()}` : ''}`
    if (!text.trim()) return
    setMessageInput(text)
    closeAdvancedDialog()
  }

  const handleSendSticker = async () => openAdvancedDialog('sticker')

  const handleSendPoll = async () => openAdvancedDialog('poll')

  const handleMessageAction = async (msg: Message, type: 'reaction' | 'edit' | 'delete') => {
    if (!selectedConversation || !msg.message_id) return
    openAdvancedDialog(type, msg)
  }

  const handleRetryMediaDownload = async (msg: Message) => {
    if (!selectedConversation || !msg.message_id) return
    setRetryingMediaMessageId(msg.message_id)
    try {
      const response = await fetch(`/api/whatsapp/media/${encodeURIComponent(msg.message_id)}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Gagal download ulang media')
      setFailedMedia({})
      await fetchMessagesSilent(getConversationKey(selectedConversation))
      toast({ title: 'Media Diperbarui', description: 'Media WhatsApp berhasil didownload ulang.' })
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Gagal download ulang media', variant: 'destructive' })
    } finally {
      setRetryingMediaMessageId(null)
    }
  }

  const loadWaProviderContacts = async (sync = false) => {
    const response = await fetch(sync ? '/api/whatsapp/contacts/sync' : '/api/whatsapp/contacts', {
      method: sync ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.success) throw new Error(data?.error || 'Gagal memuat kontak WhatsApp')
    const rawContacts = Array.isArray(data.data?.contacts) ? data.data.contacts : []
    const contacts = rawContacts
      .map((contact: any, index: number) => normalizeWaProviderContact(contact, index))
      .filter(Boolean) as WaProviderContact[]
    setWaProviderContacts(contacts)
    return { count: data.data?.count || contacts.length, contacts }
  }

  const handleSyncWaContacts = async () => {
    setIsSyncingWaContacts(true)
    try {
      const result = await loadWaProviderContacts(true)
      toast({ title: 'Kontak Disinkronkan', description: `${result.count} kontak WhatsApp terbaca dari provider.` })
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Gagal sinkron kontak WhatsApp', variant: 'destructive' })
    } finally {
      setIsSyncingWaContacts(false)
    }
  }

  const handleRefreshWaProfile = async () => {
    if (!selectedConversation || isWebchatConversation(selectedConversation)) return
    setIsRefreshingProfile(true)
    try {
      const response = await fetch('/api/whatsapp/profile-refresh', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone: getConversationKey(selectedConversation) }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Gagal refresh profil WhatsApp')
      await fetchConversationsSilent()
      toast({ title: 'Profil Diperbarui', description: 'Profil WhatsApp dicoba disinkronkan ulang.' })
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Gagal refresh profil WhatsApp', variant: 'destructive' })
    } finally {
      setIsRefreshingProfile(false)
    }
  }

  const handleSendGovConnectMenu = async () => {
    if (!selectedConversation) return
    setIsSendingMenu(true)
    const replyToSend = replyingToMessage
    try {
      const payload: Record<string, unknown> = {
        interactive: {
          type: 'buttons',
          title: 'Menu GovConnect',
          body: 'Silakan pilih kebutuhan Anda. Balasan akan diproses oleh GovConnect.',
          footer: 'Layanan desa digital',
          buttons: [
            { type: 'reply', id: 'lapor_masalah', title: 'Lapor Masalah' },
            { type: 'reply', id: 'cek_layanan', title: 'Cek Layanan' },
            { type: 'reply', id: 'hubungi_petugas', title: 'Hubungi Petugas' },
          ],
        },
      }
      if (replyToSend?.message_id) payload.reply_to_message_id = replyToSend.message_id
      setReplyingToMessage(null)
      const data = await sendLivechatPayload(payload)
      if (!data?.success) {
        setReplyingToMessage(replyToSend)
        throw new Error(data?.error || 'Gagal mengirim menu')
      }
      await fetchMessagesSilent(getConversationKey(selectedConversation))
      toast({ title: 'Menu Terkirim', description: 'Menu GovConnect berhasil dikirim.' })
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Gagal mengirim menu', variant: 'destructive' })
    } finally {
      setIsSendingMenu(false)
    }
  }

  const handleOpenContactDialog = async () => {
    setShowContactDialog(true)
    if (importantContacts.length === 0) await loadImportantContacts()
    if (waProviderContacts.length === 0 && selectedConversation && !isWebchatConversation(selectedConversation)) {
      await loadWaProviderContacts().catch(() => undefined)
    }
  }

  const handleSendImportantContact = async (contact: SendableContact) => {
    if (!selectedConversation) return
    setIsSendingContact(true)
    const replyToSend = replyingToMessage
    try {
      const payload: Record<string, unknown> = {
        contact: {
          name: contact.name,
          phone: contact.phone,
          organization: 'category' in contact ? contact.category?.name || undefined : undefined,
          title: 'source' in contact ? contact.pushName || undefined : contact.description || undefined,
          vcard: buildContactVCard(contact),
        },
      }
      if (replyToSend?.message_id) payload.reply_to_message_id = replyToSend.message_id
      setReplyingToMessage(null)
      const data = await sendLivechatPayload(payload)
      if (!data?.success) {
        setReplyingToMessage(replyToSend)
        throw new Error(data?.error || 'Gagal mengirim kontak')
      }
      setShowContactDialog(false)
      await fetchMessagesSilent(getConversationKey(selectedConversation))
      toast({ title: 'Kontak Terkirim', description: `${contact.name} berhasil dikirim sebagai kartu kontak.` })
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Gagal mengirim kontak', variant: 'destructive' })
    } finally {
      setIsSendingContact(false)
    }
  }

  const inferMediaType = (mimeType: string): UploadedLivechatMedia['type'] => {
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (mimeType.startsWith('video/')) return 'video'
    return 'document'
  }

  const uploadLivechatMedia = (file: File, token: string | null): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const formData = new FormData()
      formData.append('file', file)
      formData.append('scope', 'livechat')

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        setMediaUploadProgress(Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100))))
      }
      xhr.onload = () => {
        try {
          const result = JSON.parse(xhr.responseText || '{}')
          if (xhr.status < 200 || xhr.status >= 300 || !result.success) {
            reject(new Error(result.error || 'Gagal mengunggah media'))
            return
          }
          setMediaUploadProgress(100)
          resolve(result)
        } catch {
          reject(new Error('Response upload media tidak valid'))
        }
      }
      xhr.onerror = () => reject(new Error('Koneksi upload media gagal'))
      xhr.open('POST', '/api/uploads')
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.send(formData)
    })
  }

  const handleMediaSelect = async (file: File | null) => {
    if (!file) return

    setIsUploadingMedia(true)
    setMediaUploadProgress(0)
    try {
      const token = localStorage.getItem("token")
      const result = await uploadLivechatMedia(file, token)

      if (!result.data?.url) {
        throw new Error('Upload berhasil tetapi URL media kosong')
      }

      setSelectedMedia({
        type: inferMediaType(result.data?.mime_type || file.type),
        url: result.data.url,
        internal_url: result.data?.internal_url,
        mime_type: result.data?.mime_type || file.type,
        file_name: result.data?.filename || file.name,
        size: result.data?.size || file.size,
        storage_key: result.data?.storage_key || result.data?.path,
      })
    } catch (error: any) {
      toast({
        title: "Upload gagal",
        description: error.message || "Gagal mengunggah media",
        variant: "destructive",
      })
    } finally {
      setIsUploadingMedia(false)
      setMediaUploadProgress(0)
      if (mediaInputRef.current) mediaInputRef.current.value = ''
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
        setCurrentTakeover(data.data || null)

        // Refresh conversations
        fetchConversationsSilent()
        sendPresenceState('available', true)

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
        setCurrentTakeover(null)

        // Refresh conversations
        fetchConversationsSilent()
        sendPresenceState('unavailable', true)

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
        setCurrentTakeover(null)
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

  const filteredConversations = conversations
  const conversationStart = conversationPagination.offset + (filteredConversations.length > 0 ? 1 : 0)
  const conversationEnd = conversationPagination.offset + filteredConversations.length
  const hasPreviousConversations = conversationPagination.offset > 0
  const hasNextConversations = conversationPagination.offset + conversationPagination.limit < conversationPagination.total

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

  const getMessageStatusLabel = (msg: Message) => {
    if (msg.delivery_status === 'failed') return 'Gagal'
    if (msg.delivery_status === 'read') return 'Dibaca'
    if (msg.delivery_status === 'delivered') return 'Diterima'
    if (msg.delivery_status === 'sent') return 'Terkirim'
    return msg.source === 'ADMIN' ? 'Mengantre' : msg.source === 'AI' ? 'AI' : 'Sistem'
  }

  const renderMessageStatusIcon = (msg: Message) => {
    if (msg.delivery_status === 'failed') return <AlertTriangle className="h-3.5 w-3.5 ml-1 text-red-200" />
    if (msg.delivery_status === 'read') return <CheckCheck className="h-3.5 w-3.5 ml-1 text-blue-300" />
    if (msg.delivery_status === 'delivered') return <CheckCheck className="h-3.5 w-3.5 ml-1" />
    if (msg.delivery_status === 'sent') return <Check className="h-3.5 w-3.5 ml-1" />
    return <Clock3 className="h-3.5 w-3.5 ml-1" />
  }

  // Get initials for avatar
  const getInitials = (name: string | null | undefined, phone: string) => {
    if (name) {
      return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    }
    return phone ? phone.slice(-2) : "??"
  }

  const getConversationAvatarUrl = (conv?: Conversation | null) => {
    if (!conv || isWebchatConversation(conv)) return null
    return conv.profile_avatar_url || null
  }

  // Get display name for conversation (prioritize collected name over session ID)
  const getDisplayName = (conv: Conversation) => {
    if (conv.user_name) return conv.user_name
    if (conv.profile_name) return conv.profile_name
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
    const trimmed = text.trim()
    return /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(trimmed) ||
      /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?$/i.test(trimmed) ||
      trimmed.includes('/uploads/') ||
      (trimmed.startsWith('http') && (trimmed.includes('image') || trimmed.includes('/media/') || trimmed.includes('/cdn/')))
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

  const resolveRenderableMediaUrl = (url: string) => {
    const trimmed = url.trim()
    if (trimmed.startsWith('/uploads/')) {
      return `/api/livechat/media?src=${encodeURIComponent(trimmed)}`
    }

    try {
      const parsed = new URL(trimmed)
      const isLegacyChannelHost =
        parsed.hostname === 'channel-service' ||
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1'

      if (isLegacyChannelHost && parsed.pathname.startsWith('/uploads/')) {
        return `/api/livechat/media?src=${encodeURIComponent(trimmed)}`
      }
    } catch {
      return trimmed
    }

    return trimmed
  }

  const isMediaPlaceholder = (text: string) => /^\[(Image|Video|Audio|Document|Sticker)\](\s.*)?$/.test(text.trim())

  const renderFormattedText = (text: string, direction: Message['direction']) => {
    const tokenRegex = /(https?:\/\/[^\s<]+)|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g
    const nodes: ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    const pushPlainText = (value: string, keyPrefix: string) => {
      value.split('\n').forEach((line, index, lines) => {
        if (line) nodes.push(<span key={`${keyPrefix}-text-${index}`}>{line}</span>)
        if (index < lines.length - 1) nodes.push(<br key={`${keyPrefix}-br-${index}`} />)
      })
    }

    while ((match = tokenRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        pushPlainText(text.slice(lastIndex, match.index), `plain-${lastIndex}`)
      }

      const key = `${match.index}-${match[0]}`
      if (match[1]) {
        const trailing = match[1].match(/[.,!?)]$/)?.[0] || ''
        const href = trailing ? match[1].slice(0, -1) : match[1]
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`break-all underline underline-offset-2 ${direction === 'OUT' ? 'text-white' : 'text-blue-600 dark:text-blue-400'}`}
          >
            {href}
          </a>
        )
        if (trailing) nodes.push(<span key={`${key}-trailing`}>{trailing}</span>)
      } else if (match[2]) {
        nodes.push(<code key={key} className="rounded bg-black/10 px-1 py-0.5 text-[0.9em]">{match[2]}</code>)
      } else if (match[3]) {
        nodes.push(<strong key={key}>{match[3]}</strong>)
      } else if (match[4]) {
        nodes.push(<em key={key}>{match[4]}</em>)
      } else if (match[5]) {
        nodes.push(<span key={key} className="line-through">{match[5]}</span>)
      }

      lastIndex = tokenRegex.lastIndex
    }

    if (lastIndex < text.length) {
      pushPlainText(text.slice(lastIndex), `plain-${lastIndex}`)
    }

    return <p className="text-sm whitespace-pre-wrap wrap-break-word">{nodes.length ? nodes : text}</p>
  }

  const renderQuotedPreview = (msg: Message) => {
    if (!msg.quoted_text && !msg.quoted_message_id) return null
    return (
      <div className={`mb-2 rounded border-l-4 px-2 py-1 text-xs ${msg.direction === 'OUT' ? 'border-green-200 bg-green-600/40 text-green-50' : 'border-emerald-500 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-100'}`}>
        <div className="font-medium">Membalas pesan</div>
        <div className="line-clamp-2 opacity-90">{msg.quoted_text || msg.quoted_message_id}</div>
      </div>
    )
  }

  const renderLocationCard = (msg: Message) => {
    if (msg.location_latitude == null || msg.location_longitude == null) return null
    const label = msg.location_name || msg.location_address || 'Lokasi dibagikan'
    const mapsUrl = `https://www.google.com/maps?q=${msg.location_latitude},${msg.location_longitude}`
    return (
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex min-w-[220px] items-start gap-3 rounded-lg p-3 hover:opacity-90 ${msg.direction === 'OUT' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'}`}
      >
        <MapPin className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{label}</div>
          {msg.location_address && <div className="text-xs opacity-80">{msg.location_address}</div>}
          <div className="mt-1 text-xs underline underline-offset-2">Buka di Google Maps</div>
        </div>
      </a>
    )
  }

  const renderContactCard = (msg: Message) => {
    if (!msg.contact_name && !msg.contact_phone) return null
    return (
      <div className={`flex min-w-[220px] items-center gap-3 rounded-lg p-3 ${msg.direction === 'OUT' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'}`}>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/10">
          <UserRound className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{msg.contact_name || 'Kontak'}</div>
          {msg.contact_phone && <div className="text-xs opacity-80">{msg.contact_phone}</div>}
        </div>
      </div>
    )
  }

  const humanizeChoiceLabel = (value: unknown) => {
    if (typeof value !== 'string') return ''
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase())
  }

  const getInteractiveButtonLabel = (button: any, index: number) => {
    return button?.title || button?.Title || button?.text || button?.Text || humanizeChoiceLabel(button?.id || button?.ID) || `Pilihan ${index + 1}`
  }

  const renderInteractiveCard = (msg: Message) => {
    if (!msg.interactive_payload || typeof msg.interactive_payload !== 'object') return null
    const payload = msg.interactive_payload
    const buttons = Array.isArray(payload.buttons) ? payload.buttons : []
    const sections = Array.isArray(payload.sections) ? payload.sections : []
    return (
      <div className={`min-w-[240px] rounded-lg p-3 ${msg.direction === 'OUT' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'}`}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks className="h-4 w-4" />
          {payload.title || (payload.type === 'list' ? 'Daftar pilihan' : 'Menu pilihan')}
        </div>
        <div className="mt-1 text-sm opacity-90">{payload.body || msg.message_text}</div>
        {buttons.length > 0 && (
          <div className="mt-2 space-y-1">
            {buttons.map((button: any, index: number) => (
              <div key={`${msg.id}-button-${index}`} className="rounded border border-current/20 px-2 py-1 text-xs">
                {getInteractiveButtonLabel(button, index)}
              </div>
            ))}
          </div>
        )}
        {sections.length > 0 && <div className="mt-2 text-xs opacity-80">{sections.length} seksi pilihan terkirim</div>}
      </div>
    )
  }

  const getMessageReactions = (msg: Message): Array<{ emoji: string; from?: string }> => {
    const reactions = msg.interactive_payload?.reactions
    return Array.isArray(reactions)
      ? reactions.filter((reaction) => typeof reaction?.emoji === 'string' && reaction.emoji.trim())
      : []
  }

  const renderMessageReactions = (msg: Message) => {
    const reactions = getMessageReactions(msg)
    if (reactions.length === 0) return null
    return (
      <div className={`mt-1 flex gap-1 ${msg.direction === 'OUT' ? 'justify-end' : 'justify-start'}`}>
        {reactions.map((reaction, index) => (
          <span key={`${reaction.from || 'reaction'}-${index}`} className="rounded-full border bg-background px-2 py-0.5 text-sm text-foreground shadow-sm">
            {reaction.emoji}
          </span>
        ))}
      </div>
    )
  }

  const buildRetryPayload = (msg: Message): Record<string, unknown> => {
    if (msg.message_kind === 'location' && msg.location_latitude != null && msg.location_longitude != null) {
      return { location: { latitude: msg.location_latitude, longitude: msg.location_longitude, name: msg.location_name || undefined, address: msg.location_address || undefined } }
    }
    if (msg.message_kind === 'contact' && (msg.contact_name || msg.contact_phone)) {
      return { contact: { name: msg.contact_name || msg.contact_phone || 'Kontak', phone: msg.contact_phone || '', vcard: msg.contact_vcard || undefined } }
    }
    if ((msg.message_kind === 'buttons' || msg.message_kind === 'list') && msg.interactive_payload) {
      return { interactive: msg.interactive_payload }
    }
    if (msg.media_type && (msg.media_public_url || msg.media_url)) {
      return {
        message: isMediaPlaceholder(msg.message_text) ? '' : msg.message_text,
        media: {
          type: msg.media_type === 'sticker' ? 'image' : msg.media_type,
          url: msg.media_public_url || msg.media_url,
          internal_url: msg.media_url || undefined,
          mime_type: msg.mime_type || undefined,
          file_name: msg.file_name || undefined,
          size: msg.file_size || undefined,
          storage_key: msg.storage_key || undefined,
        },
      }
    }
    return { message: msg.message_text || '' }
  }

  const handleRetryFailedMessage = async (msg: Message) => {
    if (!selectedConversation) return
    setRetryingFailedMessageId(msg.id)
    try {
      const data = await sendLivechatPayload({ ...buildRetryPayload(msg), retry_message_id: msg.id })
      if (!data?.success) throw new Error(data?.error || 'Retry gagal')
      await fetchMessagesSilent(getConversationKey(selectedConversation))
      toast({ title: 'Retry Terkirim', description: 'Pesan berhasil dikirim ulang.' })
    } catch (error: any) {
      toast({ title: 'Retry Gagal', description: error.message || 'Pesan gagal dikirim ulang', variant: 'destructive' })
    } finally {
      setRetryingFailedMessageId(null)
    }
  }

  // Render message content (handle structured media and legacy URL messages)
  const renderMessageContent = (msg: Message) => {
    const locationCard = renderLocationCard(msg)
    if (locationCard) {
      return <div>{renderQuotedPreview(msg)}{locationCard}</div>
    }

    const contactCard = renderContactCard(msg)
    if (contactCard) {
      return <div>{renderQuotedPreview(msg)}{contactCard}</div>
    }

    const interactiveCard = renderInteractiveCard(msg)
    if (interactiveCard) {
      return <div>{renderQuotedPreview(msg)}{interactiveCard}</div>
    }

    const structuredMediaUrl = msg.media_public_url || msg.media_url

    if (structuredMediaUrl && msg.media_type) {
      const renderableUrl = resolveRenderableMediaUrl(structuredMediaUrl)
      const mediaKey = `${msg.id}:${structuredMediaUrl}`
      const caption = isMediaPlaceholder(msg.message_text) ? '' : msg.message_text

      return (
        <div className="space-y-2">
          {renderQuotedPreview(msg)}
          {(msg.media_type === 'image' || msg.media_type === 'sticker') && (
            failedMedia[mediaKey] ? (
              <div className="flex items-center gap-2 rounded-lg bg-gray-100 p-3 text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                <ImageIcon className="h-4 w-4" />
                <span className="text-sm">Gambar tidak dapat dimuat</span>
                {msg.message_id && (
                  <Button type="button" variant="outline" size="sm" onClick={() => handleRetryMediaDownload(msg)} disabled={retryingMediaMessageId === msg.message_id}>
                    {retryingMediaMessageId === msg.message_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            ) : (
              <div className="relative max-w-[280px] overflow-hidden rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={renderableUrl}
                  alt={msg.file_name || 'Media'}
                  className="h-auto w-full cursor-pointer transition-opacity hover:opacity-90"
                  onClick={() => setLightboxMedia({ url: renderableUrl, alt: msg.file_name || 'Media' })}
                  onError={() => setFailedMedia((current) => ({ ...current, [mediaKey]: true }))}
                />
              </div>
            )
          )}
          {msg.media_type === 'video' && (
            <video src={renderableUrl} controls className="max-w-[280px] rounded-lg" />
          )}
          {msg.media_type === 'audio' && (
            <audio src={renderableUrl} controls className="max-w-[280px]" />
          )}
          {msg.media_type === 'document' && (
            <a
              href={renderableUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2 rounded-lg p-3 underline-offset-2 hover:underline ${msg.direction === 'OUT' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'}`}
            >
              <FileText className="h-4 w-4" />
              <span className="text-sm font-medium">{msg.file_name || 'Buka dokumen'}</span>
            </a>
          )}
          {caption && renderFormattedText(caption, msg.direction)}
        </div>
      )
    }

    const imageUrl = extractImageUrl(msg.message_text)

    if (imageUrl) {
      const renderableImageUrl = resolveRenderableMediaUrl(imageUrl)
      const mediaKey = `${msg.id}:${imageUrl}`
      const caption = msg.message_text.replace(imageUrl, '').trim()

      return (
        <div className="space-y-2">
          {renderQuotedPreview(msg)}
          {failedMedia[mediaKey] ? (
            <div className="flex items-center gap-2 rounded-lg bg-gray-100 p-3 dark:bg-gray-700">
              <ImageIcon className="h-4 w-4" />
              <span className="text-sm">Gambar tidak dapat dimuat</span>
              {msg.message_id && (
                <Button type="button" variant="outline" size="sm" onClick={() => handleRetryMediaDownload(msg)} disabled={retryingMediaMessageId === msg.message_id}>
                  {retryingMediaMessageId === msg.message_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          ) : (
            <div className="relative max-w-[280px] overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={renderableImageUrl}
                alt="Media"
                className="h-auto w-full cursor-pointer transition-opacity hover:opacity-90"
                onClick={() => window.open(renderableImageUrl, '_blank', 'noopener,noreferrer')}
                onError={() => {
                  setFailedMedia((current) => ({ ...current, [mediaKey]: true }))
                }}
              />
            </div>
          )}
          {caption && renderFormattedText(caption, msg.direction)}
        </div>
      )
    }

    if (msg.media_type && !structuredMediaUrl) {
      return (
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4" />
          {renderFormattedText(msg.message_text, msg.direction)}
          {msg.message_id && (
            <Button type="button" variant="outline" size="sm" onClick={() => handleRetryMediaDownload(msg)} disabled={retryingMediaMessageId === msg.message_id}>
              {retryingMediaMessageId === msg.message_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              <span className="ml-1 text-xs">Download ulang</span>
            </Button>
          )}
        </div>
      )
    }

    if (msg.message_text.includes('[Gambar]') || msg.message_text.includes('[Image]')) {
      return (
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4" />
          {renderFormattedText(msg.message_text, msg.direction)}
        </div>
      )
    }

    return <div>{renderQuotedPreview(msg)}{renderFormattedText(msg.message_text, msg.direction)}</div>
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

          {conversationError && (
            <div className="border-b bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {conversationError}
            </div>
          )}

          {waSessionAlert && (
            <div className={`border-b p-3 text-xs ${waSessionAlert.status === 'disconnected' || waSessionAlert.status === 'qr' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'}`}>
              {waSessionAlert.message}
            </div>
          )}

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
                        {getConversationAvatarUrl(conv) && <AvatarImage src={getConversationAvatarUrl(conv) || undefined} alt={getDisplayName(conv)} />}
                        <AvatarFallback className={`text-xs ${conv.is_takeover ? "bg-orange-500 text-white" : "bg-green-500 text-white"}`}>
                          {getInitials(getDisplayName(conv), getConversationKey(conv))}
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
                          <p className={`text-xs truncate pr-2 ${getTypingLabel(getActiveTyping(getConversationKey(conv)), true) ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                            {getTypingLabel(getActiveTyping(getConversationKey(conv)), true) || conv.last_message || "Tidak ada pesan"}
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
                          ) : isActiveProcessingStatus(processingStatuses[getConversationKey(conv)]) ? (
                            <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs py-0 animate-pulse">
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              {processingStatuses[getConversationKey(conv)].message}
                            </Badge>
                          ) : hasFreshConversationProcessing(conv) ? (
                            <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs py-0 animate-pulse">
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              AI sedang membaca...
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

          <div className="flex items-center justify-between gap-2 border-t p-3 text-xs text-muted-foreground">
            <span>
              Menampilkan {conversationStart}-{conversationEnd} dari {conversationPagination.total} percakapan
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPreviousConversations}
                onClick={() => setConversationPagination((current) => ({
                  ...current,
                  offset: Math.max(current.offset - current.limit, 0),
                }))}
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNextConversations}
                onClick={() => setConversationPagination((current) => ({
                  ...current,
                  offset: current.offset + current.limit,
                }))}
              >
                Berikutnya
              </Button>
            </div>
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
                    onClick={() => {
                      setSelectedConversation(null)
                      setCurrentTakeover(null)
                    }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Avatar className="h-9 w-9">
                    {getConversationAvatarUrl(selectedConversation) && <AvatarImage src={getConversationAvatarUrl(selectedConversation) || undefined} alt={getDisplayName(selectedConversation)} />}
                    <AvatarFallback className={`text-xs ${selectedConversation.is_takeover ? "bg-orange-500 text-white" : "bg-green-500 text-white"}`}>
                      {getInitials(getDisplayName(selectedConversation), getConversationKey(selectedConversation))}
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
                  {!isWebchatConversation(selectedConversation) && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSyncWaContacts}
                        disabled={isSyncingWaContacts}
                        className="hidden h-8 px-2 text-xs sm:inline-flex"
                        title="Sinkron kontak WhatsApp"
                      >
                        {isSyncingWaContacts ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <UserRound className="mr-1 h-3.5 w-3.5" />}
                        Kontak
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRefreshWaProfile}
                        disabled={isRefreshingProfile}
                        className="hidden h-8 px-2 text-xs sm:inline-flex"
                        title="Refresh profil WhatsApp"
                      >
                        {isRefreshingProfile ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                        Profil
                      </Button>
                    </>
                  )}

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

              {selectedConversation.is_takeover && currentTakeover && (
                <div className="border-t bg-orange-50 px-4 py-2 text-xs text-orange-700 dark:bg-orange-950 dark:text-orange-200">
                  Ditangani petugas <span className="font-medium">{currentTakeover.admin_name || currentTakeover.admin_id}</span>
                  {formatTakeoverStartedAt(currentTakeover.started_at) ? ` sejak ${formatTakeoverStartedAt(currentTakeover.started_at)}` : ''}
                  {formatTakeoverReason(currentTakeover.reason) ? ` — ${formatTakeoverReason(currentTakeover.reason)}` : ''}
                </div>
              )}

              {messageError && (
                <div className="border-t bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {messageError}
                </div>
              )}

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
                          className={`flex animate-in fade-in slide-in-from-bottom-1 duration-200 ${msg.direction === "OUT" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[75%] rounded-lg p-3 shadow-sm ${msg.direction === "OUT"
                                ? "bg-green-500 text-white"
                                : "bg-white dark:bg-gray-800 border"
                              }`}
                          >
                            <div className="group relative">
                              {renderMessageContent(msg)}
                              {selectedConversation.is_takeover && (
                                <div className={`absolute top-1/2 z-20 flex -translate-y-1/2 gap-1 rounded-full border bg-background/95 p-1 shadow-lg opacity-0 transition-opacity group-hover:opacity-100 ${msg.direction === 'OUT' ? 'left-0 -translate-x-[calc(100%+0.5rem)]' : 'right-0 translate-x-[calc(100%+0.5rem)]'}`}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-foreground hover:bg-muted"
                                    onClick={() => setReplyingToMessage(msg)}
                                    title="Balas"
                                  >
                                    <Reply className="h-4 w-4" />
                                  </Button>
                                  {!isWebchatConversation(selectedConversation) && msg.message_id && (
                                    <>
                                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground hover:bg-muted" onClick={() => handleMessageAction(msg, 'reaction')} disabled={isSendingAdvancedAction} title="Reaction"><Smile className="h-4 w-4" /></Button>
                                      {msg.direction === 'OUT' && <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground hover:bg-muted" onClick={() => handleMessageAction(msg, 'edit')} disabled={isSendingAdvancedAction} title="Edit"><Pencil className="h-4 w-4" /></Button>}
                                      {msg.direction === 'OUT' && <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-foreground hover:bg-muted" onClick={() => handleMessageAction(msg, 'delete')} disabled={isSendingAdvancedAction} title="Delete"><Trash2 className="h-4 w-4" /></Button>}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                            {renderMessageReactions(msg)}
                            {msg.delivery_status === 'failed' && msg.status_error && (
                              <div className="mt-2 flex items-center gap-2 rounded bg-red-600/20 px-2 py-1 text-xs text-red-50">
                                <span className="min-w-0 flex-1">{msg.status_error}</span>
                                {msg.direction === 'OUT' && selectedConversation.is_takeover && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => handleRetryFailedMessage(msg)}
                                    disabled={retryingFailedMessageId === msg.id || isSendingMessage}
                                  >
                                    {retryingFailedMessageId === msg.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Retry'}
                                  </Button>
                                )}
                              </div>
                            )}
                            <div className={`flex items-center gap-1 mt-1.5 text-xs ${msg.direction === "OUT" ? "text-green-100" : "text-muted-foreground"
                              }`}>
                              <span>{formatTime(msg.timestamp)}</span>
                              {msg.interactive_payload?.edited && <span className="italic opacity-80">edited</span>}
                              {msg.direction === "OUT" && (
                                <>
                                  <span className="mx-0.5">•</span>
                                  <span className="capitalize text-[10px]">
                                    {getMessageStatusLabel(msg)}
                                  </span>
                                  {renderMessageStatusIcon(msg)}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {selectedConversation && getTypingLabel(getActiveTyping(getConversationKey(selectedConversation))) && (
                        <div className="flex justify-start">
                          <div className="rounded-lg border bg-white px-3 py-2 text-xs text-emerald-700 shadow-sm dark:bg-gray-800">
                            <span className="inline-flex items-center gap-1">
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:120ms]" />
                              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:240ms]" />
                              {getTypingLabel(getActiveTyping(getConversationKey(selectedConversation)))}
                            </span>
                          </div>
                        </div>
                      )}
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
              {selectedConversation && isActiveProcessingStatus(processingStatuses[getConversationKey(selectedConversation)]) && (
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
                  <div className="space-y-2">
                    {replyingToMessage && (
                      <div className="flex items-start justify-between rounded-lg border-l-4 border-emerald-500 bg-muted/50 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
                            <Reply className="h-3.5 w-3.5" />
                            Membalas {replyingToMessage.direction === 'OUT' ? 'pesan admin' : 'pesan warga'}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {replyingToMessage.message_text || replyingToMessage.location_name || replyingToMessage.contact_name || replyingToMessage.message_id}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReplyingToMessage(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    {isUploadingMedia && (
                      <div className="space-y-1 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>Mengunggah media...</span>
                          <span>{mediaUploadProgress}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${mediaUploadProgress}%` }} />
                        </div>
                      </div>
                    )}
                    {selectedMedia && (
                      <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          {selectedMedia.type === 'image' ? <ImageIcon className="h-4 w-4" /> : selectedMedia.type === 'video' ? <Video className="h-4 w-4" /> : selectedMedia.type === 'audio' ? <Volume2 className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                          <span className="truncate">{selectedMedia.file_name || selectedMedia.type}</span>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedMedia(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    {isWebchatConversation(selectedConversation) && (
                      <p className="text-xs text-muted-foreground">
                        Balasan media saat ini hanya didukung untuk percakapan WhatsApp. Webchat tetap mendukung balasan teks.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <input
                        ref={mediaInputRef}
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,audio/mpeg,audio/mp4,audio/ogg,audio/webm,video/mp4,video/webm"
                        onChange={(e) => handleMediaSelect(e.target.files?.[0] || null)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => mediaInputRef.current?.click()}
                        disabled={isSendingMessage || isUploadingMedia || isWebchatConversation(selectedConversation)}
                        className="h-10 w-10"
                        title={isWebchatConversation(selectedConversation) ? "Media reply saat ini hanya didukung untuk WhatsApp" : "Lampirkan media"}
                      >
                        {isUploadingMedia ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleSendVillageLocation}
                        disabled={isSendingMessage || isSendingLocation || isWebchatConversation(selectedConversation)}
                        className="h-10 w-10"
                        title={isWebchatConversation(selectedConversation) ? "Lokasi native hanya didukung untuk WhatsApp" : "Kirim lokasi kantor desa"}
                      >
                        {isSendingLocation ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleOpenContactDialog}
                        disabled={isSendingMessage || isSendingContact || isWebchatConversation(selectedConversation)}
                        className="h-10 w-10"
                        title={importantContactsError || (isWebchatConversation(selectedConversation) ? "Kartu kontak native hanya didukung untuk WhatsApp" : "Kirim kontak penting")}
                      >
                        {isSendingContact ? <RefreshCw className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleSendGovConnectMenu}
                        disabled={isSendingMessage || isSendingMenu || isWebchatConversation(selectedConversation)}
                        className="h-10 w-10"
                        title={isWebchatConversation(selectedConversation) ? "Menu WhatsApp hanya didukung untuk WhatsApp" : "Kirim menu GovConnect"}
                      >
                        {isSendingMenu ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleSendSticker}
                        disabled={isSendingMessage || isSendingAdvancedAction || isWebchatConversation(selectedConversation)}
                        className="h-10 w-10"
                        title={isWebchatConversation(selectedConversation) ? "Sticker hanya didukung untuk WhatsApp" : "Kirim sticker dari URL"}
                      >
                        <Sticker className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleSendPoll}
                        disabled={isSendingMessage || isSendingAdvancedAction || isWebchatConversation(selectedConversation)}
                        className="h-10 w-10"
                        title={isWebchatConversation(selectedConversation) ? "Poll hanya didukung untuk WhatsApp" : "Kirim poll"}
                      >
                        <BarChart3 className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => openAdvancedDialog('emoji')}
                        disabled={isSendingMessage || isSendingAdvancedAction}
                        className="h-10 w-10"
                        title="Pilih emoji/icon"
                      >
                        <SmilePlus className="h-4 w-4" />
                      </Button>
                      <Input
                        placeholder={selectedMedia ? "Tambahkan caption..." : "Ketik pesan..."}
                        value={messageInput}
                        onChange={(e) => handleMessageInputChange(e.target.value)}
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
                        disabled={isSendingMessage || isUploadingMedia || isSendingAdvancedAction || (!messageInput.trim() && !selectedMedia)}
                        className="h-10 px-4"
                      >
                        {isSendingMessage ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
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

      <Dialog open={!!advancedDialog.type} onOpenChange={(open) => !open && closeAdvancedDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {advancedDialog.type === 'sticker' && 'Kirim Sticker'}
              {advancedDialog.type === 'poll' && 'Kirim Polling'}
              {advancedDialog.type === 'emoji' && 'Kirim Icon / Emoji'}
              {advancedDialog.type === 'reaction' && 'Reaction Pesan'}
              {advancedDialog.type === 'edit' && 'Edit Pesan'}
              {advancedDialog.type === 'delete' && 'Hapus Pesan'}
            </DialogTitle>
            <DialogDescription>Preview sebelum dikirim ke WhatsApp.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {advancedDialog.type === 'sticker' && (
              <>
                <Input value={stickerUrl} onChange={(event) => setStickerUrl(event.target.value)} placeholder="https://.../sticker.webp" />
                <div className="flex min-h-36 items-center justify-center rounded-lg border bg-muted/40 p-3">
                  {stickerUrl.trim() ? <img src={stickerUrl.trim()} alt="Preview sticker" className="max-h-32 rounded" /> : <span className="text-sm text-muted-foreground">Preview sticker muncul setelah URL diisi.</span>}
                </div>
              </>
            )}
            {advancedDialog.type === 'poll' && (
              <>
                <Input value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} placeholder="Pertanyaan polling" />
                <textarea className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm" value={pollOptionsText} onChange={(event) => setPollOptionsText(event.target.value)} placeholder="Satu pilihan per baris" />
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <div className="font-medium">{pollQuestion || 'Pertanyaan polling'}</div>
                  <div className="mt-2 space-y-1">
                    {pollOptionsText.split('\n').filter(Boolean).map((option, index) => <div key={`${option}-${index}`} className="rounded border bg-background px-2 py-1">{option}</div>)}
                  </div>
                </div>
              </>
            )}
            {advancedDialog.type === 'emoji' && (
              <>
                <div className="grid grid-cols-6 gap-2">
                  {quickEmojis.map((emoji) => <button key={emoji} type="button" onClick={() => setSelectedEmoji(emoji)} className={`rounded-lg border p-2 text-2xl hover:bg-muted ${selectedEmoji === emoji ? 'border-primary bg-primary/10' : ''}`}>{emoji}</button>)}
                </div>
                <Input value={emojiText} onChange={(event) => setEmojiText(event.target.value)} placeholder="Tambahkan teks opsional" />
                <div className="rounded-lg border bg-green-500 p-3 text-white">{selectedEmoji}{emojiText.trim() ? ` ${emojiText.trim()}` : ''}</div>
              </>
            )}
            {advancedDialog.type === 'reaction' && (
              <>
                <div className="grid grid-cols-6 gap-2">
                  {quickEmojis.slice(0, 8).map((emoji) => <button key={emoji} type="button" onClick={() => setReactionEmoji(emoji)} className={`rounded-lg border p-2 text-2xl hover:bg-muted ${reactionEmoji === emoji ? 'border-primary bg-primary/10' : ''}`}>{emoji}</button>)}
                </div>
                <Input value={reactionEmoji} onChange={(event) => setReactionEmoji(event.target.value)} placeholder="Emoji atau remove" />
              </>
            )}
            {advancedDialog.type === 'edit' && <Input value={editMessageText} onChange={(event) => setEditMessageText(event.target.value)} placeholder="Teks pengganti" />}
            {advancedDialog.type === 'delete' && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">Pesan akan direvoke/dihapus dari WhatsApp jika provider mengizinkan.</div>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeAdvancedDialog}>Batal</Button>
            {advancedDialog.type === 'sticker' && <Button type="button" onClick={submitSticker} disabled={isSendingAdvancedAction || !stickerUrl.trim()}>Kirim</Button>}
            {advancedDialog.type === 'poll' && <Button type="button" onClick={submitPoll} disabled={isSendingAdvancedAction || !pollQuestion.trim()}>Kirim</Button>}
            {advancedDialog.type === 'emoji' && <Button type="button" onClick={submitEmojiMessage}>Pakai</Button>}
            {advancedDialog.type === 'reaction' && advancedDialog.targetMessage && <Button type="button" onClick={() => submitMessageAction('reaction', advancedDialog.targetMessage!, { emoji: reactionEmoji.trim() })} disabled={isSendingAdvancedAction || !reactionEmoji.trim()}>Kirim</Button>}
            {advancedDialog.type === 'edit' && advancedDialog.targetMessage && <Button type="button" onClick={() => submitMessageAction('edit', advancedDialog.targetMessage!, { body: editMessageText.trim() })} disabled={isSendingAdvancedAction || !editMessageText.trim()}>Simpan</Button>}
            {advancedDialog.type === 'delete' && advancedDialog.targetMessage && <Button type="button" variant="destructive" onClick={() => submitMessageAction('delete', advancedDialog.targetMessage!)} disabled={isSendingAdvancedAction}>Hapus</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showContactDialog} onOpenChange={setShowContactDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Kirim Kontak Penting</DialogTitle>
            <DialogDescription>Pilih kontak desa untuk dikirim sebagai kartu kontak WhatsApp.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Cari nama, telepon, kategori, kontak WhatsApp..."
                value={contactSearchQuery}
                onChange={(event) => setContactSearchQuery(event.target.value)}
              />
              <Button type="button" variant="outline" onClick={handleSyncWaContacts} disabled={isSyncingWaContacts}>
                {isSyncingWaContacts ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
            {importantContactsError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {importantContactsError}
              </div>
            )}
            <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
              {filteredImportantContacts.length === 0 && filteredWaProviderContacts.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Tidak ada kontak yang cocok.
                </div>
              ) : (
                <>
                  {filteredImportantContacts.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kontak Penting Desa</div>
                      {filteredImportantContacts.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          className="flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted"
                          onClick={() => handleSendImportantContact(contact)}
                          disabled={isSendingContact}
                        >
                          <div className="min-w-0">
                            <div className="font-medium">{contact.name}</div>
                            <div className="text-sm text-muted-foreground">{contact.phone}</div>
                            {(contact.category?.name || contact.description) && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {[contact.category?.name, contact.description].filter(Boolean).join(' • ')}
                              </div>
                            )}
                          </div>
                          <UserRound className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  )}
                  {filteredWaProviderContacts.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kontak WhatsApp Provider</div>
                      {filteredWaProviderContacts.slice(0, 80).map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          className="flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted"
                          onClick={() => handleSendImportantContact(contact)}
                          disabled={isSendingContact}
                        >
                          <div className="min-w-0">
                            <div className="font-medium">{contact.name}</div>
                            <div className="text-sm text-muted-foreground">{contact.phone}</div>
                            {contact.pushName && contact.pushName !== contact.name && (
                              <div className="mt-1 text-xs text-muted-foreground">Push name: {contact.pushName}</div>
                            )}
                          </div>
                          <UserRound className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                  if (value && value !== "empty" && value !== "Lainnya") {
                    setTakeoverReason(value)
                  } else {
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

      {/* Image Lightbox */}
      <Dialog open={!!lightboxMedia} onOpenChange={(open) => !open && setLightboxMedia(null)}>
        <DialogContent className="max-w-4xl border-0 bg-transparent p-0 shadow-none">
          {lightboxMedia && (
            <div className="relative overflow-hidden rounded-lg bg-black/90 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxMedia.url}
                alt={lightboxMedia.alt}
                className="max-h-[85vh] w-full object-contain"
              />
            </div>
          )}
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
