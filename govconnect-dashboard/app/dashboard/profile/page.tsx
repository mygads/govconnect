'use client'

import { useEffect, useState } from 'react'

interface VillageProfile {
  id: string
  name: string
  slug: string
  address?: string
  phone?: string
  email?: string
  website?: string
  description?: string
  operating_hours?: string
  logo_url?: string
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<VillageProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    slug: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    description: '',
    operating_hours: '',
    logo_url: ''
  })

  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/village/profile', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    if (data.success) {
      setProfile(data.data)
      setForm({
        name: data.data.name || '',
        slug: data.data.slug || '',
        address: data.data.address || '',
        phone: data.data.phone || '',
        email: data.data.email || '',
        website: data.data.website || '',
        description: data.data.description || '',
        operating_hours: data.data.operating_hours || '',
        logo_url: data.data.logo_url || ''
      })
    }
    setLoading(false)
  }

  const handleSave = async () => {
    setSaving(true)
    const token = localStorage.getItem('token')
    
    const res = await fetch('/api/village/profile', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(form)
    })
    
    const data = await res.json()
    if (data.success) {
      setProfile(data.data)
      alert('Profil berhasil disimpan')
    } else {
      alert(data.error || 'Gagal menyimpan profil')
    }
    setSaving(false)
  }

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Profil Desa/Kelurahan</h1>
        <p className="text-muted-foreground">Kelola informasi desa/kelurahan Anda</p>
      </div>

      {/* Profile Form */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-6 space-y-6">
        {/* Logo Preview */}
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
            {form.logo_url ? (
              <img src={form.logo_url} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl">🏛️</span>
            )}
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">URL Logo</label>
            <input
              type="url"
              value={form.logo_url}
              onChange={(e) => setForm(f => ({ ...f, logo_url: e.target.value }))}
              className="w-full border rounded-lg p-2"
              placeholder="https://..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Masukkan URL gambar logo desa/kelurahan
            </p>
          </div>
        </div>

        <div className="grid gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nama Desa/Kelurahan *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value, slug: generateSlug(e.target.value) }))}
              className="w-full border rounded-lg p-2"
              placeholder="Contoh: Kelurahan Maju Jaya"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Slug (untuk URL)</label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">/form/</span>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                className="flex-1 border rounded-lg p-2"
                placeholder="maju-jaya"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              URL akses form publik: /form/{form.slug || 'nama-desa'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Deskripsi</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border rounded-lg p-2"
              rows={3}
              placeholder="Deskripsi singkat tentang desa/kelurahan..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Alamat</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
              className="w-full border rounded-lg p-2"
              rows={2}
              placeholder="Jl. Raya Maju No. 1, Kecamatan ..."
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">No. Telepon</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border rounded-lg p-2"
                placeholder="021-12345678"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border rounded-lg p-2"
                placeholder="kontak@desa.go.id"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Website</label>
            <input
              type="url"
              value={form.website}
              onChange={(e) => setForm(f => ({ ...f, website: e.target.value }))}
              className="w-full border rounded-lg p-2"
              placeholder="https://desa-maju.go.id"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Jam Operasional</label>
            <input
              type="text"
              value={form.operating_hours}
              onChange={(e) => setForm(f => ({ ...f, operating_hours: e.target.value }))}
              className="w-full border rounded-lg p-2"
              placeholder="Senin - Jumat: 08:00 - 16:00"
            />
          </div>
        </div>

        <div className="pt-4 border-t">
          <button
            onClick={handleSave}
            disabled={saving || !form.name}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>

      {/* Public URL Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Link Publik</h3>
        <p className="text-sm text-blue-700 mb-2">
          Bagikan link berikut kepada masyarakat untuk mengakses layanan desa/kelurahan:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-white px-3 py-2 rounded border text-sm">
            {typeof window !== 'undefined' ? window.location.origin : ''}/form/{form.slug || 'nama-desa'}
          </code>
          <button
            onClick={() => {
              const url = `${window.location.origin}/form/${form.slug}`
              navigator.clipboard.writeText(url)
              alert('Link berhasil disalin!')
            }}
            className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            Salin
          </button>
        </div>
      </div>
    </div>
  )
}
