import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/api-client";
import { getPublicComplaintVillageIdFromQuery } from "../_shared/request-utils";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";

export async function GET(request: NextRequest) {
  try {
    const internalApiKey = requireInternalApiKey();
    const villageId = getPublicComplaintVillageIdFromQuery(request);

    if (!villageId) {
      return NextResponse.json({ error: "village_id wajib diisi" }, { status: 400 });
    }

    const url = new URL(`${CASE_SERVICE_URL}/complaints/categories`);
    url.searchParams.set("village_id", villageId);

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
          { error: responseText.substring(0, 200) || "Gagal memuat kategori pengaduan" },
          { status: response.status }
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.message || result?.error || "Gagal memuat kategori pengaduan" },
        { status: response.status }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Public complaint categories error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
