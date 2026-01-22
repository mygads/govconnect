import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

export async function GET(request: NextRequest) {
    try {
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

        const url = new URL(`${CASE_SERVICE_URL}/services/by-slug`);
        url.searchParams.set("village_id", village.id);
        url.searchParams.set("slug", serviceSlug);

        const response = await fetch(url.toString(), {
            headers: {
                "x-internal-api-key": INTERNAL_API_KEY,
            },
        });

        if (!response.ok) {
            const detail = await response.text();
            return NextResponse.json(
                { error: "Gagal memuat layanan", detail },
                { status: response.status }
            );
        }

        const result = await response.json();

        return NextResponse.json({
            data: result.data,
            village: {
                id: village.id,
                name: village.name,
                slug: village.slug,
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
