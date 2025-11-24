# PHASE 5: DASHBOARD (Next.js 14)

**Duration**: 10-12 jam  
**Complexity**: ⭐⭐⭐ Hard  
**Prerequisites**: Phase 0, 3 completed  
**Reference**: `clivy-app` (UI components, auth pattern)

---

## 🎯 OBJECTIVES

- Setup Next.js 14 dengan App Router
- Copy UI components dari clivy-app (login, sidebar, header)
- Implement admin authentication (JWT)
- Create pages: Login, Dashboard, Laporan, Tiket, Statistik
- Connect to Service 3 (Case Service) API
- Setup database `gc_dashboard_db` untuk admin management

---

## 📋 CHECKLIST

### 1. Project Setup
- [ ] Create folder: `govconnect-dashboard/`
- [ ] Initialize Next.js: `pnpm create next-app@latest --typescript --tailwind --app`
- [ ] Install: Prisma, shadcn/ui, axios, jose (JWT), chart.js, date-fns
- [ ] Copy components dari `clivy-app/src/components/ui/` (shadcn)
- [ ] Setup folder structure

### 2. Database Schema (Prisma)
- [ ] Model `AdminUser`:
  - [ ] username, password_hash, name, role (admin|superadmin)
  - [ ] is_active, created_at
- [ ] Model `AdminSession`:
  - [ ] admin_id, token, expires_at, created_at
- [ ] Model `ActivityLog`:
  - [ ] admin_id, action, resource, details, ip_address, timestamp
- [ ] Run migration
- [ ] Seed default admin (username: admin, password: admin123)

### 3. Authentication
- [ ] **Auth Utility** (`src/lib/auth.ts`):
  - [ ] `generateToken()` - create JWT
  - [ ] `verifyToken()` - validate JWT
  - [ ] `hashPassword()` - bcrypt
  - [ ] `comparePassword()`
- [ ] **Middleware** (`src/middleware.ts`):
  - [ ] Protect dashboard routes
  - [ ] Redirect to login if not authenticated
- [ ] **Login API** (`src/app/api/auth/login/route.ts`):
  - [ ] POST /api/auth/login
  - [ ] Verify credentials
  - [ ] Return JWT token
- [ ] **Logout API** (`src/app/api/auth/logout/route.ts`):
  - [ ] Clear session

### 4. App Structure (App Router)
- [ ] `src/app/(auth)/login/page.tsx` - Login page
- [ ] `src/app/(dashboard)/layout.tsx` - Dashboard layout (sidebar + header)
- [ ] `src/app/(dashboard)/page.tsx` - Overview dashboard
- [ ] `src/app/(dashboard)/laporan/page.tsx` - List laporan
- [ ] `src/app/(dashboard)/laporan/[id]/page.tsx` - Detail laporan
- [ ] `src/app/(dashboard)/tiket/page.tsx` - List tiket
- [ ] `src/app/(dashboard)/tiket/[id]/page.tsx` - Detail tiket
- [ ] `src/app/(dashboard)/statistik/page.tsx` - Statistics & charts

### 5. UI Components (Copy dari clivy-app)
- [ ] Copy `clivy-app/src/components/ui/` folder lengkap
- [ ] **Dashboard Components**:
  - [ ] `DashboardHeader.tsx` - top navbar dengan user menu
  - [ ] `DashboardSidebar.tsx` - side navigation
  - [ ] `StatsCard.tsx` - card untuk statistics
  - [ ] `ComplaintCard.tsx` - card untuk display laporan
  - [ ] `TicketCard.tsx` - card untuk display tiket
  - [ ] `StatusBadge.tsx` - badge untuk status
  - [ ] `UpdateStatusDialog.tsx` - modal untuk update status

### 6. API Client
- [ ] **Case Service Client** (`src/lib/api-client.ts`):
  - [ ] `fetchComplaints()` - GET /laporan
  - [ ] `fetchComplaintById()` - GET /laporan/:id
  - [ ] `updateComplaintStatus()` - PATCH /laporan/:id/status
  - [ ] `fetchTickets()` - GET /tiket
  - [ ] `fetchTicketById()` - GET /tiket/:id
  - [ ] `updateTicketStatus()` - PATCH /tiket/:id/status
  - [ ] `fetchStatistics()` - GET /statistics/overview
- [ ] Add internal API key header

### 7. Dashboard Pages Implementation
- [ ] **Overview Page**:
  - [ ] Total laporan (baru, proses, selesai)
  - [ ] Total tiket
  - [ ] Chart: laporan per kategori
  - [ ] Recent activity
- [ ] **Laporan Page**:
  - [ ] Table with filters (status, kategori)
  - [ ] Pagination
  - [ ] Search by ID atau alamat
  - [ ] Click to detail
- [ ] **Laporan Detail Page**:
  - [ ] Display full info
  - [ ] Update status button
  - [ ] Add admin notes
  - [ ] Show history
- [ ] **Tiket Page & Detail**: Similar to laporan
- [ ] **Statistik Page**:
  - [ ] Bar chart: laporan per kategori
  - [ ] Pie chart: status distribution
  - [ ] Table: top RT/RW

### 8. State Management
- [ ] Use React Context untuk auth state
- [ ] Use React Query (TanStack Query) untuk data fetching & caching

### 9. Testing
- [ ] Test login flow
- [ ] Test CRUD operations
- [ ] Test filters & pagination
- [ ] Test update status

### 10. Documentation
- [ ] README with setup guide
- [ ] `.env.example`
- [ ] Screenshots

---

## 💾 DATABASE SCHEMA

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model AdminUser {
  id            String   @id @default(cuid())
  username      String   @unique
  password_hash String
  name          String
  role          String   @default("admin") // admin|superadmin
  is_active     Boolean  @default(true)
  created_at    DateTime @default(now())
  
  sessions      AdminSession[]
  activityLogs  ActivityLog[]
  
  @@map("admin_users")
}

model AdminSession {
  id         String   @id @default(cuid())
  admin_id   String
  token      String   @unique
  expires_at DateTime
  created_at DateTime @default(now())
  
  admin      AdminUser @relation(fields: [admin_id], references: [id])
  
  @@index([admin_id])
  @@index([expires_at])
  @@map("admin_sessions")
}

model ActivityLog {
  id         String   @id @default(cuid())
  admin_id   String
  action     String   // update_status|login|view_complaint|view_ticket
  resource   String   // complaint:LAP-001|ticket:TIK-001
  details    Json?
  ip_address String?
  timestamp  DateTime @default(now())
  
  admin      AdminUser @relation(fields: [admin_id], references: [id])
  
  @@index([admin_id])
  @@index([timestamp])
  @@map("activity_logs")
}
```

---

## 🔧 CORE IMPLEMENTATION

### Auth Utility

`src/lib/auth.ts`:

```typescript
import * as jose from 'jose';
import bcrypt from 'bcryptjs';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'govconnect_secret_2025'
);

export async function generateToken(adminId: string, role: string) {
  const token = await new jose.SignJWT({ adminId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
  
  return token;
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);
    return payload;
  } catch (error) {
    return null;
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
```

---

### Login Page

`src/app/(auth)/login/page.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      // Store token
      localStorage.setItem('token', data.token);
      
      // Redirect to dashboard
      router.push('/');
    } catch (error) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">
            GovConnect Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium mb-1">
                Username
              </label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">
                Password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Loading...' : 'Login'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

### API Client

`src/lib/api-client.ts`:

```typescript
import axios from 'axios';

const CASE_SERVICE_URL = process.env.NEXT_PUBLIC_CASE_SERVICE_URL || 'http://localhost:3003';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

const apiClient = axios.create({
  baseURL: CASE_SERVICE_URL,
  headers: {
    'x-internal-api-key': INTERNAL_API_KEY,
  },
  timeout: 10000,
});

export async function fetchComplaints(filters?: {
  status?: string;
  kategori?: string;
  limit?: number;
  offset?: number;
}) {
  const response = await apiClient.get('/laporan', { params: filters });
  return response.data;
}

export async function fetchComplaintById(id: string) {
  const response = await apiClient.get(`/laporan/${id}`);
  return response.data;
}

export async function updateComplaintStatus(
  id: string,
  status: string,
  admin_notes?: string
) {
  const response = await apiClient.patch(`/laporan/${id}/status`, {
    status,
    admin_notes,
  });
  return response.data;
}

// Similar functions for tickets...
```

---

### Dashboard Layout (with Sidebar)

`src/app/(dashboard)/layout.tsx`:

```typescript
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { DashboardHeader } from '@/components/dashboard/header';

export default function DashboardLayout({
  children,
}: {
  children: React.Node;
}) {
  return (
    <div className="flex h-screen">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  );
}
```

---

## 🚀 RUNNING THE DASHBOARD

```bash
pnpm install
pnpm prisma migrate dev
pnpm prisma db seed  # Create default admin
pnpm dev
```

**Environment Variables** (`.env.local`):
```bash
DATABASE_URL=postgresql://postgres:postgres_secret_2025@localhost:5435/gc_dashboard_db
JWT_SECRET=govconnect_jwt_secret_2025_change_in_production
INTERNAL_API_KEY=govconnect_internal_secret_key_2025_change_in_production
NEXT_PUBLIC_CASE_SERVICE_URL=http://localhost:3003
```

**Default Admin**:
- Username: `admin`
- Password: `admin123`

---

## ✅ COMPLETION CRITERIA

- [x] Login working dengan JWT
- [x] Dashboard overview showing stats
- [x] Laporan list & detail working
- [x] Update status working
- [x] Tiket list & detail working
- [x] Statistics page with charts
- [x] UI responsive & clean

---

## 🚀 NEXT STEPS

→ Go to **[Phase 6: Integration & Testing](./PHASE_6_INTEGRATION.md)**

---

**Phase 5 Status**: 🔴 Not Started  
**Last Updated**: November 24, 2025
