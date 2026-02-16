"use client";

import Link from "next/link";
import {
    FileText,
    ArrowRight,
    Shield,
    Clock,
    CheckCircle2,
    Sparkles,
    MessageCircle,
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
                    <span className="bg-linear-to-r from-secondary to-primary bg-clip-text text-transparent">Online</span>
                </h1>

                <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                    Form publik ini hanya untuk permohonan layanan administrasi. Pengaduan atau keluhan disampaikan melalui WhatsApp/Webchat agar tercatat di Channel Service.
                </p>
            </section>

            {/* Service Cards */}
            <section className="grid md:grid-cols-2 gap-4">
                <Card className="h-full border-border/50 hover:border-secondary/30 hover:shadow-lg transition-all duration-300 overflow-hidden">
                    <div className="h-1 bg-linear-to-r from-secondary to-primary" />
                    <CardContent className="p-5 space-y-4">
                        <div className="flex items-start justify-between">
                            <div className="w-12 h-12 rounded-xl bg-linear-to-br from-secondary to-primary flex items-center justify-center shadow-lg">
                                <FileText className="w-6 h-6 text-white" />
                            </div>
                            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                            </div>
                        </div>

                        <div>
                            <h2 className="text-lg font-bold mb-1">Permohonan Layanan</h2>
                            <p className="text-xs text-muted-foreground">
                                Akses form layanan melalui tautan yang dikirimkan oleh WhatsApp atau Webchat.
                            </p>
                        </div>

                        <div className="rounded-xl bg-secondary/10 border border-secondary/20 p-3 text-[10px] text-muted-foreground">
                            Contoh tautan: tanggapin.ai/form/slug-desa/slug-layanan?user=628xxx
                        </div>
                    </CardContent>
                </Card>

                <Card className="h-full border-border/50 hover:border-red-500/30 hover:shadow-lg transition-all duration-300 overflow-hidden">
                    <div className="h-1 bg-linear-to-r from-red-500 to-orange-500" />
                    <CardContent className="p-5 space-y-4">
                        <div className="flex items-start justify-between">
                            <div className="w-12 h-12 rounded-xl bg-linear-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg">
                                <AlertTriangle className="w-6 h-6 text-white" />
                            </div>
                            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                                <MessageCircle className="w-4 h-4 text-muted-foreground" />
                            </div>
                        </div>

                        <div>
                            <h2 className="text-lg font-bold mb-1">Pengaduan via WhatsApp</h2>
                            <p className="text-xs text-muted-foreground">
                                Laporan pengaduan hanya diproses melalui WhatsApp/Webchat agar histori chat tercatat.
                            </p>
                        </div>

                        <Button asChild className="w-full bg-red-500 hover:bg-red-600 text-xs">
                            <Link href="/">Kembali ke Beranda</Link>
                        </Button>
                    </CardContent>
                </Card>
            </section>

            {/* Features */}
            <section className="grid grid-cols-3 gap-4">
                {[
                    { icon: Clock, title: "Cepat & Mudah", desc: "Proses hanya beberapa menit", gradient: "from-blue-500 to-cyan-500" },
                    { icon: Shield, title: "Aman & Terpercaya", desc: "Data dijamin kerahasiaannya", gradient: "from-green-500 to-emerald-500" },
                    { icon: CheckCircle2, title: "Dapat Dilacak", desc: "Pantau status pengajuan", gradient: "from-purple-500 to-violet-500" },
                ].map((item, i) => (
                    <div key={i} className="text-center space-y-2">
                        <div className={`w-10 h-10 mx-auto rounded-xl bg-linear-to-br ${item.gradient} flex items-center justify-center shadow-md`}>
                            <item.icon className="w-5 h-5 text-white" />
                        </div>
                        <h3 className="text-xs font-semibold">{item.title}</h3>
                        <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                    </div>
                ))}
            </section>

            {/* Info Banner */}
            <Card className="border-secondary/30 bg-linear-to-br from-card to-secondary/5">
                <CardContent className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-secondary/20 flex items-center justify-center shrink-0">
                        <Sparkles className="w-5 h-5 text-secondary" />
                    </div>
                    <div className="flex-1">
                        <p className="text-xs font-medium">Form Layanan 24/7</p>
                        <p className="text-[10px] text-muted-foreground">
                            Tautan form layanan dapat digunakan kapan saja. Pengaduan tetap diproses via WhatsApp/Webchat.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
