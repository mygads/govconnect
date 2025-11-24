import axios, { AxiosInstance } from 'axios'

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || 'http://localhost:3003'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: CASE_SERVICE_URL,
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': INTERNAL_API_KEY
      },
      timeout: 10000
    })
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
}

export const apiClient = new ApiClient()
export default apiClient
