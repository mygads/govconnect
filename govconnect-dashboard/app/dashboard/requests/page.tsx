'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SERVICE_REQUEST_STATUS_LABELS } from '@/lib/types'

interface ServiceRequest {
  id: string
  ticket_number: string
  applicant_name: string
  applicant_phone: string
  status: string
  created_at: string
  service: {
    name: string
    category: {
      name: string
    }
  }
}

export default function RequestsPage() {
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    fetchRequests()
  }, [page, statusFilter])

  const fetchRequests = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const params = new URLSearchParams({ page: page.toString(), limit: '20' })
      if (statusFilter) params.append('status', statusFilter)

      const res = await fetch(`/api/village/requests?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) {
        setRequests(data.data)
        setTotalPages(data.pagination.totalPages)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SUBMITTED': return 'bg-yellow-100 text-yellow-700'
      case 'VERIFYING': return 'bg-blue-100 text-blue-700'
      case 'PROCESSING': return 'bg-indigo-100 text-indigo-700'
      case 'REVISION_NEEDED': return 'bg-orange-100 text-orange-700'
      case 'READY': return 'bg-teal-100 text-teal-700'
      case 'COMPLETED': case 'DELIVERED': return 'bg-green-100 text-green-700'
      case 'REJECTED': case 'CANCELLED': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Permohonan Layanan</h1>
          <p className="text-muted-foreground">Kelola permohonan layanan dari masyarakat</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
        <div className="flex flex-wrap gap-4">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Semua Status</option>
            <option value="SUBMITTED">Diajukan</option>
            <option value="VERIFYING">Verifikasi</option>
            <option value="PROCESSING">Diproses</option>
            <option value="REVISION_NEEDED">Perlu Revisi</option>
            <option value="READY">Siap Diambil</option>
            <option value="COMPLETED">Selesai</option>
            <option value="REJECTED">Ditolak</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <svg className="w-12 h-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>Belum ada permohonan</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">No. Tiket</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Pemohon</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Layanan</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Tanggal</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm">{req.ticket_number}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{req.applicant_name}</p>
                      <p className="text-sm text-muted-foreground">{req.applicant_phone}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{req.service?.name}</p>
                      <p className="text-sm text-muted-foreground">{req.service?.category?.name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(req.status)}`}>
                        {SERVICE_REQUEST_STATUS_LABELS[req.status as keyof typeof SERVICE_REQUEST_STATUS_LABELS] || req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(req.created_at).toLocaleDateString('id-ID')}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/requests/${req.id}`}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 border rounded text-sm disabled:opacity-50"
            >
              Sebelumnya
            </button>
            <span className="text-sm text-muted-foreground">
              Halaman {page} dari {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 border rounded text-sm disabled:opacity-50"
            >
              Selanjutnya
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
