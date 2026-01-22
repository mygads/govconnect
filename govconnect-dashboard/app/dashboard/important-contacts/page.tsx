"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Phone, PlusCircle } from "lucide-react"

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
      <div>
        <h1 className="text-3xl font-bold text-foreground">Nomor Penting</h1>
        <p className="text-muted-foreground mt-2">Kelola daftar kontak darurat dan nomor penting untuk kebutuhan pengaduan.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlusCircle className="h-5 w-5" />
              Tambah Kategori
            </CardTitle>
            <CardDescription>Kelompokkan nomor penting berdasarkan kategori.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="category-name">Nama Kategori</Label>
            <Input
              id="category-name"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Polisi, Damkar, Ambulans"
            />
            <Button onClick={handleAddCategory}>Simpan Kategori</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Tambah Nomor Penting
            </CardTitle>
            <CardDescription>Data kontak yang akan muncul untuk laporan urgent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Kategori</Label>
              <Select
                value={newContact.category_id}
                onValueChange={(value) => setNewContact((prev) => ({ ...prev, category_id: value }))}
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
            <Button onClick={handleAddContact} disabled={!newContact.category_id}>
              Simpan Nomor
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Nomor Penting</CardTitle>
          <CardDescription>Semua kontak darurat yang sudah disimpan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada nomor penting.</p>
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div key={contact.id} className="border rounded-lg p-4 flex flex-col gap-1">
                  <div className="text-sm font-semibold text-foreground">{contact.name}</div>
                  <div className="text-xs text-muted-foreground">Kategori: {contact.category?.name || "-"}</div>
                  <div className="text-sm">{contact.phone}</div>
                  {contact.description && (
                    <p className="text-xs text-muted-foreground">{contact.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
