import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/api-client";
import prisma from "@/lib/prisma";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";
const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || "http://localhost:3001";

async function safeReadJson(response: Response): Promise<any | null> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

export async function GET(request: NextRequest) {
    try {
        const internalApiKey = requireInternalApiKey();
        const { searchParams } = new URL(request.url);
        const villageSlug = searchParams.get("village_slug");
        const serviceSlug = searchParams.get("service_slug");

        if (!villageSlug || !serviceSlug) {
            return NextResponse.json(
                { error: "village_slug dan service_slug wajib diisi" },
                { status: 400 }
            );
        }

        const village = await (prisma as any).villages.findUnique({
            where: { slug: villageSlug },
        });

        if (!village) {
            return NextResponse.json(
                { error: "Desa tidak ditemukan" },
                { status: 404 }
            );
        }

        const villageId = village.id;

        const url = new URL(`${CASE_SERVICE_URL}/services/by-slug`);
        url.searchParams.set("village_id", villageId);
        url.searchParams.set("slug", serviceSlug);

        const response = await fetch(url.toString(), {
            headers: {
                "x-internal-api-key": internalApiKey,
            },
        });

        const responseText = await response.text();
        let payload: any = null;

        try {
            payload = JSON.parse(responseText);
        } catch {
            payload = null;
        }

        if (!response.ok || !payload) {
            return NextResponse.json(
                {
                    error: payload?.error || "Gagal memuat layanan",
                    detail: payload?.detail || (!response.ok ? responseText.substring(0, 200) : null),
                    village_id: villageId,
                },
                { status: response.status }
            );
        }

        const result = payload;

        // Bot WA number is owned by channel-service (per village). Best-effort: do not fail page.
        let villageWaNumber: string | null = null;
        try {
            const waStatusRes = await fetch(
                `${CHANNEL_SERVICE_URL}/internal/whatsapp/status?village_id=${encodeURIComponent(village.id)}`,
                {
                    headers: {
                        "x-internal-api-key": internalApiKey,
                    },
                }
            );
            const waStatusJson = await safeReadJson(waStatusRes);
            villageWaNumber = (waStatusJson as any)?.data?.wa_number || null;

            // Fallback: if session isn't created/connected yet, channel_account may still have wa_number.
            if (!villageWaNumber) {
                const accountRes = await fetch(
                    `${CHANNEL_SERVICE_URL}/internal/channel-accounts/${encodeURIComponent(village.id)}`,
                    {
                        headers: {
                            "x-internal-api-key": internalApiKey,
                        },
                    }
                );
                const accountJson = await safeReadJson(accountRes);
                villageWaNumber = (accountJson as any)?.data?.wa_number || null;
            }
        } catch {
            villageWaNumber = null;
        }

        // Defense-in-depth: strip JID device suffix (:N) if present in wa_number
        // JID format from WhatsApp: 628xxx:N@s.whatsapp.net → stored as 628xxx:N
        if (villageWaNumber) {
            villageWaNumber = villageWaNumber.replace(/:\d+$/, '');
        }

        return NextResponse.json({
            data: result.data,
            village: {
                id: village.id,
                name: village.name,
                slug: village.slug,
                wa_number: villageWaNumber,
            },
        });
    } catch (error) {
        console.error("Public service by slug error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
