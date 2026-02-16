"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, CheckCircle2, Send, Image as ImageIcon } from "lucide-react";

export type ScenarioType = "report" | "service" | "info";

export const scenarios = {
  report: [
    { 
      type: "user", 
      text: "Lapor Pak, ada jalan berlubang di Jl. Merdeka No. 45, bahaya buat motor." 
    },
    { 
      type: "user", 
      isImage: true, 
      imageUrl: "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&q=80&w=400",
      caption: "Foto lokasi kerusakan"
    },
    { 
      type: "bot", 
      text: "Terima kasih laporannya! Lokasi terdeteksi di koordinat -6.200, 106.816 (Kec. Gambir). Laporan #Tiket-202403-001 sudah diteruskan ke Dinas PU.\n\nEstimasi penanganan: 2x24 jam.\nPantau status di: govconnect.id/track/202403-001" 
    }
  ],
  service: [
    { 
      type: "user", 
      text: "Min, syarat bikin SKCK baru apa aja ya?" 
    },
    { 
      type: "bot", 
      text: "Halo! Berikut syarat penerbitan SKCK Baru:\n\n1. Fotokopi KTP & KK\n2. Fotokopi Akta Kelahiran\n3. Pas foto 4x6 latar merah (6 lembar)\n\nMau saya bantu ambilkan antrian online untuk besok di Polsek terdekat?" 
    }
  ],
  info: [
    { 
      type: "user", 
      text: "Info dong, jadwal pencairan BLT bulan ini kapan?" 
    },
    { 
      type: "bot", 
      text: "Untuk wilayah Kelurahan Sukamaju, jadwal pencairan BLT Mitigasi Risiko Pangan adalah:\n\n📅 Selasa, 19 Maret 2024\n⏰ 08:00 - 12:00 WIB\n📍 Kantor Kelurahan (Loket 2)\n\nHarap bawa KTP asli dan undangan barcode ya!" 
    }
  ]
};

export const UseCaseChat = ({ scenario = "report" }: { scenario: ScenarioType }) => {
  const [messages, setMessages] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Use a ref to track if component is mounted to prevent state updates after unmount
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Reset messages when scenario changes
  useEffect(() => {
    setMessages([]);
    let timeoutIds: NodeJS.Timeout[] = [];
    
    const conversation = scenarios[scenario] || scenarios.report;
    let cumulativeDelay = 500;

    conversation.forEach((msg, index) => {
      // Typing delay based on text length (simulated)
      const typingDelay = msg.text ? Math.min(msg.text.length * 50, 2000) : 1000;
      
      // Add typing indicator
      const typingTimeout = setTimeout(() => {
        if (!isMounted.current) return;
        setMessages(prev => {
            // Check if last message is already typing, if so don't add
            if (prev.length > 0 && prev[prev.length - 1].type === 'typing') return prev;
            return [...prev, { type: 'typing', isUser: msg.type === 'user', id: `typing-${index}` }];
        });
      }, cumulativeDelay);
      
      cumulativeDelay += 1500; // Time showing typing indicator

      // Add actual message
      const msgTimeout = setTimeout(() => {
        if (!isMounted.current) return;
        setMessages(prev => {
          const filtered = prev.filter(m => m.type !== 'typing');
          return [...filtered, { ...msg, id: Date.now() + index }];
        });
      }, cumulativeDelay);
      
      cumulativeDelay += 1000; // Pause after message options
      
      timeoutIds.push(typingTimeout, msgTimeout);
    });

    return () => {
      timeoutIds.forEach(clearTimeout);
    };
  }, [scenario]);

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="w-full max-w-sm mx-auto bg-white dark:bg-gray-950 rounded-4xl shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-800 h-[600px] flex flex-col relative">
      {/* Header */}
      <div className="bg-[#112D4E] dark:bg-black p-4 flex items-center justify-between z-20 shadow-md">
        <div className="flex items-center gap-3">
          <div className="relative">
             <div className="w-10 h-10 rounded-full bg-linear-to-tr from-blue-500 to-cyan-400 flex items-center justify-center text-white font-bold text-sm shadow-inner ring-2 ring-white/20">
               AI
             </div>
             <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#112D4E]"></div>
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">Tanggapin AI</h3>
            <p className="text-blue-200 text-xs flex items-center gap-1 opacity-90">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
              Online
            </p>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-sm">
            <MessageCircle className="w-4 h-4 text-white" />
        </div>
      </div>

      {/* Chat Area */}
      <div 
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#F0F2F5] dark:bg-[#0a0a0a] scroll-smooth relative"
      >
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
            style={{ 
                backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', 
                backgroundSize: '20px 20px' 
            }}
        />

        <div className="text-center text-[10px] text-gray-400 my-4 font-medium uppercase tracking-wider bg-black/5 dark:bg-white/5 inline-block mx-auto px-3 py-1 rounded-full">Hari Ini</div>
        
        <AnimatePresence mode="popLayout">
          {messages.map((msg, idx) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className={`flex ${msg.type === 'user' || (msg.type === 'typing' && msg.isUser) ? 'justify-end' : 'justify-start'} relative z-10`}
            >
              {msg.type !== 'user' && !msg.isUser && (
                  <div className="w-6 h-6 rounded-full bg-linear-to-tr from-blue-500 to-cyan-400 flex items-center justify-center text-[8px] text-white font-bold mr-2 mt-auto shrink-0 shadow-sm">
                      AI
                  </div>
              )}
              
              <div 
                className={`max-w-[85%] rounded-2xl p-3 shadow-sm text-sm ${
                  msg.type === 'user' || (msg.type === 'typing' && msg.isUser)
                    ? 'bg-[#112D4E] text-white rounded-br-none' 
                    : 'bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 rounded-bl-none border border-gray-100 dark:border-gray-800'
                }`}
              >
                {msg.type === 'typing' ? (
                  <div className="flex gap-1.5 px-1 py-1 h-5 items-center">
                    <motion.div 
                        animate={{ y: [0, -3, 0] }} 
                        transition={{ repeat: Infinity, duration: 0.6, delay: 0 }}
                        className={`w-1.5 h-1.5 rounded-full ${msg.isUser ? 'bg-blue-300' : 'bg-gray-400'}`} 
                    />
                    <motion.div 
                        animate={{ y: [0, -3, 0] }} 
                        transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }}
                        className={`w-1.5 h-1.5 rounded-full ${msg.isUser ? 'bg-blue-300' : 'bg-gray-400'}`} 
                    />
                    <motion.div 
                        animate={{ y: [0, -3, 0] }} 
                        transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }}
                        className={`w-1.5 h-1.5 rounded-full ${msg.isUser ? 'bg-blue-300' : 'bg-gray-400'}`} 
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {msg.isImage && (
                        <div className="relative rounded-lg overflow-hidden mb-2 mt-1 border border-white/20">
                           {/* eslint-disable-next-line @next/next/no-img-element */}
                           <img 
                                src={msg.imageUrl} 
                                alt="Uplaod" 
                                className="w-full h-32 object-cover"
                            />
                            {msg.caption && (
                                <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] p-1 px-2 backdrop-blur-sm">
                                    {msg.caption}
                                </div>
                            )}
                        </div>
                    )}
                    <p className="whitespace-pre-line leading-relaxed">
                        {msg.text}
                    </p>
                    <div className={`flex items-center justify-end gap-1 mt-1 opacity-60 text-[10px]`}>
                        <span>Baru saja</span>
                        {msg.type === 'user' && <CheckCircle2 className="w-3 h-3 text-blue-300/80" />}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Input Area (Mock) */}
      <div className="p-3 bg-white dark:bg-gray-950 border-t border-gray-100 dark:border-gray-800 z-10">
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-900 rounded-full px-4 py-2.5 border border-transparent transition-all">
          <div className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center text-gray-500">
             <ImageIcon className="w-3 h-3" />
          </div>
          <input 
            type="text" 
            placeholder="Ketik pesan..." 
            className="bg-transparent border-none outline-none focus:ring-0 text-sm w-full dark:text-white placeholder:text-gray-400"
            disabled
          />
          <div className="w-8 h-8 rounded-full bg-[#112D4E] flex items-center justify-center text-white shrink-0 shadow-lg shadow-blue-900/20">
             <Send className="w-3.5 h-3.5 ml-0.5" />
          </div>
        </div>
      </div>
    </div>
  );
};
