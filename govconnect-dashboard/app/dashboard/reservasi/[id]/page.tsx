"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function DeprecatedDashboardRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/dashboard/pelayanan")
  }, [router])

  return null
}
