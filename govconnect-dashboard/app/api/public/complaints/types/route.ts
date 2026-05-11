import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/api-client";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";

export async function GET(request: NextRequest) {
  try {
    const internalApiKey = requireInternalApiKey();
    const villageId = request.nextUrl.searchParams.get("village_id")?.trim();
    const categoryId = request.nextUrl.searchParams.get("category_id")?.trim();
    const isUrgent = request.nextUrl.searchParams.get("is_urgent")?.trim();

    if (!villageId) {
      return NextResponse.json({ error: "village_id wajib diisi" }, { status: 400 });
    }

    const url = new URL(`${CASE_SERVICE_URL}/complaints/types`);
    url.searchParams.set("village_id", villageId);
    if (categoryId) url.searchParams.set("category_id", categoryId);
    if (isUrgent) url.searchParams.set("is_urgent", isUrgent);

    const response = await fetch(url.toString(), {
      headers: {
        "x-internal-api-key": internalApiKey,
      },
    });

    const responseText = await response.text();
    let result: any = null;

    try {
      result = JSON.parse(responseText);
    } catch {
      if (!response.ok) {
        return NextResponse.json(
          { error: responseText.substring(0, 200) || "Gagal memuat jenis pengaduan" },
          { status: response.status }
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.message || result?.error || "Gagal memuat jenis pengaduan" },
        { status: response.status }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Public complaint types error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
