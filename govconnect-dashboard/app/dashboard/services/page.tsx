'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface ServiceCategory {
  id: string
  name: string
  description?: string
  icon?: string
  display_order: number
  _count?: { services: number }
}

interface Service {
  id: string
  name: string
  slug: string
  description?: string
  processing_time?: string
  is_active: boolean
  category: { name: string }
  _count?: { requirements: number }
}

export default function ServicesPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'services' | 'categories'>('services')
  const [services, setServices] = useState<Service[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', icon: '', display_order: 0 })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    const token = localStorage.getItem('token')
    
    const [servicesRes, categoriesRes] = await Promise.all([
      fetch('/api/village/services', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/village/services/categories', { headers: { Authorization: `Bearer ${token}` } })
    ])

    const [servicesData, categoriesData] = await Promise.all([
      servicesRes.json(),
      categoriesRes.json()
    ])

    if (servicesData.success) setServices(servicesData.data)
    if (categoriesData.success) setCategories(categoriesData.data)
    setLoading(false)
  }

  const handleSaveCategory = async () => {
    setSaving(true)
    const token = localStorage.getItem('token')
    
    const url = editingCategory 
      ? `/api/village/services/categories/${editingCategory.id}`
      : '/api/village/services/categories'
    
    const res = await fetch(url, {
      method: editingCategory ? 'PUT' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(categoryForm)
    })

    const data = await res.json()
    if (data.success) {
      setShowCategoryModal(false)
      resetCategoryForm()
      fetchData()
    }
    setSaving(false)
  }

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Hapus kategori ini?')) return
    
    const token = localStorage.getItem('token')
    await fetch(`/api/village/services/categories/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    fetchData()
  }

  const handleToggleService = async (id: string, isActive: boolean) => {
    const token = localStorage.getItem('token')
    await fetch(`/api/village/services/${id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ is_active: !isActive })
    })
    fetchData()
  }

  const handleDeleteService = async (id: string) => {
    if (!confirm('Hapus layanan ini?')) return
    
    const token = localStorage.getItem('token')
    await fetch(`/api/village/services/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    fetchData()
  }

  const resetCategoryForm = () => {
    setEditingCategory(null)
    setCategoryForm({ name: '', description: '', icon: '', display_order: 0 })
  }

  const openEditCategory = (category: ServiceCategory) => {
    setEditingCategory(category)
    setCategoryForm({
      name: category.name,
      description: category.description || '',
      icon: category.icon || '',
      display_order: category.display_order
    })
    setShowCategoryModal(true)
  }

  if (loading) {
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
          <h1 className="text-2xl font-bold">Layanan</h1>
          <p className="text-muted-foreground">Kelola layanan desa/kelurahan</p>
        </div>
        <Link 
          href="/dashboard/services/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Tambah Layanan
        </Link>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('services')}
            className={`pb-3 px-1 font-medium transition-colors border-b-2 ${
              activeTab === 'services' 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Daftar Layanan ({services.length})
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`pb-3 px-1 font-medium transition-colors border-b-2 ${
              activeTab === 'categories' 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Kategori ({categories.length})
          </button>
        </div>
      </div>

      {/* Services Tab */}
      {activeTab === 'services' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border overflow-hidden">
          {services.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">Belum ada layanan</p>
              <Link href="/dashboard/services/new" className="text-blue-600 hover:underline">
                Tambah layanan pertama
              </Link>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-4 font-medium">Nama Layanan</th>
                  <th className="text-left p-4 font-medium">Kategori</th>
                  <th className="text-left p-4 font-medium">Waktu Proses</th>
                  <th className="text-left p-4 font-medium">Persyaratan</th>
                  <th className="text-center p-4 font-medium">Status</th>
                  <th className="text-right p-4 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {services.map((service) => (
                  <tr key={service.id} className="hover:bg-muted/30">
                    <td className="p-4">
                      <div>
                        <p className="font-medium">{service.name}</p>
                        {service.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1">{service.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-muted-foreground">{service.category.name}</td>
                    <td className="p-4 text-muted-foreground">{service.processing_time || '-'}</td>
                    <td className="p-4 text-muted-foreground">{service._count?.requirements || 0} item</td>
                    <td className="p-4 text-center">
                      <button
                        onClick={() => handleToggleService(service.id, service.is_active)}
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          service.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {service.is_active ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </td>
                    <td className="p-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/dashboard/services/${service.id}`}
                          className="text-blue-600 hover:underline text-sm"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleDeleteService(service.id)}
                          className="text-red-600 hover:underline text-sm"
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowCategoryModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Tambah Kategori
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <div key={category.id} className="bg-white dark:bg-gray-800 rounded-lg border p-6">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {category.icon && <span className="text-2xl">{category.icon}</span>}
                    <div>
                      <h3 className="font-semibold">{category.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {category._count?.services || 0} layanan
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">#{category.display_order}</span>
                </div>
                {category.description && (
                  <p className="text-sm text-muted-foreground mb-4">{category.description}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => openEditCategory(category)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(category.id)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>

          {categories.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Belum ada kategori</p>
            </div>
          )}
        </>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">
              {editingCategory ? 'Edit Kategori' : 'Tambah Kategori'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nama Kategori *</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-lg p-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Deskripsi</label>
                <textarea
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full border rounded-lg p-2"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Icon (emoji)</label>
                  <input
                    type="text"
                    value={categoryForm.icon}
                    onChange={(e) => setCategoryForm(f => ({ ...f, icon: e.target.value }))}
                    className="w-full border rounded-lg p-2"
                    placeholder="📝"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Urutan</label>
                  <input
                    type="number"
                    value={categoryForm.display_order}
                    onChange={(e) => setCategoryForm(f => ({ ...f, display_order: parseInt(e.target.value) || 0 }))}
                    className="w-full border rounded-lg p-2"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowCategoryModal(false); resetCategoryForm() }}
                className="flex-1 py-2 border rounded-lg hover:bg-muted/50"
              >
                Batal
              </button>
              <button
                onClick={handleSaveCategory}
                disabled={saving || !categoryForm.name}
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
