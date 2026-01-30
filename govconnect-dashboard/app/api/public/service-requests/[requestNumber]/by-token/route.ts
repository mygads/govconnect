import { NextRequest, NextResponse } from "next/server";

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || "http://localhost:3003";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ requestNumber: string }> }
) {
  try {
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
          "x-internal-api-key": INTERNAL_API_KEY,
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

    const result = await response.json();

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
