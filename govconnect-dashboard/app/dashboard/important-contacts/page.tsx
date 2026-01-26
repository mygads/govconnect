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
import { Phone, PlusCircle, X } from "lucide-react"

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

export default function ImportantContactsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<ContactCategory[]>([])
  const [contacts, setContacts] = useState<ImportantContact[]>([])

  const [newCategory, setNewCategory] = useState("")
  const [newContact, setNewContact] = useState({
    category_id: "",
    name: "",
    phone: "",
    description: "",
  })
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [contactModalOpen, setContactModalOpen] = useState(false)

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
          <Button variant="outline" onClick={() => setCategoryModalOpen(true)}>
            <PlusCircle className="h-4 w-4 mr-2" />
            Tambah Kategori
          </Button>
          <Button onClick={() => setContactModalOpen(true)}>
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
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {contact.name}
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {contact.category?.name || "-"}
                      </Badge>
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

      <Dialog open={categoryModalOpen} onOpenChange={setCategoryModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Kategori</DialogTitle>
            <DialogDescription>Kelompokkan nomor penting berdasarkan kategori.</DialogDescription>
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
            <Button variant="outline" onClick={() => setCategoryModalOpen(false)}>
              <X className="h-4 w-4 mr-2" />Tutup
            </Button>
            <Button onClick={handleAddCategory} disabled={!newCategory.trim()}>
              Simpan Kategori
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contactModalOpen} onOpenChange={setContactModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Nomor Penting</DialogTitle>
            <DialogDescription>Data kontak yang akan muncul untuk laporan urgent.</DialogDescription>
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
            <Button variant="outline" onClick={() => setContactModalOpen(false)}>
              <X className="h-4 w-4 mr-2" />Tutup
            </Button>
            <Button onClick={handleAddContact} disabled={!newContact.category_id || !newContact.name || !newContact.phone}>
              Simpan Nomor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
