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
    return [];
  }

  try {
    const url = `${config.dashboardServiceUrl}/api/internal/important-contacts`;
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

    return response.data.data || [];
  } catch (error: any) {
    logger.warn('Failed to fetch important contacts', {
      error: error.message,
      status: error.response?.status,
    });
    return [];
  }
}
