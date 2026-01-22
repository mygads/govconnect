'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SERVICE_REQUEST_STATUS_LABELS } from '@/lib/types'

interface ServiceRequest {
  id: string
  ticket_number: string
  applicant_name: string
  applicant_nik: string
  applicant_phone: string
  applicant_email?: string
  applicant_address?: string
  status: string
  delivery_method: string
  pickup_location?: string
  pickup_date?: string
  notes?: string
  rejection_reason?: string
  created_at: string
  completed_at?: string
  service: {
    id: string
    name: string
    processing_time?: string
    category: { name: string }
    requirements: any[]
  }
  filled_requirements: {
    id: string
    value?: string
    file_url?: string
    file_name?: string
    requirement: {
      name: string
      type: string
    }
  }[]
  status_history: {
    status: string
    changed_by: string
    notes?: string
    created_at: string
  }[]
}

const STATUS_ACTIONS: Record<string, { next: string[]; labels: Record<string, string> }> = {
  SUBMITTED: { 
    next: ['VERIFYING', 'REJECTED'],
    labels: { VERIFYING: 'Mulai Verifikasi', REJECTED: 'Tolak' }
  },
  VERIFYING: { 
    next: ['PROCESSING', 'REVISION_NEEDED', 'REJECTED'],
    labels: { PROCESSING: 'Proses', REVISION_NEEDED: 'Minta Revisi', REJECTED: 'Tolak' }
  },
  REVISION_NEEDED: { 
    next: ['VERIFYING'],
    labels: { VERIFYING: 'Verifikasi Ulang' }
  },
  PROCESSING: { 
    next: ['READY', 'REJECTED'],
    labels: { READY: 'Siap Diambil', REJECTED: 'Tolak' }
  },
  READY: { 
    next: ['COMPLETED', 'DELIVERED'],
    labels: { COMPLETED: 'Selesai', DELIVERED: 'Dikirim' }
  },
  DELIVERED: { 
    next: ['COMPLETED'],
    labels: { COMPLETED: 'Selesai' }
  }
}

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [request, setRequest] = useState<ServiceRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    fetchRequest()
  }, [])

  const fetchRequest = async () => {
    try {
      const { id } = await params
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/village/requests/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) {
        setRequest(data.data)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleStatusUpdate = async () => {
    if (!newStatus) return
    setUpdating(true)

    try {
      const { id } = await params
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/village/requests/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: newStatus,
          notes,
          ...(newStatus === 'REJECTED' && { rejection_reason: notes })
        })
      })
      const data = await res.json()
      if (data.success) {
        setShowModal(false)
        setNotes('')
        fetchRequest()
      }
    } catch (err) {
      console.error(err)
    } finally {
      setUpdating(false)
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Permohonan tidak ditemukan</p>
        <Link href="/dashboard/requests" className="text-blue-600 hover:underline mt-2 inline-block">
          Kembali ke daftar
        </Link>
      </div>
    )
  }

  const availableActions = STATUS_ACTIONS[request.status]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/requests" className="text-sm text-blue-600 hover:underline mb-2 inline-block">
            ← Kembali
          </Link>
          <h1 className="text-2xl font-bold">Detail Permohonan</h1>
          <p className="text-muted-foreground">Tiket: {request.ticket_number}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(request.status)}`}>
          {SERVICE_REQUEST_STATUS_LABELS[request.status as keyof typeof SERVICE_REQUEST_STATUS_LABELS]}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Applicant Info */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
            <h2 className="font-semibold mb-4">Data Pemohon</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Nama Lengkap</p>
                <p className="font-medium">{request.applicant_name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">NIK</p>
                <p className="font-medium">{request.applicant_nik}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">No. WhatsApp</p>
                <p className="font-medium">{request.applicant_phone}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{request.applicant_email || '-'}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-sm text-muted-foreground">Alamat</p>
                <p className="font-medium">{request.applicant_address || '-'}</p>
              </div>
            </div>
          </div>

          {/* Service Info */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
            <h2 className="font-semibold mb-4">Layanan</h2>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Jenis Layanan</p>
                <p className="font-medium">{request.service.name}</p>
                <p className="text-sm text-muted-foreground">{request.service.category.name}</p>
              </div>
              {request.service.processing_time && (
                <div>
                  <p className="text-sm text-muted-foreground">Estimasi Waktu</p>
                  <p className="font-medium">{request.service.processing_time}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Metode Pengambilan</p>
                <p className="font-medium">
                  {request.delivery_method === 'PICKUP' ? 'Ambil di Kantor' : 
                   request.delivery_method === 'DELIVERY' ? 'Diantar' : 'Digital'}
                </p>
              </div>
              {request.notes && (
                <div>
                  <p className="text-sm text-muted-foreground">Catatan Pemohon</p>
                  <p className="font-medium">{request.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Filled Requirements */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
            <h2 className="font-semibold mb-4">Dokumen Persyaratan</h2>
            {request.filled_requirements.length === 0 ? (
              <p className="text-muted-foreground">Tidak ada dokumen</p>
            ) : (
              <div className="space-y-3">
                {request.filled_requirements.map((filled) => (
                  <div key={filled.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium">{filled.requirement.name}</p>
                      {filled.value && (
                        <p className="text-sm text-muted-foreground">{filled.value}</p>
                      )}
                    </div>
                    {filled.file_url && (
                      <a 
                        href={filled.file_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Lihat File
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rejection Reason */}
          {request.rejection_reason && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h2 className="font-semibold text-red-700 mb-2">Alasan Penolakan</h2>
              <p className="text-red-600">{request.rejection_reason}</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Actions */}
          {availableActions && availableActions.next.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
              <h2 className="font-semibold mb-4">Aksi</h2>
              <div className="space-y-2">
                {availableActions.next.map((status) => (
                  <button
                    key={status}
                    onClick={() => { setNewStatus(status); setShowModal(true) }}
                    className={`w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                      status === 'REJECTED' 
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {availableActions.labels[status]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
            <h2 className="font-semibold mb-4">Riwayat Status</h2>
            <div className="space-y-4">
              {request.status_history.map((history, index) => (
                <div key={index} className="flex gap-3">
                  <div className={`w-3 h-3 rounded-full mt-1.5 ${getStatusColor(history.status).replace('text-', 'bg-').replace('-700', '-500')}`} />
                  <div className="flex-1">
                    <p className="font-medium text-sm">
                      {SERVICE_REQUEST_STATUS_LABELS[history.status as keyof typeof SERVICE_REQUEST_STATUS_LABELS]}
                    </p>
                    <p className="text-xs text-muted-foreground">{history.changed_by}</p>
                    {history.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{history.notes}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(history.created_at).toLocaleString('id-ID')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
            <h2 className="font-semibold mb-4">Tanggal</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">Diajukan</p>
                <p className="font-medium">{new Date(request.created_at).toLocaleString('id-ID')}</p>
              </div>
              {request.completed_at && (
                <div>
                  <p className="text-muted-foreground">Selesai</p>
                  <p className="font-medium">{new Date(request.completed_at).toLocaleString('id-ID')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status Update Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">
              Update Status ke: {SERVICE_REQUEST_STATUS_LABELS[newStatus as keyof typeof SERVICE_REQUEST_STATUS_LABELS]}
            </h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={newStatus === 'REJECTED' ? 'Alasan penolakan...' : 'Catatan (opsional)...'}
              className="w-full border rounded-lg p-3 mb-4"
              rows={3}
              required={newStatus === 'REJECTED' || newStatus === 'REVISION_NEEDED'}
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowModal(false); setNotes('') }}
                className="flex-1 py-2 border rounded-lg hover:bg-muted/50"
              >
                Batal
              </button>
              <button
                onClick={handleStatusUpdate}
                disabled={updating || ((newStatus === 'REJECTED' || newStatus === 'REVISION_NEEDED') && !notes)}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {updating ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
