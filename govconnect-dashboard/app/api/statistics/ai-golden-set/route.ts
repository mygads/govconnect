import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { ai } from "@/lib/api-client"
import prisma from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization")
    const token = request.cookies.get("token")?.value || authHeader?.replace("Bearer ", "")
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }

    if (payload.role !== "superadmin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const prismaAny = prisma as any

    const latestRun = await prismaAny.ai_golden_set_runs.findFirst({
      orderBy: { completed_at: "desc" },
      include: { items: true },
    })

    const historyRuns = await prismaAny.ai_golden_set_runs.findMany({
      orderBy: { completed_at: "desc" },
      take: 30,
    })

    if (latestRun) {
      return NextResponse.json({
        latest: {
          run_id: latestRun.run_id,
          total: latestRun.total,
          intent_accuracy: latestRun.intent_accuracy,
          keyword_accuracy: latestRun.keyword_accuracy,
          overall_accuracy: latestRun.overall_accuracy,
          thresholds: latestRun.thresholds,
          status: latestRun.status,
          started_at: latestRun.started_at,
          completed_at: latestRun.completed_at,
          results: latestRun.items,
        },
        history: historyRuns.map((run: any) => ({
          run_id: run.run_id,
          total: run.total,
          intent_accuracy: run.intent_accuracy,
          keyword_accuracy: run.keyword_accuracy,
          overall_accuracy: run.overall_accuracy,
          thresholds: run.thresholds,
          status: run.status,
          started_at: run.started_at,
          completed_at: run.completed_at,
        })),
      })
    }

    // Fallback: if no DB history, pull from AI service
    const response = await ai.getGoldenSetSummary()
    if (response.ok) {
      const data = await response.json()
      return NextResponse.json(data)
    }

    return NextResponse.json({ latest: null, history: [] })
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to get golden set summary", message: error.message }, { status: 500 })
  }
}
