import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { apiFetch, buildUrl, getHeaders, ServicePath } from "@/lib/api-client"

async function getSession(request: NextRequest) {
  const token = request.cookies.get("token")?.value ||
    request.headers.get("authorization")?.replace("Bearer ", "")
  if (!token) return null

  const payload = await verifyToken(token)
  if (!payload) return null

  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true },
  })
  if (!session || session.expires_at < new Date()) return null

  return session
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { note_text, image_url } = body as { note_text?: string; image_url?: string }

    if (!note_text) {
      return NextResponse.json({ error: "note_text wajib diisi" }, { status: 400 })
    }

    const url = new URL(buildUrl(ServicePath.CASE, `/complaints/${id}/updates`))
    if (session.admin.village_id) {
      url.searchParams.set("village_id", session.admin.village_id)
    }

    const response = await apiFetch(url.toString(), {
      method: "POST",
      headers: getHeaders({
        ...(session.admin.village_id ? { "x-village-id": session.admin.village_id } : {}),
        "x-admin-role": session.admin.role,
      }),
      body: JSON.stringify({
        note_text,
        image_url: image_url || null,
      }),
    })

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
