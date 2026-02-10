"use client";

import { useEffect, useMemo, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft,
    Send,
    Loader2,
    AlertCircle,
    CheckCircle2,
    FileText,
    MapPin,
    Phone,
    User,
    CreditCard,
    Info,
    MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ServiceRequirement {
    id: string;
    label: string;
    field_type: "file" | "text" | "textarea" | "select" | "radio" | "date" | "number";
    is_required: boolean;
    options_json?: any;
    help_text?: string | null;
}

interface ServiceItem {
    id: string;
    name: string;
    description: string;
    slug: string;
    mode: string;
    requirements: ServiceRequirement[];
    category?: { name: string } | null;
}

interface PageProps {
    params: Promise<{ villageSlug: string; serviceSlug: string }>;
}

interface ServiceResponse {
    data: ServiceItem;
    village: {
        id: string;
        name: string;
        slug: string;
        wa_number?: string | null;
    };
}

export default function ServiceRequestFormPage({ params }: PageProps) {
    const { villageSlug, serviceSlug } = use(params);
    const searchParams = useSearchParams();

    const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
    const ALLOWED_FILE_TYPES = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    const ACCEPT_FILE_TYPES = ".pdf,.jpg,.jpeg,.png,.doc,.docx";

    const [service, setService] = useState<ServiceItem | null>(null);
    const [villageName, setVillageName] = useState<string>("");
    const [villageWaNumber, setVillageWaNumber] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ request_number: string } | null>(null);

    const [citizenData, setCitizenData] = useState({
        nama_lengkap: "",
        nik: "",
        alamat: "",
        wa_user_id: "",
    });

    const [requirementsData, setRequirementsData] = useState<Record<string, string>>({});
    const [fileUploading, setFileUploading] = useState<Record<string, boolean>>({});
    const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

    function normalizeTo628(input: string): string {
        const digits = (input || "").replace(/\D/g, "");
        if (!digits) return "";
        if (digits.startsWith("0")) return `62${digits.slice(1)}`;
        if (digits.startsWith("62")) return digits;
        if (digits.startsWith("8")) return `62${digits}`;
        return digits;
    }

    const waUserPrefill = useMemo(() => {
        // Support both ?wa= (from WhatsApp) and ?user= (legacy) for WA number prefill
        const waUserRaw = searchParams.get("wa") || searchParams.get("user") || "";
        return normalizeTo628(waUserRaw);
    }, [searchParams]);

    // Get session ID for webchat channel tracking
    const sessionId = useMemo(() => {
        return searchParams.get("session") || "";
    }, [searchParams]);

    const isWaPrefilled = !!waUserPrefill;
    const isWebchatSession = !!sessionId;

    useEffect(() => {
        if (waUserPrefill) {
            setCitizenData((prev) => ({
                ...prev,
                wa_user_id: waUserPrefill,
            }));
        }
    }, [waUserPrefill]);

    useEffect(() => {
        const loadService = async () => {
            try {
                const response = await fetch(`/api/public/services/by-slug?village_slug=${villageSlug}&service_slug=${serviceSlug}`);
                const result: ServiceResponse = await response.json();
                if (!response.ok) {
                    throw new Error((result as any)?.error || "Gagal memuat layanan");
                }
                setService(result.data);
                setVillageName(result.village?.name || "");
                setVillageWaNumber(result.village?.wa_number ? normalizeTo628(result.village.wa_number) : null);
            } catch (err: any) {
                setError(err.message || "Gagal memuat layanan");
            } finally {
                setLoading(false);
            }
        };

        loadService();
    }, [villageSlug, serviceSlug]);

    const normalizedRequirements = useMemo(() => {
        if (!service?.requirements) return [] as ServiceRequirement[];
        return service.requirements;
    }, [service]);

    function updateCitizenField(field: keyof typeof citizenData, value: string) {
        setCitizenData((prev) => ({ ...prev, [field]: value }));
    }

    function updateRequirementField(reqId: string, value: string) {
        setRequirementsData((prev) => ({ ...prev, [reqId]: value }));
    }

    function updateFileUploading(reqId: string, value: boolean) {
        setFileUploading((prev) => ({ ...prev, [reqId]: value }));
    }

    function updateFileError(reqId: string, value: string) {
        setFileErrors((prev) => ({ ...prev, [reqId]: value }));
    }

    function normalizeOptions(options: any): string[] {
        if (!options) return [];
        if (Array.isArray(options)) return options.map(String);
        if (typeof options === "string") {
            try {
                const parsed = JSON.parse(options);
                if (Array.isArray(parsed)) return parsed.map(String);
            } catch {
                return options.split(",").map((item) => item.trim()).filter(Boolean);
            }
        }
        if (typeof options === "object") {
            return Object.values(options).map((value) => String(value));
        }
        return [];
    }

    function isValidWaNumber(value: string) {
        return /^628\d{8,12}$/.test(value);
    }

    function isFormComplete() {
        if (!service) return false;
        if (service.mode === "offline") return false;
        if (!citizenData.nama_lengkap || !citizenData.nik || !citizenData.alamat || !citizenData.wa_user_id) return false;
        if (!isValidWaNumber(citizenData.wa_user_id)) return false;
        if (citizenData.nik.length !== 16) return false;

        if (Object.values(fileUploading).some(Boolean)) return false;
        if (Object.values(fileErrors).some((value) => value)) return false;

        for (const req of normalizedRequirements) {
            if (req.is_required && !requirementsData[req.id]) return false;
        }

        return true;
    }

    async function handleFileChange(reqId: string, file: File | null) {
        if (!file) {
            updateRequirementField(reqId, "");
            updateFileError(reqId, "");
            return;
        }

        if (!ALLOWED_FILE_TYPES.includes(file.type)) {
            updateRequirementField(reqId, "");
            updateFileError(reqId, "Tipe file tidak didukung. Gunakan PDF/JPG/PNG/DOC/DOCX.");
            return;
        }

        if (file.size > MAX_UPLOAD_SIZE) {
            updateRequirementField(reqId, "");
            updateFileError(reqId, "Ukuran file maksimal 5MB.");
            return;
        }

        updateFileError(reqId, "");
        updateFileUploading(reqId, true);

        try {
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch("/api/public/uploads", {
                method: "POST",
                body: formData,
            });

            // Handle non-JSON responses gracefully
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                const text = await response.text();
                console.error("Upload returned non-JSON:", text.substring(0, 200));
                throw new Error("Gagal mengunggah file. Server tidak merespons dengan benar.");
            }

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result?.error || "Gagal mengunggah file");
            }

            updateRequirementField(reqId, result?.data?.url || "");
        } catch (err: any) {
            updateRequirementField(reqId, "");
            const errorMessage = err.message?.includes("JSON")
                ? "Gagal mengunggah file. Silakan coba lagi."
                : (err.message || "Gagal mengunggah file");
            updateFileError(reqId, errorMessage);
        } finally {
            updateFileUploading(reqId, false);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (!service) return;
        if (!isFormComplete()) {
            setError("Mohon lengkapi semua data wajib terlebih dahulu.");
            return;
        }

        if (Object.values(fileUploading).some(Boolean)) {
            setError("Mohon tunggu hingga semua file selesai diunggah.");
            return;
        }

        if (Object.values(fileErrors).some((value) => value)) {
            setError("Periksa kembali file yang diunggah.");
            return;
        }

        setSubmitting(true);

        try {
            // Normalize wa_user_id to 62 format (in case user typed 08xxx)
            const normalizedWa = normalizeTo628(citizenData.wa_user_id);
            
            // Derive no_hp from wa_user_id (628xxx -> 08xxx)
            const derivedNoHp = normalizedWa.startsWith("628")
                ? `0${normalizedWa.slice(2)}`
                : normalizedWa;
            
            // Determine channel based on how user accessed the form
            const channel = sessionId ? "WEBCHAT" : "WHATSAPP";
            
            const response = await fetch("/api/public/service-requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    service_id: service.id,
                    wa_user_id: normalizedWa,
                    channel,
                    channel_identifier: sessionId || undefined, // For webchat tracking
                    citizen_data: {
                        nama_lengkap: citizenData.nama_lengkap,
                        nik: citizenData.nik,
                        alamat: citizenData.alamat,
                        no_hp: derivedNoHp,
                    },
                    requirement_data: requirementsData,
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result?.error || "Gagal mengirim permohonan layanan");
            }

            setSuccess({ request_number: result?.data?.request_number || "" });
        } catch (err: any) {
            setError(err.message || "Terjadi kesalahan saat mengirim permohonan");
        } finally {
            setSubmitting(false);
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-secondary" />
                <p className="text-xs text-muted-foreground">Memuat layanan...</p>
            </div>
        );
    }

    if (error && !service) {
        return (
            <div className="max-w-md mx-auto py-12">
                <Card className="border-red-200/50 dark:border-red-800/30">
                    <CardContent className="p-5">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                            <div>
                                <p className="font-semibold text-sm">Layanan Tidak Ditemukan</p>
                                <p className="text-xs text-muted-foreground mt-1">{error}</p>
                                <Button variant="outline" size="sm" asChild className="mt-3 text-xs">
                                    <Link href="/form">Kembali ke Panduan</Link>
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (success) {
        const botNumber = villageWaNumber ? normalizeTo628(villageWaNumber) : "";
        const canChatBot = !!success.request_number && /^62\d{8,15}$/.test(botNumber);
        const waMessage = success.request_number ? `Cek status ${success.request_number}` : "";
        const waLink = canChatBot
            ? `https://wa.me/${botNumber}?text=${encodeURIComponent(waMessage)}`
            : "";

        return (
            <div className="max-w-lg mx-auto py-8">
                <Card className="border-green-200/50 dark:border-green-800/30 bg-linear-to-br from-green-50/50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                    <CardContent className="pt-8 pb-6 px-6 text-center space-y-6">
                        <div className="w-16 h-16 mx-auto rounded-2xl bg-linear-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-lg">
                            <CheckCircle2 className="w-8 h-8 text-white" />
                        </div>

                        <div className="space-y-2">
                            <h1 className="text-xl font-bold text-green-700 dark:text-green-400">
                                Permohonan Berhasil Dikirim!
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Kami akan memproses permohonan layanan Anda. Simpan nomor layanan berikut untuk cek status.
                            </p>
                        </div>

                        <div className="bg-background/80 rounded-xl p-4 border border-border/50">
                            <p className="text-xs text-muted-foreground mb-1">Nomor Layanan</p>
                            <p className="text-xl font-mono font-bold text-secondary">
                                {success.request_number || "-"}
                            </p>
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Status dapat dicek melalui WhatsApp dengan menyebutkan nomor layanan di atas.
                        </p>

                        {canChatBot ? (
                            <Button asChild className="w-full bg-secondary hover:bg-secondary/90">
                                <a href={waLink} target="_blank" rel="noreferrer">
                                    <MessageCircle className="w-4 h-4 mr-2" />
                                    Cek Status via WhatsApp
                                </a>
                            </Button>
                        ) : (
                            <div className="text-[10px] text-muted-foreground border border-border/50 rounded-xl p-3 bg-background/70">
                                Nomor WhatsApp bot desa belum tersedia. Silakan chat bot desa dan kirim pesan: <b>{waMessage}</b>
                            </div>
                        )}

                        <div className="flex gap-3">
                            <Button variant="outline" asChild className="flex-1">
                                <Link href="/form">Kembali</Link>
                            </Button>
                            <Button asChild className="flex-1 bg-secondary hover:bg-secondary/90">
                                <Link href="/">Ke Beranda</Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!service) {
        return null;
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div>
                <Link
                    href="/form"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
                >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Kembali
                </Link>

                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-linear-to-br from-secondary to-primary flex items-center justify-center shadow-md">
                        <FileText className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold">{service.name}</h1>
                        <p className="text-xs text-muted-foreground mt-1">{service.description}</p>
                        {villageName && (
                            <p className="text-[10px] text-muted-foreground mt-1">{villageName}</p>
                        )}
                    </div>
                </div>
            </div>

            <Card className="border-border/50">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Info className="w-4 h-4 text-secondary" />
                        Informasi Layanan
                    </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-1">
                    <p>Mode layanan: {service.mode === "online" ? "Online" : service.mode === "offline" ? "Offline" : "Online & Offline"}</p>
                    <p>Kategori: {service.category?.name || "Layanan Administrasi"}</p>
                </CardContent>
            </Card>

            <form onSubmit={handleSubmit} className="space-y-6">
                <Card className="border-border/50">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold">Data Pemohon</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold flex items-center gap-1">
                                    <User className="w-3.5 h-3.5" /> Nama Lengkap <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={citizenData.nama_lengkap}
                                    onChange={(e) => updateCitizenField("nama_lengkap", e.target.value)}
                                    placeholder="Nama sesuai KTP"
                                    className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold flex items-center gap-1">
                                    <CreditCard className="w-3.5 h-3.5" /> NIK <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={citizenData.nik}
                                    onChange={(e) => updateCitizenField("nik", e.target.value.replace(/\D/g, ""))}
                                    placeholder="16 digit"
                                    maxLength={16}
                                    className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold flex items-center gap-1">
                                    <MapPin className="w-3.5 h-3.5" /> Alamat <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={citizenData.alamat}
                                    onChange={(e) => updateCitizenField("alamat", e.target.value)}
                                    placeholder="Alamat lengkap"
                                    className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold flex items-center gap-1">
                                    <Phone className="w-3.5 h-3.5" /> Nomor WhatsApp <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={citizenData.wa_user_id}
                                    readOnly={isWaPrefilled}
                                    onChange={(e) => {
                                        if (isWaPrefilled) return;
                                        updateCitizenField("wa_user_id", e.target.value.replace(/\s+/g, ""));
                                    }}
                                    onBlur={(e) => {
                                        if (isWaPrefilled) return;
                                        // Auto-convert 08xx to 628xx when user leaves the field
                                        const normalized = normalizeTo628(e.target.value);
                                        if (normalized && normalized !== citizenData.wa_user_id) {
                                            updateCitizenField("wa_user_id", normalized);
                                        }
                                    }}
                                    placeholder="628xxxxxxxxxx"
                                    className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                    required
                                />
                                {isWaPrefilled ? (
                                    <p className="text-[10px] text-muted-foreground">Nomor WhatsApp terisi otomatis dari tautan WhatsApp dan tidak bisa diubah.</p>
                                ) : (
                                    <p className="text-[10px] text-muted-foreground">Format: 628xxxxxxxxxx (tanpa tanda + atau spasi)</p>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {normalizedRequirements.length > 0 && (
                    <Card className="border-border/50">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold">Persyaratan</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {normalizedRequirements.map((req) => {
                                const options = normalizeOptions(req.options_json);
                                const value = requirementsData[req.id] || "";
                                const labelText = `${req.label}${req.is_required ? " *" : ""}`;

                                return (
                                    <div key={req.id} className="space-y-2">
                                        <label className="text-xs font-semibold">
                                            {labelText}
                                        </label>

                                        {req.field_type === "textarea" && (
                                            <textarea
                                                value={value}
                                                onChange={(e) => updateRequirementField(req.id, e.target.value)}
                                                rows={3}
                                                placeholder={req.help_text || "Isi sesuai kebutuhan"}
                                                className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                            />
                                        )}

                                        {req.field_type === "select" && (
                                            <select
                                                value={value}
                                                onChange={(e) => updateRequirementField(req.id, e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                            >
                                                <option value="">Pilih opsi</option>
                                                {options.map((opt) => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                ))}
                                            </select>
                                        )}

                                        {req.field_type === "radio" && (
                                            <div className="flex flex-wrap gap-2">
                                                {options.map((opt) => (
                                                    <label key={opt} className="flex items-center gap-1 text-xs">
                                                        <input
                                                            type="radio"
                                                            name={req.id}
                                                            value={opt}
                                                            checked={value === opt}
                                                            onChange={(e) => updateRequirementField(req.id, e.target.value)}
                                                        />
                                                        {opt}
                                                    </label>
                                                ))}
                                            </div>
                                        )}

                                        {req.field_type === "date" && (
                                            <input
                                                type="date"
                                                value={value}
                                                onChange={(e) => updateRequirementField(req.id, e.target.value)}
                                                className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                            />
                                        )}

                                        {req.field_type === "number" && (
                                            <input
                                                type="number"
                                                value={value}
                                                onChange={(e) => updateRequirementField(req.id, e.target.value)}
                                                placeholder={req.help_text || "Masukkan angka"}
                                                className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                            />
                                        )}

                                        {req.field_type === "file" && (
                                            <div className="space-y-2">
                                                <input
                                                    type="file"
                                                    accept={ACCEPT_FILE_TYPES}
                                                    onChange={(e) => handleFileChange(req.id, e.target.files?.[0] || null)}
                                                    className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                                />
                                                {fileUploading[req.id] && (
                                                    <p className="text-[10px] text-muted-foreground">Mengunggah file...</p>
                                                )}
                                                {requirementsData[req.id] && !fileUploading[req.id] && (
                                                    <p className="text-[10px] text-emerald-600">
                                                        File terunggah. <a href={requirementsData[req.id]} target="_blank" rel="noreferrer" className="underline">Lihat file</a>
                                                    </p>
                                                )}
                                                {fileErrors[req.id] && (
                                                    <p className="text-[10px] text-red-600">{fileErrors[req.id]}</p>
                                                )}
                                                <p className="text-[10px] text-muted-foreground">Tipe file: PDF/JPG/PNG/DOC/DOCX, maks 5MB.</p>
                                            </div>
                                        )}

                                        {(req.field_type === "text" || !req.field_type) && (
                                            <input
                                                type="text"
                                                value={value}
                                                onChange={(e) => updateRequirementField(req.id, e.target.value)}
                                                placeholder={req.help_text || "Isi sesuai kebutuhan"}
                                                className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                                            />
                                        )}

                                        {req.help_text && (
                                            <p className="text-[10px] text-muted-foreground">{req.help_text}</p>
                                        )}
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                )}

                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30">
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
                    </div>
                )}

                {service?.mode === "offline" && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                        <Info className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                            Layanan ini <b>offline</b>. Permohonan tidak bisa dikirim online. Silakan datang ke kantor kelurahan.
                        </p>
                    </div>
                )}

                <Button
                    type="submit"
                    disabled={submitting || !isFormComplete()}
                    className="w-full h-11 bg-linear-to-r from-secondary to-primary hover:from-secondary/90 hover:to-primary/90 text-white shadow-lg"
                >
                    {submitting ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Mengirim...
                        </>
                    ) : (
                        <>
                            <Send className="w-4 h-4 mr-2" />
                            Kirim Permohonan
                        </>
                    )}
                </Button>
            </form>

            <Card className="border-secondary/30 bg-secondary/5">
                <CardContent className="p-4 text-[10px] text-muted-foreground space-y-1">
                    <p className="font-semibold text-xs text-foreground">Catatan</p>
                    <p>Dokumen asli wajib dibawa ke kantor kelurahan. Dokumen tidak bisa dikirim via chat.</p>
                    <p>Pastikan nomor WhatsApp aktif untuk menerima update status.</p>
                </CardContent>
            </Card>
        </div>
    );
}
