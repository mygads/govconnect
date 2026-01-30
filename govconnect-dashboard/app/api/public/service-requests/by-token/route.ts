import { NextRequest, NextResponse } from "next/server";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

export async function GET(request: NextRequest) {
  try {
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
    if (wa) url.searchParams.set("wa", wa);
    if (sessionId) url.searchParams.set("session_id", sessionId);

    const response = await fetch(url.toString(), {
      headers: {
        "x-internal-api-key": INTERNAL_API_KEY,
      },
    });

    const result = await response.json();

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
