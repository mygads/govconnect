"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Sun,
  Moon,
  MessageCircle,
  FileText,
  Bell,
  Clock,
  Phone,
  Mail,
  MapPin,
  Heart,
  LayoutDashboard,
  BarChart3,
  Users,
  Shield,
  AlertTriangle,
  Siren,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  WhatsAppIcon,
  ChatAnimation,
  HowItWorksAnimation,
  SolutionAnimation,
  FAQAnimation,
  ClockToCheckAnimation,
  StepsLightingAnimation,
  PhoneServicesAnimation,
  ProblemAnimation,
  LiveChatWidget,
} from "@/components/landing";
import { generateWhatsAppLink } from "@/lib/whatsapp";

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};

const slideInLeft = {
  hidden: { opacity: 0, x: -50 },
  visible: { opacity: 1, x: 0 },
};

const slideInRight = {
  hidden: { opacity: 0, x: 50 },
  visible: { opacity: 1, x: 0 },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
};

export default function LandingPage() {
  const router = useRouter();
  const [isDark, setIsDark] = useState(false);
  const whatsappLink = generateWhatsAppLink();

  // Set initial theme on mount
  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/70 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5">
              <Image
                src={isDark ? "/logo-dashboard-dark.png" : "/logo-dashboard.png"}
                alt="GovConnect Logo"
                width={140}
                height={140}
                className="object-contain"
                priority
              />
            </Link>

            {/* Menu - Desktop */}
            <div className="hidden lg:flex items-center gap-1 absolute left-1/2 -translate-x-1/2 bg-muted/50 rounded-full px-2 py-1">
              {[
                { id: "masalah", label: "Masalah" },
                { id: "fitur", label: "Fitur" },
                { id: "cara-penggunaan", label: "Cara Kerja" },
                { id: "manfaat", label: "Manfaat" },
                { id: "testimoni", label: "Testimoni" },
                { id: "faq", label: "FAQ" },
              ].map((item) => (
                <Link
                  key={item.id}
                  href={`#${item.id}`}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-background/80 px-4 py-2 rounded-full transition-all duration-200"
                >
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Login & Theme Toggle */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="rounded-full w-9 h-9 hover:bg-muted transition-colors duration-200"
              >
                {isDark ? (
                  <Sun className="h-[1.1rem] w-[1.1rem] text-yellow-500" />
                ) : (
                  <Moon className="h-[1.1rem] w-[1.1rem] text-slate-600" />
                )}
              </Button>
              <Button asChild className="rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground shadow-md shadow-secondary/20 px-6">
                <Link href="/login">Login</Link>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-24 pb-16 md:pt-32 md:pb-24 overflow-hidden">
        {/* Background Gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-secondary/5 via-transparent to-primary/5 pointer-events-none" />
        <div className="absolute top-20 left-10 w-72 h-72 bg-secondary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div
              variants={slideInLeft}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.6 }}
              className="text-center md:text-left"
            >
              {/* Badge */}
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="inline-flex items-center gap-2 bg-secondary/10 border border-secondary/20 rounded-full px-4 py-1.5 mb-6"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
                </span>
                <span className="text-sm font-medium text-secondary">Layanan 24/7 via WhatsApp</span>
              </motion.div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
                Layanan Kelurahan{" "}
                <span className="bg-gradient-to-r from-secondary to-primary bg-clip-text text-transparent">
                  Dalam Satu Aplikasi
                </span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-xl mx-auto md:mx-0">
                GovConnect membantu Kamu mengurus laporan, surat, dan informasi
                kelurahan dengan cepat dan mudah. Tidak perlu lagi antre
                berjam-jam atau bolak-balik ke kantor kelurahan.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
                <Button size="lg" className="text-lg px-8 bg-secondary hover:bg-secondary/90 shadow-lg shadow-secondary/25" asChild>
                  <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon className="mr-2 h-5 w-5" />
                    Mulai Sekarang
                  </a>
                </Button>
                <Button size="lg" variant="outline" className="text-lg px-8 border-2" asChild>
                  <Link href="#cara-penggunaan">Pelajari Lebih Lanjut</Link>
                </Button>
              </div>

              {/* Stats */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 }}
                className="flex flex-wrap gap-8 mt-10 justify-center md:justify-start"
              >
                {[
                  { value: "1000+", label: "Warga Terlayani" },
                  { value: "24/7", label: "Layanan Aktif" },
                  { value: "< 5 menit", label: "Respon Cepat" },
                ].map((stat, index) => (
                  <div key={index} className="text-center md:text-left">
                    <p className="text-2xl md:text-3xl font-bold text-secondary">{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            <motion.div
              variants={slideInRight}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative"
            >
              {/* Decorative elements */}
              <div className="absolute -top-4 -left-4 w-20 h-20 bg-secondary/20 rounded-2xl rotate-12 blur-sm" />
              <div className="absolute -bottom-4 -right-4 w-16 h-16 bg-primary/20 rounded-full blur-sm" />
              <ChatAnimation />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section id="masalah" className="py-20 bg-gradient-to-b from-muted/50 to-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center max-w-3xl mx-auto mb-16"
          >
            <span className="inline-block text-sm font-semibold text-destructive bg-destructive/10 px-4 py-1.5 rounded-full mb-4">
              Masalah yang Sering Terjadi
            </span>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Masalah Umum Layanan Kelurahan
            </h2>
            <p className="text-muted-foreground text-lg">
              Proses yang rumit dan memakan waktu membuat warga kesulitan mengakses layanan kelurahan
            </p>
          </motion.div>

          <ProblemAnimation />

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid md:grid-cols-3 gap-6 mt-12"
          >
            {[
              { icon: Clock, title: "Proses Lama", desc: "Harus datang ke kantor kelurahan dan menunggu berjam-jam dalam antrian", color: "from-red-500 to-orange-500" },
              { icon: FileText, title: "Prosedur Rumit", desc: "Banyak formulir dan persyaratan yang membingungkan warga", color: "from-orange-500 to-amber-500" },
              { icon: Bell, title: "Tidak Ada Notifikasi", desc: "Tidak tahu status pengajuan dan harus cek manual berulang kali", color: "from-amber-500 to-yellow-500" },
            ].map((problem, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="group hover:shadow-xl transition-all duration-300 border-destructive/10 hover:border-destructive/30 overflow-hidden">
                  <CardHeader className="relative">
                    <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${problem.color} opacity-5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:opacity-10 transition-opacity`} />
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${problem.color} flex items-center justify-center mb-4 shadow-lg`}>
                      <problem.icon className="h-7 w-7 text-white" />
                    </div>
                    <CardTitle className="text-xl">{problem.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{problem.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="fitur" className="py-20 md:py-28 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-1/2 left-0 w-96 h-96 bg-secondary/5 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2" />
        <div className="absolute top-1/2 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-block text-sm font-semibold text-secondary bg-secondary/10 px-4 py-1.5 rounded-full mb-4">
              Fitur Unggulan
            </span>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Solusi Lengkap dalam{" "}
              <span className="bg-gradient-to-r from-secondary to-primary bg-clip-text text-transparent">
                Satu Aplikasi
              </span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              GovConnect mengintegrasikan semua layanan kelurahan dalam satu platform yang mudah diakses
            </p>
          </motion.div>

          <div className="flex justify-center mb-16">
            <SolutionAnimation />
          </div>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid md:grid-cols-3 gap-8"
          >
            {[
              { icon: MessageCircle, title: "Laporan Keluhan", desc: "Laporkan masalah infrastruktur dan dapatkan tindak lanjut cepat dari petugas", gradient: "from-blue-500 to-cyan-500", bg: "from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30" },
              { icon: FileText, title: "Pengajuan Surat", desc: "Ajukan surat keterangan tanpa harus datang ke kantor kelurahan", gradient: "from-green-500 to-emerald-500", bg: "from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30" },
              { icon: Bell, title: "Informasi Real-time", desc: "Dapatkan notifikasi dan update status pengajuan Anda secara langsung", gradient: "from-orange-500 to-amber-500", bg: "from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30" },
            ].map((feature, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className={`h-full hover:shadow-2xl transition-all duration-300 border-0 bg-gradient-to-br ${feature.bg} group`}>
                  <CardHeader className="pb-4">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                      <feature.icon className="h-7 w-7 text-white" />
                    </div>
                    <CardTitle className="text-xl">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="cara-penggunaan" className="py-20 md:py-28 bg-gradient-to-b from-muted/50 to-background relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 left-20 w-4 h-4 bg-secondary rounded-full" />
          <div className="absolute top-40 right-40 w-3 h-3 bg-primary rounded-full" />
          <div className="absolute bottom-40 left-1/4 w-2 h-2 bg-secondary rounded-full" />
          <div className="absolute bottom-20 right-1/3 w-3 h-3 bg-primary rounded-full" />
        </div>
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-block text-sm font-semibold text-primary bg-primary/10 px-4 py-1.5 rounded-full mb-4">
              Mudah & Cepat
            </span>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Cara Penggunaan</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Hanya 4 langkah mudah untuk mengakses layanan kelurahan
            </p>
          </motion.div>

          <div className="flex justify-center">
            <HowItWorksAnimation />
          </div>
        </div>
      </section>

      {/* Dashboard Admin Section */}
      <section id="dashboard-admin" className="py-20 md:py-28 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-primary/5 to-transparent pointer-events-none" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header - Centered */}
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary bg-primary/10 px-4 py-1.5 rounded-full mb-4">
              <LayoutDashboard className="w-4 h-4" />
              Untuk Petugas Pemerintah
            </span>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Dashboard Admin untuk{" "}
              <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                Pengelolaan Terpusat
              </span>
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Petugas pemerintah dapat memantau semua data laporan, pengajuan surat, 
              dan komunikasi warga melalui satu dashboard yang terintegrasi.
            </p>
          </motion.div>

          {/* Features Grid */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12"
          >
            {[
              { icon: BarChart3, title: "Statistik Real-time", desc: "Pantau data dan tren laporan secara langsung", gradient: "from-blue-500 to-cyan-500" },
              { icon: Users, title: "Manajemen Warga", desc: "Kelola data dan riwayat interaksi warga", gradient: "from-green-500 to-emerald-500" },
              { icon: Shield, title: "Keamanan Data", desc: "Enkripsi end-to-end dan akses terkontrol", gradient: "from-purple-500 to-violet-500" },
              { icon: Zap, title: "Respon Cepat", desc: "Notifikasi dan eskalasi otomatis", gradient: "from-orange-500 to-amber-500" },
            ].map((item, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full hover:shadow-lg transition-all duration-300 border-border/50 hover:border-primary/30">
                  <CardContent className="pt-6 text-center">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center mx-auto mb-4 shadow-lg`}>
                      <item.icon className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="font-semibold mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          {/* Dashboard Preview */}
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <div className="relative w-full max-w-5xl mx-auto">
              {/* Glow effect */}
              <div className="absolute -inset-4 bg-gradient-to-r from-primary/20 via-secondary/20 to-primary/20 rounded-3xl blur-xl opacity-50" />
              
              <div className="relative bg-gradient-to-b from-muted to-background p-2 rounded-2xl">
                <Image
                  src="/dashboard.png"
                  alt="Dashboard Admin Preview"
                  width={1200}
                  height={800}
                  className="rounded-xl shadow-2xl border border-border/50"
                />
              </div>

              {/* Floating Stats Card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 }}
                className="absolute -bottom-4 -right-4 md:bottom-8 md:right-8 bg-card border border-border shadow-xl rounded-2xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="text-xl font-bold">100%</p>
                    <p className="text-xs text-muted-foreground">Laporan Tertangani</p>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Emergency Alert Section */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-destructive/5 via-orange-500/5 to-background relative overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0 opacity-30">
          <motion.div
            className="absolute top-20 left-20 w-20 h-20 bg-destructive/20 rounded-full"
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <motion.div
            className="absolute bottom-20 right-20 w-16 h-16 bg-orange-500/20 rounded-full"
            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.7, 0.5] }}
            transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }}
          />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header - Centered */}
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="inline-flex items-center gap-2 bg-destructive/20 border border-destructive/30 text-destructive px-4 py-1.5 rounded-full mb-4">
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <Siren className="w-4 h-4" />
              </motion.div>
              <span className="font-semibold text-sm">Fitur Darurat</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Notifikasi{" "}
              <span className="text-destructive">Laporan Darurat</span>{" "}
              & Bencana
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Sistem notifikasi prioritas tinggi untuk laporan bencana dan keadaan darurat 
              agar penanganan dapat dilakukan dengan cepat dan tepat.
            </p>
          </motion.div>

          {/* Emergency Features Grid */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid md:grid-cols-3 gap-6 mb-12"
          >
            {[
              { icon: AlertTriangle, title: "Deteksi Otomatis", desc: "AI mendeteksi kata kunci darurat dalam laporan warga secara real-time", gradient: "from-orange-500 to-amber-500" },
              { icon: Siren, title: "Alert Prioritas", desc: "Notifikasi khusus dengan suara dan visual berbeda untuk petugas", gradient: "from-red-500 to-rose-500" },
              { icon: Zap, title: "Eskalasi Cepat", desc: "Laporan darurat langsung diteruskan ke pimpinan dan tim tanggap", gradient: "from-yellow-500 to-orange-500" },
            ].map((item, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full hover:shadow-lg transition-all duration-300 border-destructive/20 hover:border-destructive/40">
                  <CardContent className="pt-6 text-center">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center mx-auto mb-4 shadow-lg`}>
                      <item.icon className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="font-semibold mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          {/* Emergency Alert Preview Card */}
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <div className="relative w-full max-w-2xl mx-auto">
              <motion.div
                className="absolute -inset-4 bg-gradient-to-r from-destructive/20 to-orange-500/20 rounded-3xl blur-xl"
                animate={{ opacity: [0.4, 0.7, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              
              <Card className="relative border-destructive/30 bg-card/95 backdrop-blur-sm overflow-hidden">
                {/* Alert Header */}
                <div className="bg-gradient-to-r from-destructive to-orange-500 px-6 py-4">
                  <div className="flex items-center justify-center gap-3">
                    <motion.div
                      animate={{ rotate: [0, 10, -10, 0] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                    >
                      <Siren className="w-8 h-8 text-white" />
                    </motion.div>
                    <div className="text-center">
                      <p className="text-white font-bold text-lg">LAPORAN DARURAT</p>
                      <p className="text-white/80 text-sm">Prioritas Tinggi • Baru saja</p>
                    </div>
                  </div>
                </div>
                
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5 text-destructive" />
                      </div>
                      <div>
                        <p className="font-semibold">Banjir di RT 03 RW 02</p>
                        <p className="text-sm text-muted-foreground">
                          Ketinggian air sudah mencapai 50cm dan terus naik. 
                          Beberapa rumah warga mulai terendam.
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Jl. Melati No. 15, Kelurahan Sukamaju</span>
                    </div>
                    
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" className="bg-destructive hover:bg-destructive/90 flex-1">
                        <Zap className="w-4 h-4 mr-1" />
                        Tangani Sekarang
                      </Button>
                      <Button size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10">
                        Eskalasi
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Notification badge */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 }}
                className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border shadow-lg rounded-xl px-4 py-2 flex items-center gap-2"
              >
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-medium">Tim Tanggap Aktif</span>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Benefits Section */}
      <section id="manfaat" className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <span className="inline-block text-sm font-semibold text-secondary bg-secondary/10 px-4 py-1.5 rounded-full mb-4">
              Keuntungan
            </span>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Manfaat Utama untuk Warga</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Nikmati kemudahan layanan kelurahan dengan berbagai keuntungan
            </p>
          </motion.div>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {/* Benefit 1: Hemat Waktu */}
            <motion.div variants={fadeInUp}>
              <Card className="h-full hover:shadow-lg transition-shadow duration-300 bg-gradient-to-b from-blue-50 to-white dark:from-blue-950/30 dark:to-card border-blue-100 dark:border-blue-900/30">
                <CardContent className="pt-8 pb-6 text-center">
                  <div className="flex justify-center mb-4">
                    <ClockToCheckAnimation />
                  </div>
                  <h3 className="text-lg font-semibold mb-2 text-blue-700 dark:text-blue-400">Hemat Waktu</h3>
                  <p className="text-muted-foreground text-sm">
                    Proses yang biasanya 2-3 jam, kini hanya 10 menit dari rumah
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            {/* Benefit 2: Transparan */}
            <motion.div variants={fadeInUp}>
              <Card className="h-full hover:shadow-lg transition-shadow duration-300 bg-gradient-to-b from-green-50 to-white dark:from-green-950/30 dark:to-card border-green-100 dark:border-green-900/30">
                <CardContent className="pt-8 pb-6 text-center">
                  <div className="flex justify-center mb-4 h-16 items-center">
                    <StepsLightingAnimation />
                  </div>
                  <h3 className="text-lg font-semibold mb-2 text-green-700 dark:text-green-400">Transparan</h3>
                  <p className="text-muted-foreground text-sm">
                    Pantau status pengajuan secara real-time tanpa perlu menelepon
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            {/* Benefit 3: Mudah Diakses */}
            <motion.div variants={fadeInUp}>
              <Card className="h-full hover:shadow-lg transition-shadow duration-300 bg-gradient-to-b from-purple-50 to-white dark:from-purple-950/30 dark:to-card border-purple-100 dark:border-purple-900/30">
                <CardContent className="pt-8 pb-6 text-center">
                  <div className="flex justify-center mb-4">
                    <PhoneServicesAnimation />
                  </div>
                  <h3 className="text-lg font-semibold mb-2 text-purple-700 dark:text-purple-400">Mudah Diakses</h3>
                  <p className="text-muted-foreground text-sm">
                    Bisa digunakan kapan saja, di mana saja melalui smartphone
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            {/* Benefit 4: Gratis */}
            <motion.div variants={fadeInUp}>
              <Card className="h-full hover:shadow-lg transition-shadow duration-300 bg-gradient-to-b from-rose-50 to-white dark:from-rose-950/30 dark:to-card border-rose-100 dark:border-rose-900/30">
                <CardContent className="pt-8 pb-6 text-center">
                  <div className="flex justify-center mb-4">
                    <motion.div
                      className="relative w-16 h-16 flex items-center justify-center"
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <div className="w-14 h-14 rounded-full bg-rose-500/20 flex items-center justify-center">
                        <Heart className="h-7 w-7 text-rose-500" />
                      </div>
                      {/* Pulse rings */}
                      <motion.div
                        className="absolute inset-0 rounded-full border-2 border-rose-400"
                        animate={{ scale: [1, 1.4], opacity: [0.5, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      />
                      <motion.div
                        className="absolute inset-0 rounded-full border-2 border-rose-400"
                        animate={{ scale: [1, 1.4], opacity: [0.5, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
                      />
                    </motion.div>
                  </div>
                  <h3 className="text-lg font-semibold mb-2 text-rose-700 dark:text-rose-400">Gratis</h3>
                  <p className="text-muted-foreground text-sm">
                    Layanan GovConnect sepenuhnya gratis untuk semua warga
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimoni" className="py-20 md:py-28 bg-gradient-to-b from-muted/50 to-background relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto mb-16"
          >
            <span className="inline-block text-sm font-semibold text-secondary bg-secondary/10 px-4 py-1.5 rounded-full mb-4">
              Testimoni Warga
            </span>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Apa Kata Mereka?</h2>
            <p className="text-muted-foreground text-lg">
              Testimoni dari warga yang sudah menggunakan GovConnect
            </p>
          </motion.div>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="grid md:grid-cols-3 gap-8"
          >
            {[
              {
                name: "Budi Santoso",
                role: "Warga RT 05",
                text: "Dulu ngurus surat pengantar bisa setengah hari. Sekarang dengan GovConnect, saya ajukan dari rumah dan tinggal ambil di kelurahan. Praktis banget!",
                image: "https://randomuser.me/api/portraits/men/32.jpg",
                rating: 5,
              },
              {
                name: "Siti Rahayu",
                role: "Ibu Rumah Tangga",
                text: "Saya lapor jalan rusak depan rumah lewat aplikasi. Dalam 3 hari sudah diperbaiki. Responsnya cepat dan ada notifikasi terus.",
                image: "https://randomuser.me/api/portraits/women/44.jpg",
                rating: 5,
              },
              {
                name: "Ahmad Hidayat",
                role: "Pedagang",
                text: "Sebagai pedagang, waktu sangat berharga. GovConnect membantu saya mengurus izin tanpa harus tutup warung. Terima kasih!",
                image: "https://randomuser.me/api/portraits/men/85.jpg",
                rating: 5,
              },
            ].map((testimonial, index) => (
              <motion.div key={index} variants={fadeInUp}>
                <Card className="h-full hover:shadow-xl transition-all duration-300 border-border/50 group relative overflow-hidden">
                  {/* Quote decoration */}
                  <div className="absolute top-4 right-4 text-6xl text-secondary/10 font-serif leading-none">&ldquo;</div>
                  <CardContent className="pt-8 pb-6 relative">
                    {/* Rating stars */}
                    <div className="flex gap-1 mb-4">
                      {[...Array(testimonial.rating)].map((_, i) => (
                        <svg key={i} className="w-4 h-4 text-yellow-400 fill-current" viewBox="0 0 20 20">
                          <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                        </svg>
                      ))}
                    </div>
                    <p className="text-muted-foreground mb-6 leading-relaxed">&ldquo;{testimonial.text}&rdquo;</p>
                    <div className="flex items-center gap-4 pt-4 border-t border-border/50">
                      <div className="relative w-12 h-12 rounded-full overflow-hidden ring-2 ring-secondary/20 group-hover:ring-secondary/40 transition-all">
                        <Image
                          src={testimonial.image}
                          alt={testimonial.name}
                          fill
                          className="object-cover"
                        />
                      </div>
                      <div>
                        <h4 className="font-semibold">{testimonial.name}</h4>
                        <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={fadeInUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Pertanyaan yang Sering Diajukan</h2>
            <p className="text-muted-foreground text-lg">
              Temukan jawaban untuk pertanyaan umum tentang GovConnect
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-5 gap-12 items-start">
            <motion.div
              variants={slideInLeft}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="lg:col-span-2 flex justify-center items-center"
            >
              <FAQAnimation />
            </motion.div>

            <motion.div
              variants={slideInRight}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="lg:col-span-3"
            >
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger className="text-left">
                    Apakah GovConnect gratis untuk digunakan?
                  </AccordionTrigger>
                  <AccordionContent>
                    Ya, GovConnect sepenuhnya gratis untuk semua warga. Tidak ada biaya pendaftaran maupun biaya penggunaan.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger className="text-left">
                    Bagaimana cara mendaftar di GovConnect?
                  </AccordionTrigger>
                  <AccordionContent>
                    Pendaftaran sangat mudah. Anda hanya perlu menyiapkan NIK dan nomor HP aktif. Proses ini hanya membutuhkan waktu sekitar 2 menit.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger className="text-left">
                    Apakah data saya aman di GovConnect?
                  </AccordionTrigger>
                  <AccordionContent>
                    Keamanan data adalah prioritas kami. Semua informasi dienkripsi dan hanya digunakan untuk keperluan layanan kelurahan.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-4">
                  <AccordionTrigger className="text-left">
                    Berapa lama proses pengajuan surat?
                  </AccordionTrigger>
                  <AccordionContent>
                    Waktu proses bervariasi tergantung jenis surat, namun umumnya 2-3 hari kerja. Anda akan mendapat notifikasi real-time.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gradient-to-b from-muted/30 to-muted/50 border-t border-border/50 pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-12 gap-8 mb-12">
            <div className="md:col-span-5">
              <Link href="/" className="flex items-center gap-2 mb-4">
                <Image
                  src={isDark ? "/logo-dashboard-dark.png" : "/logo-dashboard.png"}
                  alt="GovConnect Logo"
                  width={140}
                  height={140}
                  className="object-contain"
                />
              </Link>
              <p className="text-muted-foreground mb-6 max-w-sm leading-relaxed">
                GovConnect adalah platform digital yang menghubungkan warga
                dengan layanan kelurahan secara cepat, mudah, dan transparan.
              </p>
              <div className="flex gap-3">
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-full bg-green-500/10 hover:bg-green-500/20 flex items-center justify-center text-green-600 transition-colors"
                >
                  <WhatsAppIcon className="h-5 w-5" />
                </a>
                <a
                  href="mailto:info@govconnect.id"
                  className="w-10 h-10 rounded-full bg-secondary/10 hover:bg-secondary/20 flex items-center justify-center text-secondary transition-colors"
                >
                  <Mail className="h-5 w-5" />
                </a>
              </div>
            </div>

            <div className="md:col-span-3">
              <h4 className="font-semibold mb-4 text-foreground">Layanan</h4>
              <ul className="space-y-3 text-muted-foreground">
                <li>
                  <Link href="#" className="hover:text-secondary transition-colors inline-flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary/50" />
                    Lapor Masalah
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-secondary transition-colors inline-flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary/50" />
                    Layanan Surat
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-secondary transition-colors inline-flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary/50" />
                    Informasi
                  </Link>
                </li>
                <li>
                  <Link href="#" className="hover:text-secondary transition-colors inline-flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary/50" />
                    Cek Status
                  </Link>
                </li>
              </ul>
            </div>

            <div className="md:col-span-4">
              <h4 className="font-semibold mb-4 text-foreground">Kontak</h4>
              <ul className="space-y-4 text-muted-foreground">
                <li className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0">
                    <Phone className="h-4 w-4 text-secondary" />
                  </div>
                  <span>+62 896-6817-6764</span>
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0">
                    <Mail className="h-4 w-4 text-secondary" />
                  </div>
                  <span>info@govconnect.id</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4 text-secondary" />
                  </div>
                  <span>Jl. Telekomunikasi, Bandung</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-t border-border/50 pt-8 text-muted-foreground text-sm">
            <p>&copy; {new Date().getFullYear()} GovConnect. All rights reserved.</p>
            <p className="flex items-center gap-1">
              Powered by{" "}
              <a
                href="https://genfity.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-secondary hover:underline font-medium"
              >
                Genfity Digital Solution
              </a>
            </p>
          </div>
        </div>
      </footer>

      {/* Live Chat Widget - Right Side */}
      <LiveChatWidget isDark={isDark} />
    </div>
  );
}
