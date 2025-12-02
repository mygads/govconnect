import axios, { AxiosInstance } from 'axios'

// Use dashboard API routes as proxy to case service
// This works from both client and server side
const API_BASE_URL = typeof window !== 'undefined' 
  ? '/api'  // Client-side: use relative API routes
  : 'http://localhost:3000/api'  // Server-side: use absolute URL

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000
    })
  }

  // Set auth token for requests
  setAuthToken(token: string) {
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`
  }

  // Remove auth token
  clearAuthToken() {
    delete this.client.defaults.headers.common['Authorization']
  }

  // Complaints
  async getComplaints(params?: {
    status?: string
    kategori?: string
    limit?: number
    offset?: number
  }) {
    const response = await this.client.get('/laporan', { params })
    return response.data
  }

  async getComplaintById(id: string) {
    const response = await this.client.get(`/laporan/${id}`)
    return response.data
  }

  async updateComplaintStatus(id: string, data: {
    status: string
    admin_notes?: string
  }) {
    const response = await this.client.patch(`/laporan/${id}/status`, data)
    return response.data
  }

  // Tickets
  async getTickets(params?: {
    status?: string
    jenis?: string
    limit?: number
    offset?: number
  }) {
    const response = await this.client.get('/tiket', { params })
    return response.data
  }

  async getTicketById(id: string) {
    const response = await this.client.get(`/tiket/${id}`)
    return response.data
  }

  async updateTicketStatus(id: string, data: {
    status: string
    admin_notes?: string
  }) {
    const response = await this.client.patch(`/tiket/${id}/status`, data)
    return response.data
  }

  // Statistics
  async getStatistics() {
    const response = await this.client.get('/statistics/overview')
    return response.data
  }

  // Trend Analysis
  async getTrends(period: 'weekly' | 'monthly' = 'weekly') {
    const response = await this.client.get('/statistics/trends', {
      params: { period },
    })
    return response.data
  }
}

// Create singleton instance
const apiClient = new ApiClient()

// Helper to initialize with token from localStorage (client-side only)
if (typeof window !== 'undefined') {
  const token = localStorage.getItem('token')
  if (token) {
    apiClient.setAuthToken(token)
  }
}

export { apiClient }
export default apiClient
