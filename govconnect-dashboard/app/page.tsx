"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useScroll, useTransform, useInView, useMotionValue, useSpring, AnimatePresence } from "framer-motion";
import {
  Sun, Moon, MessageCircle, Phone, Mail, MapPin, LayoutDashboard, BarChart3,
  Users, Shield, AlertTriangle, Siren, Zap, Brain, Database, Globe, Building2,
  CalendarCheck, FileCheck, Map, Send, Workflow, Network, RefreshCw,
  Building, Landmark, BadgeCheck, Clock, Sparkles, Play,
  CheckCircle2, ArrowRight, Menu, X, ChevronRight, Rocket, Target, Award,
  Headphones, LineChart, Settings, Lock, Layers, Activity, TrendingUp,
  ChevronDown, ExternalLink, ArrowUpRight, Cpu, Server, MessageSquare,
  ShieldCheck, BarChart, PieChart, Timer, UserCheck, FileWarning, Gauge,
  FileText, Smartphone, Search, XCircle, MinusCircle, Laptop
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { WhatsAppIcon, ChatAnimation, LiveChatWidget, UseCaseSection, CustomTrainAnimation, FeatureComparison, FAQSection, SectionTitle, StatsSection, TrustSection } from "@/components/landing";
import { generateWhatsAppLink } from "@/lib/whatsapp";
import { HomePageJsonLd } from "@/components/seo";
import { Badge } from "@/components/ui/badge";

/* ── Animation Variants ───────────────────────────────── */
const fadeInUp = { hidden: { opacity: 0, y: 40 }, visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: "easeOut" as const } } };
const fadeIn = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.5 } } };
const staggerContainer = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } };
const scaleIn = { hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.5 } } };
const staggerItem = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } } };
const fadeRight = { hidden: { opacity: 0, x: -40 }, visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: "easeOut" as const } } };
const fadeLeft = { hidden: { opacity: 0, x: 40 }, visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: "easeOut" as const } } };

/* ── Components ───────────────────────────────────────── */

export default function LandingPage() {
  const [isDark, setIsDark] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const whatsappLink = generateWhatsAppLink();
  const { scrollYProgress } = useScroll();

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (savedTheme === "dark" || (!savedTheme && systemDark)) {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    } else {
      setIsDark(false);
      document.documentElement.classList.remove("dark");
    }

    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    if (newDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const navItems = [
    { id: "masalah", label: "Masalah" },
    { id: "solusi", label: "Solusi" },
    { id: "fitur", label: "Fitur" },
    { id: "demo", label: "Use Case" },
  ];

  return (
    <>
      <HomePageJsonLd />
      <div className="min-h-screen bg-[#F9F7F7] dark:bg-[#000000] text-[#112D4E] dark:text-[#F9F7F7] font-sans selection:bg-[#3F72AF] selection:text-white transition-colors duration-300">
        
        {/* Progress Bar */}
        <motion.div className="fixed top-0 left-0 right-0 h-1 bg-[#3F72AF] z-[100] origin-left" style={{ scaleX: scrollYProgress }} />

        {/* ── Navbar ────────────────────────────────────────── */}
        <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-[#F9F7F7]/95 dark:bg-black/95 backdrop-blur-md shadow-sm border-b border-[#DBE2EF] dark:border-[#222]" : "bg-transparent py-5 text-[#112D4E]"}`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between h-14">
              {/* Logo */}
              <Link href="/" className="flex items-center gap-2.5 group">
                <div className="relative h-10 w-auto">
                   <Image 
                     src={isDark ? "/logo-dashboard-dark.png" : "/logo-dashboard.png"} 
                     alt="Tanggapin AI Logo" 
                     width={150} 
                     height={40} 
                     className="object-contain h-full w-auto"
                     priority
                   />
                </div>
              </Link>

              {/* Desktop Nav */}
              <div className="hidden md:flex items-center gap-1 bg-[#DBE2EF]/20 dark:bg-[#111]/80 backdrop-blur-sm border border-[#3F72AF]/10 dark:border-white/5 rounded-full px-2 py-1.5">
                {navItems.map((item) => (
                  <Link key={item.id} href={`#${item.id}`} className="text-sm font-semibold text-[#112D4E]/70 dark:text-[#F9F7F7]/80 hover:text-[#3F72AF] hover:bg-white/80 dark:hover:bg-white/10 px-4 py-2 rounded-full transition-all">
                    {item.label}
                  </Link>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full w-10 h-10 hover:bg-[#DBE2EF] dark:hover:bg-[#222]">
                  {isDark ? <Sun className="h-5 w-5 text-yellow-500" /> : <Moon className="h-5 w-5 text-[#112D4E]" />}
                </Button>
                <Button asChild className="hidden sm:flex rounded-full bg-[#112D4E] hover:bg-[#3F72AF] text-white px-6 font-bold shadow-xl shadow-[#112D4E]/20 hover:shadow-[#3F72AF]/30 transition-all">
                  <Link href="/login">
                    Login
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden rounded-full w-10 h-10 text-[#112D4E] dark:text-white">
                  {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                </Button>
              </div>
            </div>
          </div>

          {/* Mobile Menu */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="md:hidden bg-[#F9F7F7] dark:bg-black border-b border-[#DBE2EF] dark:border-[#333]"> 
                <div className="px-4 py-6 space-y-3">
                  {navItems.map((item) => (
                    <Link key={item.id} href={`#${item.id}`} onClick={() => setMobileMenuOpen(false)} className="block text-lg font-bold text-[#112D4E] dark:text-[#F9F7F7] py-2 border-b border-[#DBE2EF]/50 dark:border-[#333]">
                      {item.label}
                    </Link>
                  ))}
                  <Button asChild className="w-full mt-6 rounded-xl bg-[#25D366] hover:bg-[#20ba59] text-white py-6 text-lg font-bold shadow-lg">
                    <a href={whatsappLink}>Tes AI Sekarang di WhatsApp</a>
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </nav>

        {/* ═══════════════════════════════════════════════════
            HERO SECTION
            ═══════════════════════════════════════════════════ */}
        <section className="relative pt-32 pb-20 md:pt-40 md:pb-32 overflow-hidden bg-[#F9F7F7] dark:bg-[#000000]">
          {/* Decorative blobs - darker in light mode for better visibility */}
          <div className="absolute top-0 right-0 w-[50vw] h-[50vw] bg-[#3F72AF]/5 dark:bg-[#3F72AF]/20 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-[40vw] h-[40vw] bg-[#112D4E]/5 dark:bg-[#112D4E]/20 rounded-full blur-[120px] translate-y-1/2 -translate-x-1/2" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              
              {/* Hero Text */}
              <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="relative z-10 text-center lg:text-left">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
                  className="inline-flex items-center gap-2 bg-[#112D4E] border border-white/10 dark:bg-[#1a1a1a] dark:border-[#333] text-white px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-8 shadow-xl"
                >
                  <Sparkles className="w-3 h-3 text-yellow-400 animate-pulse" />
                  PKM Karya Inovasi 2026
                </motion.div>

                <h1 className="text-4xl md:text-6xl font-black text-[#112D4E] dark:text-[#F9F7F7] leading-[1.1] mb-6">
                  Sistem <span className="text-[#3F72AF]">AI Agent</span> Pemerintah untuk Respons <span className="relative whitespace-nowrap">
                    <span className="relative z-10">Cepat & Tepat</span>
                    <span className="absolute bottom-1 left-0 right-0 h-4 bg-[#DBE2EF] dark:bg-[#3F72AF]/30 -rotate-2 z-0 rounded-sm"></span>
                  </span>
                </h1>

                <p className="text-lg md:text-xl text-[#112D4E]/80 dark:text-[#DBE2EF] leading-relaxed mb-10 max-w-xl mx-auto lg:mx-0">
                  Platform <strong>Large Language Model (LLM)</strong> untuk meningkatkan kecepatan respons pelayanan dan pengaduan publik melalui <strong>WhatsApp</strong> 24/7.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                  <Button size="lg" className="h-14 px-8 rounded-2xl bg-[#112D4E] hover:bg-[#3F72AF] text-white text-lg font-bold shadow-xl shadow-[#112D4E]/30 transition-all hover:scale-105" asChild>
                    <a href={whatsappLink} target="_blank">
                      <WhatsAppIcon className="mr-2 w-5 h-5" />
                      Chat Sekarang
                    </a>
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 px-8 rounded-2xl border-2 border-[#112D4E]/10 bg-white dark:bg-black hover:bg-[#DBE2EF] dark:hover:bg-[#111] text-[#112D4E] dark:text-[#F9F7F7] text-lg font-bold shadow-sm" asChild>
                    <Link href="#demo">
                      <Play className="mr-2 w-5 h-5 fill-current" />
                      Lihat Demo
                    </Link>
                  </Button>
                </div>

                <div className="mt-10 flex items-center justify-center lg:justify-start gap-6 text-[#112D4E] dark:text-[#DBE2EF] text-sm font-semibold opacity-90">
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-500" /> Tanpa Instalasi</div>
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-500" /> Respons &lt; 2 Detik</div>
                </div>
              </motion.div>

              {/* Hero Visual / Animation */}
              <motion.div variants={scaleIn} initial="hidden" animate="visible" className="relative z-0">
                <div className="relative transform lg:translate-x-10">
                  {/* Chat Animation Container - Darker BG in light mode for contrast */}
                  <div className="relative z-10">
                     <ChatAnimation />
                  </div>
                  
                  {/* Floating Elements */}
                  <motion.div 
                    animate={{ y: [0, -10, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute -top-10 -right-5 bg-white dark:bg-[#111] p-4 rounded-2xl shadow-2xl border border-[#DBE2EF] dark:border-[#333] z-20 max-w-[200px]"
                  >
                    <div className="flex items-center gap-2 mb-2">
                       <div className="p-1.5 bg-[#3F72AF]/10 rounded-lg">
                          <LayoutDashboard className="w-5 h-5 text-[#3F72AF]" />
                       </div>
                       <span className="font-bold text-xs text-[#112D4E] dark:text-white">Dashboard Eksekutif</span>
                    </div>
                    <div className="h-2 bg-[#DBE2EF] dark:bg-[#333] rounded-full w-full mb-2"></div>
                    <div className="h-2 bg-[#DBE2EF] dark:bg-[#333] rounded-full w-2/3"></div>
                  </motion.div>

                  <motion.div 
                    animate={{ y: [0, 10, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                    className="absolute bottom-20 -left-10 bg-[#25D366] p-4 rounded-2xl shadow-xl z-20 flex items-center gap-3 text-white ring-4 ring-white dark:ring-black"
                  >
                    <WhatsAppIcon className="w-8 h-8" />
                    <div>
                      <p className="text-xs font-medium opacity-90">Terhubung ke</p>
                      <p className="font-bold text-sm">WhatsApp Warga</p>
                    </div>
                  </motion.div>
                </div>
              </motion.div>

            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            LATAR BELAKANG / STATS BLOCK
            ═══════════════════════════════════════════════════ */}
        <section className="bg-[#112D4E] py-20 text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center relative z-10">
            <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={{ once: true }}>
              <motion.h3 variants={fadeInUp} className="text-2xl md:text-3xl font-bold mb-12">
                Mengapa <span className="text-[#112D4E] bg-white px-3 py-1 rounded-lg shadow-lg">Transformasi</span> Diperlukan?
              </motion.h3>
              
              <div className="grid md:grid-cols-3 gap-8 separate-borders">
                {[
                  { val: "10.846", label: "Laporan Ombudsman RI 2024", desc: "Keluhan Pelayanan Publik", icon: FileWarning },
                  { val: "45,88%", label: "Target Laporan", desc: "Pemerintah Daerah", icon: Landmark },
                  { val: "64%", label: "Dominasi Masalah", desc: "Penundaan & Tidak Ada Layanan", icon: Clock },
                ].map((stat, i) => (
                   <motion.div key={i} variants={fadeIn} className="p-8 rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 transition-all hover:-translate-y-1">
                     <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-6">
                        <stat.icon className="w-8 h-8 text-[#DBE2EF]" />
                     </div>
                     <div className="text-4xl md:text-5xl font-black mb-2">{stat.val}</div>
                     <div className="text-lg font-bold text-[#DBE2EF] mb-2">{stat.label}</div>
                     <div className="text-sm text-white/60">{stat.desc}</div>
                   </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            STATS STRIP
            ═══════════════════════════════════════════════════ */}
        <section className="bg-white dark:bg-black">
           <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <StatsSection />
           </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            MASALAH (PROBLEMS)
            ═══════════════════════════════════════════════════ */}
        <section id="masalah" className="py-24 bg-[#F9F7F7] dark:bg-[#000000]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <SectionTitle subtitle="Analisis Masalah" align="center">3 Tantangan Utama Birokrasi</SectionTitle>
            
            <div className="grid md:grid-cols-3 gap-8 mt-16">
              {[
                { 
                  title: "Penundaan Berlarut", 
                  desc: "Respon lambat terhadap pertanyaan & aduan masyarakat karena keterbatasan jam kerja dan petugas.", 
                  stat: "33.86%",
                  color: "text-red-600 dark:text-red-400",
                  bg: "bg-white dark:bg-[#111]"
                },
                { 
                  title: "Informasi Tersebar", 
                  desc: "Data prosedur layanan sulit diakses, tidak terpusat, dan seringkali tidak konsisten antar petugas.", 
                  stat: "30.31%",
                  color: "text-yellow-600 dark:text-yellow-400",
                  bg: "bg-white dark:bg-[#111]"
                },
                { 
                  title: "Minim Transparansi", 
                  desc: "Masyarakat tidak bisa melacak status pengajuan surat atau tindak lanjut laporan pengaduan mereka.", 
                  stat: "20.61%",
                  color: "text-blue-600 dark:text-blue-400",
                  bg: "bg-white dark:bg-[#111]"
                }
              ].map((item, i) => (
                <motion.div 
                  key={i} 
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  whileHover={{ y: -10 }}
                  className={`relative p-10 rounded-4xl ${item.bg} border border-[#112D4E]/10 dark:border-[#222] shadow-2xl overflow-hidden group`}
                >
                  <div className={`absolute -right-4 -top-4 w-32 h-32 bg-current opacity-5 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700 ${item.color}`}></div>
                  <div className={`text-5xl font-black ${item.color} mb-6`}>{item.stat}</div>
                  <h3 className="text-2xl font-bold text-[#112D4E] dark:text-white mb-4">{item.title}</h3>
                  <p className="text-[#112D4E]/70 dark:text-[#DBE2EF]/70 leading-relaxed font-medium">{item.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            SOLUSI & TECH
            ═══════════════════════════════════════════════════ */}
        <section id="solusi" className="py-24 bg-white dark:bg-[#050505] overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <motion.div initial={{ opacity: 0, x: -50 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
                <SectionTitle subtitle="Solusi Kami" align="left">AI Generatif + Data Pemerintah</SectionTitle>
                <div className="prose prose-lg dark:prose-invert text-[#112D4E]/80 dark:text-[#DBE2EF]/80 mb-10">
                  <p className="text-xl leading-relaxed">
                    Tanggapin menggabungkan kecanggihan <span className="text-[#3F72AF] font-bold bg-[#3F72AF]/10 px-1 rounded">Large Language Model (LLM)</span> dengan teknologi <span className="text-[#3F72AF] font-bold bg-[#3F72AF]/10 px-1 rounded">RAG (Retrieval-Augmented Generation)</span>.
                  </p>
                  <p>
                    Tidak seperti chatbot biasa yang kaku, Tanggapin <strong>memahami konteks</strong> percakapan natural dan memberikan jawaban yang diambil <strong>hanya dari dokumen resmi</strong> pemerintah desa/instansi yang telah diverifikasi.
                  </p>
                </div>
                
                <div className="space-y-6">
                  {[
                    "Jawaban Berbasis Fakta & Regulasi (Anti Halusinasi)",
                    "Memahami Bahasa Daerah & Non-Formal",
                    "Integrasi Database Kependudukan & Layanan",
                    "Eskalasi Otomatis ke Petugas Manusia"
                  ].map((feat, i) => (
                    <div key={i} className="flex items-center gap-4 group">
                      <div className="w-10 h-10 rounded-full bg-[#E3F2FD] dark:bg-[#3F72AF]/20 flex items-center justify-center text-[#3F72AF] group-hover:scale-110 transition-transform">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <span className="font-bold text-[#112D4E] dark:text-[#F9F7F7] text-lg">{feat}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0, x: 50 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="relative">
                {/* Tech Diagram Visualization */}
                <div className="bg-[#112D4E] dark:bg-[#111] rounded-4xl p-8 md:p-12 relative overflow-hidden shadow-2xl border-4 border-[#3F72AF]/20">
                  <div className="absolute top-0 right-0 p-40 bg-[#3F72AF] rounded-full filter blur-[100px] opacity-20"></div>
                  
                  <div className="space-y-8 relative z-10">
                    <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/10 flex items-center gap-4 transform hover:-translate-y-1 transition-transform">
                      <div className="bg-green-500/20 p-3 rounded-xl"><MessageCircle className="text-green-400 w-6 h-6" /></div>
                      <div className="text-white">
                        <p className="opacity-50 text-xs font-bold uppercase mb-1">Warga bertanya</p>
                        <p className="font-medium text-lg">"Syarat bikin KTP apa aja mas?"</p>
                      </div>
                    </div>
                    
                    <div className="flex justify-center"><ArrowDown className="text-white/30 animate-bounce w-8 h-8" /></div>

                    <div className="bg-[#3F72AF]/20 backdrop-blur-md p-8 rounded-2xl border border-[#3F72AF]/30 text-center ring-1 ring-[#3F72AF]/50">
                      <Brain className="w-12 h-12 text-[#3F72AF] mx-auto mb-4" />
                      <p className="text-white font-bold text-xl mb-1">AI Processing (RAG)</p>
                      <p className="text-white/60 text-sm">Mencari di Dokumen Perda & SOP Dukcapil...</p>
                    </div>

                    <div className="flex justify-center"><ArrowDown className="text-white/30 animate-bounce w-8 h-8" /></div>

                    <div className="bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/10 flex items-center gap-4 transform hover:-translate-y-1 transition-transform">
                      <div className="bg-blue-500/20 p-3 rounded-xl"><Zap className="text-blue-400 w-6 h-6" /></div>
                      <div className="text-white">
                        <p className="opacity-50 text-xs font-bold uppercase mb-1">Tanggapin menjawab</p>
                        <p className="font-medium text-lg">"Berdasarkan Perda No. 5, syarat KTP adalah: 1. KK Asli..."</p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        <UseCaseSection />

        {/* ═══════════════════════════════════════════════════
            CUSTOM AGENT TRAIN (NEW)
            ═══════════════════════════════════════════════════ */}
        <section className="py-24 bg-[#112D4E] relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    <div className="order-2 lg:order-1">
                        <CustomTrainAnimation />
                    </div>
                    <div className="order-1 lg:order-2 text-white">
                        <div className="inline-block py-1 px-3 rounded-full text-xs font-bold uppercase tracking-wider mb-4 bg-white/10 text-[#DBE2EF]">
                            Full Customization
                        </div>
                        <h2 className="text-3xl md:text-5xl font-black mb-6 leading-tight">
                            Latih AI dengan <br/><span className="text-[#3F72AF]">Data Instansi Anda</span>
                        </h2>
                        <p className="text-lg text-[#DBE2EF]/80 mb-8 leading-relaxed">
                            Bukan sekadar chatbot template. Kustomisasi penuh knowledge base AI Anda dengan mengunggah peraturan daerah (Perda), SOP, dan data spesifik wilayah Anda sendiri.
                        </p>
                        
                        <div className="space-y-6">
                            {[
                                { title: "Upload Dokumen PDF/Word/Excel", desc: "Sistem otomatis membaca & mempelajari konten." },
                                { title: "Atur Gaya Bahasa (Persona)", desc: "Pilih gaya formal, santai, atau bahasa daerah." },
                                { title: "Integrasi API Database", desc: "Hubungkan dengan sistem kependudukan (SIAK) yang ada." }
                            ].map((item, i) => (
                                <div key={i} className="flex gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                                        <Database className="w-6 h-6 text-[#3F72AF]" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-lg">{item.title}</h4>
                                        <p className="text-sm text-[#DBE2EF]/60">{item.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            FITUR (FEATURES)
            ═══════════════════════════════════════════════════ */}
        <section id="fitur" className="py-24 bg-[#F9F7F7] dark:bg-[#000000]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <SectionTitle subtitle="Modul Sistem" align="center">Ekosistem Tanggapin AI</SectionTitle>
            
            <div className="grid lg:grid-cols-3 gap-8 mt-12">
              {/* Feature 1 */}
              <div className="bg-white dark:bg-[#111] rounded-4xl p-10 border border-[#DBE2EF] dark:border-[#222] hover:shadow-2xl transition-all duration-300 group hover:-translate-y-2">
                <div className="w-20 h-20 bg-[#3F72AF]/10 rounded-3xl flex items-center justify-center text-[#3F72AF] mb-8 group-hover:scale-110 transition-transform">
                  <ShieldAlert className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-bold text-[#112D4E] dark:text-white mb-4">Tanggapin Pengaduan</h3>
                <p className="text-[#112D4E]/70 dark:text-[#DBE2EF]/70 mb-8 min-h-20 text-lg leading-relaxed">
                  Kanal pelaporan masalah warga (infrastruktur, sosial, keamanan) yang terstruktur. AI mendeteksi kategori, lokasi, dan urgensi secara otomatis.
                </p>
                <ul className="space-y-4 text-[#112D4E] dark:text-[#DBE2EF]">
                  <li className="flex gap-3 text-sm font-bold"><CheckCircle2 className="w-5 h-5 text-green-500" /> Klasifikasi Isu Otomatis</li>
                  <li className="flex gap-3 text-sm font-bold"><CheckCircle2 className="w-5 h-5 text-green-500" /> Tracking Status Tiket</li>
                  <li className="flex gap-3 text-sm font-bold"><CheckCircle2 className="w-5 h-5 text-green-500" /> Notifikasi Real-time</li>
                </ul>
              </div>

              {/* Feature 2 (Highlighted) */}
              <div className="bg-[#112D4E] dark:bg-[#1a1a1a] rounded-4xl p-10 border border-[#112D4E] dark:border-[#333] shadow-2xl relative overflow-hidden transform lg:-translate-y-6">
                <div className="absolute top-0 right-0 bg-[#3F72AF] text-white text-xs font-bold px-6 py-2 rounded-bl-2xl">UNGGULAN</div>
                <div className="w-20 h-20 bg-white/10 rounded-3xl flex items-center justify-center text-white mb-8">
                  <FileText className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-4">Tanggapin Layanan</h3>
                <p className="text-blue-100 mb-8 min-h-20 text-lg leading-relaxed">
                  Asisten virtual untuk administrasi kependudukan. Warga dapat mengajukan surat pengantar, cek syarat, dan mengisi formulir cukup via chatting.
                </p>
                <ul className="space-y-4 text-white">
                  <li className="flex gap-3 text-sm font-bold"><CheckCircle2 className="w-5 h-5 text-[#3F72AF]" /> Panduan Syarat Smart</li>
                  <li className="flex gap-3 text-sm font-bold"><CheckCircle2 className="w-5 h-5 text-[#3F72AF]" /> Pengisian Form via Chat</li>
                  <li className="flex gap-3 text-sm font-bold"><CheckCircle2 className="w-5 h-5 text-[#3F72AF]" /> Digital Document Archiving</li>
                </ul>
              </div>

              {/* Feature 3 */}
              <div className="bg-white dark:bg-[#111] rounded-4xl p-10 border border-[#DBE2EF] dark:border-[#222] hover:shadow-2xl transition-all duration-300 group hover:-translate-y-2">
                <div className="w-20 h-20 bg-[#3F72AF]/10 rounded-3xl flex items-center justify-center text-[#3F72AF] mb-8 group-hover:scale-110 transition-transform">
                  <Info className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-bold text-[#112D4E] dark:text-white mb-4">Tanggapin Informasi</h3>
                <p className="text-[#112D4E]/70 dark:text-[#DBE2EF]/70 mb-8 min-h-20 text-lg leading-relaxed">
                  Pusat informasi publik yang aktif 24/7. Menjawab pertanyaan seputar info desa, jadwal kegiatan, bansos, hingga potensi wisata.
                </p>
                <ul className="space-y-4 text-[#112D4E] dark:text-[#DBE2EF]">
                  <li className="flex gap-3 text-sm font-bold"><CheckCircle2 className="w-5 h-5 text-green-500" /> Data Selalu Update (RAG)</li>
                  <li className="flex gap-3 text-sm font-bold"><CheckCircle2 className="w-5 h-5 text-green-500" /> Multilingual Support</li>
                  <li className="flex gap-3 text-sm font-bold"><CheckCircle2 className="w-5 h-5 text-green-500" /> Broadcast Pengumuman</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            COMPARISON TABLE
            ═══════════════════════════════════════════════════ */}
        <section className="py-24 bg-white dark:bg-black">
           <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center">
              <div className="mb-6 flex justify-center">
                <div className="relative w-24 h-24 bg-[#112D4E]/5 dark:bg-white/5 rounded-full flex items-center justify-center p-4">
                  <Image 
                    src="/logo.png" 
                    alt="Tanggapin Logo" 
                    width={64} 
                    height={64} 
                    className="object-contain"
                  />
                </div>
              </div>
              <SectionTitle subtitle="Nilai Lebih" align="center">Kenapa Tanggapin AI?</SectionTitle>
              <div className="mt-12 space-y-20">
                 <FeatureComparison />
                 <TrustSection />
              </div>
           </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            DASHBOARD PREVIEW
            ═══════════════════════════════════════════════════ */}
        <section id="dashboard" className="py-24 bg-[#112D4E] relative overflow-hidden">
          {/* Background Elements */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#3F72AF] rounded-full filter blur-[100px] opacity-30"></div>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-600 rounded-full filter blur-[100px] opacity-20"></div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10 text-center">
            <Badge className="bg-white/10 text-white hover:bg-white/20 mb-6 border-none px-4 py-1">Untuk Eksekutif & Admin</Badge>
            <h2 className="text-3xl md:text-5xl font-black text-white mb-8">
              Keputusan Lebih Cepat dengan <br /> <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-400 to-cyan-400">Dashboard Berbasis Data</span>
            </h2>
            <p className="text-[#DBE2EF]/80 text-lg max-w-2xl mx-auto mb-16 leading-relaxed">
              Monitor kinerja pelayanan desa/instansi Anda secara real-time. Peta sebaran masalah, tren aduan, dan performa respon dalam satu layar.
            </p>

            <div className="relative mx-auto max-w-6xl rounded-3xl bg-black/20 p-2 ring-1 ring-white/10 backdrop-blur-3xl lg:p-4 perspective-1000 shadow-2xl">
              <div className="rounded-2xl overflow-hidden border border-white/10 bg-[#1a1a1a]">
                 <Image 
                   src="/dashboard.png"
                   alt="Dashboard Preview" 
                   width={1400} 
                   height={900} 
                   className="w-full h-auto object-cover"
                   unoptimized
                 />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6 mt-16 text-left">
               {[
                 { title: "Real-time Analytics", desc: "Data masuk seketika saat warga melapor." },
                 { title: "Sentiment Analysis", desc: "AI membaca emosi warga: Marah, Netral, Puas." },
                 { title: "Geo-Tagging Map", desc: "Lihat titik lokasi kerusakan/masalah di peta." },
                 { title: "Export Laporan", desc: "Unduh laporan PDF/Excel sekali klik." }
               ].map((item, i) => (
                 <div key={i} className="bg-white/5 p-6 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors">
                    <h4 className="font-bold text-white mb-2">{item.title}</h4>
                    <p className="text-sm text-[#DBE2EF]/60">{item.desc}</p>
                 </div>
               ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            FAQ
            ═══════════════════════════════════════════════════ */}
        <FAQSection />

        {/* ═══════════════════════════════════════════════════
            CTA
            ═══════════════════════════════════════════════════ */}
        <section className="py-20 bg-white dark:bg-black text-center relative overflow-hidden">
           <div className="absolute inset-0 bg-linear-to-b from-transparent to-[#F9F7F7]/50 dark:to-[#111] pointer-events-none"></div>
           <div className="max-w-4xl mx-auto px-4 relative z-10">
             <Rocket className="w-16 h-16 text-[#3F72AF] mx-auto mb-6 animate-bounce" />
             <h2 className="text-3xl md:text-5xl font-black text-[#112D4E] dark:text-white mb-6">Siap Menuju <span className="text-[#3F72AF]">Smart Government?</span></h2>
             <p className="text-lg md:text-xl text-[#112D4E]/60 dark:text-[#DBE2EF]/60 mb-10 max-w-2xl mx-auto">
               Jangan biarkan pelayanan terhambat. Gabung revolusi AI sekarang dan tingkatkan kepuasan masyarakat.
             </p>
             <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" className="h-12 px-8 rounded-xl bg-[#25D366] hover:bg-[#1ebd59] text-white text-lg font-bold shadow-xl shadow-green-500/20 transform hover:-translate-y-1 transition-all" asChild>
                  <a href={whatsappLink} target="_blank">
                    <WhatsAppIcon className="w-5 h-5 mr-2" /> Hubungi Kami via WhatsApp
                  </a>
                </Button>
                <Button size="lg" variant="outline" className="h-12 px-8 rounded-xl border-2 hover:bg-[#F9F7F7] dark:hover:bg-[#111] text-lg font-bold" asChild>
                   <Link href="/login">Masuk Dashboard</Link>
                </Button>
             </div>
           </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            FOOTER
            ═══════════════════════════════════════════════════ */}
        <footer className="bg-[#112D4E] dark:bg-[#050505] text-[#DBE2EF] py-20 border-t border-white/5 relative z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="grid md:grid-cols-4 gap-12 mb-16">
              <div className="col-span-1 md:col-span-2">
                <div className="flex items-center gap-3 mb-8">
                   <div className="relative w-40 h-10">
                      <Image 
                        src="/logo-dashboard-dark.png" 
                        alt="Tanggapin AI" 
                        fill
                        className="object-contain object-left"
                      />
                   </div>
                </div>
                <p className="text-white/60 leading-relaxed max-w-sm text-lg mb-8">
                  Sistem AI Agent khusus Pemerintah Berbasis Large Language Model untuk Meningkatkan Kecepatan Respons Pelayanan dan Pengaduan Publik.
                </p>
                <div className="flex gap-4">
                  <a href={whatsappLink} target="_blank" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#25D366] text-white transition-all"><WhatsAppIcon className="w-5 h-5" /></a>
                  <a href="mailto:genfity@gmail.com" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#3F72AF] text-white transition-all"><Mail className="w-5 h-5" /></a>
                  <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#E1306C] text-white transition-all"><TrendingUp className="w-5 h-5" /></a>
                </div>
              </div>
              
              <div>
                <h4 className="font-bold text-white mb-8 uppercase tracking-wider text-sm">Produk</h4>
                <ul className="space-y-4 text-base">
                  <li><Link href="#fitur" className="hover:text-white hover:translate-x-1 transition-all inline-block">Tanggapin Pengaduan</Link></li>
                  <li><Link href="#fitur" className="hover:text-white hover:translate-x-1 transition-all inline-block">Tanggapin Layanan</Link></li>
                  <li><Link href="#fitur" className="hover:text-white hover:translate-x-1 transition-all inline-block">Tanggapin Informasi</Link></li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-white mb-8 uppercase tracking-wider text-sm">Kontak</h4>
                <ul className="space-y-4 text-base">
                  <li className="flex items-center gap-4"><MapPin className="w-5 h-5 text-[#3F72AF]" /> <span>Bandung, Jawa Barat</span></li>
                  <li className="flex items-center gap-4"><Mail className="w-5 h-5 text-[#3F72AF]" /> <span>genfity@gmail.com</span></li>
                  <li className="flex items-center gap-4"><Phone className="w-5 h-5 text-[#3F72AF]" /> <span>+62 812-3378-4490</span></li>
                </ul>
              </div>
            </div>
            
            <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center text-sm text-white/40">
              <p>&copy; 2026 Tanggapin AI. PKM Karsa Cipta / Karya Inovasi.</p>
              <p>Developed by <a href="https://genfity.com" target="_blank" rel="noopener noreferrer" className="text-[#3F72AF] hover:text-white transition-colors">Genfity Digital Solution</a></p>
            </div>
          </div>
        </footer>

        <LiveChatWidget isDark={isDark} />
      </div>
    </>
  );
}

/* Helper Icons */
function ArrowDown(props: any) {
  return <svg {...props} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>;
}

function ShieldAlert(props: any) {
  return <svg {...props} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>;
}

function Info(props: any) {
  return <svg {...props} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>;
}
