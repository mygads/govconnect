import { NextRequest, NextResponse } from "next/server";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "token wajib diisi" },
        { status: 400 }
      );
    }

    const url = new URL(`${CASE_SERVICE_URL}/service-requests/by-token`);
    url.searchParams.set("token", token);

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
