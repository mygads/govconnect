"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle,
  MapPin,
  X,
  Minus,
  Send,
  RotateCcw,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Sparkles,
  Bot,
  User,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLiveChat } from "@/hooks/use-live-chat";
import { ChatMessage } from "@/lib/live-chat-types";
import Image from "next/image";

// Message status icon component
function MessageStatus({ status }: { status: ChatMessage["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="w-3 h-3 text-muted-foreground animate-pulse" />;
    case "sent":
      return <Check className="w-3 h-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="w-3 h-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="w-3 h-3 text-blue-500" />;
    case "error":
      return <AlertCircle className="w-3 h-3 text-destructive" />;
    default:
      return null;
  }
}

// Processing status type
interface ProcessingStatus {
  stage: string;
  message: string;
  progress: number;
}

// Typing indicator component - simple dots animation for all cases
function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-secondary to-primary flex items-center justify-center">
        <Bot className="w-4 h-4 text-white" />
      </div>
      <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-2.5">
        {/* Tampilan sederhana - user tidak perlu tau AI atau admin yang balas */}
        <div className="flex gap-1">
          <motion.span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
          />
          <motion.span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
          />
          <motion.span
            className="w-2 h-2 bg-muted-foreground/50 rounded-full"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
          />
        </div>
      </div>
    </div>
  );
}


// Single message component
function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const formattedTime = new Date(message.timestamp).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
      className={`flex items-end gap-2 px-4 py-1 ${isUser ? "flex-row-reverse" : ""}`}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-secondary to-primary flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-white" />
        </div>
      )}
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-white" />
        </div>
      )}

      {/* Message bubble */}
      <div className={`max-w-[75%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`px-4 py-2.5 rounded-2xl ${
            isUser
              ? "bg-gradient-to-br from-secondary to-secondary/90 text-secondary-foreground rounded-br-md"
              : "bg-muted rounded-bl-md"
          }`}
        >
          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
            {message.content}
          </p>
        </div>
        
        {/* Time and status */}
        <div className={`flex items-center gap-1 mt-1 px-1 ${isUser ? "justify-end" : ""}`}>
          <span className="text-[10px] text-muted-foreground">{formattedTime}</span>
          {isUser && <MessageStatus status={message.status} />}
        </div>
      </div>
    </motion.div>
  );
}

// Welcome message component
function WelcomeMessage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-8 px-4 text-center"
    >
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-secondary/20 to-primary/20 flex items-center justify-center mb-4">
        <Sparkles className="w-8 h-8 text-secondary" />
      </div>
      <h3 className="font-semibold text-lg mb-2">Selamat Datang! 👋</h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        Saya asisten virtual GovConnect. Silakan tanyakan informasi seputar layanan kelurahan, 
        pengajuan surat, atau laporan keluhan.
      </p>
      <div className="flex flex-wrap gap-2 mt-4 justify-center">
        {["Info layanan", "Cara pengajuan surat", "Lapor keluhan"].map((suggestion) => (
          <span
            key={suggestion}
            className="text-xs bg-secondary/10 text-secondary px-3 py-1.5 rounded-full"
          >
            {suggestion}
          </span>
        ))}
      </div>
    </motion.div>
  );
}


// Main Live Chat Widget
export function LiveChatWidget({ isDark }: { isDark?: boolean }) {
  const {
    isOpen,
    isMinimized,
    messages,
    isTyping,
    processingStatus,
    unreadCount,
    isLoaded,
    isTakeover,
    adminName,
    selectedVillage,
    openChat,
    closeChat,
    minimizeChat,
    maximizeChat,
    toggleChat,
    sendMessage,
    clearChat,
    selectVillage,
    switchVillage,
    messagesEndRef,
  } = useLiveChat();

  const [inputValue, setInputValue] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [villages, setVillages] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [villagesLoading, setVillagesLoading] = useState(false);
  const [villagesError, setVillagesError] = useState<string | null>(null);
  const [villagesFetched, setVillagesFetched] = useState(false);
  const [selectedVillageId, setSelectedVillageId] = useState<string>("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const canChat = !!selectedVillage?.id;

  // Fetch villages list when chat is opened and no village selected yet
  useEffect(() => {
    if (!isOpen || canChat || villagesLoading || villagesFetched) return;

    setVillagesLoading(true);
    setVillagesError(null);

    fetch('/api/public/webchat/villages')
      .then(async (res) => {
        if (!res.ok) return { success: false, data: [] };
        return res.json();
      })
      .then((json) => {
        const data = Array.isArray(json?.data) ? json.data : [];
        setVillages(data);
      })
      .catch((err) => {
        setVillagesError(err?.message || 'Gagal memuat daftar desa');
      })
      .finally(() => {
        setVillagesLoading(false);
        setVillagesFetched(true);
      });
  }, [isOpen, canChat, villagesLoading, villagesFetched]);

  // Auto scroll to bottom when messages change
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    if (!canChat) return;
    sendMessage(inputValue);
    setInputValue("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearChat = () => {
    clearChat();
    setShowClearConfirm(false);
  };

  const handleStartWithVillage = () => {
    const v = villages.find((x) => x.id === selectedVillageId);
    if (!v) return;
    selectVillage({ id: v.id, name: v.name, slug: v.slug });
  };

  if (!isLoaded) return null;

  return (
    <>
      {/* Chat Button - Right Side */}
      <AnimatePresence>
        {(!isOpen || isMinimized) && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed bottom-6 right-6 z-50"
          >
            <Button
              onClick={isMinimized ? maximizeChat : openChat}
              className="relative w-14 h-14 rounded-full bg-gradient-to-br from-secondary to-primary hover:from-secondary/90 hover:to-primary/90 shadow-lg shadow-secondary/25 hover:shadow-xl hover:shadow-secondary/30 transition-all duration-300"
            >
              <MessageCircle className="w-6 h-6 text-white" />
              
              {/* Unread badge */}
              {unreadCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -left-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs font-bold rounded-full flex items-center justify-center"
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </motion.span>
              )}
              
              {/* Pulse animation */}
              <span className="absolute inset-0 rounded-full bg-secondary/30 animate-ping" />
            </Button>
            
            {/* Tooltip - Left Side - Hidden on mobile */}
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1 }}
              className="hidden sm:block absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-card border border-border shadow-lg rounded-lg px-3 py-2 whitespace-nowrap"
            >
              <p className="text-sm font-medium">Chat dengan kami! 💬</p>
              <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-card border-r border-t border-border rotate-45" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Chat Window - Right Side */}
      <AnimatePresence>
        {isOpen && !isMinimized && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-48px)] h-[600px] max-h-[calc(100vh-100px)] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-secondary to-primary p-4 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Image
                      src={"/logo.png"}
                      alt="GovConnect"
                      width={32}
                      height={32}
                      className=""
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 border-2 border-white rounded-full" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">
                      {isTakeover ? (adminName || 'Admin') : 'Asisten GovConnect'}
                    </h3>
                    <p className="text-xs text-white/80">
                      {isTakeover ? '🟢 Admin sedang membantu Anda' : 'Online • Siap membantu'}
                    </p>
                    <p className="text-[11px] text-white/80 mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {canChat ? `Terhubung ke: ${selectedVillage?.name}` : 'Pilih desa terlebih dulu'}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-1">
                  {/* Switch Village */}
                  {canChat && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setShowClearConfirm(false);
                        setSelectedVillageId('');
                        switchVillage();
                      }}
                      className="w-8 h-8 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
                      title="Ganti Desa"
                    >
                      <MapPin className="w-4 h-4" />
                    </Button>
                  )}

                  {/* New Chat Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowClearConfirm(true)}
                    className="w-8 h-8 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
                    title="Chat Baru"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                  
                  {/* Minimize Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={minimizeChat}
                    className="w-8 h-8 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  
                  {/* Close Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={closeChat}
                    className="w-8 h-8 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Clear Confirmation */}
            <AnimatePresence>
              {showClearConfirm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      Mulai percakapan baru?
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowClearConfirm(false)}
                        className="h-7 px-2 text-xs"
                      >
                        Batal
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleClearChat}
                        className="h-7 px-2 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Hapus
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>


            {/* Messages Area */}
            <div 
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto py-4 space-y-2 bg-gradient-to-b from-background to-muted/30"
            >
              {!canChat ? (
                <div className="px-4">
                  <div className="border border-border bg-card/80 rounded-2xl p-4">
                    <p className="text-sm font-medium">Pilih desa untuk memulai chat</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Chat akan terhubung ke basis pengetahuan desa yang dipilih.
                    </p>

                    <div className="mt-4 space-y-3">
                      <Select value={selectedVillageId} onValueChange={setSelectedVillageId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={villagesLoading ? 'Memuat daftar desa...' : 'Pilih desa'} />
                        </SelectTrigger>
                        <SelectContent>
                          {villages.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {villagesError && (
                        <p className="text-xs text-destructive">{villagesError}</p>
                      )}

                      {!villagesLoading && !villagesError && villagesFetched && villages.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          Belum ada desa yang tersedia untuk Webchat.
                        </p>
                      )}

                      <Button
                        onClick={handleStartWithVillage}
                        disabled={!selectedVillageId || villagesLoading}
                        className="w-full"
                      >
                        Mulai Chat
                      </Button>
                    </div>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <WelcomeMessage />
              ) : (
                <>
                  {messages.map((message) => (
                    <ChatBubble key={message.id} message={message} />
                  ))}
                  {isTyping && <TypingIndicator />}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-border bg-card">
              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={!canChat}
                    placeholder="Ketik pesan..."
                    rows={1}
                    className="w-full resize-none rounded-xl border border-border bg-muted/50 px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all placeholder:text-muted-foreground"
                    style={{ maxHeight: "120px" }}
                  />
                </div>
                
                <Button
                  onClick={handleSend}
                  disabled={!canChat || !inputValue.trim() || isTyping}
                  className="w-11 h-11 rounded-xl bg-gradient-to-br from-secondary to-primary hover:from-secondary/90 hover:to-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  <Send className="w-5 h-5 text-white" />
                </Button>
              </div>
              
              {/* Footer */}
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                Didukung oleh GovConnect AI • Tekan Enter untuk kirim
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default LiveChatWidget;
