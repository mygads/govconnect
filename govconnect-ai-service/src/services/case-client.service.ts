import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';

interface ComplaintData {
  wa_user_id: string;
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
}

interface TicketData {
  wa_user_id: string;
  jenis: string;
  data_json: any;
}

interface ComplaintResponse {
  status: string;
  data: {
    complaint_id: string;
    status: string;
  };
}

interface TicketResponse {
  status: string;
  data: {
    ticket_id: string;
    status: string;
  };
}

/**
 * Create complaint in Case Service (SYNC call)
 */
export async function createComplaint(data: ComplaintData): Promise<string | null> {
  logger.info('Creating complaint in Case Service', {
    wa_user_id: data.wa_user_id,
    kategori: data.kategori,
  });
  
  try {
    const url = `${config.caseServiceUrl}/laporan/create`;
    const response = await axios.post<ComplaintResponse>(
      url,
      data,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 seconds
      }
    );
    
    const complaintId = response.data.data.complaint_id;
    
    logger.info('✅ Complaint created successfully', {
      wa_user_id: data.wa_user_id,
      complaint_id: complaintId,
    });
    
    return complaintId;
  } catch (error: any) {
    logger.error('❌ Failed to create complaint', {
      wa_user_id: data.wa_user_id,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    
    return null;
  }
}

/**
 * Create ticket in Case Service (SYNC call)
 */
export async function createTicket(data: TicketData): Promise<string | null> {
  logger.info('Creating ticket in Case Service', {
    wa_user_id: data.wa_user_id,
    jenis: data.jenis,
  });
  
  try {
    const url = `${config.caseServiceUrl}/tiket/create`;
    const response = await axios.post<TicketResponse>(
      url,
      data,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    
    const ticketId = response.data.data.ticket_id;
    
    logger.info('✅ Ticket created successfully', {
      wa_user_id: data.wa_user_id,
      ticket_id: ticketId,
    });
    
    return ticketId;
  } catch (error: any) {
    logger.error('❌ Failed to create ticket', {
      wa_user_id: data.wa_user_id,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    
    return null;
  }
}

/**
 * Check if Case Service is available
 */
export async function checkCaseServiceHealth(): Promise<boolean> {
  try {
    const url = `${config.caseServiceUrl}/health`;
    const response = await axios.get(url, { timeout: 3000 });
    return response.status === 200;
  } catch (error) {
    logger.warn('Case Service health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

export interface ComplaintStatusResponse {
  data: {
    complaint_id: string;
    kategori: string;
    alamat: string | null;
    status: string;
    admin_notes: string | null;
    created_at: string;
    updated_at: string;
  } | null;
}

export interface TicketStatusResponse {
  data: {
    ticket_id: string;
    jenis: string;
    status: string;
    admin_notes: string | null;
    data_json: any;
    created_at: string;
    updated_at: string;
  } | null;
}

/**
 * Get complaint status by complaint_id (e.g., LAP-20251201-001)
 */
export async function getComplaintStatus(complaintId: string): Promise<ComplaintStatusResponse['data']> {
  logger.info('Fetching complaint status from Case Service', {
    complaint_id: complaintId,
  });
  
  try {
    const url = `${config.caseServiceUrl}/laporan/${complaintId}`;
    const response = await axios.get<ComplaintStatusResponse>(
      url,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    
    logger.info('✅ Complaint status fetched successfully', {
      complaint_id: complaintId,
      status: response.data.data?.status,
    });
    
    return response.data.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      logger.info('Complaint not found', { complaint_id: complaintId });
      return null;
    }
    
    logger.error('❌ Failed to fetch complaint status', {
      complaint_id: complaintId,
      error: error.message,
      status: error.response?.status,
    });
    
    return null;
  }
}

/**
 * Get ticket status by ticket_id (e.g., TIK-20251201-001)
 */
export async function getTicketStatus(ticketId: string): Promise<TicketStatusResponse['data']> {
  logger.info('Fetching ticket status from Case Service', {
    ticket_id: ticketId,
  });
  
  try {
    const url = `${config.caseServiceUrl}/tiket/${ticketId}`;
    const response = await axios.get<TicketStatusResponse>(
      url,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    
    logger.info('✅ Ticket status fetched successfully', {
      ticket_id: ticketId,
      status: response.data.data?.status,
    });
    
    return response.data.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      logger.info('Ticket not found', { ticket_id: ticketId });
      return null;
    }
    
    logger.error('❌ Failed to fetch ticket status', {
      ticket_id: ticketId,
      error: error.message,
      status: error.response?.status,
    });
    
    return null;
  }
}
