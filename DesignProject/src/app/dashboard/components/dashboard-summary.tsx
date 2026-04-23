"use client"

import { generateDashboardSummary, type DashboardSummaryOutput } from "@/ai/flows/dashboard-summary-generator"
import { Skeleton } from "@/components/ui/skeleton"
import { useEffect, useState } from "react"

export default function DashboardSummary() {
  const [summary, setSummary] = useState<DashboardSummaryOutput | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function getSummary() {
      try {
        setLoading(true)
        const result = await generateDashboardSummary()
        setSummary(result)
      } catch (error) {
        console.error("Failed to generate summary:", error)
        setSummary({ summary: "Could not generate summary at this time." })
      } finally {
        setLoading(false)
      }
    }
    getSummary()
  }, [])

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    )
  }

  return (
    <p className="text-sm text-muted-foreground">
      {summary?.summary}
    </p>
  )
}
