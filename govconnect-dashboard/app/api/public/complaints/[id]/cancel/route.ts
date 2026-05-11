import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/api-client";
import { normalizePhoneNumber } from "@/lib/whatsapp";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";

function isValidWaNumber(value: string) {
  return /^628\d{8,12}$/.test(value);
}

function normalizeChannel(value?: string): "WHATSAPP" | "WEBCHAT" | null {
  if (value === "WHATSAPP" || value === "WEBCHAT") return value;
  return null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const internalApiKey = requireInternalApiKey();
    const { id } = await context.params;
    const body = await request.json();
    const { wa_user_id, cancel_reason, channel, channel_identifier, session_id, sessionId } = body as {
      wa_user_id?: string;
      cancel_reason?: string;
      channel?: "WHATSAPP" | "WEBCHAT";
      channel_identifier?: string;
      session_id?: string;
      sessionId?: string;
    };

    const explicitChannel = normalizeChannel(channel);
    const resolvedChannelIdentifier = [channel_identifier, session_id, sessionId].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ) || "";
    const normalizedWaUserId = wa_user_id ? normalizePhoneNumber(wa_user_id) : "";
    const hasWebchatIdentifier = !!resolvedChannelIdentifier;
    const hasWhatsAppIdentity = !!normalizedWaUserId;

    if (explicitChannel === "WHATSAPP" && hasWebchatIdentifier) {
      return NextResponse.json(
        { error: "channel WHATSAPP tidak boleh dikirim bersama session/channel_identifier webchat" },
        { status: 400 },
      );
    }

    if (explicitChannel === "WEBCHAT" && !hasWebchatIdentifier) {
      return NextResponse.json(
        { error: "channel_identifier atau session_id wajib diisi untuk channel Webchat" },
        { status: 400 },
      );
    }

    const normalizedChannel = explicitChannel
      || (hasWebchatIdentifier ? "WEBCHAT" : null)
      || (hasWhatsAppIdentity ? "WHATSAPP" : null);

    if (!normalizedChannel) {
      return NextResponse.json(
        { error: "channel tidak dapat ditentukan; kirim wa_user_id untuk WhatsApp atau session/channel_identifier untuk Webchat" },
        { status: 400 },
      );
    }

    if (normalizedChannel === "WHATSAPP") {
      if (!normalizedWaUserId) {
        return NextResponse.json({ error: "wa_user_id wajib diisi untuk channel WhatsApp" }, { status: 400 });
      }

      if (!isValidWaNumber(normalizedWaUserId)) {
        return NextResponse.json({ error: "Format nomor WhatsApp harus 628xxxxxxxxxx" }, { status: 400 });
      }
    }

    if (normalizedChannel === "WEBCHAT" && !resolvedChannelIdentifier) {
      return NextResponse.json(
        { error: "channel_identifier atau session_id wajib diisi untuk channel Webchat" },
        { status: 400 }
      );
    }

    const response = await fetch(`${CASE_SERVICE_URL}/laporan/${id}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": internalApiKey,
      },
      body: JSON.stringify({
        ...(normalizedWaUserId ? { wa_user_id: normalizedWaUserId } : {}),
        ...(cancel_reason ? { cancel_reason } : {}),
        channel: normalizedChannel,
        ...(resolvedChannelIdentifier
          ? {
              session_id: resolvedChannelIdentifier,
              channel_identifier: resolvedChannelIdentifier,
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
          { error: responseText.substring(0, 200) || "Gagal membatalkan laporan" },
          { status: response.status }
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.message || result?.error || "Gagal membatalkan laporan" },
        { status: response.status }
      );
    }

    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    console.error("Public complaint cancel error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
