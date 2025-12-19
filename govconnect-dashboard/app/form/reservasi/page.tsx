"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    ArrowRight,
    ArrowLeft,
    Clock,
    Users,
    FileText,
    Loader2,
    AlertCircle,
    Sparkles,
    ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    graphqlFetch,
    GET_SERVICES,
    Service,
} from "@/lib/graphql-client";

const CATEGORY_COLORS: Record<string, { gradient: string; bg: string; text: string }> = {
    administrasi: {
        gradient: "from-blue-500 to-cyan-500",
        bg: "bg-blue-100 dark:bg-blue-900/30",
        text: "text-blue-700 dark:text-blue-300",
    },
    perizinan: {
        gradient: "from-purple-500 to-violet-500",
        bg: "bg-purple-100 dark:bg-purple-900/30",
        text: "text-purple-700 dark:text-purple-300",
    },
    kependudukan: {
        gradient: "from-green-500 to-emerald-500",
        bg: "bg-green-100 dark:bg-green-900/30",
        text: "text-green-700 dark:text-green-300",
    },
    sosial: {
        gradient: "from-orange-500 to-amber-500",
        bg: "bg-orange-100 dark:bg-orange-900/30",
        text: "text-orange-700 dark:text-orange-300",
    },
};

const CATEGORY_NAMES: Record<string, string> = {
    administrasi: "Administrasi",
    perizinan: "Perizinan",
    kependudukan: "Kependudukan",
    sosial: "Sosial",
};

export default function ReservasiPage() {
    const [services, setServices] = useState<Service[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeCategory, setActiveCategory] = useState<string | null>(null);

    useEffect(() => {
        loadServices();
    }, []);

    async function loadServices() {
        try {
            const data = await graphqlFetch<{ services: Service[] }>(GET_SERVICES);
            setServices(data.services.filter(s => s.is_active && s.is_online_available));
        } catch (err: any) {
            setError(err.message || "Gagal memuat layanan. Pastikan layanan backend sudah berjalan.");
        } finally {
            setLoading(false);
        }
    }

    // Group services by category
    const servicesByCategory = services.reduce((acc, service) => {
        if (!acc[service.category]) {
            acc[service.category] = [];
        }
        acc[service.category].push(service);
        return acc;
    }, {} as Record<string, Service[]>);

    const categories = Object.keys(servicesByCategory);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-secondary" />
                <p className="text-xs text-muted-foreground">Memuat layanan...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="max-w-md mx-auto py-12">
                <Card className="border-red-200/50 dark:border-red-800/30 bg-gradient-to-br from-red-50/50 to-orange-50/50 dark:from-red-950/20 dark:to-orange-950/20">
                    <CardContent className="p-5">
                        <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0">
                                <AlertCircle className="w-5 h-5 text-red-500" />
                            </div>
                            <div>
                                <p className="font-semibold text-sm text-red-700 dark:text-red-400">Gagal Memuat Layanan</p>
                                <p className="text-xs text-muted-foreground mt-1">{error}</p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => { setError(null); setLoading(true); loadServices(); }}
                                    className="mt-3 text-xs"
                                >
                                    Coba Lagi
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-8 py-4">
            {/* Header */}
            <div>
                <Link
                    href="/form"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
                >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Kembali
                </Link>

                <h1 className="text-xl font-bold">Reservasi Layanan</h1>
                <p className="text-xs text-muted-foreground mt-1">
                    Pilih layanan yang Anda butuhkan untuk membuat janji kunjungan
                </p>
            </div>

            {/* Category Tabs */}
            <div className="flex flex-wrap gap-1.5">
                <button
                    onClick={() => setActiveCategory(null)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${activeCategory === null
                            ? "bg-secondary text-white"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                >
                    Semua
                </button>
                {categories.map((cat) => {
                    const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.administrasi;
                    return (
                        <button
                            key={cat}
                            onClick={() => setActiveCategory(cat)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${activeCategory === cat
                                    ? `${colors.bg} ${colors.text}`
                                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                                }`}
                        >
                            {CATEGORY_NAMES[cat] || cat}
                        </button>
                    );
                })}
            </div>

            {/* Services Grid */}
            <div className="space-y-6">
                {categories
                    .filter((cat) => activeCategory === null || cat === activeCategory)
                    .map((category) => (
                        <div key={category} className="space-y-3">
                            {/* Category Header */}
                            {activeCategory === null && (
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full bg-gradient-to-br ${CATEGORY_COLORS[category]?.gradient || "from-slate-400 to-slate-500"}`} />
                                    <h2 className="text-sm font-semibold">{CATEGORY_NAMES[category] || category}</h2>
                                    <span className="text-[10px] text-muted-foreground">({servicesByCategory[category].length})</span>
                                </div>
                            )}

                            {/* Services */}
                            <div className="grid sm:grid-cols-2 gap-3">
                                {servicesByCategory[category].map((service) => {
                                    const colors = CATEGORY_COLORS[service.category] || CATEGORY_COLORS.administrasi;
                                    return (
                                        <Link
                                            key={service.code}
                                            href={`/form/reservasi/${service.code}`}
                                            className="group"
                                        >
                                            <Card className="h-full border-border/50 hover:border-secondary/30 hover:shadow-md transition-all duration-200">
                                                <CardContent className="p-4">
                                                    <div className="flex items-start gap-3">
                                                        <div className="flex-1 space-y-2">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
                                                                    {service.code}
                                                                </span>
                                                            </div>

                                                            <h3 className="text-sm font-semibold group-hover:text-secondary transition-colors">
                                                                {service.name}
                                                            </h3>

                                                            <p className="text-[10px] text-muted-foreground line-clamp-2">
                                                                {service.description}
                                                            </p>

                                                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                                                <span className="flex items-center gap-1">
                                                                    <Clock className="w-3 h-3" />
                                                                    {service.estimated_duration} menit
                                                                </span>
                                                                <span className="flex items-center gap-1">
                                                                    <Users className="w-3 h-3" />
                                                                    {service.daily_quota}/hari
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center group-hover:bg-secondary/20 transition-colors flex-shrink-0">
                                                            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-secondary transition-colors" />
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
            </div>

            {/* Empty State */}
            {services.length === 0 && !error && (
                <div className="text-center py-12">
                    <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-3">
                        <FileText className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Tidak ada layanan yang tersedia saat ini
                    </p>
                </div>
            )}
        </div>
    );
}
