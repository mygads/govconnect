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
    CalendarDays,
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

interface CitizenFieldDefinition {
    key: string;
    label: string;
    field_type: "text" | "textarea" | "select" | "radio" | "date" | "number";
    is_required: boolean;
    help_text?: string | null;
    options?: string[];
    validation?: "nik" | "wa_phone" | null;
}

interface SubmissionSchema {
    submissionPolicy: {
        mode: string;
        allowsPublicSubmission: boolean;
    };
    citizenFields: CitizenFieldDefinition[];
    requirementFields: Array<{
        key: string;
        label: string;
        field_type: ServiceRequirement["field_type"];
        is_required: boolean;
        help_text?: string | null;
        options?: string[];
    }>;
}

interface UploadedRequirementFile {
    url: string;
    internal_url?: string | null;
    file_name?: string | null;
    mime_type?: string | null;
    size?: number | null;
    storage_key?: string | null;
}

type RequirementValue = string | UploadedRequirementFile;

interface ServiceItem {
    id: string;
    name: string;
    description: string;
    slug: string;
    mode: string;
    estimated_cost?: string | null;
    estimated_processing_time?: string | null;
    village_id: string;
    requirements: ServiceRequirement[];
    category?: { name: string } | null;
    submission_schema?: SubmissionSchema;
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

const citizenFieldIcons: Record<string, typeof User> = {
    nama_lengkap: User,
    nik: CreditCard,
    alamat: MapPin,
    no_hp: Phone,
    wa_user_id: Phone,
    tempat_lahir: MapPin,
    tanggal_lahir: CalendarDays,
};

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

function normalizeTo628(input: string): string {
    const digits = (input || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("0")) return `62${digits.slice(1)}`;
    if (digits.startsWith("62")) return digits;
    if (digits.startsWith("8")) return `62${digits}`;
    return digits;
}

function isValidWaNumber(value: string) {
    const digits = value.replace(/\D/g, "");
    return /^(08\d{8,12}|628\d{8,12})$/.test(digits);
}

function formatServiceModeLabel(mode?: string | null) {
    switch ((mode || "").trim().toLowerCase()) {
        case "online":
            return "Online";
        case "offline":
            return "Offline";
        case "both":
            return "Online & Offline";
        default:
            return "Belum diatur";
    }
}

function getPhoneFieldKey(fields: CitizenFieldDefinition[]): string | null {
    const phoneField = fields.find((field) => field.validation === "wa_phone" || field.key === "no_hp" || field.key === "wa_user_id");
    return phoneField?.key || null;
}

function buildCitizenState(
    fields: CitizenFieldDefinition[],
    existing: Record<string, string>,
    phonePrefill = "",
): Record<string, string> {
    const phoneFieldKey = getPhoneFieldKey(fields);
    const next: Record<string, string> = {};

    for (const field of fields) {
        if (field.key === phoneFieldKey && phonePrefill) {
            next[field.key] = existing[field.key] || phonePrefill;
            continue;
        }
        next[field.key] = existing[field.key] || "";
    }

    return next;
}

function validateCitizenField(field: CitizenFieldDefinition, value: string): boolean {
    if (!value.trim()) return !field.is_required;
    if (field.validation === "nik") return /^\d{16}$/.test(value.trim());
    if (field.validation === "wa_phone") return isValidWaNumber(value.trim());
    if (field.field_type === "number") return !Number.isNaN(Number(value));
    if (field.field_type === "date") return !Number.isNaN(Date.parse(value));
    if ((field.field_type === "select" || field.field_type === "radio") && field.options?.length) {
        return field.options.includes(value);
    }
    return true;
}

function isUploadedRequirementFile(value: unknown): value is UploadedRequirementFile {
    return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as UploadedRequirementFile).url === "string";
}

function getRequirementFile(value: unknown): UploadedRequirementFile | null {
    if (typeof value === "string") {
        const url = value.trim();
        return url ? { url } : null;
    }
    if (!isUploadedRequirementFile(value)) return null;
    const url = value.url.trim();
    if (!url) return null;
    return {
        url,
        internal_url: typeof value.internal_url === "string" ? value.internal_url : null,
        file_name: typeof value.file_name === "string" ? value.file_name : null,
        mime_type: typeof value.mime_type === "string" ? value.mime_type : null,
        size: typeof value.size === "number" ? value.size : null,
        storage_key: typeof value.storage_key === "string" ? value.storage_key : null,
    };
}

function hasRequirementValue(value: RequirementValue | undefined): boolean {
    if (typeof value === "string") return !!value.trim();
    return !!getRequirementFile(value);
}

function getRequirementInputValue(value: RequirementValue | undefined): string {
    return typeof value === "string" ? value : "";
}

function getStatusChannelLabel(isWebchatSession: boolean): string {
    return isWebchatSession ? "melalui percakapan ini" : "melalui WhatsApp ini";
}

export default function ServiceRequestFormPage({ params }: PageProps) {
    const { villageSlug, serviceSlug } = use(params);
    const searchParams = useSearchParams();

    const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
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
    const [idempotencyKey] = useState(() => globalThis.crypto?.randomUUID?.() || `service-request-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const [citizenData, setCitizenData] = useState<Record<string, string>>({});
    const [requirementsData, setRequirementsData] = useState<Record<string, RequirementValue>>({});
    const [fileUploading, setFileUploading] = useState<Record<string, boolean>>({});
    const [fileErrors, setFileErrors] = useState<Record<string, string>>({});

    const waUserPrefill = useMemo(() => {
        const waUserRaw = searchParams.get("wa") || searchParams.get("user") || "";
        return normalizeTo628(waUserRaw);
    }, [searchParams]);

    const sessionId = useMemo(() => searchParams.get("session") || "", [searchParams]);
    const isWebchatSession = !!sessionId;

    const submissionSchema = service?.submission_schema;
    const citizenFields = submissionSchema?.citizenFields || [];
    const requirementFields = service?.requirements || [];
    const phoneFieldKey = useMemo(() => getPhoneFieldKey(citizenFields), [citizenFields]);
    const isWaPrefilled = !!waUserPrefill && !!phoneFieldKey;

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

    useEffect(() => {
        if (!citizenFields.length) return;
        setCitizenData((prev) => buildCitizenState(citizenFields, prev, waUserPrefill));
    }, [citizenFields, waUserPrefill]);

    function updateCitizenField(field: string, value: string) {
        setCitizenData((prev) => ({ ...prev, [field]: value }));
    }

    function updateRequirementField(reqId: string, value: RequirementValue) {
        setRequirementsData((prev) => ({ ...prev, [reqId]: value }));
    }

    function updateFileUploading(reqId: string, value: boolean) {
        setFileUploading((prev) => ({ ...prev, [reqId]: value }));
    }

    function updateFileError(reqId: string, value: string) {
        setFileErrors((prev) => ({ ...prev, [reqId]: value }));
    }

    function isFormComplete() {
        if (!service || !submissionSchema) return false;
        if (!submissionSchema.submissionPolicy.allowsPublicSubmission) return false;

        for (const field of citizenFields) {
            const value = citizenData[field.key] || "";
            if (field.is_required && !value.trim()) return false;
            if (!validateCitizenField(field, value)) return false;
        }

        if (Object.values(fileUploading).some(Boolean)) return false;
        if (Object.values(fileErrors).some((value) => value)) return false;

        for (const req of requirementFields) {
            if (req.is_required && !hasRequirementValue(requirementsData[req.id])) return false;
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
            updateFileError(reqId, "Ukuran file maksimal 10MB.");
            return;
        }

        updateFileError(reqId, "");
        updateFileUploading(reqId, true);

        try {
            if (!service?.village_id) throw new Error("village_id tidak tersedia untuk upload file");
            const formData = new FormData();
            formData.append("file", file);
            formData.append("village_id", service.village_id);

            const response = await fetch("/api/public/uploads", {
                method: "POST",
                body: formData,
            });

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

            const uploadedFile = getRequirementFile({
                url: result?.data?.url,
                internal_url: result?.data?.internal_url,
                file_name: result?.data?.file_name || file.name,
                mime_type: result?.data?.mime_type || file.type,
                size: typeof result?.data?.size === "number" ? result.data.size : file.size,
                storage_key: result?.data?.storage_key,
            });

            if (!uploadedFile) {
                throw new Error("Gagal mengunggah file. URL file tidak tersedia.");
            }

            updateRequirementField(reqId, uploadedFile);
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

        if (!service || !submissionSchema) return;
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
            const rawPhoneValue = phoneFieldKey ? (citizenData[phoneFieldKey] || "") : "";
            const normalizedWa = normalizeTo628(rawPhoneValue);
            const derivedNoHp = normalizedWa.startsWith("628") ? `0${normalizedWa.slice(2)}` : normalizedWa;
            const channel = sessionId ? "WEBCHAT" : "WHATSAPP";
            const citizenPayload = { ...citizenData };

            if (phoneFieldKey === "no_hp" && normalizedWa) {
                citizenPayload.no_hp = derivedNoHp;
            }
            if (phoneFieldKey === "wa_user_id" && normalizedWa) {
                citizenPayload.wa_user_id = normalizedWa;
            }

            const response = await fetch("/api/public/service-requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    service_id: service.id,
                    ...(normalizedWa ? { wa_user_id: normalizedWa } : {}),
                    channel,
                    channel_identifier: sessionId || undefined,
                    citizen_data: citizenPayload,
                    requirement_data: requirementsData,
                    idempotency_key: idempotencyKey,
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

    function renderCitizenField(field: CitizenFieldDefinition) {
        const Icon = citizenFieldIcons[field.key] || User;
        const value = citizenData[field.key] || "";
        const options = field.options || [];
        const isPhoneField = field.key === phoneFieldKey;

        if (field.field_type === "textarea") {
            return (
                <div key={field.key} className="space-y-2 sm:col-span-2">
                    <label className="text-xs font-semibold flex items-center gap-1">
                        <Icon className="w-3.5 h-3.5" /> {field.label} {field.is_required && <span className="text-red-500">*</span>}
                    </label>
                    <textarea
                        value={value}
                        onChange={(e) => updateCitizenField(field.key, e.target.value)}
                        rows={3}
                        placeholder={field.help_text || `Isi ${field.label.toLowerCase()}`}
                        className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                    />
                    {field.help_text && <p className="text-[10px] text-muted-foreground">{field.help_text}</p>}
                </div>
            );
        }

        if (field.field_type === "select") {
            return (
                <div key={field.key} className="space-y-2">
                    <label className="text-xs font-semibold flex items-center gap-1">
                        <Icon className="w-3.5 h-3.5" /> {field.label} {field.is_required && <span className="text-red-500">*</span>}
                    </label>
                    <select
                        value={value}
                        onChange={(e) => updateCitizenField(field.key, e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                    >
                        <option value="">Pilih opsi</option>
                        {options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                    {field.help_text && <p className="text-[10px] text-muted-foreground">{field.help_text}</p>}
                </div>
            );
        }

        if (field.field_type === "radio") {
            return (
                <div key={field.key} className="space-y-2 sm:col-span-2">
                    <label className="text-xs font-semibold flex items-center gap-1">
                        <Icon className="w-3.5 h-3.5" /> {field.label} {field.is_required && <span className="text-red-500">*</span>}
                    </label>
                    <div className="flex flex-wrap gap-3 rounded-xl border border-border/50 bg-card px-3 py-2">
                        {options.map((opt) => (
                            <label key={opt} className="flex items-center gap-1 text-xs">
                                <input
                                    type="radio"
                                    name={field.key}
                                    value={opt}
                                    checked={value === opt}
                                    onChange={(e) => updateCitizenField(field.key, e.target.value)}
                                />
                                {opt}
                            </label>
                        ))}
                    </div>
                    {field.help_text && <p className="text-[10px] text-muted-foreground">{field.help_text}</p>}
                </div>
            );
        }

        const inputType = field.field_type === "date"
            ? "date"
            : field.field_type === "number"
                ? "number"
                : "text";

        return (
            <div key={field.key} className="space-y-2">
                <label className="text-xs font-semibold flex items-center gap-1">
                    <Icon className="w-3.5 h-3.5" /> {field.label} {field.is_required && <span className="text-red-500">*</span>}
                </label>
                <input
                    type={inputType}
                    value={value}
                    readOnly={isPhoneField && isWaPrefilled}
                    maxLength={field.validation === "nik" ? 16 : undefined}
                    onChange={(e) => {
                        if (isPhoneField && isWaPrefilled) return;
                        const nextValue = field.validation === "nik"
                            ? e.target.value.replace(/\D/g, "")
                            : e.target.value;
                        updateCitizenField(field.key, nextValue);
                    }}
                    onBlur={(e) => {
                        if (!isPhoneField || isWaPrefilled) return;
                        const normalized = normalizeTo628(e.target.value);
                        if (normalized && normalized !== value) {
                            updateCitizenField(field.key, normalized);
                        }
                    }}
                    placeholder={field.validation === "wa_phone"
                        ? "628xxxxxxxxxx"
                        : field.help_text || `Isi ${field.label.toLowerCase()}`}
                    className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card text-xs focus:outline-none focus:ring-2 focus:ring-secondary"
                />
                {isPhoneField ? (
                    isWaPrefilled ? (
                        <p className="text-[10px] text-muted-foreground">Nomor WhatsApp terisi otomatis dari tautan WhatsApp dan tidak bisa diubah.</p>
                    ) : (
                        <p className="text-[10px] text-muted-foreground">Format: 628xxxxxxxxxx atau 08xxxxxxxxxx.</p>
                    )
                ) : field.help_text ? (
                    <p className="text-[10px] text-muted-foreground">{field.help_text}</p>
                ) : null}
            </div>
        );
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
        const canChatBot = !isWebchatSession && !!success.request_number && /^62\d{8,15}$/.test(botNumber);
        const waMessage = success.request_number ? `Cek status ${success.request_number}` : "";
        const waLink = canChatBot
            ? `https://wa.me/${botNumber}?text=${encodeURIComponent(waMessage)}`
            : "";
        const statusChannelLabel = getStatusChannelLabel(isWebchatSession);

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
                            Status akan dikirim {statusChannelLabel}. Simpan nomor layanan di atas bila Anda perlu menyebutkannya ke petugas.
                        </p>

                        {canChatBot ? (
                            <Button asChild className="w-full bg-secondary hover:bg-secondary/90">
                                <a href={waLink} target="_blank" rel="noreferrer">
                                    <MessageCircle className="w-4 h-4 mr-2" />
                                    Cek Status via WhatsApp
                                </a>
                            </Button>
                        ) : isWebchatSession ? (
                            <div className="text-[10px] text-muted-foreground border border-border/50 rounded-xl p-3 bg-background/70">
                                Update status berikutnya akan muncul melalui percakapan ini dengan nomor layanan <b>{success.request_number || "-"}</b>.
                            </div>
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
                    <p>Mode layanan: {formatServiceModeLabel(service.mode)}</p>
                    <p>Kategori: {service.category?.name || "Layanan Administrasi"}</p>
                    {service.estimated_cost && <p>Estimasi biaya: {service.estimated_cost}</p>}
                    {service.estimated_processing_time && <p>Estimasi waktu proses: {service.estimated_processing_time}</p>}
                </CardContent>
            </Card>

            <form onSubmit={handleSubmit} className="space-y-6">
                <Card className="border-border/50">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold">Data Pemohon</CardTitle>
                    </CardHeader>
                    <CardContent className="grid sm:grid-cols-2 gap-4">
                        {citizenFields.map((field) => renderCitizenField(field))}
                    </CardContent>
                </Card>

                {requirementFields.length > 0 && (
                    <Card className="border-border/50">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold">Persyaratan</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {requirementFields.map((req) => {
                                const options = normalizeOptions(req.options_json);
                                const requirementValue = requirementsData[req.id];
                                const value = getRequirementInputValue(requirementValue);
                                const uploadedFile = getRequirementFile(requirementValue);
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
                                                {uploadedFile && !fileUploading[req.id] && (
                                                    <p className="text-[10px] text-emerald-600">
                                                        File terunggah{uploadedFile.file_name ? `: ${uploadedFile.file_name}` : ""}. <a href={uploadedFile.url} target="_blank" rel="noreferrer" className="underline">Lihat file</a>
                                                    </p>
                                                )}
                                                {fileErrors[req.id] && (
                                                    <p className="text-[10px] text-red-600">{fileErrors[req.id]}</p>
                                                )}
                                                <p className="text-[10px] text-muted-foreground">Tipe file: PDF/JPG/PNG/DOC/DOCX, maks 10MB.</p>
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

                {!submissionSchema?.submissionPolicy.allowsPublicSubmission && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                        <Info className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                            Layanan ini <b>offline</b>. Permohonan tidak bisa dikirim online. Silakan datang ke kantor kelurahan/desa.
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
        </div>
    );
}
