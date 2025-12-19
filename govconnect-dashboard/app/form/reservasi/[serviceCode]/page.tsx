"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Send,
    Calendar,
    Clock,
    FileText,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Info,
    ChevronRight,
    User,
    CreditCard,
    MapPin,
    Phone
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    graphqlFetch,
    GET_SERVICE,
    GET_AVAILABLE_SLOTS,
    CREATE_RESERVATION,
    Service,
    AvailableSlots,
    CreateReservationInput,
    CreateReservationResponse,
} from "@/lib/graphql-client";

interface PageProps {
    params: Promise<{ serviceCode: string }>;
}

export default function ReservationFormPage({ params }: PageProps) {
    const { serviceCode } = use(params);

    const [service, setService] = useState<Service | null>(null);
    const [availableSlots, setAvailableSlots] = useState<AvailableSlots | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{
        reservation_id: string;
        queue_number: number;
        message: string
    } | null>(null);

    // Form state
    const [step, setStep] = useState(1);
    const [selectedDate, setSelectedDate] = useState<string>("");
    const [selectedTime, setSelectedTime] = useState<string>("");
    const [formData, setFormData] = useState<Record<string, string>>({
        nama_lengkap: "",
        nik: "",
        alamat: "",
        no_hp: "",
    });

    useEffect(() => {
        loadService();
    }, [serviceCode]);

    async function loadService() {
        try {
            const data = await graphqlFetch<{ service: Service }>(GET_SERVICE, { code: serviceCode });
            setService(data.service);
        } catch (err: any) {
            setError(err.message || "Gagal memuat layanan");
        } finally {
            setLoading(false);
        }
    }

    async function loadSlots(date: string) {
        setLoadingSlots(true);
        setSelectedTime("");
        try {
            const data = await graphqlFetch<{ availableSlots: AvailableSlots }>(
                GET_AVAILABLE_SLOTS,
                { serviceCode, date }
            );
            setAvailableSlots(data.availableSlots);
        } catch (err: any) {
            setError(err.message || "Gagal memuat slot waktu");
        } finally {
            setLoadingSlots(false);
        }
    }

    function handleDateChange(date: string) {
        setSelectedDate(date);
        loadSlots(date);
        setStep(2);
    }

    function handleTimeSelect(time: string) {
        setSelectedTime(time);
        setStep(3);
    }

    function updateFormData(field: string, value: string) {
        setFormData(prev => ({ ...prev, [field]: value }));
    }

    function isFormComplete() {
        if (!service) return false;
        if (!formData.nama_lengkap || !formData.nik || !formData.alamat || !formData.no_hp) return false;
        if (formData.nik.length !== 16) return false;

        for (const q of service.citizen_questions || []) {
            if (q.required && !formData[q.field]) return false;
        }
        return true;
    }

    async function handleSubmit() {
        if (!service || !isFormComplete()) return;

        setError(null);
        setSubmitting(true);

        try {
            const additionalData: Record<string, string> = {};
            for (const q of service.citizen_questions || []) {
                if (formData[q.field]) {
                    additionalData[q.field] = formData[q.field];
                }
            }

            const input: CreateReservationInput = {
                service_code: serviceCode,
                reservation_date: selectedDate,
                reservation_time: selectedTime,
                nama_lengkap: formData.nama_lengkap,
                nik: formData.nik,
                alamat: formData.alamat,
                no_hp: formData.no_hp,
                additional_data: Object.keys(additionalData).length > 0
                    ? JSON.stringify(additionalData)
                    : undefined,
            };

            const data = await graphqlFetch<{ createReservation: CreateReservationResponse }>(
                CREATE_RESERVATION,
                { input }
            );

            if (data.createReservation.success) {
                setSuccess({
                    reservation_id: data.createReservation.reservation_id!,
                    queue_number: data.createReservation.queue_number!,
                    message: data.createReservation.message!,
                });
            } else {
                setError(data.createReservation.error || "Gagal membuat reservasi");
            }
        } catch (err: any) {
            setError(err.message || "Terjadi kesalahan");
        } finally {
            setSubmitting(false);
        }
    }

    const availableDates = Array.from({ length: 14 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() + i + 1);
        return date.toISOString().split('T')[0];
    });

    function formatDate(dateStr: string) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('id-ID', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-secondary" />
                <p className="text-xs text-muted-foreground">Memuat layanan...</p>
            </div>
        );
    }

    if (!service) {
        return (
            <div className="max-w-md mx-auto py-12">
                <Card className="border-red-200/50 dark:border-red-800/30">
                    <CardContent className="p-5">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                            <div>
                                <p className="font-semibold text-sm">Layanan Tidak Ditemukan</p>
                                <p className="text-xs text-muted-foreground mt-1">Kode layanan "{serviceCode}" tidak valid.</p>
                                <Button variant="outline" size="sm" asChild className="mt-3 text-xs">
                                    <Link href="/form/reservasi">Kembali ke Daftar Layanan</Link>
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (success) {
        return (
            <div className="max-w-lg mx-auto py-8">
                <Card className="border-green-200/50 dark:border-green-800/30 bg-gradient-to-br from-green-50/50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                    <CardContent className="pt-8 pb-6 px-6 text-center space-y-6">
                        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-lg">
                            <CheckCircle2 className="w-8 h-8 text-white" />
                        </div>

                        <div>
                            <h1 className="text-xl font-bold text-green-700 dark:text-green-400">Reservasi Berhasil!</h1>
                            <p className="text-sm text-muted-foreground mt-1">{success.message}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-background/80 rounded-xl p-3 border border-border/50">
                                <p className="text-[10px] text-muted-foreground">ID Reservasi</p>
                                <p className="text-sm font-mono font-bold text-secondary">{success.reservation_id}</p>
                            </div>
                            <div className="bg-background/80 rounded-xl p-3 border border-border/50">
                                <p className="text-[10px] text-muted-foreground">Nomor Antrian</p>
                                <p className="text-2xl font-bold text-secondary">{success.queue_number}</p>
                            </div>
                        </div>

                        <div className="bg-secondary/10 rounded-xl p-3 text-left text-xs space-y-1">
                            <p><strong>Layanan:</strong> {service.name}</p>
                            <p><strong>Tanggal:</strong> {formatDate(selectedDate)}</p>
                            <p><strong>Waktu:</strong> {selectedTime}</p>
                        </div>

                        <p className="text-[10px] text-muted-foreground">
                            Harap datang 15 menit sebelum waktu reservasi. Bawa dokumen persyaratan yang diperlukan.
                        </p>

                        <div className="flex gap-3">
                            <Button variant="outline" asChild className="flex-1">
                                <Link href="/form">Kembali</Link>
                            </Button>
                            <Button asChild className="flex-1 bg-secondary hover:bg-secondary/90">
                                <Link href="/form/reservasi">Buat Reservasi Lagi</Link>
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
            <div className="mb-6">
                <Link
                    href="/form/reservasi"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
                >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Kembali ke daftar layanan
                </Link>

                <h1 className="text-xl font-bold">{service.name}</h1>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{service.description}</p>
            </div>

            {/* Progress Steps */}
            <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
                {[
                    { num: 1, label: "Tanggal", icon: Calendar },
                    { num: 2, label: "Waktu", icon: Clock },
                    { num: 3, label: "Data", icon: User },
                    { num: 4, label: "Kirim", icon: Send },
                ].map((s, i) => {
                    const Icon = s.icon;
                    return (
                        <div key={s.num} className="flex items-center">
                            <button
                                onClick={() => s.num < step && setStep(s.num)}
                                disabled={s.num > step}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${step === s.num
                                        ? "bg-secondary text-white"
                                        : step > s.num
                                            ? "bg-secondary/20 text-secondary cursor-pointer hover:bg-secondary/30"
                                            : "bg-muted text-muted-foreground cursor-not-allowed"
                                    }`}
                            >
                                {step > s.num ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                                <span className="hidden sm:inline">{s.label}</span>
                            </button>
                            {i < 3 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mx-1" />}
                        </div>
                    );
                })}
            </div>

            {/* Step 1: Date Selection */}
            {step === 1 && (
                <div className="space-y-4">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-secondary" /> Pilih Tanggal
                    </h2>

                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
                        {availableDates.map((date) => {
                            const d = new Date(date);
                            return (
                                <button
                                    key={date}
                                    onClick={() => handleDateChange(date)}
                                    className={`p-3 rounded-xl border-2 text-center transition-all ${selectedDate === date
                                            ? "border-secondary bg-secondary/10"
                                            : "border-border/50 hover:border-secondary/50 bg-card"
                                        }`}
                                >
                                    <p className="text-xs font-semibold">{d.toLocaleDateString('id-ID', { weekday: 'short' })}</p>
                                    <p className="text-lg font-bold">{d.getDate()}</p>
                                    <p className="text-[10px] text-muted-foreground">{d.toLocaleDateString('id-ID', { month: 'short' })}</p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Step 2: Time Selection */}
            {step === 2 && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold flex items-center gap-2">
                            <Clock className="w-4 h-4 text-secondary" /> Pilih Waktu
                        </h2>
                        <button onClick={() => setStep(1)} className="text-xs text-secondary hover:underline">
                            Ganti tanggal
                        </button>
                    </div>

                    <p className="text-xs text-muted-foreground">{formatDate(selectedDate)}</p>

                    {loadingSlots ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-secondary" />
                        </div>
                    ) : !availableSlots?.is_open ? (
                        <Card className="border-amber-200/50 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-950/20">
                            <CardContent className="p-4">
                                <p className="text-xs text-amber-700 dark:text-amber-300">Kantor tutup pada hari ini.</p>
                                <button onClick={() => setStep(1)} className="text-xs text-secondary hover:underline mt-2">
                                    Pilih tanggal lain
                                </button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                            {availableSlots?.slots.map((slot) => (
                                <button
                                    key={slot.time}
                                    onClick={() => slot.available && handleTimeSelect(slot.time)}
                                    disabled={!slot.available}
                                    className={`p-2 rounded-xl border-2 text-center transition-all ${selectedTime === slot.time
                                            ? "border-secondary bg-secondary/10"
                                            : slot.available
                                                ? "border-border/50 hover:border-secondary/50 bg-card"
                                                : "border-border/30 bg-muted/50 opacity-50 cursor-not-allowed"
                                        }`}
                                >
                                    <p className={`text-xs font-semibold ${slot.available ? "" : "text-muted-foreground"}`}>
                                        {slot.time}
                                    </p>
                                    {slot.available && slot.remaining !== undefined && (
                                        <p className="text-[10px] text-muted-foreground">{slot.remaining} slot</p>
                                    )}
                                    {!slot.available && <p className="text-[10px] text-red-500">Penuh</p>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Step 3: Form Data */}
            {step === 3 && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold flex items-center gap-2">
                            <User className="w-4 h-4 text-secondary" /> Lengkapi Data
                        </h2>
                        <button onClick={() => setStep(2)} className="text-xs text-secondary hover:underline">
                            Ganti waktu
                        </button>
                    </div>

                    {/* Common Fields */}
                    <Card className="border-border/50">
                        <CardHeader className="pb-2 pt-4 px-4">
                            <CardTitle className="text-xs font-semibold flex items-center gap-2">
                                <User className="w-3.5 h-3.5" /> Data Diri
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium">Nama Lengkap <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={formData.nama_lengkap}
                                    onChange={(e) => updateFormData("nama_lengkap", e.target.value)}
                                    placeholder="Nama sesuai KTP"
                                    className="w-full px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium flex items-center gap-1">
                                    <CreditCard className="w-3 h-3" /> NIK (16 digit) <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.nik}
                                    onChange={(e) => updateFormData("nik", e.target.value.replace(/\D/g, '').slice(0, 16))}
                                    placeholder="3373123456789012"
                                    maxLength={16}
                                    className="w-full px-3 py-2 rounded-lg border border-border/50 bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-secondary"
                                />
                                {formData.nik && formData.nik.length !== 16 && (
                                    <p className="text-[10px] text-amber-600">{formData.nik.length}/16 digit</p>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium flex items-center gap-1">
                                    <MapPin className="w-3 h-3" /> Alamat <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.alamat}
                                    onChange={(e) => updateFormData("alamat", e.target.value)}
                                    placeholder="Alamat lengkap sesuai KTP"
                                    className="w-full px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium flex items-center gap-1">
                                    <Phone className="w-3 h-3" /> No. HP <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="tel"
                                    value={formData.no_hp}
                                    onChange={(e) => updateFormData("no_hp", e.target.value)}
                                    placeholder="08123456789"
                                    className="w-full px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Service-Specific Questions */}
                    {service.citizen_questions && service.citizen_questions.length > 0 && (
                        <Card className="border-border/50">
                            <CardHeader className="pb-2 pt-4 px-4">
                                <CardTitle className="text-xs font-semibold flex items-center gap-2">
                                    <FileText className="w-3.5 h-3.5" /> Informasi Tambahan
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-4 pb-4 space-y-3">
                                {service.citizen_questions.map((q) => (
                                    <div key={q.field} className="space-y-1.5">
                                        <label className="text-xs font-medium">
                                            {q.question} {q.required && <span className="text-red-500">*</span>}
                                        </label>

                                        {q.type === 'select' && q.options ? (
                                            <select
                                                value={formData[q.field] || ""}
                                                onChange={(e) => updateFormData(q.field, e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                                            >
                                                <option value="">Pilih...</option>
                                                {q.options.map((opt) => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                type={q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text'}
                                                value={formData[q.field] || ""}
                                                onChange={(e) => updateFormData(q.field, e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg border border-border/50 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-secondary"
                                            />
                                        )}
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    <div className="flex gap-3">
                        <Button variant="outline" onClick={() => setStep(2)}>Kembali</Button>
                        <Button
                            onClick={() => setStep(4)}
                            disabled={!isFormComplete()}
                            className="flex-1 bg-secondary hover:bg-secondary/90"
                        >
                            Lanjut Review
                        </Button>
                    </div>
                </div>
            )}

            {/* Step 4: Review & Submit */}
            {step === 4 && (
                <div className="space-y-6">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-secondary" /> Review & Kirim
                    </h2>

                    <Card className="border-border/50">
                        <CardContent className="p-0 divide-y divide-border/50">
                            <div className="p-3">
                                <p className="text-[10px] text-muted-foreground">Layanan</p>
                                <p className="text-sm font-semibold">{service.name}</p>
                            </div>
                            <div className="p-3 grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-[10px] text-muted-foreground">Tanggal</p>
                                    <p className="text-xs font-medium">{formatDate(selectedDate)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] text-muted-foreground">Waktu</p>
                                    <p className="text-xs font-medium">{selectedTime}</p>
                                </div>
                            </div>
                            <div className="p-3 grid grid-cols-2 gap-2 text-xs">
                                <div><span className="text-muted-foreground">Nama:</span> {formData.nama_lengkap}</div>
                                <div><span className="text-muted-foreground">NIK:</span> <span className="font-mono">{formData.nik}</span></div>
                                <div><span className="text-muted-foreground">HP:</span> {formData.no_hp}</div>
                                <div><span className="text-muted-foreground">Alamat:</span> {formData.alamat}</div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Requirements */}
                    {service.requirements && service.requirements.length > 0 && (
                        <Card className="border-amber-200/50 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-950/20">
                            <CardContent className="p-4">
                                <div className="flex items-start gap-2">
                                    <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Dokumen yang Perlu Dibawa</p>
                                        <ul className="mt-1 space-y-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                            {service.requirements.map((req, i) => (
                                                <li key={i}>• {req}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30">
                            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                            <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <Button variant="outline" onClick={() => setStep(3)}>Edit Data</Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="flex-1 bg-secondary hover:bg-secondary/90"
                        >
                            {submitting ? (
                                <><Loader2 className="w-4 h-4 animate-spin mr-2" />Mengirim...</>
                            ) : (
                                <><Send className="w-4 h-4 mr-2" />Kirim Reservasi</>
                            )}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
