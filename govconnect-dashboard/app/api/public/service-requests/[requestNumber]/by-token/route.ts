import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/api-client";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ requestNumber: string }> }
) {
  try {
    const internalApiKey = requireInternalApiKey();
    const { requestNumber } = await context.params;
    const body = await request.json();
    const { edit_token, citizen_data, requirement_data, wa_user_id, session_id } = body as {
      edit_token?: string;
      citizen_data?: Record<string, any>;
      requirement_data?: Record<string, any>;
      wa_user_id?: string;
      session_id?: string;
    };

    if (!edit_token) {
      return NextResponse.json(
        { error: "edit_token wajib diisi" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${CASE_SERVICE_URL}/service-requests/${requestNumber}/by-token`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-internal-api-key": internalApiKey,
        },
        body: JSON.stringify({
          edit_token,
          ...(wa_user_id ? { wa_user_id } : {}),
          ...(session_id ? { session_id } : {}),
          citizen_data_json: citizen_data || {},
          requirement_data_json: requirement_data || {},
        }),
      }
    );

    const responseText = await response.text();
    let result: any = null;

    try {
      result = JSON.parse(responseText);
    } catch {
      if (!response.ok) {
        return NextResponse.json(
          { error: responseText.substring(0, 200) || "Gagal memperbarui layanan" },
          { status: response.status }
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.message || result?.error || "Gagal memperbarui layanan" },
        { status: response.status }
      );
    }

    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    console.error("Public service request update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
