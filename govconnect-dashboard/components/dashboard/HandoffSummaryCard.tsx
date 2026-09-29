"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react"

interface HandoffSummary {
  intent?: string
  stage: string
  identityLevel?: string
  filledSlots: Array<{ key: string; value: string }>
  pendingMutation: boolean
  lastCitizenMessage?: string
  timeline: string[]
  text: string
}

/**
 * A1: shows the latest auto-generated handoff summary for a conversation,
 * so staff taking over see the context (slots filled, stage, timeline).
 * Renders nothing when no summary exists — never blocks the chat UI.
 */
export function HandoffSummaryCard({ userId, channel }: { userId: string; channel?: string }) {
  const [summary, setSummary] = useState<HandoffSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/handoffs/latest?user_id=${encodeURIComponent(userId)}&channel=${encodeURIComponent(channel ?? "whatsapp")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setSummary(data?.summary ?? null) })
      .catch(() => { if (!cancelled) setSummary(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId, channel])

  if (loading) return <div className="border-t px-4 py-2"><Skeleton className="h-8 w-full" /></div>
  if (!summary) return null

  return (
    <div className="border-t bg-blue-50/60 dark:bg-blue-950/30">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-blue-900 dark:text-blue-100"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Ringkasan konteks AI — baca sebelum membalas</span>
        {summary.pendingMutation && <Badge variant="destructive" className="text-[10px]">ada aksi tertunda</Badge>}
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="px-4 pb-3 text-xs text-blue-950 dark:text-blue-50 space-y-2">
          <p className="whitespace-pre-wrap">{summary.text}</p>
          {summary.filledSlots.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {summary.filledSlots.map((s) => (
                <Badge key={s.key} variant="outline" className="text-[10px] bg-white/60">
                  {s.key}: {s.value}
                </Badge>
              ))}
            </div>
          )}
          {summary.timeline.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5 text-[11px] opacity-80">
              {summary.timeline.slice(0, 5).map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
