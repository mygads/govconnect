/**
 * AI Service Client for Dashboard
 * 
 * Handles communication with AI Service for knowledge vector operations
 * Called when admin creates/updates/deletes knowledge
 * 
 * Menggunakan endpoint AI Service langsung (tanpa gateway agregasi)
 */

import { ai } from './api-client';

interface KnowledgeVectorPayload {
  id: string;
  village_id?: string;
  title: string;
  content: string;
  category: string;
  keywords: string[];
  qualityScore?: number;
}

/**
 * Add knowledge vector to AI Service
 * Called when admin creates new knowledge
 */
export async function addKnowledgeVector(payload: KnowledgeVectorPayload): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await ai.addKnowledge(payload);

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to add knowledge vector:', error);
      return { success: false, error: error.error || 'Failed to add vector' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error calling AI Service:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update knowledge vector in AI Service
 * Called when admin updates knowledge (re-embeds)
 */
export async function updateKnowledgeVector(id: string, payload: Omit<KnowledgeVectorPayload, 'id'>): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await ai.updateKnowledge(id, payload);

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to update knowledge vector:', error);
      return { success: false, error: error.error || 'Failed to update vector' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error calling AI Service:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Delete knowledge vector from AI Service
 * Called when admin deletes knowledge
 */
export async function deleteKnowledgeVector(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await ai.deleteKnowledge(id);

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to delete knowledge vector:', error);
      return { success: false, error: error.error || 'Failed to delete vector' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error calling AI Service:', error.message);
    return { success: false, error: error.message };
  }
}


