import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { apiFetch, buildUrl, getHeaders, ServicePath } from "@/lib/api-client"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization")
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const token = authHeader.replace("Bearer ", "")
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { note_text, image_url } = body as { note_text?: string; image_url?: string }

    if (!note_text) {
      return NextResponse.json({ error: "note_text wajib diisi" }, { status: 400 })
    }

    const response = await apiFetch(
      buildUrl(ServicePath.CASE, `/complaints/${id}/updates`),
      {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          note_text,
          image_url: image_url || null,
        }),
      }
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Gagal menyimpan update" }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Error creating complaint update:", error)
    return NextResponse.json({ error: "Failed to create update" }, { status: 500 })
  }
}
