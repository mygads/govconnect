import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/api-client";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";

export async function GET(request: NextRequest) {
  try {
    const internalApiKey = requireInternalApiKey();
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const wa = searchParams.get("wa") || searchParams.get("wa_user_id");
    const sessionId = searchParams.get("session") || searchParams.get("session_id");

    if (!token) {
      return NextResponse.json(
        { error: "token wajib diisi" },
        { status: 400 }
      );
    }

    const url = new URL(`${CASE_SERVICE_URL}/service-requests/by-token`);
    url.searchParams.set("token", token);
    if (wa) url.searchParams.set("wa_user_id", wa);
    if (sessionId) url.searchParams.set("session_id", sessionId);

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
          { error: responseText.substring(0, 200) || "Token tidak valid" },
          { status: response.status }
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.message || result?.error || "Token tidak valid" },
        { status: response.status }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Public service request by token error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
