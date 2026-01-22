'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { REPORT_STATUS_LABELS } from '@/lib/types'

interface Report {
  id: string
  ticket_number: string
  reporter_name: string
  reporter_phone: string
  title: string
  description: string
  location?: string
  photo_url?: string
  status: string
  is_anonymous: boolean
  created_at: string
  type: { name: string }
  category: { name: string }
}

interface ReportCategory {
  id: string
  name: string
  description?: string
  icon?: string
}

interface ReportType {
  id: string
  name: string
  description?: string
  category: { name: string }
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<'reports' | 'categories' | 'types'>('reports')
  const [reports, setReports] = useState<Report[]>([])
  const [categories, setCategories] = useState<ReportCategory[]>([])
  const [types, setTypes] = useState<ReportType[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // Category Modal
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ReportCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', icon: '' })

  // Type Modal
  const [showTypeModal, setShowTypeModal] = useState(false)
  const [editingType, setEditingType] = useState<ReportType | null>(null)
  const [typeForm, setTypeForm] = useState({ name: '', description: '', category_id: '' })

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
  }, [statusFilter, page])

  const fetchData = async () => {
    setLoading(true)
    const token = localStorage.getItem('token')

    // Fetch reports
    const params = new URLSearchParams()
    if (statusFilter) params.append('status', statusFilter)
    params.append('page', page.toString())
    params.append('limit', '10')

    const [reportsRes, categoriesRes, typesRes] = await Promise.all([
      fetch(`/api/village/reports?${params}`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/village/reports/categories', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/village/reports/types', { headers: { Authorization: `Bearer ${token}` } })
    ])

    const [reportsData, categoriesData, typesData] = await Promise.all([
      reportsRes.json(),
      categoriesRes.json(),
      typesRes.json()
    ])

    if (reportsData.success) {
      setReports(reportsData.data)
      setTotalPages(Math.ceil(reportsData.pagination.total / 10))
    }
    if (categoriesData.success) setCategories(categoriesData.data)
    if (typesData.success) setTypes(typesData.data)
    
    setLoading(false)
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

  // Category handlers
  const handleSaveCategory = async () => {
    setSaving(true)
    const token = localStorage.getItem('token')
    const url = editingCategory 
      ? `/api/village/reports/categories/${editingCategory.id}`
      : '/api/village/reports/categories'
    
    const res = await fetch(url, {
      method: editingCategory ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(categoryForm)
    })
    
    if ((await res.json()).success) {
      setShowCategoryModal(false)
      setCategoryForm({ name: '', description: '', icon: '' })
      setEditingCategory(null)
      fetchData()
    }
    setSaving(false)
  }

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Hapus kategori ini?')) return
    const token = localStorage.getItem('token')
    await fetch(`/api/village/reports/categories/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    fetchData()
  }

  // Type handlers
  const handleSaveType = async () => {
    setSaving(true)
    const token = localStorage.getItem('token')
    const url = editingType 
      ? `/api/village/reports/types/${editingType.id}`
      : '/api/village/reports/types'
    
    const res = await fetch(url, {
      method: editingType ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(typeForm)
    })
    
    if ((await res.json()).success) {
      setShowTypeModal(false)
      setTypeForm({ name: '', description: '', category_id: '' })
      setEditingType(null)
      fetchData()
    }
    setSaving(false)
  }

  const handleDeleteType = async (id: string) => {
    if (!confirm('Hapus jenis pengaduan ini?')) return
    const token = localStorage.getItem('token')
    await fetch(`/api/village/reports/types/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    fetchData()
  }

  if (loading && reports.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pengaduan & Pelaporan</h1>
          <p className="text-muted-foreground">Kelola pengaduan masyarakat</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('reports')}
            className={`pb-3 px-1 font-medium transition-colors border-b-2 ${
              activeTab === 'reports' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground'
            }`}
          >
            Daftar Pengaduan
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`pb-3 px-1 font-medium transition-colors border-b-2 ${
              activeTab === 'categories' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground'
            }`}
          >
            Kategori
          </button>
          <button
            onClick={() => setActiveTab('types')}
            className={`pb-3 px-1 font-medium transition-colors border-b-2 ${
              activeTab === 'types' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground'
            }`}
          >
            Jenis Pengaduan
          </button>
        </div>
      </div>

      {/* Reports Tab */}
      {activeTab === 'reports' && (
        <>
          <div className="flex gap-3">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="border rounded-lg px-3 py-2"
            >
              <option value="">Semua Status</option>
              {Object.entries(REPORT_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border overflow-hidden">
            {reports.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Tidak ada pengaduan</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-4 font-medium">Tiket</th>
                    <th className="text-left p-4 font-medium">Pelapor</th>
                    <th className="text-left p-4 font-medium">Judul</th>
                    <th className="text-left p-4 font-medium">Jenis</th>
                    <th className="text-center p-4 font-medium">Status</th>
                    <th className="text-left p-4 font-medium">Tanggal</th>
                    <th className="text-right p-4 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reports.map((report) => (
                    <tr key={report.id} className="hover:bg-muted/30">
                      <td className="p-4 font-mono text-sm">{report.ticket_number}</td>
                      <td className="p-4">
                        {report.is_anonymous ? (
                          <span className="text-muted-foreground italic">Anonim</span>
                        ) : (
                          <div>
                            <p className="font-medium">{report.reporter_name}</p>
                            <p className="text-sm text-muted-foreground">{report.reporter_phone}</p>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        <p className="font-medium line-clamp-1">{report.title}</p>
                        {report.location && (
                          <p className="text-sm text-muted-foreground">📍 {report.location}</p>
                        )}
                      </td>
                      <td className="p-4">
                        <p className="text-sm">{report.type.name}</p>
                        <p className="text-xs text-muted-foreground">{report.category.name}</p>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(report.status)}`}>
                          {REPORT_STATUS_LABELS[report.status as keyof typeof REPORT_STATUS_LABELS]}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {new Date(report.created_at).toLocaleDateString('id-ID')}
                      </td>
                      <td className="p-4 text-right">
                        <Link href={`/dashboard/reports/${report.id}`} className="text-blue-600 hover:underline text-sm">
                          Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Prev
              </button>
              <span className="px-3 py-1">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => { setCategoryForm({ name: '', description: '', icon: '' }); setEditingCategory(null); setShowCategoryModal(true) }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + Tambah Kategori
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <div key={cat.id} className="bg-white dark:bg-gray-800 rounded-lg border p-6">
                <div className="flex items-center gap-3 mb-2">
                  {cat.icon && <span className="text-2xl">{cat.icon}</span>}
                  <h3 className="font-semibold">{cat.name}</h3>
                </div>
                {cat.description && <p className="text-sm text-muted-foreground mb-4">{cat.description}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEditingCategory(cat); setCategoryForm({ name: cat.name, description: cat.description || '', icon: cat.icon || '' }); setShowCategoryModal(true) }}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Edit
                  </button>
                  <button onClick={() => handleDeleteCategory(cat.id)} className="text-sm text-red-600 hover:underline">
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Types Tab */}
      {activeTab === 'types' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => { setTypeForm({ name: '', description: '', category_id: categories[0]?.id || '' }); setEditingType(null); setShowTypeModal(true) }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + Tambah Jenis
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-4 font-medium">Nama</th>
                  <th className="text-left p-4 font-medium">Kategori</th>
                  <th className="text-left p-4 font-medium">Deskripsi</th>
                  <th className="text-right p-4 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {types.map((type) => (
                  <tr key={type.id} className="hover:bg-muted/30">
                    <td className="p-4 font-medium">{type.name}</td>
                    <td className="p-4 text-muted-foreground">{type.category.name}</td>
                    <td className="p-4 text-muted-foreground">{type.description || '-'}</td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => { setEditingType(type); setTypeForm({ name: type.name, description: type.description || '', category_id: (type as any).category_id || '' }); setShowTypeModal(true) }}
                        className="text-sm text-blue-600 hover:underline mr-2"
                      >
                        Edit
                      </button>
                      <button onClick={() => handleDeleteType(type.id)} className="text-sm text-red-600 hover:underline">
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">{editingCategory ? 'Edit Kategori' : 'Tambah Kategori'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nama *</label>
                <input type="text" value={categoryForm.name} onChange={(e) => setCategoryForm(f => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Deskripsi</label>
                <textarea value={categoryForm.description} onChange={(e) => setCategoryForm(f => ({ ...f, description: e.target.value }))} className="w-full border rounded-lg p-2" rows={2} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Icon (emoji)</label>
                <input type="text" value={categoryForm.icon} onChange={(e) => setCategoryForm(f => ({ ...f, icon: e.target.value }))} className="w-full border rounded-lg p-2" placeholder="🚨" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCategoryModal(false)} className="flex-1 py-2 border rounded-lg hover:bg-muted/50">Batal</button>
              <button onClick={handleSaveCategory} disabled={saving || !categoryForm.name} className="flex-1 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Type Modal */}
      {showTypeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">{editingType ? 'Edit Jenis' : 'Tambah Jenis'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nama *</label>
                <input type="text" value={typeForm.name} onChange={(e) => setTypeForm(f => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg p-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Kategori *</label>
                <select value={typeForm.category_id} onChange={(e) => setTypeForm(f => ({ ...f, category_id: e.target.value }))} className="w-full border rounded-lg p-2">
                  {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Deskripsi</label>
                <textarea value={typeForm.description} onChange={(e) => setTypeForm(f => ({ ...f, description: e.target.value }))} className="w-full border rounded-lg p-2" rows={2} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowTypeModal(false)} className="flex-1 py-2 border rounded-lg hover:bg-muted/50">Batal</button>
              <button onClick={handleSaveType} disabled={saving || !typeForm.name || !typeForm.category_id} className="flex-1 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
