"use client";

import { useEffect, useState } from "react";
import { motion, useScroll } from "framer-motion";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileCheck,
  Gauge,
  Globe2,
  Layers3,
  LineChart,
  LockKeyhole,
  Mail,
  Menu,
  MessageCircle,
  Moon,
  Network,
  Phone,
  Play,
  Rocket,
  ShieldCheck,
  Sparkles,
  Sun,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChatAnimation, LiveChatWidget, WhatsAppIcon } from "@/components/landing";
import { HomePageJsonLd } from "@/components/seo";
import { generateWhatsAppLink } from "@/lib/whatsapp";

const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45 } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const navItems = [
  { id: "arsitektur", label: "Arsitektur" },
  { id: "fitur", label: "Fitur" },
  { id: "kontrol", label: "Kontrol" },
  { id: "demo", label: "Demo" },
  { id: "faq", label: "FAQ" },
];

const stats = [
  { value: "24/7", label: "layanan warga aktif" },
  { value: "Multi-tenant", label: "siap banyak desa" },
  { value: "AI Wallet", label: "biaya AI terkendali" },
  { value: "Realtime", label: "laporan & analytics" },
];

const architecture = [
  {
    icon: MessageCircle,
    title: "Citizen Channels",
    desc: "Warga menghubungi layanan via WhatsApp atau webchat tanpa perlu install aplikasi baru.",
    items: ["WhatsApp", "Webchat", "Status tracking"],
  },
  {
    icon: Brain,
    title: "AI Orchestration",
    desc: "AI memahami pesan, membaca knowledge base, membuat tiket, dan mengarahkan alur layanan.",
    items: ["Knowledge lookup", "Intent routing", "Human handoff"],
  },
  {
    icon: Database,
    title: "Gov Services",
    desc: "Laporan, permohonan layanan, dokumen, kontak penting, dan profil desa dikelola terpusat.",
    items: ["Case service", "Service catalog", "Village data"],
  },
  {
    icon: BarChart3,
    title: "Admin Command Center",
    desc: "Admin desa memantau operasional, biaya AI, wallet, analytics, dan kesehatan layanan.",
    items: ["Dashboard", "Analytics", "System health"],
  },
];

const features = [
  {
    icon: Bot,
    title: "Asisten AI Pemerintahan",
    desc: "Menjawab pertanyaan warga dari knowledge base desa dengan konteks layanan publik.",
    className: "",
  },
  {
    icon: FileCheck,
    title: "Laporan & Layanan",
    desc: "Keluhan, pengaduan, pengajuan surat, dan permohonan layanan masuk ke dashboard.",
    className: "",
  },
  {
    icon: Globe2,
    title: "Omnichannel",
    desc: "WhatsApp dan webchat memakai alur layanan yang sama agar pengalaman warga konsisten.",
    className: "",
  },
  {
    icon: LineChart,
    title: "Analitik Operasional",
    desc: "Pantau volume laporan, tren kategori, performa layanan, dan aktivitas AI.",
    className: "",
  },
  {
    icon: Building2,
    title: "Dashboard Admin Desa",
    desc: "Role admin desa menjaga akses operasional sesuai tanggung jawab layanan.",
    className: "",
  },
  {
    icon: Wallet,
    title: "Kontrol Saldo AI",
    desc: "Pemakaian AI tercatat transparan dan saldo desa bisa dipantau dari dashboard.",
    className: "",
  },
];

const personas = [
  {
    title: "Untuk Warga",
    desc: "Tanya syarat layanan, kirim laporan, ajukan surat, dan cek status langsung dari HP.",
    items: ["Chat 24/7", "Tidak perlu antre", "Update status"],
  },
  {
    title: "Untuk Admin Desa",
    desc: "Kelola laporan, layanan, knowledge base, WhatsApp, analytics, dan saldo AI desa.",
    items: ["Inbox layanan", "Knowledge base", "AI balance"],
  },
  {
    title: "Untuk Pemerintah Daerah",
    desc: "Pantau kualitas layanan, tren laporan, kebutuhan warga, dan efisiensi operasional.",
    items: ["Insight layanan", "Monitoring", "Keputusan data-driven"],
  },
];

const controls = [
  { icon: ShieldCheck, title: "Tenant Scoped", desc: "Data, blacklist, wallet, dan analytics mengikuti konteks desa." },
  { icon: Gauge, title: "Rate Limit & Blacklist", desc: "Batasi spam, pelaporan berulang, dan nomor bermasalah dari dashboard." },
  { icon: Wallet, title: "AI Wallet", desc: "Setiap penggunaan AI dapat dilacak dan didebit dari saldo desa." },
  { icon: LockKeyhole, title: "Audit & Monitoring", desc: "Aktivitas admin, provider, dan kesehatan sistem lebih mudah diawasi." },
];

const outcomes = [
  { value: "< 3 detik", label: "respons awal AI" },
  { value: "80%", label: "pertanyaan rutin dapat diotomasi" },
  { value: "1 dashboard", label: "untuk channel dan operasional" },
  { value: "2-4 minggu", label: "estimasi implementasi awal" },
];

const faqs = [
  {
    q: "Apa nilai jual utama GovConnect?",
    a: "GovConnect menyatukan WhatsApp, webchat, AI knowledge base, tiket layanan, analytics, wallet AI, dan kontrol multi-tenant dalam satu platform operasional pemerintahan.",
  },
  {
    q: "Apakah bisa dipakai oleh banyak desa?",
    a: "Ya. Arsitekturnya multi-tenant sehingga data desa, role admin, saldo AI, rate limit, dan laporan dapat dipisahkan per desa.",
  },
  {
    q: "Apakah AI tetap bisa dikontrol biayanya?",
    a: "Ya. GovConnect memakai AI wallet dan ledger penggunaan sehingga pemakaian WhatsApp, webchat, dan testing knowledge dapat dipantau dan dibatasi.",
  },
  {
    q: "Bagaimana jika AI tidak bisa menjawab?",
    a: "Percakapan tetap dapat diarahkan ke admin atau ditindaklanjuti sebagai laporan/permohonan layanan sesuai alur yang dikonfigurasi.",
  },
  {
    q: "Channel apa saja yang didukung?",
    a: "Landing ini menonjolkan WhatsApp dan webchat sebagai channel utama, dengan dashboard sebagai pusat kendali admin.",
  },
];

export default function LandingPage() {
  const [isDark, setIsDark] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const whatsappLink = generateWhatsAppLink();
  const { scrollYProgress } = useScroll();

  useEffect(() => {
    document.documentElement.classList.remove("dark");
    const handleScroll = () => setScrolled(window.scrollY > 32);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  return (
    <>
      <HomePageJsonLd />
      <main className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-950 transition-colors duration-300 dark:bg-slate-950 dark:text-white">
        <motion.div
          className="fixed left-0 right-0 top-0 z-[70] h-0.5 origin-left bg-gradient-to-r from-emerald-400 via-cyan-500 to-blue-600"
          style={{ scaleX: scrollYProgress }}
        />

        <nav className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? "border-b border-white/10 bg-white/85 shadow-sm backdrop-blur-2xl dark:bg-slate-950/85" : "bg-transparent"}`}>
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <Link href="/" className="flex items-center">
              <Image src={isDark ? "/logo-dashboard-dark.png" : "/logo-dashboard.png"} alt="GovConnect" width={132} height={40} priority className="h-10 w-auto object-contain" />
            </Link>

            <div className="hidden items-center gap-1 rounded-full border border-slate-200/70 bg-white/70 p-1 text-sm shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5 md:flex">
              {navItems.map((item) => (
                <Link key={item.id} href={`#${item.id}`} className="rounded-full px-4 py-2 text-slate-600 transition hover:bg-slate-900 hover:text-white dark:text-slate-300 dark:hover:bg-white dark:hover:text-slate-950">
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full">
                {isDark ? <Sun className="h-4 w-4 text-amber-300" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button asChild className="hidden rounded-full bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 sm:inline-flex">
                <Link href="/login">Masuk Dashboard</Link>
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen((value) => !value)} className="rounded-full md:hidden">
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          {mobileMenuOpen && (
            <div className="border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 md:hidden">
              <div className="space-y-1">
                {navItems.map((item) => (
                  <Link key={item.id} href={`#${item.id}`} onClick={() => setMobileMenuOpen(false)} className="block rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">
                    {item.label}
                  </Link>
                ))}
                <Button asChild className="mt-3 w-full rounded-full">
                  <Link href="/login">Masuk Dashboard</Link>
                </Button>
              </div>
            </div>
          )}
        </nav>

        <section className="relative isolate overflow-hidden px-4 pb-16 pt-28 sm:px-6 lg:px-8 lg:pb-24 lg:pt-32">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.24),transparent_32%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.22),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,250,252,1))] dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.2),transparent_30%),radial-gradient(circle_at_top_right,rgba(37,99,235,0.24),transparent_34%),linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,1))]" />
          <div className="absolute left-1/2 top-24 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-400/20 blur-3xl" />

          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.02fr_0.98fr]">
            <motion.div variants={stagger} initial="hidden" animate="visible" className="text-center lg:text-left">
              <motion.div variants={fadeUp} className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-white/70 px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm backdrop-blur dark:bg-white/10 dark:text-emerald-300">
                <Sparkles className="h-4 w-4" /> AI command center untuk layanan publik modern
              </motion.div>

              <motion.h1 variants={fadeUp} className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-5xl lg:text-6xl">
                Transformasi layanan warga dari chat menjadi tindakan nyata.
              </motion.h1>
              <motion.p variants={fadeUp} className="mx-auto mt-6 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300 lg:mx-0 lg:text-lg">
                GovConnect menghubungkan WhatsApp, webchat, AI knowledge base, laporan warga, permohonan layanan, analytics, dan kontrol biaya AI dalam satu platform pemerintahan yang siap operasional.
              </motion.p>

              <motion.div variants={fadeUp} className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
                <Button asChild size="lg" className="rounded-full bg-gradient-to-r from-emerald-500 to-cyan-600 text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-600 hover:to-cyan-700">
                  <Link href="#demo">
                    <Play className="mr-2 h-4 w-4" /> Lihat Demo
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="rounded-full border-slate-300 bg-white/70 backdrop-blur dark:border-white/15 dark:bg-white/5">
                  <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon className="mr-2 h-4 w-4" /> Konsultasi WhatsApp
                  </a>
                </Button>
              </motion.div>

              <motion.div variants={fadeUp} className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stats.map((item) => (
                  <div key={item.value} className="rounded-2xl border border-white/70 bg-white/70 p-4 text-left shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
                    <div className="text-lg font-semibold text-slate-950 dark:text-white">{item.value}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.label}</div>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.15 }} className="relative">
              <div className="absolute -left-6 top-12 z-10 hidden rounded-2xl border border-white/70 bg-white/85 p-4 shadow-xl backdrop-blur dark:border-white/10 dark:bg-slate-900/85 sm:block">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600"><Zap className="h-5 w-5" /></div>
                  <div>
                    <p className="text-sm font-semibold">Auto-ticket created</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Laporan warga langsung masuk dashboard</p>
                  </div>
                </div>
              </div>
              <div className="absolute -right-4 bottom-14 z-10 hidden rounded-2xl border border-white/70 bg-white/85 p-4 shadow-xl backdrop-blur dark:border-white/10 dark:bg-slate-900/85 md:block">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-blue-500/10 p-2 text-blue-600"><Wallet className="h-5 w-5" /></div>
                  <div>
                    <p className="text-sm font-semibold">AI usage tracked</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Debit wallet per desa</p>
                  </div>
                </div>
              </div>
              <ChatAnimation />
            </motion.div>
          </div>
        </section>

        <section className="relative border-y border-slate-200/70 bg-white/70 py-6 backdrop-blur dark:border-white/10 dark:bg-white/5">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-4 text-xs font-medium text-slate-500 dark:text-slate-400 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Desa/Kelurahan", icon: Building2 },
              { label: "Kecamatan", icon: Network },
              { label: "Kabupaten/Kota", icon: Layers3 },
              { label: "Puskesmas", icon: ShieldCheck },
              { label: "Dinas Publik", icon: FileCheck },
              { label: "Command Center", icon: Activity },
            ].map((item) => (
              <div key={item.label} className="group flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:text-slate-950 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:hover:text-white">
                <item.icon className="h-4 w-4 text-cyan-600 transition group-hover:scale-110" />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="arsitektur" className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
          <div className="absolute left-0 top-24 -z-10 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="absolute bottom-10 right-0 -z-10 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="mx-auto max-w-7xl">
            <SectionHeader eyebrow="Arsitektur GovConnect" title="Dari percakapan warga menjadi workflow layanan yang terukur." desc="Setiap pesan masuk melewati channel, AI orchestration, service layer, lalu masuk ke command center admin dengan audit, analytics, dan kontrol biaya." />

            <div className="relative mt-14 rounded-[2rem] border border-slate-200/70 bg-white/70 p-4 shadow-2xl shadow-slate-200/60 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none sm:p-6">
              <div className="absolute inset-x-10 top-1/2 hidden h-px bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500 lg:block" />
              <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} className="relative grid gap-4 lg:grid-cols-4">
                {architecture.map((item, index) => (
                  <motion.div key={item.title} variants={fadeUp}>
                    <Card className="group relative h-full overflow-hidden border-slate-200/70 bg-white shadow-sm transition duration-300 hover:-translate-y-2 hover:border-cyan-300 hover:shadow-2xl hover:shadow-cyan-500/10 dark:border-white/10 dark:bg-slate-950/80">
                      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-cyan-500 to-blue-600 opacity-0 transition group-hover:opacity-100" />
                      <CardContent className="p-6">
                        <div className="mb-6 flex items-center justify-between">
                          <div className="relative rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 p-3 text-white shadow-lg shadow-emerald-500/20">
                            <div className="absolute inset-0 rounded-2xl bg-white/20 opacity-0 blur transition group-hover:opacity-100" />
                            <item.icon className="relative h-5 w-5" />
                          </div>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-400">Step 0{index + 1}</span>
                        </div>
                        <h3 className="text-lg font-semibold">{item.title}</h3>
                        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.desc}</p>
                        <div className="mt-6 space-y-2">
                          {item.items.map((tag) => (
                            <div key={tag} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {tag}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </div>
        </section>

        <section id="fitur" className="relative overflow-hidden bg-slate-100/70 px-4 py-24 dark:bg-white/[0.03] sm:px-6 lg:px-8">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:44px_44px] opacity-40 dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)]" />
          <div className="relative mx-auto max-w-7xl">
            <SectionHeader eyebrow="Fitur utama" title="Lebih dari chatbot: satu operating system untuk layanan warga." desc="Bagian warga dibuat sederhana, sementara bagian admin menyimpan kontrol penuh untuk operasional, laporan, knowledge, biaya AI, dan performa layanan." />

            <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map((item, index) => (
                <motion.div key={item.title} variants={fadeUp} className={item.className}>
                  <Card className="group relative h-full overflow-hidden border-slate-200/70 bg-white/90 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-slate-300/40 dark:border-white/10 dark:bg-slate-950/80 dark:hover:shadow-cyan-500/10">
                    <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-gradient-to-br from-emerald-400/20 to-cyan-500/20 blur-2xl transition group-hover:scale-150" />
                    <CardContent className="relative flex h-full flex-col justify-between p-7">
                      <div>
                        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg transition group-hover:rotate-3 group-hover:scale-110 dark:bg-white dark:text-slate-950">
                          <item.icon className="h-5 w-5" />
                        </div>
                        <h3 className="text-xl font-semibold">{item.title}</h3>
                        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.desc}</p>
                      </div>
                      <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
                        <span>Module 0{index + 1}</span>
                        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {personas.map((item, index) => (
                <Card key={item.title} className="group overflow-hidden border-slate-200/70 bg-white/80 shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-white/10 dark:bg-white/5">
                  <CardContent className="p-6">
                    <div className="mb-5 flex items-center justify-between">
                      <div className="rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 p-3 text-white shadow-lg shadow-cyan-500/20">
                        {index === 0 ? <MessageCircle className="h-5 w-5" /> : index === 1 ? <Building2 className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                      </div>
                      <span className="text-xs font-semibold text-slate-400">Persona</span>
                    </div>
                    <h3 className="text-lg font-semibold">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.desc}</p>
                    <div className="mt-5 space-y-2">
                      {item.items.map((point) => (
                        <div key={point} className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-white/10 dark:text-slate-300">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {point}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="kontrol" className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
          <div className="absolute left-1/2 top-10 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
            <div>
              <Pill>Kontrol operasional</Pill>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">AI boleh pintar, tapi operasional tetap harus terkendali.</h2>
              <p className="mt-5 text-base leading-8 text-slate-600 dark:text-slate-300">
                GovConnect menonjolkan kontrol yang biasanya hilang pada chatbot biasa: tenant scoping, rate limit, blacklist, wallet debit, audit trail, dan monitoring provider.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-3">
                {["Scope desa", "Blacklist", "Wallet debit", "Audit log"].map((item) => (
                  <div key={item} className="rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm font-medium shadow-sm dark:border-white/10 dark:bg-white/5">
                    <CheckCircle2 className="mb-2 h-4 w-4 text-emerald-500" /> {item}
                  </div>
                ))}
              </div>
              <Button asChild className="mt-8 rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                <Link href="/login">
                  Buka Dashboard <ChevronRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>

            <div className="rounded-[2rem] border border-slate-200/70 bg-slate-950 p-3 shadow-2xl shadow-cyan-500/10 dark:border-white/10">
              <div className="rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_36%),linear-gradient(180deg,rgba(15,23,42,1),rgba(2,6,23,1))] p-5 text-white">
                <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-sm text-slate-400">GovConnect Control Plane</p>
                    <p className="text-lg font-semibold">Operational safeguards</p>
                  </div>
                  <div className="flex gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-red-400" />
                    <span className="h-3 w-3 rounded-full bg-yellow-400" />
                    <span className="h-3 w-3 rounded-full bg-emerald-400" />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {controls.map((item) => (
                    <div key={item.title} className="group rounded-2xl border border-white/10 bg-white/[0.06] p-5 transition hover:bg-white/[0.1]">
                      <div className="mb-4 inline-flex rounded-xl bg-white/10 p-3 text-cyan-300 group-hover:text-emerald-300">
                        <item.icon className="h-5 w-5" />
                      </div>
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="demo" className="relative overflow-hidden bg-slate-950 px-4 py-20 text-white sm:px-6 lg:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.24),transparent_34%)]" />
          <div className="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <Pill dark>Demo produk</Pill>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">Lihat bagaimana admin mengontrol layanan warga dari satu dashboard.</h2>
              <p className="mt-5 text-base leading-8 text-slate-300">
                Landing page tetap menyediakan demo webchat di pojok kanan bawah, sementara dashboard memperlihatkan operasional desa: laporan, layanan, knowledge, analytics, AI usage, dan balance.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="rounded-full bg-white text-slate-950 hover:bg-slate-200">
                  <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon className="mr-2 h-4 w-4" /> Coba via WhatsApp
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline" className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                  <Link href="/login">Masuk Dashboard</Link>
                </Button>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-emerald-400/20 to-blue-500/20 blur-2xl" />
              <Image src="/dashboard.png" alt="GovConnect dashboard preview" width={900} height={560} className="relative rounded-3xl border border-white/10 shadow-2xl" />
              <div className="absolute -bottom-6 left-6 right-6 grid grid-cols-3 gap-3 rounded-2xl border border-white/10 bg-slate-900/90 p-4 shadow-2xl backdrop-blur">
                {outcomes.slice(0, 3).map((item) => (
                  <div key={item.value}>
                    <p className="text-sm font-semibold sm:text-base">{item.value}</p>
                    <p className="mt-1 text-[10px] text-slate-400 sm:text-xs">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeader eyebrow="Dampak bisnis" title="Point jual yang mudah dipahami stakeholder." desc="GovConnect membantu pemerintah mempercepat layanan, mengurangi beban petugas, dan membuat penggunaan AI tetap transparan." />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {outcomes.map((item) => (
                <Card key={item.value} className="border-slate-200/70 bg-white text-center shadow-sm dark:border-white/10 dark:bg-white/5">
                  <CardContent className="p-6">
                    <div className="bg-gradient-to-r from-emerald-500 to-cyan-600 bg-clip-text text-3xl font-semibold text-transparent">{item.value}</div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="bg-slate-100/70 px-4 py-20 dark:bg-white/[0.03] sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <SectionHeader eyebrow="FAQ" title="Pertanyaan yang sering muncul." desc="Ringkasan cepat untuk calon pengguna dan stakeholder teknis." />
            <Accordion type="single" collapsible className="mt-10 space-y-3">
              {faqs.map((item, index) => (
                <AccordionItem key={item.q} value={`faq-${index}`} className="rounded-2xl border border-slate-200 bg-white px-5 dark:border-white/10 dark:bg-slate-900/70">
                  <AccordionTrigger className="text-left font-semibold hover:no-underline">{item.q}</AccordionTrigger>
                  <AccordionContent className="leading-7 text-slate-600 dark:text-slate-300">{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        <section className="px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-emerald-500 via-cyan-600 to-blue-700 p-8 text-center text-white shadow-2xl shadow-cyan-500/20 sm:p-12">
            <Rocket className="mx-auto h-10 w-10" />
            <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">Siap membuat layanan warga lebih cepat dan terukur?</h2>
            <p className="mx-auto mt-4 max-w-2xl text-white/85">Mulai dari konsultasi kebutuhan, setup knowledge base, integrasi channel, sampai dashboard operasional untuk admin desa dan pengelola layanan.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full bg-white text-slate-950 hover:bg-slate-100">
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                  <WhatsAppIcon className="mr-2 h-4 w-4" /> Konsultasi Sekarang
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                <a href="mailto:info@govconnect.id">
                  <Mail className="mr-2 h-4 w-4" /> Kirim Email
                </a>
              </Button>
            </div>
          </div>
        </section>

        <footer className="border-t border-slate-200 bg-white px-4 py-10 dark:border-white/10 dark:bg-slate-950 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
            <div>
              <Image src={isDark ? "/logo-dashboard-dark.png" : "/logo-dashboard.png"} alt="GovConnect" width={132} height={40} className="h-10 w-auto object-contain" />
              <p className="mt-4 max-w-md text-sm leading-7 text-slate-600 dark:text-slate-300">Platform AI untuk menghubungkan masyarakat dan admin desa dalam satu sistem layanan publik digital.</p>
            </div>
            <div>
              <h3 className="font-semibold">Produk</h3>
              <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {navItems.map((item) => <Link key={item.id} href={`#${item.id}`} className="block hover:text-cyan-600">{item.label}</Link>)}
              </div>
            </div>
            <div>
              <h3 className="font-semibold">Kontak</h3>
              <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-emerald-600"><Phone className="h-4 w-4" /> WhatsApp</a>
                <a href="mailto:info@govconnect.id" className="flex items-center gap-2 hover:text-cyan-600"><Mail className="h-4 w-4" /> info@govconnect.id</a>
              </div>
            </div>
          </div>
          <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-2 border-t border-slate-200 pt-6 text-xs text-slate-500 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Dibuat dan dikembangkan oleh{" "}
              <a href="https://genfity.com" target="_blank" rel="noopener noreferrer" className="font-medium text-cyan-600 hover:underline dark:text-cyan-400">
                Genfity Digital Solution
              </a>
            </p>
            <p>© {new Date().getFullYear()} GovConnect. Hak cipta dilindungi.</p>
          </div>
        </footer>

        <LiveChatWidget isDark={isDark} />
      </main>
    </>
  );
}

function Pill({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${dark ? "border border-white/15 bg-white/10 text-emerald-200" : "border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
      <Sparkles className="h-4 w-4" /> {children}
    </span>
  );
}

function SectionHeader({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  return (
    <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} className="mx-auto max-w-3xl text-center">
      <motion.div variants={fadeUp}>
        <Pill>{eyebrow}</Pill>
      </motion.div>
      <motion.h2 variants={fadeUp} className="mt-5 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
        {title}
      </motion.h2>
      <motion.p variants={fadeUp} className="mt-4 text-base leading-8 text-slate-600 dark:text-slate-300">
        {desc}
      </motion.p>
    </motion.div>
  );
}
