"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Send, Paperclip, Smile, Image as ImageIcon, FileText, CheckCircle } from "lucide-react";

/**
 * ChatAnimation Component
 * Displays an animated chat conversation in the hero section
 * Shows a sequence of messages with auto-scroll and typing indicators
 */

type Message = {
    id: number;
    type: "bot" | "user";
    text: string;
    isImage?: boolean;
    isDocument?: boolean;
};

const allMessages: Omit<Message, "id">[] = [
  // Conversation 1: Laporan Jalan Rusak
  { type: "bot", text: "Halo! 👋 Selamat datang di Tanggapin. Saya Tanggapin AI dan siap membantu layanan kelurahan. Ada yang bisa saya bantu?" },
  { type: "user", text: "Saya mau lapor jalan rusak di RT 05" },
  { type: "bot", text: "Baik, saya akan bantu proses laporan Anda. Mohon kirimkan foto lokasi kerusakan jalan 📸" },
  { type: "user", text: "📷 Foto jalan berlubang", isImage: true },
  { type: "bot", text: "Foto diterima! ✅ Mohon jelaskan lokasi lebih detail (nama jalan, dekat landmark apa?)" },
  { type: "user", text: "Jl. Melati No. 15, depan warung Pak Ahmad" },
  { type: "bot", text: "Laporan berhasil dikirim! 🎉\n\n📋 Nomor Laporan: #LAP-20241208-001\n📍 Lokasi: Jl. Melati No. 15\n⏱️ Estimasi: 2-3 hari kerja\n\nAnda akan mendapat notifikasi update status." },
  
  // Conversation 2: Pengajuan Surat
  { type: "user", text: "Saya juga mau ajukan surat keterangan domisili" },
  { type: "bot", text: "Tentu! Untuk pengajuan Surat Keterangan Domisili, saya butuh beberapa dokumen:\n\n1️⃣ Foto KTP\n2️⃣ Foto Kartu Keluarga\n3️⃣ Surat pengantar RT/RW" },
  { type: "user", text: "📄 Dokumen KTP & KK", isDocument: true },
  { type: "bot", text: "Dokumen diterima! ✅ Apakah Anda sudah memiliki surat pengantar dari RT/RW?" },
  { type: "user", text: "Sudah ada, ini fotonya" },
  { type: "user", text: "📄 Surat Pengantar RT", isDocument: true },
  { type: "bot", text: "Semua dokumen lengkap! 📝\n\nPengajuan Surat Keterangan Domisili Anda sedang diproses.\n\n📋 No. Pengajuan: #SKD2024015\n⏱️ Estimasi selesai: 1-2 hari kerja\n📍 Pengambilan: Kantor Kelurahan" },
  
  // Conversation 3: Informasi
  { type: "user", text: "Jam operasional kelurahan kapan ya?" },
  { type: "bot", text: "🕐 Jam Operasional Kelurahan:\n\nSenin - Kamis: 08.00 - 16.00\nJumat: 08.00 - 11.30\nSabtu - Minggu: Libur\n\n📞 Hotline: 021-12345678\n📍 Jl. Raya Kelurahan No. 1" },
  { type: "user", text: "Terima kasih banyak! 🙏" },
  { type: "bot", text: "Sama-sama! 😊 Senang bisa membantu.\n\nJika ada pertanyaan lain, jangan ragu untuk menghubungi saya kapan saja. Tanggapin siap melayani 24/7 melalui Tanggapin AI! 💪" },
];


export const ChatAnimation = () => {
  const [messages, setMessages] = useState<any[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    let isMounted = true;

    const playSequence = async () => {
      if (!isMounted) return;

      if (currentIndex >= allMessages.length) {
        timeout = setTimeout(() => {
          if (isMounted) {
            setMessages([]);
            setCurrentIndex(0);
          }
        }, 5000);
        return;
      }

      const nextMsg = allMessages[currentIndex];
      
      if (nextMsg.type === "bot") {
        if (isMounted) setIsTyping(true);
        await new Promise(r => setTimeout(r, 1000)); 
        if (isMounted) setIsTyping(false);
      } else {
        await new Promise(r => setTimeout(r, 800));
      }

      if (isMounted) {
        setMessages(prev => [...prev, { ...nextMsg, id: Date.now() }]);
        setCurrentIndex(prev => prev + 1);
      }
    };

    timeout = setTimeout(playSequence, 500);
    
    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [currentIndex]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  return (
    <div className="relative w-full max-w-sm mx-auto">
      {/* Phone Mockup Frame */}
      <div className="relative bg-[#111] rounded-[2.5rem] p-3 shadow-2xl border-4 border-[#333]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-[#111] rounded-b-xl z-20"></div>
        
        {/* Screen Content */}
        <div className="bg-[#0b141a] h-[600px] rounded-4xl overflow-hidden flex flex-col relative">
           {/* WhatsApp Header */}
           <div className="bg-[#202c33] p-4 pt-8 flex items-center gap-3 shadow-sm z-10 sticky top-0">
             <div className="w-8 h-8 rounded-full bg-[#112D4E] flex items-center justify-center text-white font-bold text-xs ring-1 ring-white/10">T</div>
             <div className="flex-1">
               <div className="text-white font-bold text-sm">Tanggapin</div>
               <div className="text-[#8696a0] text-xs">Akun Terverifikasi AI • Online 24/7</div>
             </div>
           </div>

           {/* Chat Area */}
           <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d986a26d40.png')] bg-repeat opacity-90" ref={scrollRef}>
             <AnimatePresence mode="popLayout">
               {messages.map((msg) => (
                 <motion.div
                   key={msg.id}
                   initial={{ opacity: 0, y: 10, scale: 0.95 }}
                   animate={{ opacity: 1, y: 0, scale: 1 }}
                   transition={{ duration: 0.2 }}
                   className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}
                 >
                   <div 
                     className={`max-w-[85%] rounded-2xl p-3 text-sm shadow-sm relative ${
                       msg.type === "user" 
                         ? "bg-[#005c4b] text-white rounded-tr-none" 
                         : "bg-[#202c33] text-white rounded-tl-none border border-white/5"
                     }`}
                   >
                     {/* Triangle pointer */}
                     <span className={`absolute top-0 w-0 h-0 border-[6px] border-transparent ${
                        msg.type === "user" 
                        ? "-right-2 border-t-[#005c4b] border-l-[#005c4b]" 
                        : "-left-2 border-t-[#202c33] border-r-[#202c33]"
                     }`}></span>

                     {msg.isImage && (
                       <div className="mb-2 rounded-lg bg-black/20 h-32 flex items-center justify-center border border-white/10">
                         <ImageIcon className="w-8 h-8 text-white/50" />
                       </div>
                     )}
                     
                     {msg.isDocument && (
                       <div className="mb-2 p-3 rounded-lg bg-black/20 flex items-center gap-3 border border-white/10">
                         <FileText className="w-8 h-8 text-red-400" />
                         <div className="text-xs truncate max-w-[120px]">
                            <div className="font-bold">file.pdf</div>
                            <div className="opacity-60">120 KB</div>
                         </div>
                       </div>
                     )}

                     <div className="whitespace-pre-line leading-relaxed">{msg.text}</div>
                     <div className={`text-[10px] text-right mt-1 ${msg.type === "user" ? "text-white/60" : "text-white/40"}`}>
                       Now <CheckCircle className={`inline w-3 h-3 ml-0.5 ${msg.type === "user" ? "text-[#53bdeb]" : ""}`} />
                     </div>
                   </div>
                 </motion.div>
               ))}
             </AnimatePresence>
             
             {isTyping && (
               <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                 <div className="bg-[#202c33] px-4 py-3 rounded-2xl rounded-tl-none border border-white/5 flex gap-1.5 items-center">
                   <span className="w-1.5 h-1.5 bg-[#8696a0] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                   <span className="w-1.5 h-1.5 bg-[#8696a0] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                   <span className="w-1.5 h-1.5 bg-[#8696a0] rounded-full animate-bounce"></span>
                 </div>
               </motion.div>
             )}
           </div>

           {/* Input Bar */}
           <div className="bg-[#202c33] p-3 flex items-center gap-2 z-10 sticky bottom-0">
             <div className="p-2 text-[#8696a0]"><Smile className="w-5 h-5"/></div>
             <div className="p-2 text-[#8696a0]"><Paperclip className="w-5 h-5"/></div>
             <div className="flex-1 bg-[#2a3942] rounded-lg px-4 py-2 text-sm text-[#8696a0]">
               Ketik pesan...
             </div>
             <div className="p-2 bg-[#00a884] rounded-full text-white">
               <Send className="w-4 h-4" />
             </div>
           </div>
        </div>
      </div>
      
    </div>
  );
};
