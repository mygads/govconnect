"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface AdminUser {
  id: string
  username: string
  name: string
  role: string
}

interface AuthContextType {
  user: AdminUser | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

let csrfTokenPromise: Promise<string | null> | null = null

async function getCsrfToken(): Promise<string | null> {
  csrfTokenPromise ??= fetch('/api/csrf', { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => data?.csrfToken || null)
    .catch(() => null)

  return csrfTokenPromise
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
      })
      if (response.ok) {
        const data = await response.json()
        setUser(data.user)
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error('Auth check failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const login = async (username: string, password: string) => {
    const csrfToken = await getCsrfToken()
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Login gagal')
    }

    const data = await response.json()
    setUser(data.user)
    router.push('/dashboard')
  }

  const logout = async () => {
    try {
      const csrfToken = await getCsrfToken()
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
      })
    } finally {
      setUser(null)
      router.push('/login')
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
