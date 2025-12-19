"use client";

import Link from "next/link";
import {
    FileText,
    CalendarCheck,
    ArrowRight,
    Shield,
    Clock,
    CheckCircle2,
    Sparkles,
    AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function FormLandingPage() {
    return (
        <div className="space-y-12 py-8">
            {/* Hero Section */}
            <section className="text-center space-y-4">
                <div className="inline-flex items-center gap-1.5 bg-secondary/10 border border-secondary/20 rounded-full px-3 py-1">
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-secondary"></span>
                    </span>
                    <span className="text-xs font-medium text-secondary">Layanan Resmi Pemerintah</span>
                </div>

                <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold leading-tight">
                    Layanan Publik{" "}
                    <span className="bg-gradient-to-r from-secondary to-primary bg-clip-text text-transparent">Online</span>
                </h1>

                <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                    Sampaikan laporan pengaduan atau lakukan reservasi layanan pemerintah dengan mudah dan cepat, tanpa perlu datang ke kantor.
                </p>
            </section>

            {/* Service Cards */}
            <section className="grid md:grid-cols-2 gap-4">
                {/* Laporan Card */}
                <Link href="/form/laporan" className="group">
                    <Card className="h-full border-border/50 hover:border-red-500/30 hover:shadow-lg transition-all duration-300 overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-red-500 to-orange-500" />
                        <CardContent className="p-5 space-y-4">
                            <div className="flex items-start justify-between">
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg">
                                    <AlertTriangle className="w-6 h-6 text-white" />
                                </div>
                                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center group-hover:bg-red-100 dark:group-hover:bg-red-900/30 transition-colors">
                                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-red-600 dark:group-hover:text-red-400 group-hover:translate-x-0.5 transition-all" />
                                </div>
                            </div>

                            <div>
                                <h2 className="text-lg font-bold mb-1">Buat Laporan</h2>
                                <p className="text-xs text-muted-foreground">
                                    Laporkan masalah infrastruktur, fasilitas umum, atau layanan publik. Tim kami akan segera menindaklanjuti.
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                                {['Jalan Rusak', 'Lampu Mati', 'Sampah', 'Drainase'].map((tag) => (
                                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                                        {tag}
                                    </span>
                                ))}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    +3 lainnya
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                </Link>

                {/* Reservasi Card */}
                <Link href="/form/reservasi" className="group">
                    <Card className="h-full border-border/50 hover:border-secondary/30 hover:shadow-lg transition-all duration-300 overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-secondary to-primary" />
                        <CardContent className="p-5 space-y-4">
                            <div className="flex items-start justify-between">
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-secondary to-primary flex items-center justify-center shadow-lg">
                                    <CalendarCheck className="w-6 h-6 text-white" />
                                </div>
                                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center group-hover:bg-secondary/20 transition-colors">
                                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-secondary group-hover:translate-x-0.5 transition-all" />
                                </div>
                            </div>

                            <div>
                                <h2 className="text-lg font-bold mb-1">Reservasi Layanan</h2>
                                <p className="text-xs text-muted-foreground">
                                    Buat janji untuk mengurus surat-surat dan dokumen resmi. Pilih waktu yang sesuai dengan jadwal Anda.
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                                {['Surat Domisili', 'SKTM', 'SKCK', 'KTP'].map((tag) => (
                                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/20 text-secondary">
                                        {tag}
                                    </span>
                                ))}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    +8 lainnya
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                </Link>
            </section>

            {/* Features */}
            <section className="grid grid-cols-3 gap-4">
                {[
                    { icon: Clock, title: "Cepat & Mudah", desc: "Proses hanya beberapa menit", gradient: "from-blue-500 to-cyan-500" },
                    { icon: Shield, title: "Aman & Terpercaya", desc: "Data dijamin kerahasiaannya", gradient: "from-green-500 to-emerald-500" },
                    { icon: CheckCircle2, title: "Dapat Dilacak", desc: "Pantau status pengajuan", gradient: "from-purple-500 to-violet-500" },
                ].map((item, i) => (
                    <div key={i} className="text-center space-y-2">
                        <div className={`w-10 h-10 mx-auto rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center shadow-md`}>
                            <item.icon className="w-5 h-5 text-white" />
                        </div>
                        <h3 className="text-xs font-semibold">{item.title}</h3>
                        <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                    </div>
                ))}
            </section>

            {/* Info Banner */}
            <Card className="border-secondary/30 bg-gradient-to-br from-card to-secondary/5">
                <CardContent className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-secondary/20 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-5 h-5 text-secondary" />
                    </div>
                    <div className="flex-1">
                        <p className="text-xs font-medium">Layanan 24/7</p>
                        <p className="text-[10px] text-muted-foreground">
                            Form online ini tersedia kapan saja. Tidak perlu ke kantor atau menghubungi via WhatsApp.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
