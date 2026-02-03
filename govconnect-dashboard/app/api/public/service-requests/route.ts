import { NextRequest, NextResponse } from "next/server";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

function isValidWaNumber(value: string) {
    return /^628\d{8,12}$/.test(value);
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { service_id, wa_user_id, channel, channel_identifier, citizen_data, requirement_data } = body as {
            service_id?: string;
            wa_user_id?: string;
            channel?: "WHATSAPP" | "WEBCHAT";
            channel_identifier?: string;
            citizen_data?: Record<string, any>;
            requirement_data?: Record<string, any>;
        };

        if (!service_id || !wa_user_id) {
            return NextResponse.json(
                { error: "service_id dan wa_user_id wajib diisi" },
                { status: 400 }
            );
        }

        if (!isValidWaNumber(wa_user_id)) {
            return NextResponse.json(
                { error: "Format nomor WhatsApp harus 628xxxxxxxxxx" },
                { status: 400 }
            );
        }

        const requiredCitizenFields = ["nama_lengkap", "nik", "alamat", "no_hp"];
        const missingCitizenFields = requiredCitizenFields.filter(
            (field) => !citizen_data?.[field]
        );

        if (missingCitizenFields.length > 0) {
            return NextResponse.json(
                { error: `Data pemohon belum lengkap: ${missingCitizenFields.join(", ")}` },
                { status: 400 }
            );
        }

        const response = await fetch(`${CASE_SERVICE_URL}/service-requests`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-api-key": INTERNAL_API_KEY,
            },
            body: JSON.stringify({
                service_id,
                wa_user_id,
                channel: channel || "WHATSAPP",
                channel_identifier: channel_identifier || undefined,
                citizen_data_json: citizen_data || {},
                requirement_data_json: requirement_data || {},
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            return NextResponse.json(
                { error: result?.error || "Gagal membuat permohonan layanan" },
                { status: response.status }
            );
        }

        return NextResponse.json(result, { status: response.status });
    } catch (error) {
        console.error("Public service request error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
