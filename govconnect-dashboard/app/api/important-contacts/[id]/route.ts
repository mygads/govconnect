import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })
  if (!session || session.expires_at < new Date()) return null
  return session
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { id } = await context.params
  
  const contact = await prisma.important_contacts.findUnique({
    where: { id },
    include: { category: true }
  })
  
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  
  // Verify the contact belongs to the admin's village
  if (contact.category.village_id !== session.admin.village_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  
  return NextResponse.json({ data: contact })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { id } = await context.params
  
  // Check if contact exists and belongs to admin's village
  const existingContact = await prisma.important_contacts.findUnique({
    where: { id },
    include: { category: true }
  })
  
  if (!existingContact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  
  if (existingContact.category.village_id !== session.admin.village_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  
  const body = await request.json()
  const { category_id, name, phone, description } = body
  
  if (!name || !phone) {
    return NextResponse.json({ error: 'name and phone are required' }, { status: 400 })
  }
  
  // If category_id is changed, verify the new category belongs to the same village
  if (category_id && category_id !== existingContact.category_id) {
    const newCategory = await prisma.important_contact_categories.findUnique({
      where: { id: category_id }
    })
    
    if (!newCategory || newCategory.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }
  }
  
  const contact = await prisma.important_contacts.update({
    where: { id },
    data: {
      category_id: category_id || existingContact.category_id,
      name,
      phone,
      description: description || null,
    },
    include: { category: true }
  })
  
  return NextResponse.json({ data: contact })
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const { id } = await context.params
  
  // Check if contact exists and belongs to admin's village
  const existingContact = await prisma.important_contacts.findUnique({
    where: { id },
    include: { category: true }
  })
  
  if (!existingContact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  
  if (existingContact.category.village_id !== session.admin.village_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  
  await prisma.important_contacts.delete({
    where: { id }
  })
  
  return NextResponse.json({ success: true })
}
