import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"
import { ai } from "@/lib/api-client"
import goldenSet from "@/data/golden-set.json"
import prisma from "@/lib/prisma"

export async function POST(request: NextRequest) {
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

    const response = await ai.runGoldenSetEvaluation({
      items: goldenSet,
    })

    if (!response.ok) {
      return NextResponse.json({ error: "AI service error" }, { status: 502 })
    }

    const data = await response.json()

    const prismaAny = prisma as any
    const stored = await prismaAny.ai_golden_set_runs.create({
      data: {
        run_id: data.run_id,
        total: data.total,
        intent_accuracy: data.intent_accuracy,
        keyword_accuracy: data.keyword_accuracy,
        overall_accuracy: data.overall_accuracy,
        thresholds: data.thresholds,
        status: data.status,
        started_at: new Date(data.started_at),
        completed_at: new Date(data.completed_at),
        items: {
          create: (data.results || []).map((item: any) => ({
            query: item.query,
            expected_intent: item.expected_intent || null,
            predicted_intent: item.predicted_intent,
            reply_text: item.reply_text,
            intent_match: typeof item.intent_match === "boolean" ? item.intent_match : null,
            keyword_match: typeof item.keyword_match === "boolean" ? item.keyword_match : null,
            keyword_score: typeof item.keyword_score === "number" ? item.keyword_score : null,
            score: item.score,
            latency_ms: item.latency_ms,
          })),
        },
      },
      include: { items: true },
    })

    return NextResponse.json({
      run_id: stored.run_id,
      total: stored.total,
      intent_accuracy: stored.intent_accuracy,
      keyword_accuracy: stored.keyword_accuracy,
      overall_accuracy: stored.overall_accuracy,
      thresholds: stored.thresholds,
      status: stored.status,
      started_at: stored.started_at,
      completed_at: stored.completed_at,
      results: stored.items,
    })
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to run golden set evaluation", message: error.message }, { status: 500 })
  }
}
