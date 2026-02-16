"use client";

import { motion } from "framer-motion";
import { Check, X, Smartphone, Globe, MessageSquare, Database, Server, Headphones, Activity, BarChart, Rocket, Brain, Shield } from "lucide-react";

export const FeatureComparison = () => {
    return (
        <div className="overflow-x-auto relative rounded-3xl border border-gray-200 dark:border-[#333] shadow-2xl bg-white dark:bg-[#050505] scrollbar-hide">
            <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                    <tr className="bg-gray-50/50 dark:bg-[#111] border-b border-gray-200 dark:border-[#333]">
                        <th className="p-6 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-1/3 sticky left-0 bg-gray-50/90 dark:bg-[#111]/90 backdrop-blur-sm z-10">
                            Fitur Utama
                        </th>
                        <th className="p-6 text-center w-1/4 border-l border-gray-200 dark:border-[#333]">
                            <div className="flex flex-col items-center gap-2 mb-2">
                                <div className="w-12 h-12 bg-gray-100 dark:bg-[#222] rounded-xl flex items-center justify-center">
                                    <Smartphone className="w-6 h-6 text-gray-500" />
                                </div>
                                <div className="text-lg font-bold text-gray-700 dark:text-gray-300">WhatsApp Manual</div>
                            </div>
                            <div className="text-xs font-normal text-gray-500 dark:text-gray-400">Admin Manusia</div>
                        </th>
                        <th className="p-6 text-center w-1/4 border-l border-gray-200 dark:border-[#333]">
                            <div className="flex flex-col items-center gap-2 mb-2">
                                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-xl flex items-center justify-center">
                                    <Globe className="w-6 h-6 text-red-500" />
                                </div>
                                <div className="text-lg font-bold text-gray-700 dark:text-gray-300">SP4N LAPOR!</div>
                            </div>
                            <div className="text-xs font-normal text-gray-500 dark:text-gray-400">Aplikasi Pemerintah</div>
                        </th>
                        <th className="p-6 text-center w-1/4 bg-blue-50/50 dark:bg-blue-900/10 border-l border-blue-200 dark:border-blue-800 relative shadow-inner">
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 to-cyan-400" />
                            <div className="flex flex-col items-center gap-3 mb-2">
                                <div className="w-14 h-14 bg-gradient-to-tr from-blue-500 to-cyan-400 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg ring-4 ring-blue-100 dark:ring-blue-900/30">
                                    AI
                                </div>
                                <div className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-cyan-500 dark:from-blue-400 dark:to-cyan-300">Tanggapin AI</div>
                            </div>
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold uppercase tracking-wider shadow-sm border border-blue-200 dark:border-blue-700">
                                <Rocket className="w-3 h-3" /> Rekomendasi
                            </div>
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-[#333]">
                    {[
                        { 
                            name: "Kecepatan Respon", 
                            icon: Activity,
                            manual: "Lambat (Jam Kerja)", 
                            lapor: "2-5 Hari Kerja", 
                            ai: "< 2 Detik (24/7)" 
                        },
                        { 
                            name: "Channel Akses", 
                            icon: Smartphone,
                            manual: "WhatsApp Saja", 
                            lapor: "Website & App", 
                            ai: "WhatsApp & Web Widget" 
                        },
                        { 
                            name: "Basis Pengetahuan", 
                            icon: Database,
                            manual: "Hafalan Admin", 
                            lapor: "Manual Disposisi", 
                            ai: "Otomatis (RAG) dari Dokumen" 
                        },
                        { 
                            name: "Integrasi Data Warga", 
                            icon: Server,
                            manual: <X className="w-5 h-5 text-red-400 mx-auto" />, 
                            lapor: <Check className="w-5 h-5 text-green-500 mx-auto" />, 
                            ai: <Check className="w-5 h-5 text-green-500 mx-auto" /> 
                        },
                        { 
                            name: "Analisis Sentimen", 
                            icon: Headphones,
                            manual: <X className="w-5 h-5 text-red-400 mx-auto" />, 
                            lapor: <X className="w-5 h-5 text-red-400 mx-auto" />, 
                            ai: <Check className="w-5 h-5 text-green-500 mx-auto" /> 
                        },
                    ].map((feature, idx) => (
                        <motion.tr 
                            key={idx}
                            initial={{ opacity: 0, x: -20 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className="hover:bg-gray-50 dark:hover:bg-[#111] transition-colors"
                        >
                            <td className="p-6 text-sm font-bold text-[#112D4E] dark:text-white flex items-center gap-3 sticky left-0 bg-white dark:bg-[#050505] z-10 border-r border-gray-100 dark:border-[#333]">
                                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-[#222] flex items-center justify-center text-gray-500 shrink-0">
                                    <feature.icon className="w-4 h-4" />
                                </div>
                                {feature.name}
                            </td>
                            <td className="p-6 text-center text-sm text-gray-600 dark:text-gray-400 border-l border-gray-200 dark:border-[#333]">
                                {feature.manual}
                            </td>
                            <td className="p-6 text-center text-sm text-gray-600 dark:text-gray-400 border-l border-gray-200 dark:border-[#333]">
                                {feature.lapor}
                            </td>
                            <td className="p-6 text-center text-sm font-bold text-[#3F72AF] bg-[#3F72AF]/5 dark:bg-[#3F72AF]/10 border-l border-[#3F72AF]/20">
                                {feature.ai}
                            </td>
                        </motion.tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export const CustomTrainAnimation = () => {
    return (
        <div className="relative h-[500px] w-full bg-[#112D4E] rounded-3xl overflow-hidden flex items-center justify-center p-8 group border border-[#3F72AF]/30 shadow-2xl">
            {/* Background Grid */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:40px_40px]" />
            
            {/* Central Brain */}
            <motion.div 
               className="relative z-10 w-40 h-40 rounded-full bg-[#3F72AF] flex items-center justify-center shadow-[0_0_60px_rgba(63,114,175,0.6)] cursor-pointer"
               whileHover={{ scale: 1.1 }}
               animate={{ boxShadow: ["0 0 60px rgba(63,114,175,0.6)", "0 0 100px rgba(63,114,175,0.8)", "0 0 60px rgba(63,114,175,0.6)"] }}
               transition={{ duration: 3, repeat: Infinity }}
            >
               <Brain className="w-20 h-20 text-white" />
               
               {/* Pulse Rings */}
               <motion.div 
                 className="absolute inset-0 rounded-full border border-white/60"
                 animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                 transition={{ duration: 2, repeat: Infinity }}
               />
               <motion.div 
                 className="absolute inset-0 rounded-full border border-white/30"
                 animate={{ scale: [1, 2], opacity: [0.3, 0] }}
                 transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
               />
            </motion.div>

            {/* Orbiting Elements */}
            {[
                { icon: Database, color: "text-green-400", label: "Data Warga", delay: 0 },
                { icon: Server, color: "text-blue-400", label: "Regulasi", delay: 1 },
                { icon: MessageSquare, color: "text-yellow-400", label: "History Chat", delay: 2 },
                { icon: BarChart, color: "text-purple-400", label: "Statistik", delay: 3 },
                { icon: Globe, color: "text-cyan-400", label: "API Integrasi", delay: 4 },
                { icon: Rocket, color: "text-red-400", label: "Auto Action", delay: 5 },
            ].map((item, i) => (
                <motion.div
                    key={i}
                    className="absolute w-24 h-24 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 flex flex-col items-center justify-center gap-2 hover:bg-white/20 transition-all cursor-pointer hover:border-white/50 z-20"
                    animate={{ 
                         rotate: 360,
                        x: [0, 200, 0, -200, 0],
                        y: [-200, 0, 200, 0, -200],
                    }}
                    transition={{ 
                        duration: 20, 
                        repeat: Infinity, 
                        ease: "linear",
                        delay: -i * (20/6) 
                    }}
                >
                    {/* Counter-rotate icon to keep upright */}
                    <motion.div 
                       animate={{ rotate: -360 }}
                       transition={{ duration: 20, repeat: Infinity, ease: "linear", delay: -i * (20/6) }}
                       className="flex flex-col items-center gap-2"
                    >
                        <item.icon className={`w-8 h-8 ${item.color}`} />
                        <span className="text-[10px] text-white font-bold">{item.label}</span>
                    </motion.div>
                </motion.div>
            ))}

            {/* Connecting Lines (Simulated) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
                <circle cx="50%" cy="50%" r="200" fill="none" stroke="white" strokeDasharray="4 4" />
            </svg>
            
            <div className="absolute bottom-6 left-0 right-0 text-center z-10">
                <span className="text-white/60 text-xs uppercase tracking-[0.2em] font-light bg-black/30 px-4 py-2 rounded-full backdrop-blur-sm border border-white/10">
                    Custom Knowledge Base Engine
                </span>
            </div>
        </div>
    );
};

export const TrustSection = () => {
    return (
        <div className="grid md:grid-cols-3 gap-8 text-center">
            {[
                { icon: Shield, title: "Keamanan Data Prioritas", desc: "Enkripsi End-to-End & ISO 27001 Compliant." },
                { icon: Server, title: "Server Lokal (On-Premises)", desc: "Data warga tidak keluar dari infrastruktur Indonesia." },
                { icon: Check, title: "Verifikasi Identitas", desc: "Integrasi NIK untuk validasi pelapor asli." }
            ].map((item, i) => (
               <motion.div 
                 key={i}
                 initial={{ opacity: 0, y: 20 }}
                 whileInView={{ opacity: 1, y: 0 }}
                 transition={{ delay: i * 0.2 }}
                 className="p-6 bg-white dark:bg-[#111] rounded-2xl border border-gray-100 dark:border-[#222] hover:border-blue-500/30 hover:shadow-lg transition-all"
               >
                   <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center mx-auto mb-4 text-blue-600 dark:text-blue-400">
                      <item.icon className="w-6 h-6" />
                   </div>
                   <h3 className="font-bold text-lg mb-2 text-[#112D4E] dark:text-white">{item.title}</h3>
                   <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{item.desc}</p>
               </motion.div>
            ))}
        </div>
    );
};

export const StatsSection = () => {
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-12 border-y border-gray-200 dark:border-[#222] my-12 relative overflow-hidden">
             {/* Background Decoration */}
             <div className="absolute inset-0 bg-blue-50/30 dark:bg-blue-900/5 -z-10" />
             
             {[
                { number: "2 Detik", label: "Respon Rata-rata" },
                { number: "24/7", label: "Layanan Non-stop" },
                { number: "100%", label: "Akurasi Data Regulasi" },
                { number: "50+", label: "Instansi Terhubung" }
             ].map((stat, i) => (
                <motion.div 
                    key={i} 
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1, duration: 0.5 }}
                    className="text-center"
                >
                    <h3 className="text-3xl md:text-5xl font-black text-[#112D4E] dark:text-white mb-2">{stat.number}</h3>
                    <p className="text-sm uppercase tracking-widest text-[#3F72AF] font-semibold">{stat.label}</p>
                </motion.div>
             ))}
        </div>
    );
};

