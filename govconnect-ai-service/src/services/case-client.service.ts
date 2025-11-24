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
