"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Phone, PlusCircle, X, Pencil, Trash2, AlertTriangle, Folder, FolderOpen } from "lucide-react"

interface ContactCategory {
  id: string
  name: string
}

interface ImportantContact {
  id: string
  name: string
  phone: string
  description?: string | null
  category: ContactCategory
}

interface LinkedComplaintType {
  id: string
  name: string
  category_name: string
}

export default function ImportantContactsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<ContactCategory[]>([])
  const [contacts, setContacts] = useState<ImportantContact[]>([])

  // Add/Edit Category Modal
  const [newCategory, setNewCategory] = useState("")
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ContactCategory | null>(null)

  // Add/Edit Contact Modal
  const [newContact, setNewContact] = useState({
    category_id: "",
    name: "",
    phone: "",
    description: "",
  })
  const [contactModalOpen, setContactModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<ImportantContact | null>(null)

  // Delete Confirmation Dialogs
  const [deleteContactDialogOpen, setDeleteContactDialogOpen] = useState(false)
  const [contactToDelete, setContactToDelete] = useState<ImportantContact | null>(null)
  
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<ContactCategory | null>(null)
  const [linkedComplaintTypes, setLinkedComplaintTypes] = useState<LinkedComplaintType[]>([])
  const [loadingLinkedTypes, setLoadingLinkedTypes] = useState(false)

  // Category management modal
  const [categoryManagementOpen, setCategoryManagementOpen] = useState(false)

  const fetchData = async () => {
    try {
      setLoading(true)
      const [categoryRes, contactRes] = await Promise.all([
        fetch("/api/important-contacts/categories", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }),
        fetch("/api/important-contacts", {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }),
      ])

      if (categoryRes.ok) {
        const data = await categoryRes.json()
        setCategories(data.data || [])
      }

      if (contactRes.ok) {
        const data = await contactRes.json()
        setContacts(data.data || [])
      }
    } catch (error) {
      console.error("Failed to load important contacts:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // ================== CATEGORY HANDLERS ==================

  const handleAddCategory = async () => {
    if (!newCategory.trim()) return

    try {
      const response = await fetch("/api/important-contacts/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ name: newCategory.trim() }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menambahkan kategori")
      }

      setNewCategory("")
      setCategoryModalOpen(false)
      await fetchData()
      toast({
        title: "Kategori ditambahkan",
        description: "Kategori nomor penting berhasil dibuat.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menambahkan kategori",
        variant: "destructive",
      })
    }
  }

  const handleEditCategory = async () => {
    if (!editingCategory || !newCategory.trim()) return

    try {
      const response = await fetch(`/api/important-contacts/categories/${editingCategory.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ name: newCategory.trim() }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal mengubah kategori")
      }

      setNewCategory("")
      setEditingCategory(null)
      setCategoryModalOpen(false)
      await fetchData()
      toast({
        title: "Kategori diperbarui",
        description: "Kategori nomor penting berhasil diubah.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal mengubah kategori",
        variant: "destructive",
      })
    }
  }

  const openEditCategoryModal = (category: ContactCategory) => {
    setEditingCategory(category)
    setNewCategory(category.name)
    setCategoryModalOpen(true)
  }

  const openDeleteCategoryDialog = async (category: ContactCategory) => {
    setCategoryToDelete(category)
    setLoadingLinkedTypes(true)
    setDeleteCategoryDialogOpen(true)

    // Fetch linked complaint types
    try {
      const response = await fetch(`/api/important-contacts/categories/${category.id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })

      if (response.ok) {
        const data = await response.json()
        setLinkedComplaintTypes(data.linkedComplaintTypes || [])
      }
    } catch (error) {
      console.error("Failed to fetch linked types:", error)
    } finally {
      setLoadingLinkedTypes(false)
    }
  }

  const handleDeleteCategory = async () => {
    if (!categoryToDelete) return

    try {
      const response = await fetch(`/api/important-contacts/categories/${categoryToDelete.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menghapus kategori")
      }

      const data = await response.json()
      
      setDeleteCategoryDialogOpen(false)
      setCategoryToDelete(null)
      setLinkedComplaintTypes([])
      await fetchData()
      
      let description = "Kategori dan semua nomor penting di dalamnya berhasil dihapus."
      if (data.linkedTypesCleared > 0) {
        description += ` ${data.linkedTypesCleared} jenis pengaduan telah dinonaktifkan pengiriman nomor pentingnya.`
      }
      
      toast({
        title: "Kategori dihapus",
        description,
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menghapus kategori",
        variant: "destructive",
      })
    }
  }

  // ================== CONTACT HANDLERS ==================

  const handleAddContact = async () => {
    if (!newContact.category_id || !newContact.name || !newContact.phone) return

    try {
      const response = await fetch("/api/important-contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          category_id: newContact.category_id,
          name: newContact.name,
          phone: newContact.phone,
          description: newContact.description,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menambahkan nomor penting")
      }

      setNewContact({ category_id: "", name: "", phone: "", description: "" })
      setContactModalOpen(false)
      await fetchData()
      toast({
        title: "Nomor penting ditambahkan",
        description: "Data kontak darurat berhasil disimpan.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menambahkan nomor penting",
        variant: "destructive",
      })
    }
  }

  const handleEditContact = async () => {
    if (!editingContact || !newContact.category_id || !newContact.name || !newContact.phone) return

    try {
      const response = await fetch(`/api/important-contacts/${editingContact.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          category_id: newContact.category_id,
          name: newContact.name,
          phone: newContact.phone,
          description: newContact.description,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal mengubah nomor penting")
      }

      setNewContact({ category_id: "", name: "", phone: "", description: "" })
      setEditingContact(null)
      setContactModalOpen(false)
      await fetchData()
      toast({
        title: "Nomor penting diperbarui",
        description: "Data kontak darurat berhasil diubah.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal mengubah nomor penting",
        variant: "destructive",
      })
    }
  }

  const openEditContactModal = (contact: ImportantContact) => {
    setEditingContact(contact)
    setNewContact({
      category_id: contact.category.id,
      name: contact.name,
      phone: contact.phone,
      description: contact.description || "",
    })
    setContactModalOpen(true)
  }

  const openDeleteContactDialog = (contact: ImportantContact) => {
    setContactToDelete(contact)
    setDeleteContactDialogOpen(true)
  }

  const handleDeleteContact = async () => {
    if (!contactToDelete) return

    try {
      const response = await fetch(`/api/important-contacts/${contactToDelete.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Gagal menghapus nomor penting")
      }

      setDeleteContactDialogOpen(false)
      setContactToDelete(null)
      await fetchData()
      toast({
        title: "Nomor penting dihapus",
        description: "Data kontak darurat berhasil dihapus.",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal menghapus nomor penting",
        variant: "destructive",
      })
    }
  }

  // ================== MODAL HANDLERS ==================

  const openAddCategoryModal = () => {
    setEditingCategory(null)
    setNewCategory("")
    setCategoryModalOpen(true)
  }

  const openAddContactModal = () => {
    setEditingContact(null)
    setNewContact({ category_id: "", name: "", phone: "", description: "" })
    setContactModalOpen(true)
  }

  const closeCategoryModal = () => {
    setCategoryModalOpen(false)
    setEditingCategory(null)
    setNewCategory("")
  }

  const closeContactModal = () => {
    setContactModalOpen(false)
    setEditingContact(null)
    setNewContact({ category_id: "", name: "", phone: "", description: "" })
  }

  // Get contacts count per category
  const getContactsCountForCategory = (categoryId: string) => {
    return contacts.filter(c => c.category.id === categoryId).length
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Nomor Penting</h1>
          <p className="text-muted-foreground mt-2">Kelola daftar kontak darurat dan nomor penting untuk kebutuhan pengaduan.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCategoryManagementOpen(true)}>
            <FolderOpen className="h-4 w-4 mr-2" />
            Kelola Kategori
          </Button>
          <Button onClick={openAddContactModal}>
            <Phone className="h-4 w-4 mr-2" />
            Tambah Nomor
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Nomor Penting</CardTitle>
          <CardDescription>Semua kontak darurat yang sudah disimpan.</CardDescription>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada nomor penting.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {contacts.map((contact) => (
                <Card key={contact.id} className="border">
                  <CardContent className="pt-5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">
                          {contact.name}
                        </div>
                        <Badge variant="outline" className="text-xs mt-1">
                          {contact.category?.name || "-"}
                        </Badge>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditContactModal(contact)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => openDeleteContactDialog(contact)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="text-sm font-medium">{contact.phone}</div>
                    {contact.description && (
                      <p className="text-xs text-muted-foreground">{contact.description}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Category Management Modal */}
      <Dialog open={categoryManagementOpen} onOpenChange={setCategoryManagementOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Kelola Kategori</DialogTitle>
            <DialogDescription>Tambah, ubah, atau hapus kategori nomor penting.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button onClick={openAddCategoryModal} className="w-full">
              <PlusCircle className="h-4 w-4 mr-2" />
              Tambah Kategori Baru
            </Button>
            
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Belum ada kategori.</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {categories.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{category.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {getContactsCountForCategory(category.id)} kontak
                      </Badge>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setCategoryManagementOpen(false)
                          openEditCategoryModal(category)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => {
                          setCategoryManagementOpen(false)
                          openDeleteCategoryDialog(category)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryManagementOpen(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Category Modal */}
      <Dialog open={categoryModalOpen} onOpenChange={(open) => !open && closeCategoryModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Edit Kategori" : "Tambah Kategori"}</DialogTitle>
            <DialogDescription>
              {editingCategory 
                ? "Ubah nama kategori nomor penting." 
                : "Kelompokkan nomor penting berdasarkan kategori."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="category-name">Nama Kategori</Label>
              <Input
                id="category-name"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Polisi, Damkar, Ambulans"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCategoryModal}>
              <X className="h-4 w-4 mr-2" />Batal
            </Button>
            <Button 
              onClick={editingCategory ? handleEditCategory : handleAddCategory} 
              disabled={!newCategory.trim()}
            >
              {editingCategory ? "Simpan Perubahan" : "Simpan Kategori"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Contact Modal */}
      <Dialog open={contactModalOpen} onOpenChange={(open) => !open && closeContactModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingContact ? "Edit Nomor Penting" : "Tambah Nomor Penting"}</DialogTitle>
            <DialogDescription>
              {editingContact
                ? "Ubah data kontak darurat."
                : "Data kontak yang akan muncul untuk laporan urgent."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Kategori</Label>
              <Select
                value={newContact.category_id}
                onValueChange={(value: string) => setNewContact((prev) => ({ ...prev, category_id: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categories.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Belum ada kategori. Silakan tambah kategori terlebih dahulu.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Nama Kontak</Label>
              <Input
                value={newContact.name}
                onChange={(e) => setNewContact((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Pak Budi (Damkar)"
              />
            </div>
            <div className="space-y-2">
              <Label>Nomor Telepon</Label>
              <Input
                value={newContact.phone}
                onChange={(e) => setNewContact((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="0812xxxxxxx"
              />
            </div>
            <div className="space-y-2">
              <Label>Catatan (Opsional)</Label>
              <Input
                value={newContact.description}
                onChange={(e) => setNewContact((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Kontak piket 24 jam"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeContactModal}>
              <X className="h-4 w-4 mr-2" />Batal
            </Button>
            <Button 
              onClick={editingContact ? handleEditContact : handleAddContact} 
              disabled={!newContact.category_id || !newContact.name || !newContact.phone}
            >
              {editingContact ? "Simpan Perubahan" : "Simpan Nomor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Contact Confirmation */}
      <AlertDialog open={deleteContactDialogOpen} onOpenChange={setDeleteContactDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Nomor Penting?</AlertDialogTitle>
            <AlertDialogDescription>
              Apakah Anda yakin ingin menghapus kontak <strong>{contactToDelete?.name}</strong> ({contactToDelete?.phone})?
              <br /><br />
              Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setContactToDelete(null)}>Batal</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteContact}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Category Confirmation */}
      <AlertDialog open={deleteCategoryDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setCategoryToDelete(null)
          setLinkedComplaintTypes([])
        }
        setDeleteCategoryDialogOpen(open)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {linkedComplaintTypes.length > 0 && <AlertTriangle className="h-5 w-5 text-yellow-500" />}
              Hapus Kategori?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Apakah Anda yakin ingin menghapus kategori <strong>{categoryToDelete?.name}</strong>?
                </p>
                
                <div className="text-sm text-destructive font-medium">
                  ⚠️ Semua nomor penting dalam kategori ini ({getContactsCountForCategory(categoryToDelete?.id || "")} kontak) akan ikut terhapus!
                </div>

                {loadingLinkedTypes ? (
                  <div className="text-sm text-muted-foreground">Memeriksa jenis pengaduan terkait...</div>
                ) : linkedComplaintTypes.length > 0 ? (
                  <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                      ⚠️ Kategori ini terhubung ke {linkedComplaintTypes.length} jenis pengaduan:
                    </p>
                    <ul className="text-sm text-yellow-700 dark:text-yellow-300 list-disc list-inside">
                      {linkedComplaintTypes.map((type) => (
                        <li key={type.id}>
                          {type.name} {type.category_name && <span className="text-xs">({type.category_name})</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      Pengiriman nomor penting pada jenis pengaduan tersebut akan dinonaktifkan secara otomatis.
                    </p>
                  </div>
                ) : null}

                <p className="text-sm text-muted-foreground">
                  Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteCategory}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={loadingLinkedTypes}
            >
              {linkedComplaintTypes.length > 0 ? "Hapus Tetap" : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
