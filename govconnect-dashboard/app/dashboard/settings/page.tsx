"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useAuth } from "@/components/auth/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { User, Lock, Save } from "lucide-react"

export default function SettingsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)

  const formatRoleLabel = (role?: string | null) => {
    if (!role) return 'Admin'
    const normalized = role.toLowerCase()
    const map: Record<string, string> = {
      superadmin: 'Super Admin',
      super_admin: 'Super Admin',
      village_admin: 'Admin Desa',
      admin: 'Admin',
    }
    if (map[normalized]) return map[normalized]
    return normalized
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  const [profile, setProfile] = useState({
    name: user?.name || '',
    username: user?.username || '',
  })

  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          name: profile.name,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Gagal memperbarui profil')
      }

      toast({
        title: "Berhasil",
        description: "Profil berhasil diperbarui",
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal memperbarui profil",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()

    if (passwords.newPassword !== passwords.confirmPassword) {
      toast({
        title: "Gagal",
        description: "Konfirmasi password tidak sesuai",
        variant: "destructive",
      })
      return
    }

    if (passwords.newPassword.length < 8) {
      toast({
        title: "Gagal",
        description: "Password minimal 8 karakter",
        variant: "destructive",
      })
      return
    }

    setPasswordLoading(true)

    try {
      const response = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Gagal mengganti password')
      }

      toast({
        title: "Berhasil",
        description: "Password berhasil diperbarui",
      })

      setPasswords({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
    } catch (error: any) {
      toast({
        title: "Gagal",
        description: error.message || "Gagal mengganti password",
        variant: "destructive",
      })
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Akun Admin</h1>
        <p className="text-muted-foreground mt-2">Kelola profil dan keamanan akun admin desa.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Informasi Profil
            </CardTitle>
            <CardDescription>Perbarui informasi profil admin.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProfileUpdate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  value={profile.username}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">Username tidak bisa diubah.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Nama Lengkap</Label>
                <Input
                  id="name"
                  type="text"
                  value={profile.name}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Peran</Label>
                <Input
                  id="role"
                  type="text"
                  value={formatRoleLabel(user?.role)}
                  disabled
                  className="bg-muted"
                />
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                <Save className="h-4 w-4 mr-2" />
                {loading ? 'Menyimpan...' : 'Simpan Perubahan'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Password Change */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Ubah Password
            </CardTitle>
            <CardDescription>Perbarui password untuk menjaga keamanan akun.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Password Saat Ini</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={passwords.currentPassword}
                  onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
                  required
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="newPassword">Password Baru</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={passwords.newPassword}
                  onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                  required
                  minLength={8}
                />
                <p className="text-xs text-muted-foreground">Minimal 8 karakter</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Konfirmasi Password Baru</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={passwords.confirmPassword}
                  onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })}
                  required
                  minLength={8}
                />
              </div>

              <Button type="submit" disabled={passwordLoading} className="w-full">
                <Lock className="h-4 w-4 mr-2" />
                {passwordLoading ? 'Mengubah...' : 'Ubah Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
