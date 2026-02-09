import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, apiFetch, ServicePath } from '@/lib/api-client'

// DELETE - Reset all AI token usage data
export async function DELETE(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const res = await apiFetch(buildUrl(ServicePath.AI, '/admin/reset-token-usage'), {
      method: 'DELETE',
      headers: getHeaders(),
      timeout: 10000,
    })

    if (res.ok) {
      const data = await res.json()
      return NextResponse.json(data)
    }

    const errorText = await res.text()
    console.error('Reset token usage error:', errorText)
    return NextResponse.json({ error: 'Failed to reset token usage' }, { status: res.status })
  } catch (error) {
    console.error('Error resetting token usage:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
