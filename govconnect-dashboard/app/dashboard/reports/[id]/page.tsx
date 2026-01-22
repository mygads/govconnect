'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { REPORT_STATUS_LABELS } from '@/lib/types'

interface Report {
  id: string
  ticket_number: string
  reporter_name: string
  reporter_phone: string
  reporter_email?: string
  title: string
  description: string
  location?: string
  photo_url?: string
  status: string
  is_anonymous: boolean
  created_at: string
  resolved_at?: string
  type: { name: string }
  category: { name: string }
  responses: {
    id: string
    message: string
    is_internal: boolean
    attachment_url?: string
    responder: { name: string }
    created_at: string
  }[]
}

const STATUS_ACTIONS: Record<string, { next: string[]; labels: Record<string, string> }> = {
  SUBMITTED: { 
    next: ['REVIEWING', 'REJECTED'],
    labels: { REVIEWING: 'Mulai Review', REJECTED: 'Tolak' }
  },
  REVIEWING: { 
    next: ['IN_PROGRESS', 'REJECTED'],
    labels: { IN_PROGRESS: 'Proses', REJECTED: 'Tolak' }
  },
  IN_PROGRESS: { 
    next: ['RESOLVED'],
    labels: { RESOLVED: 'Selesaikan' }
  },
  RESOLVED: { 
    next: ['CLOSED'],
    labels: { CLOSED: 'Tutup' }
  }
}

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [showResponseModal, setShowResponseModal] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [statusNotes, setStatusNotes] = useState('')
  const [responseMessage, setResponseMessage] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchReport()
  }, [])

  const fetchReport = async () => {
    const { id } = await params
    const token = localStorage.getItem('token')
    const res = await fetch(`/api/village/reports/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    if (data.success) setReport(data.data)
    setLoading(false)
  }

  const handleStatusUpdate = async () => {
    if (!newStatus) return
    setSaving(true)
    const { id } = await params
    const token = localStorage.getItem('token')
    
    const res = await fetch(`/api/village/reports/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    })
    
    if ((await res.json()).success) {
      // Add response if notes provided
      if (statusNotes) {
        await fetch(`/api/village/reports/${id}/responses`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: statusNotes, is_internal: false })
        })
      }
      setShowStatusModal(false)
      setStatusNotes('')
      fetchReport()
    }
    setSaving(false)
  }

  const handleAddResponse = async () => {
    if (!responseMessage) return
    setSaving(true)
    const { id } = await params
    const token = localStorage.getItem('token')
    
    const res = await fetch(`/api/village/reports/${id}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: responseMessage, is_internal: isInternal })
    })
    
    if ((await res.json()).success) {
      setShowResponseModal(false)
      setResponseMessage('')
      setIsInternal(false)
      fetchReport()
    }
    setSaving(false)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SUBMITTED': return 'bg-yellow-100 text-yellow-700'
      case 'REVIEWING': return 'bg-blue-100 text-blue-700'
      case 'IN_PROGRESS': return 'bg-indigo-100 text-indigo-700'
      case 'RESOLVED': return 'bg-green-100 text-green-700'
      case 'CLOSED': return 'bg-gray-100 text-gray-700'
      case 'REJECTED': return 'bg-red-100 text-red-700'
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

  if (!report) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Pengaduan tidak ditemukan</p>
        <Link href="/dashboard/reports" className="text-blue-600 hover:underline mt-2 inline-block">Kembali</Link>
      </div>
    )
  }

  const availableActions = STATUS_ACTIONS[report.status]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/reports" className="text-sm text-blue-600 hover:underline mb-2 inline-block">← Kembali</Link>
          <h1 className="text-2xl font-bold">Detail Pengaduan</h1>
          <p className="text-muted-foreground">Tiket: {report.ticket_number}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(report.status)}`}>
          {REPORT_STATUS_LABELS[report.status as keyof typeof REPORT_STATUS_LABELS]}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Report Details */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
            <h2 className="font-semibold mb-4">{report.title}</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Deskripsi</p>
                <p className="whitespace-pre-wrap">{report.description}</p>
              </div>
              {report.location && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Lokasi</p>
                  <p>📍 {report.location}</p>
                </div>
              )}
              {report.photo_url && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Foto</p>
                  <img src={report.photo_url} alt="Bukti" className="max-w-sm rounded-lg border" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <p className="text-sm text-muted-foreground">Kategori</p>
                  <p className="font-medium">{report.category.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Jenis</p>
                  <p className="font-medium">{report.type.name}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Reporter Info */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
            <h2 className="font-semibold mb-4">Data Pelapor</h2>
            {report.is_anonymous ? (
              <p className="text-muted-foreground italic">Pelapor memilih untuk anonim</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Nama</p>
                  <p className="font-medium">{report.reporter_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">No. WhatsApp</p>
                  <p className="font-medium">{report.reporter_phone}</p>
                </div>
                {report.reporter_email && (
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p className="font-medium">{report.reporter_email}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Responses */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Tanggapan</h2>
              <button
                onClick={() => setShowResponseModal(true)}
                className="text-sm text-blue-600 hover:underline"
              >
                + Tambah Tanggapan
              </button>
            </div>

            {report.responses.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">Belum ada tanggapan</p>
            ) : (
              <div className="space-y-4">
                {report.responses.map((response) => (
                  <div 
                    key={response.id} 
                    className={`p-4 rounded-lg ${response.is_internal ? 'bg-yellow-50 border-yellow-200 border' : 'bg-muted/50'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{response.responder.name}</span>
                        {response.is_internal && (
                          <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded">Internal</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(response.created_at).toLocaleString('id-ID')}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{response.message}</p>
                    {response.attachment_url && (
                      <a href={response.attachment_url} target="_blank" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
                        📎 Lampiran
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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
                    onClick={() => { setNewStatus(status); setShowStatusModal(true) }}
                    className={`w-full py-2 px-4 rounded-lg text-sm font-medium ${
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

          {/* Dates */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
            <h2 className="font-semibold mb-4">Tanggal</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">Dilaporkan</p>
                <p className="font-medium">{new Date(report.created_at).toLocaleString('id-ID')}</p>
              </div>
              {report.resolved_at && (
                <div>
                  <p className="text-muted-foreground">Diselesaikan</p>
                  <p className="font-medium">{new Date(report.resolved_at).toLocaleString('id-ID')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status Update Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">
              Update Status: {REPORT_STATUS_LABELS[newStatus as keyof typeof REPORT_STATUS_LABELS]}
            </h3>
            <textarea
              value={statusNotes}
              onChange={(e) => setStatusNotes(e.target.value)}
              placeholder="Catatan untuk pelapor (opsional)..."
              className="w-full border rounded-lg p-3 mb-4"
              rows={3}
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowStatusModal(false); setStatusNotes('') }} className="flex-1 py-2 border rounded-lg">Batal</button>
              <button onClick={handleStatusUpdate} disabled={saving} className="flex-1 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Response Modal */}
      {showResponseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">Tambah Tanggapan</h3>
            <textarea
              value={responseMessage}
              onChange={(e) => setResponseMessage(e.target.value)}
              placeholder="Tulis tanggapan..."
              className="w-full border rounded-lg p-3 mb-4"
              rows={4}
            />
            <div className="flex items-center gap-2 mb-4">
              <input
                type="checkbox"
                id="is_internal"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
              />
              <label htmlFor="is_internal" className="text-sm">
                Catatan internal (tidak terlihat pelapor)
              </label>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowResponseModal(false); setResponseMessage('') }} className="flex-1 py-2 border rounded-lg">Batal</button>
              <button onClick={handleAddResponse} disabled={saving || !responseMessage} className="flex-1 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Kirim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
