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
} from "lucide-react"

interface Conversation {
  id: string
  wa_user_id: string
  user_name: string | null
  last_message: string | null
  last_message_at: string
  unread_count: number
  is_takeover: boolean
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
    { value: "Follow-up dari tiket sebelumnya", label: "Follow-up tiket" },
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

  // Keep ref in sync with state
  useEffect(() => {
    selectedConversationRef.current = selectedConversation
  }, [selectedConversation])

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
  }, [selectedConversation?.wa_user_id])

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
            (c: Conversation) => c.wa_user_id === selectedConversationRef.current?.wa_user_id
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
  const fetchMessagesSilent = useCallback(async (wa_user_id: string) => {
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/livechat/conversations/${encodeURIComponent(wa_user_id)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) return

      const data = await response.json()
      if (data.success) {
        setMessages(data.data?.messages || [])
      }
    } catch (error) {
      console.error("Error fetching messages:", error)
    }
  }, [])

  // Fetch messages with loading (for initial selection)
  const fetchMessagesWithLoading = useCallback(async (wa_user_id: string) => {
    setIsInitialMessagesLoading(true)
    try {
      const token = localStorage.getItem("token")
      const response = await fetch(`/api/livechat/conversations/${encodeURIComponent(wa_user_id)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) throw new Error("Failed to fetch messages")

      const data = await response.json()
      if (data.success) {
        setMessages(data.data?.messages || [])
        previousMessagesLengthRef.current = 0 // Reset so it scrolls
        
        // Mark as read
        await fetch(`/api/livechat/conversations/${encodeURIComponent(wa_user_id)}/read`, {
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

  // Polling for real-time updates (silent - no loading indicators)
  useEffect(() => {
    // Clear previous polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }

    // Start new polling
    pollingRef.current = setInterval(() => {
      fetchConversationsSilent()
      if (selectedConversationRef.current) {
        fetchMessagesSilent(selectedConversationRef.current.wa_user_id)
      }
    }, 3000) // Poll every 3 seconds

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [fetchConversationsSilent, fetchMessagesSilent])

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
    await fetchMessagesWithLoading(conv.wa_user_id)
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
        `/api/livechat/conversations/${encodeURIComponent(selectedConversation.wa_user_id)}/send`,
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
        await fetchMessagesSilent(selectedConversation.wa_user_id)
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
        `/api/livechat/takeover/${encodeURIComponent(selectedConversation.wa_user_id)}`,
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
          title: "Takeover Aktif",
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
        `/api/livechat/takeover/${encodeURIComponent(selectedConversation.wa_user_id)}`,
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
          title: "Takeover Selesai",
          description: "AI Bot akan kembali menangani percakapan ini.",
        })
      } else {
        throw new Error(data.error || "Gagal mengakhiri takeover")
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Gagal mengakhiri takeover",
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
        `/api/livechat/conversations/${encodeURIComponent(selectedConversation.wa_user_id)}`,
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

  // Filter conversations by search
  const filteredConversations = conversations.filter((conv) => {
    const searchLower = searchQuery.toLowerCase()
    return (
      conv.wa_user_id.includes(searchLower) ||
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
    return phone.slice(-2)
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
            <p className="text-sm whitespace-pre-wrap break-words">{caption}</p>
          )}
        </div>
      )
    }
    
    // Check if message mentions it has an image but URL not directly visible
    if (msg.message_text.includes('[Gambar]') || msg.message_text.includes('[Image]')) {
      return (
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4" />
          <p className="text-sm whitespace-pre-wrap break-words">{msg.message_text}</p>
        </div>
      )
    }
    
    return (
      <p className="text-sm whitespace-pre-wrap break-words">{msg.message_text}</p>
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
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1 text-xs">
                  Semua
                </TabsTrigger>
                <TabsTrigger value="takeover" className="flex-1 text-xs">
                  <Hand className="h-3 w-3 mr-1" />
                  Takeover
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
                    className={`w-full p-3 text-left hover:bg-accent transition-colors ${
                      selectedConversation?.id === conv.id ? "bg-accent" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback className={`text-xs ${conv.is_takeover ? "bg-orange-500 text-white" : "bg-green-500 text-white"}`}>
                          {getInitials(conv.user_name, conv.wa_user_id)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm truncate">
                            {conv.user_name || conv.wa_user_id}
                          </p>
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
                        <div className="mt-1">
                          {conv.is_takeover ? (
                            <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs py-0">
                              <Hand className="h-3 w-3 mr-1" />
                              Takeover
                            </Badge>
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
                      {getInitials(selectedConversation.user_name, selectedConversation.wa_user_id)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-sm">
                      {selectedConversation.user_name || selectedConversation.wa_user_id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedConversation.wa_user_id}
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
                      <span className="hidden sm:inline">Takeover</span>
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
                            className={`max-w-[75%] rounded-lg p-3 shadow-sm ${
                              msg.direction === "OUT"
                                ? "bg-green-500 text-white"
                                : "bg-white dark:bg-gray-800 border"
                            }`}
                          >
                            {renderMessageContent(msg)}
                            <div className={`flex items-center gap-1 mt-1.5 text-xs ${
                              msg.direction === "OUT" ? "text-green-100" : "text-muted-foreground"
                            }`}>
                              <span>{formatTime(msg.timestamp)}</span>
                              {msg.direction === "OUT" && (
                                <>
                                  <span className="mx-0.5">•</span>
                                  <span className="capitalize text-[10px]">
                                    {msg.source === 'ADMIN' ? 'Admin' : msg.source === 'AI' ? 'AI' : 'System'}
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
                    <p className="text-xs">Klik "Takeover" untuk mengambil alih.</p>
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
              Dengan mengambil alih percakapan ini, AI Bot tidak akan membalas pesan dari pengguna ini hingga Anda mengakhiri takeover.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-sm font-medium">Template Alasan</label>
              <Select 
                value={takeoverReasonTemplate} 
                onValueChange={(value) => {
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
                placeholder="Tulis alasan takeover..."
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
              Pengguna: <span className="font-medium text-foreground">{selectedConversation?.user_name || selectedConversation?.wa_user_id}</span>
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
