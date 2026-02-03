import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';

export interface ImportantContact {
  id: string;
  name: string;
  phone: string;
  description?: string | null;
  category?: {
    id: string;
    name: string;
  };
}

export async function getImportantContacts(
  villageId: string,
  categoryName?: string | null,
  categoryId?: string | null
): Promise<ImportantContact[]> {
  if (!villageId) {
    logger.warn('getImportantContacts called without villageId');
    return [];
  }

  try {
    const url = `${config.dashboardServiceUrl}/api/internal/important-contacts`;
    
    logger.debug('📞 Fetching important contacts', {
      url,
      villageId,
      categoryName,
      categoryId,
    });
    
    const response = await axios.get<{ data: ImportantContact[] }>(url, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
        'Content-Type': 'application/json',
      },
      params: {
        village_id: villageId,
        ...(categoryName ? { category_name: categoryName } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
      },
      timeout: 10000,
    });

    const contacts = response.data.data || [];
    logger.debug('📞 Important contacts fetched', {
      villageId,
      categoryName,
      count: contacts.length,
      contactNames: contacts.slice(0, 3).map(c => c.name),
    });
    
    return contacts;
  } catch (error: any) {
    logger.warn('Failed to fetch important contacts', {
      error: error.message,
      status: error.response?.status,
    });
    return [];
  }
}
