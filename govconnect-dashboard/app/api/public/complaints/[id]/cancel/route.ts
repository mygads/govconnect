import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/api-client";
import { resolvePublicComplaintIdentity } from "../../_shared/request-utils";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";

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

    const response = await fetch(`${CASE_SERVICE_URL}/laporan/${id}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-key": internalApiKey,
      },
      body: JSON.stringify({
        ...(identity.waUserId ? { wa_user_id: identity.waUserId } : {}),
        ...(cancel_reason ? { cancel_reason } : {}),
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
