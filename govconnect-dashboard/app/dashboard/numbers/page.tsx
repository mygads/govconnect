'use client'

import { useEffect, useState } from 'react'

interface ImportantNumberCategory {
  id: string
  name: string
  description?: string
  icon?: string
  display_order: number
  _count?: { numbers: number }
}

interface ImportantNumber {
  id: string
  name: string
  phone: string
  description?: string
  is_active: boolean
  display_order: number
  category: { id: string; name: string }
}

export default function ImportantNumbersPage() {
  const [activeTab, setActiveTab] = useState<'numbers' | 'categories'>('numbers')
  const [categories, setCategories] = useState<ImportantNumberCategory[]>([])
  const [numbers, setNumbers] = useState<ImportantNumber[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('')

  // Category Modal
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ImportantNumberCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', icon: '', display_order: 0 })

  // Number Modal
  const [showNumberModal, setShowNumberModal] = useState(false)
  const [editingNumber, setEditingNumber] = useState<ImportantNumber | null>(null)
  const [numberForm, setNumberForm] = useState({ name: '', phone: '', description: '', category_id: '', is_active: true, display_order: 0 })

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    const token = localStorage.getItem('token')

    const [categoriesRes, numbersRes] = await Promise.all([
      fetch('/api/village/important-numbers/categories', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/village/important-numbers', { headers: { Authorization: `Bearer ${token}` } })
    ])

    const [categoriesData, numbersData] = await Promise.all([
      categoriesRes.json(),
      numbersRes.json()
    ])

    if (categoriesData.success) setCategories(categoriesData.data)
    if (numbersData.success) setNumbers(numbersData.data)
    setLoading(false)
  }

  // Category handlers
  const handleSaveCategory = async () => {
    setSaving(true)
    const token = localStorage.getItem('token')
    const url = editingCategory 
      ? `/api/village/important-numbers/categories/${editingCategory.id}`
      : '/api/village/important-numbers/categories'
    
    const res = await fetch(url, {
      method: editingCategory ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(categoryForm)
    })
    
    if ((await res.json()).success) {
      setShowCategoryModal(false)
      resetCategoryForm()
      fetchData()
    }
    setSaving(false)
  }

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Hapus kategori ini? Nomor di dalamnya akan terhapus.')) return
    const token = localStorage.getItem('token')
    await fetch(`/api/village/important-numbers/categories/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    fetchData()
  }

  const resetCategoryForm = () => {
    setEditingCategory(null)
    setCategoryForm({ name: '', description: '', icon: '', display_order: categories.length })
  }

  const openEditCategory = (cat: ImportantNumberCategory) => {
    setEditingCategory(cat)
    setCategoryForm({
      name: cat.name,
      description: cat.description || '',
      icon: cat.icon || '',
      display_order: cat.display_order
    })
    setShowCategoryModal(true)
  }

  // Number handlers
  const handleSaveNumber = async () => {
    setSaving(true)
    const token = localStorage.getItem('token')
    const url = editingNumber 
      ? `/api/village/important-numbers/${editingNumber.id}`
      : '/api/village/important-numbers'
    
    const res = await fetch(url, {
      method: editingNumber ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(numberForm)
    })
    
    if ((await res.json()).success) {
      setShowNumberModal(false)
      resetNumberForm()
      fetchData()
    }
    setSaving(false)
  }

  const handleDeleteNumber = async (id: string) => {
    if (!confirm('Hapus nomor ini?')) return
    const token = localStorage.getItem('token')
    await fetch(`/api/village/important-numbers/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    fetchData()
  }

  const handleToggleActive = async (num: ImportantNumber) => {
    const token = localStorage.getItem('token')
    await fetch(`/api/village/important-numbers/${num.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !num.is_active })
    })
    fetchData()
  }

  const resetNumberForm = () => {
    setEditingNumber(null)
    setNumberForm({ name: '', phone: '', description: '', category_id: categories[0]?.id || '', is_active: true, display_order: numbers.length })
  }

  const openEditNumber = (num: ImportantNumber) => {
    setEditingNumber(num)
    setNumberForm({
      name: num.name,
      phone: num.phone,
      description: num.description || '',
      category_id: num.category.id,
      is_active: num.is_active,
      display_order: num.display_order
    })
    setShowNumberModal(true)
  }

  const openNewNumber = () => {
    resetNumberForm()
    setNumberForm(f => ({ ...f, category_id: categories[0]?.id || '' }))
    setShowNumberModal(true)
  }

  // Filtered numbers
  const filteredNumbers = numbers.filter(num => {
    return !categoryFilter || num.category.id === categoryFilter
  })

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
          <h1 className="text-2xl font-bold">Nomor Penting</h1>
          <p className="text-muted-foreground">Kelola daftar nomor penting untuk masyarakat</p>
        </div>
        <button
          onClick={openNewNumber}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Tambah Nomor
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('numbers')}
            className={`pb-3 px-1 font-medium transition-colors border-b-2 ${
              activeTab === 'numbers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground'
            }`}
          >
            Daftar Nomor ({numbers.length})
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`pb-3 px-1 font-medium transition-colors border-b-2 ${
              activeTab === 'categories' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground'
            }`}
          >
            Kategori ({categories.length})
          </button>
        </div>
      </div>

      {/* Numbers Tab */}
      {activeTab === 'numbers' && (
        <>
          <div className="flex gap-3">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border rounded-lg px-3 py-2"
            >
              <option value="">Semua Kategori</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          {filteredNumbers.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border">
              <p className="text-muted-foreground mb-4">Belum ada nomor penting</p>
              <button onClick={openNewNumber} className="text-blue-600 hover:underline">
                Tambah nomor pertama
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg border overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-4 font-medium">Nama</th>
                    <th className="text-left p-4 font-medium">No. Telepon</th>
                    <th className="text-left p-4 font-medium">Kategori</th>
                    <th className="text-left p-4 font-medium">Keterangan</th>
                    <th className="text-center p-4 font-medium">Status</th>
                    <th className="text-right p-4 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredNumbers.map((num) => (
                    <tr key={num.id} className="hover:bg-muted/30">
                      <td className="p-4 font-medium">{num.name}</td>
                      <td className="p-4">
                        <a href={`tel:${num.phone}`} className="text-blue-600 hover:underline">
                          {num.phone}
                        </a>
                      </td>
                      <td className="p-4 text-muted-foreground">{num.category.name}</td>
                      <td className="p-4 text-muted-foreground text-sm">{num.description || '-'}</td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleToggleActive(num)}
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            num.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {num.is_active ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td className="p-4 text-right">
                        <button onClick={() => openEditNumber(num)} className="text-sm text-blue-600 hover:underline mr-2">Edit</button>
                        <button onClick={() => handleDeleteNumber(num.id)} className="text-sm text-red-600 hover:underline">Hapus</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => { resetCategoryForm(); setShowCategoryModal(true) }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + Tambah Kategori
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <div key={cat.id} className="bg-white dark:bg-gray-800 rounded-lg border p-6">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {cat.icon && <span className="text-2xl">{cat.icon}</span>}
                    <div>
                      <h3 className="font-semibold">{cat.name}</h3>
                      <p className="text-sm text-muted-foreground">{cat._count?.numbers || 0} nomor</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">#{cat.display_order}</span>
                </div>
                {cat.description && (
                  <p className="text-sm text-muted-foreground mb-4">{cat.description}</p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => openEditCategory(cat)} className="text-sm text-blue-600 hover:underline">Edit</button>
                  <button onClick={() => handleDeleteCategory(cat.id)} className="text-sm text-red-600 hover:underline">Hapus</button>
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Icon (emoji)</label>
                  <input type="text" value={categoryForm.icon} onChange={(e) => setCategoryForm(f => ({ ...f, icon: e.target.value }))} className="w-full border rounded-lg p-2" placeholder="🚔" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Urutan</label>
                  <input type="number" value={categoryForm.display_order} onChange={(e) => setCategoryForm(f => ({ ...f, display_order: parseInt(e.target.value) || 0 }))} className="w-full border rounded-lg p-2" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCategoryModal(false)} className="flex-1 py-2 border rounded-lg">Batal</button>
              <button onClick={handleSaveCategory} disabled={saving || !categoryForm.name} className="flex-1 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Number Modal */}
      {showNumberModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">{editingNumber ? 'Edit Nomor' : 'Tambah Nomor'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nama *</label>
                <input type="text" value={numberForm.name} onChange={(e) => setNumberForm(f => ({ ...f, name: e.target.value }))} className="w-full border rounded-lg p-2" placeholder="Contoh: Puskesmas Desa Maju" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">No. Telepon *</label>
                <input type="tel" value={numberForm.phone} onChange={(e) => setNumberForm(f => ({ ...f, phone: e.target.value }))} className="w-full border rounded-lg p-2" placeholder="Contoh: 021-12345678" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Kategori *</label>
                <select value={numberForm.category_id} onChange={(e) => setNumberForm(f => ({ ...f, category_id: e.target.value }))} className="w-full border rounded-lg p-2">
                  {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Keterangan</label>
                <textarea value={numberForm.description} onChange={(e) => setNumberForm(f => ({ ...f, description: e.target.value }))} className="w-full border rounded-lg p-2" rows={2} placeholder="Contoh: Buka 24 jam" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Urutan</label>
                  <input type="number" value={numberForm.display_order} onChange={(e) => setNumberForm(f => ({ ...f, display_order: parseInt(e.target.value) || 0 }))} className="w-full border rounded-lg p-2" />
                </div>
                <div className="flex items-center pt-6">
                  <input type="checkbox" id="is_active" checked={numberForm.is_active} onChange={(e) => setNumberForm(f => ({ ...f, is_active: e.target.checked }))} className="mr-2" />
                  <label htmlFor="is_active" className="text-sm">Aktif</label>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowNumberModal(false)} className="flex-1 py-2 border rounded-lg">Batal</button>
              <button onClick={handleSaveNumber} disabled={saving || !numberForm.name || !numberForm.phone || !numberForm.category_id} className="flex-1 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
