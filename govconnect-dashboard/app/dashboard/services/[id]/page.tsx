'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface ServiceCategory {
  id: string
  name: string
}

interface Service {
  id: string
  name: string
  slug: string
  description?: string
  processing_time?: string
  is_active: boolean
  category_id: string
  category: { name: string }
  requirements: Requirement[]
}

interface Requirement {
  id: string
  name: string
  type: 'TEXT' | 'NUMBER' | 'FILE' | 'DATE' | 'SELECT'
  is_required: boolean
  description?: string
  options?: string
  display_order: number
}

export default function ServiceFormPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [isNew, setIsNew] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    processing_time: '',
    is_active: true,
    category_id: ''
  })
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [showRequirementModal, setShowRequirementModal] = useState(false)
  const [editingRequirement, setEditingRequirement] = useState<Requirement | null>(null)
  const [requirementForm, setRequirementForm] = useState<{
    name: string
    type: 'TEXT' | 'NUMBER' | 'FILE' | 'DATE' | 'SELECT'
    is_required: boolean
    description: string
    options: string
    display_order: number
  }>({
    name: '',
    type: 'TEXT',
    is_required: true,
    description: '',
    options: '',
    display_order: 0
  })

  useEffect(() => {
    initPage()
  }, [])

  const initPage = async () => {
    const { id } = await params
    const isNewService = id === 'new'
    setIsNew(isNewService)

    const token = localStorage.getItem('token')
    
    // Fetch categories
    const catRes = await fetch('/api/village/services/categories', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const catData = await catRes.json()
    if (catData.success) {
      setCategories(catData.data)
      if (isNewService && catData.data.length > 0) {
        setForm(f => ({ ...f, category_id: catData.data[0].id }))
      }
    }

    // Fetch service if editing
    if (!isNewService) {
      const serviceRes = await fetch(`/api/village/services/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const serviceData = await serviceRes.json()
      if (serviceData.success) {
        const s = serviceData.data
        setForm({
          name: s.name,
          slug: s.slug,
          description: s.description || '',
          processing_time: s.processing_time || '',
          is_active: s.is_active,
          category_id: s.category_id
        })
        setRequirements(s.requirements || [])
      }
    }

    setLoading(false)
  }

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  const handleNameChange = (name: string) => {
    setForm(f => ({
      ...f,
      name,
      slug: isNew ? generateSlug(name) : f.slug
    }))
  }

  const handleSave = async () => {
    if (!form.name || !form.category_id) {
      alert('Nama dan kategori wajib diisi')
      return
    }

    setSaving(true)
    const token = localStorage.getItem('token')
    const { id } = await params

    const url = isNew ? '/api/village/services' : `/api/village/services/${id}`
    const method = isNew ? 'POST' : 'PUT'

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(form)
    })

    const data = await res.json()
    if (data.success) {
      if (isNew) {
        router.push(`/dashboard/services/${data.data.id}`)
      } else {
        router.push('/dashboard/services')
      }
    } else {
      alert(data.error || 'Gagal menyimpan')
    }
    setSaving(false)
  }

  const handleSaveRequirement = async () => {
    const { id } = await params
    if (isNew) {
      alert('Simpan layanan terlebih dahulu')
      return
    }

    setSaving(true)
    const token = localStorage.getItem('token')

    const url = editingRequirement
      ? `/api/village/services/${id}/requirements/${editingRequirement.id}`
      : `/api/village/services/${id}/requirements`
    const method = editingRequirement ? 'PUT' : 'POST'

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requirementForm)
    })

    const data = await res.json()
    if (data.success) {
      setShowRequirementModal(false)
      resetRequirementForm()
      // Refresh requirements
      const serviceRes = await fetch(`/api/village/services/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const serviceData = await serviceRes.json()
      if (serviceData.success) {
        setRequirements(serviceData.data.requirements || [])
      }
    }
    setSaving(false)
  }

  const handleDeleteRequirement = async (reqId: string) => {
    if (!confirm('Hapus persyaratan ini?')) return
    
    const { id } = await params
    const token = localStorage.getItem('token')
    
    await fetch(`/api/village/services/${id}/requirements/${reqId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })

    setRequirements(requirements.filter(r => r.id !== reqId))
  }

  const resetRequirementForm = () => {
    setEditingRequirement(null)
    setRequirementForm({
      name: '',
      type: 'TEXT',
      is_required: true,
      description: '',
      options: '',
      display_order: requirements.length
    })
  }

  const openEditRequirement = (req: Requirement) => {
    setEditingRequirement(req)
    setRequirementForm({
      name: req.name,
      type: req.type,
      is_required: req.is_required,
      description: req.description || '',
      options: req.options || '',
      display_order: req.display_order
    })
    setShowRequirementModal(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link href="/dashboard/services" className="text-sm text-blue-600 hover:underline mb-2 inline-block">
          ← Kembali
        </Link>
        <h1 className="text-2xl font-bold">{isNew ? 'Tambah Layanan' : 'Edit Layanan'}</h1>
      </div>

      {/* Service Form */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
        <h2 className="font-semibold mb-4">Informasi Layanan</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nama Layanan *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full border rounded-lg p-2"
              placeholder="Contoh: Surat Keterangan Domisili"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Slug (URL)</label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
              className="w-full border rounded-lg p-2 bg-muted/50"
              placeholder="surat-keterangan-domisili"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Kategori *</label>
            <select
              value={form.category_id}
              onChange={(e) => setForm(f => ({ ...f, category_id: e.target.value }))}
              className="w-full border rounded-lg p-2"
            >
              <option value="">Pilih kategori...</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Deskripsi</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border rounded-lg p-2"
              rows={3}
              placeholder="Jelaskan tentang layanan ini..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Estimasi Waktu Proses</label>
            <input
              type="text"
              value={form.processing_time}
              onChange={(e) => setForm(f => ({ ...f, processing_time: e.target.value }))}
              className="w-full border rounded-lg p-2"
              placeholder="Contoh: 1-3 hari kerja"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={form.is_active}
              onChange={(e) => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="rounded"
            />
            <label htmlFor="is_active" className="text-sm">Layanan aktif</label>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>

      {/* Requirements Section */}
      {!isNew && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Persyaratan</h2>
            <button
              onClick={() => { resetRequirementForm(); setShowRequirementModal(true) }}
              className="text-sm text-blue-600 hover:underline"
            >
              + Tambah Persyaratan
            </button>
          </div>

          {requirements.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Belum ada persyaratan</p>
          ) : (
            <div className="space-y-3">
              {requirements
                .sort((a, b) => a.display_order - b.display_order)
                .map((req) => (
                  <div key={req.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground w-6">{req.display_order + 1}.</span>
                      <div>
                        <p className="font-medium">
                          {req.name}
                          {req.is_required && <span className="text-red-500 ml-1">*</span>}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {req.type === 'TEXT' && 'Teks'}
                          {req.type === 'NUMBER' && 'Angka'}
                          {req.type === 'FILE' && 'File Upload'}
                          {req.type === 'DATE' && 'Tanggal'}
                          {req.type === 'SELECT' && 'Pilihan'}
                          {req.description && ` - ${req.description}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditRequirement(req)}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteRequirement(req.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Requirement Modal */}
      {showRequirementModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">
              {editingRequirement ? 'Edit Persyaratan' : 'Tambah Persyaratan'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nama Persyaratan *</label>
                <input
                  type="text"
                  value={requirementForm.name}
                  onChange={(e) => setRequirementForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-lg p-2"
                  placeholder="Contoh: Fotokopi KTP"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tipe Input</label>
                <select
                  value={requirementForm.type}
                  onChange={(e) => setRequirementForm(f => ({ ...f, type: e.target.value as any }))}
                  className="w-full border rounded-lg p-2"
                >
                  <option value="TEXT">Teks</option>
                  <option value="NUMBER">Angka</option>
                  <option value="FILE">File Upload</option>
                  <option value="DATE">Tanggal</option>
                  <option value="SELECT">Pilihan</option>
                </select>
              </div>
              {requirementForm.type === 'SELECT' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Opsi (pisahkan dengan koma)</label>
                  <input
                    type="text"
                    value={requirementForm.options}
                    onChange={(e) => setRequirementForm(f => ({ ...f, options: e.target.value }))}
                    className="w-full border rounded-lg p-2"
                    placeholder="Opsi 1, Opsi 2, Opsi 3"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Keterangan</label>
                <input
                  type="text"
                  value={requirementForm.description}
                  onChange={(e) => setRequirementForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border rounded-lg p-2"
                  placeholder="Contoh: Scan atau foto jelas"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Urutan</label>
                <input
                  type="number"
                  value={requirementForm.display_order}
                  onChange={(e) => setRequirementForm(f => ({ ...f, display_order: parseInt(e.target.value) || 0 }))}
                  className="w-full border rounded-lg p-2"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_required"
                  checked={requirementForm.is_required}
                  onChange={(e) => setRequirementForm(f => ({ ...f, is_required: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="is_required" className="text-sm">Wajib diisi</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowRequirementModal(false); resetRequirementForm() }}
                className="flex-1 py-2 border rounded-lg hover:bg-muted/50"
              >
                Batal
              </button>
              <button
                onClick={handleSaveRequirement}
                disabled={saving || !requirementForm.name}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
