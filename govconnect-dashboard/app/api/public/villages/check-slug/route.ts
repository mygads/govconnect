import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const slug = searchParams.get("slug")?.trim().toLowerCase()

    if (!slug) {
      return NextResponse.json({ error: "slug wajib diisi" }, { status: 400 })
    }

    const exists = await prisma.villages.findUnique({
      where: { slug },
      select: { id: true },
    })

    return NextResponse.json({ available: !exists })
  } catch (error) {
    console.error("Check village slug error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
