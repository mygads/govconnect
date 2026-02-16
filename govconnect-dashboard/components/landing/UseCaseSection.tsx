"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Siren, FileText, Globe, ArrowRight, CheckCircle2 } from "lucide-react";
import { UseCaseChat, ScenarioType } from "./UseCaseChat";
import { SectionTitle } from "./SectionTitle";
// Wait, I need to check where SectionTitle is. 
// In page.tsx: import { SectionTitle } from "@/components/landing/SectionTitle"; 
// So it is in components/landing/SectionTitle.

const tabs: { id: ScenarioType; title: string; desc: string; icon: any; color: string; features: string[] }[] = [
    {
        id: "report",
        title: "Pelaporan Warga",
        desc: "Lapor kerusakan fasilitas umum cukup dengan foto. AI mendeteksi lokasi dan kategori otomatis.",
        icon: Siren,
        color: "text-orange-500",
        features: ["Auto-tagging Lokasi GPS", "Notifikasi Real-time", "Tanpa Antri"]
    },
    {
        id: "service",
        title: "Administrasi Desa",
        desc: "Urus surat pengantar, SKCK, atau KTP dari rumah. Verifikasi dokumen awal oleh AI.",
        icon: FileText,
        color: "text-blue-500",
        features: ["Cek Syarat Dokumen", "Ambil Antrian Online", "Hemat Waktu"]
    },
    {
        id: "info",
        title: "Pusat Informasi",
        desc: "Tanya jadwal bansos, agenda desa, atau info wisata. Dijawab instan 24/7.",
        icon: Globe,
        color: "text-purple-500",
        features: ["Data Resmi & Valid", "Support Bahasa Daerah", "Respon Cepat"]
    }
];

export const UseCaseSection = () => {
    const [activeTab, setActiveTab] = useState<ScenarioType>("report");

    return (
        <section id="demo" className="py-24 bg-[#DBE2EF]/30 dark:bg-[#0a0a0a] relative overflow-hidden">
             {/* Background Decoration */}
             <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 -left-20 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl mix-blend-multiply dark:mix-blend-screen animate-blob" />
                <div className="absolute top-1/3 -right-20 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl mix-blend-multiply dark:mix-blend-screen animate-blob animation-delay-2000" />
             </div>

             <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
                <div className="text-center mb-16">
                    <h2 className="text-blue-600 font-bold tracking-wide uppercase text-sm mb-2">Skenario Penggunaan</h2>
                    <h3 className="text-3xl md:text-4xl font-bold text-[#112D4E] dark:text-white">
                        Satu AI, <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-600 to-cyan-500">Beragam Solusi</span>
                    </h3>
                </div>

                <div className="grid lg:grid-cols-12 gap-12 items-start">
                    {/* Left Column: Tabs */}
                    <div className="lg:col-span-12 xl:col-span-5 flex flex-col gap-4">
                        {tabs.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`group relative text-left p-6 rounded-3xl transition-all duration-300 border-2 ${
                                        isActive 
                                            ? "bg-white dark:bg-gray-900 border-blue-500 shadow-xl scale-[1.02]" 
                                            : "bg-white/50 dark:bg-gray-900/50 border-transparent hover:bg-white hover:border-blue-200 dark:hover:bg-gray-900 hover:shadow-lg"
                                    }`}
                                >
                                    <div className="flex items-start gap-4">
                                        <div className={`p-3 rounded-2xl transition-colors ${
                                            isActive ? "bg-blue-100 dark:bg-blue-900/30" : "bg-gray-100 dark:bg-gray-800 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20"
                                        }`}>
                                            <tab.icon className={`w-6 h-6 ${isActive ? tab.color : "text-gray-500 group-hover:text-blue-500"}`} />
                                        </div>
                                        <div className="flex-1">
                                            <h4 className={`text-lg font-bold mb-2 transition-colors ${
                                                isActive ? "text-[#112D4E] dark:text-white" : "text-gray-600 dark:text-gray-400 group-hover:text-[#112D4E] dark:group-hover:text-white"
                                            }`}>
                                                {tab.title}
                                            </h4>
                                            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
                                                {tab.desc}
                                            </p>
                                            
                                            {/* Features List (Visible only when active) */}
                                            <motion.div 
                                                initial={false}
                                                animate={{ height: isActive ? "auto" : 0, opacity: isActive ? 1 : 0 }}
                                                transition={{ duration: 0.3 }}
                                                className="overflow-hidden"
                                            >
                                                <ul className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                                                    {tab.features.map((feature, i) => (
                                                        <li key={i} className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                                                            <CheckCircle2 className={`w-3.5 h-3.5 ${tab.color}`} />
                                                            {feature}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </motion.div>
                                        </div>
                                        
                                        {/* Active Arrow Indicator */}
                                        {isActive && (
                                            <div className="hidden lg:flex items-center justify-center h-full absolute right-4 top-0 bottom-0 text-blue-500">
                                                <ArrowRight className="w-5 h-5 animate-pulse" />
                                            </div>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Right Column: Chat Widget */}
                    <div className="lg:col-span-12 xl:col-span-7 sticky top-24 pt-4 lg:pt-0">
                         <div className="relative mx-auto max-w-md lg:max-w-full">
                            {/* Decorative Elements behind chat */}
                            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-purple-500/20 blur-3xl transform rotate-6 scale-95 rounded-[3rem]" />
                            
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, scale: 0.95, x: 20 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                transition={{ duration: 0.4, ease: "easeOut" }}
                            >
                                <UseCaseChat scenario={activeTab} />
                            </motion.div>

                            {/* Floating badges or extra info can go here */}
                         </div>
                    </div>
                </div>
             </div>
        </section>
    );
};
