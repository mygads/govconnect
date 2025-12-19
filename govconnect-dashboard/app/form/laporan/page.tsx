"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    Send,
    Camera,
    MapPin,
    AlertCircle,
    Loader2,
    CheckCircle2,
    Construction,
    Lightbulb,
    Trash2,
    Droplets,
    TreeDeciduous,
    Wrench,
    MoreHorizontal,
    ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    graphqlFetch,
    CREATE_COMPLAINT,
    CreateComplaintInput,
    CreateComplaintResponse,
} from "@/lib/graphql-client";

// Complaint categories with lucide icons
const COMPLAINT_CATEGORIES = [
    { code: 'jalan_rusak', name: 'Jalan Rusak', description: 'Kerusakan jalan, lubang, retak', icon: Construction, color: 'from-orange-500 to-amber-500' },
    { code: 'lampu_mati', name: 'Lampu Mati', description: 'Penerangan jalan umum mati', icon: Lightbulb, color: 'from-yellow-500 to-orange-500' },
    { code: 'sampah', name: 'Sampah', description: 'Masalah sampah menumpuk', icon: Trash2, color: 'from-green-500 to-emerald-500' },
    { code: 'drainase', name: 'Drainase', description: 'Saluran air tersumbat/rusak', icon: Droplets, color: 'from-blue-500 to-cyan-500' },
    { code: 'pohon_tumbang', name: 'Pohon Tumbang', description: 'Pohon tumbang/berbahaya', icon: TreeDeciduous, color: 'from-green-600 to-teal-500' },
    { code: 'fasilitas_rusak', name: 'Fasilitas Rusak', description: 'Kerusakan fasilitas umum', icon: Wrench, color: 'from-purple-500 to-violet-500' },
    { code: 'lainnya', name: 'Lainnya', description: 'Masalah lain yang tidak tercantum', icon: MoreHorizontal, color: 'from-slate-500 to-slate-600' },
];

export default function LaporanFormPage() {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ complaint_id: string; message: string } | null>(null);

    // Form state
    const [formData, setFormData] = useState<CreateComplaintInput>({
        kategori: "",
        deskripsi: "",
        alamat: "",
        rt_rw: "",
        foto_url: "",
        nama_pelapor: "",
        no_hp: "",
    });
    const [customCategory, setCustomCategory] = useState("");

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            // If category is 'lainnya', append custom category to description
            let finalData = { ...formData };
            if (formData.kategori === 'lainnya' && customCategory) {
                finalData.deskripsi = `[Kategori: ${customCategory}]\n\n${formData.deskripsi}`;
            }

            const data = await graphqlFetch<{ createComplaint: CreateComplaintResponse }>(
                CREATE_COMPLAINT,
                { input: finalData }
            );

            if (data.createComplaint.success) {
                setSuccess({
                    complaint_id: data.createComplaint.complaint_id!,
                    message: data.createComplaint.message!,
                });
            } else {
                setError(data.createComplaint.error || "Gagal membuat laporan");
            }
        } catch (err: any) {
            setError(err.message || "Terjadi kesalahan. Pastikan layanan backend sudah berjalan.");
        } finally {
            setSubmitting(false);
        }
    }

    function updateForm(field: keyof CreateComplaintInput, value: string) {
        setFormData((prev) => ({ ...prev, [field]: value }));
    }

    if (success) {
        return (
            <div className="max-w-lg mx-auto py-8">
                <Card className="border-green-200/50 dark:border-green-800/30 bg-gradient-to-br from-green-50/50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                    <CardContent className="pt-8 pb-6 px-6 text-center space-y-6">
                        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-lg">
                            <CheckCircle2 className="w-8 h-8 text-white" />
                        </div>

                        <div className="space-y-2">
                            <h1 className="text-xl font-bold text-green-700 dark:text-green-400">
                                Laporan Berhasil Dibuat!
                            </h1>
                            <p className="text-sm text-muted-foreground">{success.message}</p>
                        </div>

                        <div className="bg-background/80 rounded-xl p-4 border border-border/50">
                            <p className="text-xs text-muted-foreground mb-1">ID Laporan Anda</p>
                            <p className="text-xl font-mono font-bold text-secondary">
                                {success.complaint_id}
                            </p>
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Simpan ID ini untuk memantau status laporan. Tim kami akan segera menindaklanjuti.
                        </p>

                        <div className="flex gap-3">
                            <Button variant="outline" asChild className="flex-1">
                                <Link href="/form">Kembali</Link>
                            </Button>
                            <Button
                                onClick={() => {
                                    setSuccess(null);
                                    setFormData({
                                        kategori: "",
                                        deskripsi: "",
                                        alamat: "",
                                        rt_rw: "",
                                        foto_url: "",
                                        nama_pelapor: "",
                                        no_hp: "",
                                    });
                                    setCustomCategory("");
                                }}
                                className="flex-1 bg-secondary hover:bg-secondary/90"
                            >
                                Buat Laporan Lagi
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <Link
                    href="/form"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
                >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Kembali
                </Link>

                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-md">
                        <AlertCircle className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold">Buat Laporan</h1>
                        <p className="text-xs text-muted-foreground">Laporkan masalah infrastruktur atau fasilitas umum</p>
                    </div>
                </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Category Selection */}
                <div className="space-y-3">
                    <label className="text-sm font-semibold flex items-center gap-1">
                        Kategori Laporan <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {COMPLAINT_CATEGORIES.map((cat) => {
                            const Icon = cat.icon;
                            const isSelected = formData.kategori === cat.code;
                            return (
                                <button
                                    key={cat.code}
                                    type="button"
                                    onClick={() => updateForm("kategori", cat.code)}
                                    className={`p-3 rounded-xl border-2 text-left transition-all duration-200 ${isSelected
                                            ? "border-secondary bg-secondary/10 shadow-md"
                                            : "border-border/50 hover:border-secondary/50 bg-card"
                                        }`}
                                >
                                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${cat.color} flex items-center justify-center mb-2 shadow-sm`}>
                                        <Icon className="w-4 h-4 text-white" />
                                    </div>
                                    <p className="text-xs font-semibold truncate">{cat.name}</p>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Custom Category Input (shown when 'lainnya' selected) */}
                {formData.kategori === 'lainnya' && (
                    <div className="space-y-2">
                        <label className="text-sm font-semibold">
                            Kategori Lainnya <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={customCategory}
                            onChange={(e) => setCustomCategory(e.target.value)}
                            placeholder="Jelaskan jenis masalah..."
                            required
                            className="w-full px-4 py-2.5 rounded-xl border border-border/50 bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent transition-all"
                        />
                    </div>
                )}

                {/* Description */}
                <div className="space-y-2">
                    <label className="text-sm font-semibold">
                        Deskripsi Masalah <span className="text-red-500">*</span>
                    </label>
                    <textarea
                        value={formData.deskripsi}
                        onChange={(e) => updateForm("deskripsi", e.target.value)}
                        placeholder="Jelaskan masalah yang Anda temukan dengan detail..."
                        rows={4}
                        required
                        className="w-full px-4 py-3 rounded-xl border border-border/50 bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent transition-all resize-none"
                    />
                </div>

                {/* Location */}
                <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5" />
                            Alamat Lokasi
                        </label>
                        <input
                            type="text"
                            value={formData.alamat || ""}
                            onChange={(e) => updateForm("alamat", e.target.value)}
                            placeholder="Jl. Contoh No. 123..."
                            className="w-full px-4 py-2.5 rounded-xl border border-border/50 bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent transition-all"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-semibold">RT/RW</label>
                        <input
                            type="text"
                            value={formData.rt_rw || ""}
                            onChange={(e) => updateForm("rt_rw", e.target.value)}
                            placeholder="001/002"
                            className="w-full px-4 py-2.5 rounded-xl border border-border/50 bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent transition-all"
                        />
                    </div>
                </div>

                {/* Photo URL */}
                <div className="space-y-2">
                    <label className="text-sm font-semibold flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5" />
                        URL Foto (opsional)
                    </label>
                    <input
                        type="url"
                        value={formData.foto_url || ""}
                        onChange={(e) => updateForm("foto_url", e.target.value)}
                        placeholder="https://example.com/foto.jpg"
                        className="w-full px-4 py-2.5 rounded-xl border border-border/50 bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent transition-all"
                    />
                    <p className="text-[10px] text-muted-foreground">
                        Upload foto ke layanan seperti Imgur atau Google Drive, lalu paste link-nya di sini
                    </p>
                </div>

                {/* Reporter Info */}
                <Card className="border-border/50">
                    <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm font-semibold">Data Pelapor</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-4">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">
                                    Nama Lengkap <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.nama_pelapor}
                                    onChange={(e) => updateForm("nama_pelapor", e.target.value)}
                                    placeholder="Nama sesuai KTP"
                                    required
                                    className="w-full px-4 py-2.5 rounded-xl border border-border/50 bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent transition-all"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">
                                    No. HP <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="tel"
                                    value={formData.no_hp}
                                    onChange={(e) => updateForm("no_hp", e.target.value)}
                                    placeholder="08123456789"
                                    required
                                    className="w-full px-4 py-2.5 rounded-xl border border-border/50 bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent transition-all"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Error */}
                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30">
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
                    </div>
                )}

                {/* Submit */}
                <Button
                    type="submit"
                    disabled={submitting || !formData.kategori || !formData.deskripsi || !formData.nama_pelapor || !formData.no_hp || (formData.kategori === 'lainnya' && !customCategory)}
                    className="w-full h-11 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white shadow-lg"
                >
                    {submitting ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Mengirim...
                        </>
                    ) : (
                        <>
                            <Send className="w-4 h-4 mr-2" />
                            Kirim Laporan
                        </>
                    )}
                </Button>
            </form>
        </div>
    );
}
