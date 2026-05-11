import { NextRequest } from "next/server";
import { normalizePhoneNumber } from "@/lib/whatsapp";

type PublicComplaintChannel = "WHATSAPP" | "WEBCHAT";

type PublicComplaintIdentityInput = {
  wa_user_id?: string;
  channel?: string;
  channel_identifier?: string;
  session_id?: string;
  sessionId?: string;
};

export type PublicComplaintIdentity = {
  channel: PublicComplaintChannel;
  waUserId?: string;
  channelIdentifier?: string;
};

function isValidWaNumber(value: string) {
  return /^628\d{8,12}$/.test(value);
}

function normalizeChannel(value?: string): PublicComplaintChannel | null {
  if (value === "WHATSAPP" || value === "WEBCHAT") return value;
  return null;
}

export function normalizePublicComplaintVillageId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getPublicComplaintVillageIdFromQuery(request: NextRequest): string {
  return normalizePublicComplaintVillageId(request.nextUrl.searchParams.get("village_id"));
}

export function resolvePublicComplaintIdentity(input: PublicComplaintIdentityInput): {
  identity?: PublicComplaintIdentity;
  error?: string;
} {
  const explicitChannel = normalizeChannel(input.channel);
  const resolvedChannelIdentifier = [input.channel_identifier, input.session_id, input.sessionId].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  ) || "";
  const normalizedWaUserId = input.wa_user_id ? normalizePhoneNumber(input.wa_user_id) : "";
  const hasWebchatIdentifier = !!resolvedChannelIdentifier;
  const hasWhatsAppIdentity = !!normalizedWaUserId;

  if (explicitChannel === "WHATSAPP" && hasWebchatIdentifier) {
    return {
      error: "channel WHATSAPP tidak boleh dikirim bersama session/channel_identifier webchat",
    };
  }

  if (explicitChannel === "WEBCHAT" && !hasWebchatIdentifier) {
    return {
      error: "channel_identifier atau session_id wajib diisi untuk channel Webchat",
    };
  }

  const normalizedChannel = explicitChannel
    || (hasWebchatIdentifier ? "WEBCHAT" : null)
    || (hasWhatsAppIdentity ? "WHATSAPP" : null);

  if (!normalizedChannel) {
    return {
      error: "channel tidak dapat ditentukan; kirim wa_user_id untuk WhatsApp atau session/channel_identifier untuk Webchat",
    };
  }

  if (normalizedChannel === "WHATSAPP") {
    if (!normalizedWaUserId) {
      return { error: "wa_user_id wajib diisi untuk channel WhatsApp" };
    }

    if (!isValidWaNumber(normalizedWaUserId)) {
      return { error: "Format nomor WhatsApp harus 628xxxxxxxxxx" };
    }
  }

  if (normalizedChannel === "WEBCHAT" && !resolvedChannelIdentifier) {
    return {
      error: "channel_identifier atau session_id wajib diisi untuk channel Webchat",
    };
  }

  return {
    identity: {
      channel: normalizedChannel,
      ...(normalizedWaUserId ? { waUserId: normalizedWaUserId } : {}),
      ...(resolvedChannelIdentifier ? { channelIdentifier: resolvedChannelIdentifier } : {}),
    },
  };
}
