import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/api-client";
import {
  normalizePublicComplaintVillageId,
  resolvePublicComplaintIdentity,
} from "./_shared/request-utils";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";

export async function POST(request: NextRequest) {
  try {
    const internalApiKey = requireInternalApiKey();
    const body = await request.json();
    const {
      village_id,
      wa_user_id,
      channel,
      channel_identifier,
      session_id,
      sessionId,
      kategori,
      deskripsi,
      alamat,
      rt_rw,
      foto_url,
      type_id,
      category_id,
      reporter_name,
      reporter_phone,
    } = body as {
      village_id?: string;
      wa_user_id?: string;
      channel?: "WHATSAPP" | "WEBCHAT";
      channel_identifier?: string;
      session_id?: string;
      sessionId?: string;
      kategori?: string;
      deskripsi?: string;
      alamat?: string;
      rt_rw?: string;
      foto_url?: string | string[];
      type_id?: string;
      category_id?: string;
      reporter_name?: string;
      reporter_phone?: string;
    };

    const identityResult = resolvePublicComplaintIdentity({
      wa_user_id,
      channel,
      channel_identifier,
      session_id,
      sessionId,
    });
    if (identityResult.error || !identityResult.identity) {
      return NextResponse.json({ error: identityResult.error || "Identitas pengirim tidak valid" }, { status: 400 });
    }

    const identity = identityResult.identity;
    const villageId = normalizePublicComplaintVillageId(village_id);

    if (!villageId) {
      return NextResponse.json({ error: "village_id wajib diisi" }, { status: 400 });
    }

    if (!kategori) {
      return NextResponse.json({ error: "kategori wajib diisi" }, { status: 400 });
    }

    if (!deskripsi || deskripsi.trim().length < 10) {
      return NextResponse.json({ error: "deskripsi minimal 10 karakter" }, { status: 400 });
    }

    const response = await fetch(`${CASE_SERVICE_URL}/laporan/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": internalApiKey,
      },
      body: JSON.stringify({
        village_id: villageId,
        kategori,
        deskripsi,
        alamat,
        rt_rw,
        foto_url: Array.isArray(foto_url) ? JSON.stringify(foto_url) : foto_url,
        type_id,
        category_id,
        reporter_name,
        reporter_phone,
        ...(identity.waUserId ? { wa_user_id: identity.waUserId } : {}),
        channel: identity.channel,
        ...(identity.channelIdentifier
          ? {
              session_id: identity.channelIdentifier,
              channel_identifier: identity.channelIdentifier,
            }
          : {}),
      }),
    });

    const responseText = await response.text();
    let result: any = null;

    try {
      result = JSON.parse(responseText);
    } catch {
      if (!response.ok) {
        return NextResponse.json(
          { error: responseText.substring(0, 200) || "Gagal membuat laporan" },
          { status: response.status }
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.message || result?.error || "Gagal membuat laporan" },
        { status: response.status }
      );
    }

    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    console.error("Public complaint create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
