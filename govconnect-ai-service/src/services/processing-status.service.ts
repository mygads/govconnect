/**
 * Processing Status Service
 * 
 * Provides real-time processing status updates for:
 * - Dashboard admin (to see AI is working)
 * - Webchat users (typing indicator)
 * - WhatsApp users (via Channel Service)
 * 
 * Status stages:
 * 1. "Membaca pesan..." - Initial processing
 * 2. "Mencari informasi..." - RAG/Knowledge search
 * 3. "Menyiapkan jawaban..." - LLM processing
 * 4. "Mengirim..." - Sending response
 */

import logger from '../utils/logger';

// ==================== TYPES ====================

export type ProcessingStage = 
  | 'receiving'      // Menerima pesan
  | 'reading'        // Membaca pesan
  | 'searching'      // Mencari informasi (RAG)
  | 'thinking'       // AI sedang berpikir
  | 'preparing'      // Menyiapkan jawaban
  | 'sending'        // Mengirim jawaban
  | 'completed'      // Selesai
  | 'error';         // Error

export interface ProcessingStatus {
  userId: string;
  stage: ProcessingStage;
  message: string;
  progress: number;      // 0-100
  startTime: number;
  lastUpdate: number;
  estimatedTimeMs?: number;
}

export interface StatusUpdate {
  stage: ProcessingStage;
  message: string;
  progress: number;
}

type StatusCallback = (status: ProcessingStatus) => void;

// ==================== STATUS MESSAGES ====================

const STAGE_MESSAGES: Record<ProcessingStage, string[]> = {
  receiving: [
    'Menerima pesan...',
    'Pesan diterima...',
  ],
  reading: [
    'Membaca pesan...',
    'Sedang memahami pertanyaan...',
    'Menganalisis pesan...',
  ],
  searching: [
    'Mencari informasi yang relevan...',
    'Menelusuri knowledge base...',
    'Mencari data terkait...',
  ],
  thinking: [
    'Sedang berpikir...',
    'Memproses informasi...',
    'Menyusun jawaban...',
  ],
  preparing: [
    'Menyiapkan jawaban...',
    'Hampir selesai...',
    'Finalisasi response...',
  ],
  sending: [
    'Mengirim jawaban...',
    'Mengirim response...',
  ],
  completed: [
    'Selesai',
  ],
  error: [
    'Terjadi kesalahan',
    'Gagal memproses',
  ],
};

const STAGE_PROGRESS: Record<ProcessingStage, number> = {
  receiving: 10,
  reading: 20,
  searching: 40,
  thinking: 60,
  preparing: 80,
  sending: 95,
  completed: 100,
  error: 0,
};

// ==================== STORAGE ====================

// Active processing statuses
const activeStatuses = new Map<string, ProcessingStatus>();

// Callbacks for status updates (for real-time push)
const statusCallbacks = new Map<string, StatusCallback[]>();

// ==================== CORE FUNCTIONS ====================

/**
 * Start tracking processing for a user
 */
export function startProcessing(userId: string): ProcessingStatus {
  const status: ProcessingStatus = {
    userId,
    stage: 'receiving',
    message: getRandomMessage('receiving'),
    progress: STAGE_PROGRESS.receiving,
    startTime: Date.now(),
    lastUpdate: Date.now(),
  };

  activeStatuses.set(userId, status);
  notifyCallbacks(userId, status);

  logger.debug('[ProcessingStatus] Started', { userId });

  return status;
}

/**
 * Update processing stage
 */
export function updateStage(userId: string, stage: ProcessingStage): ProcessingStatus | null {
  const status = activeStatuses.get(userId);
  if (!status) return null;

  status.stage = stage;
  status.message = getRandomMessage(stage);
  status.progress = STAGE_PROGRESS[stage];
  status.lastUpdate = Date.now();

  // Estimate remaining time based on elapsed
  const elapsed = Date.now() - status.startTime;
  if (status.progress > 0 && status.progress < 100) {
    status.estimatedTimeMs = Math.round((elapsed / status.progress) * (100 - status.progress));
  }

  activeStatuses.set(userId, status);
  notifyCallbacks(userId, status);

  logger.debug('[ProcessingStatus] Updated', { 
    userId, 
    stage, 
    progress: status.progress,
    elapsedMs: elapsed,
  });

  return status;
}

/**
 * Complete processing
 */
export function completeProcessing(userId: string): void {
  const status = activeStatuses.get(userId);
  if (status) {
    status.stage = 'completed';
    status.message = getRandomMessage('completed');
    status.progress = 100;
    status.lastUpdate = Date.now();

    notifyCallbacks(userId, status);

    const totalTime = Date.now() - status.startTime;
    logger.debug('[ProcessingStatus] Completed', { userId, totalTimeMs: totalTime });
  }

  // Clean up after a short delay
  setTimeout(() => {
    activeStatuses.delete(userId);
  }, 5000);
}

/**
 * Mark processing as error
 */
export function errorProcessing(userId: string, errorMessage?: string): void {
  const status = activeStatuses.get(userId);
  if (status) {
    status.stage = 'error';
    status.message = errorMessage || getRandomMessage('error');
    status.progress = 0;
    status.lastUpdate = Date.now();

    notifyCallbacks(userId, status);
  }

  // Clean up after a short delay
  setTimeout(() => {
    activeStatuses.delete(userId);
  }, 5000);
}

/**
 * Get current status for a user
 */
export function getStatus(userId: string): ProcessingStatus | null {
  return activeStatuses.get(userId) || null;
}

/**
 * Check if user has active processing
 */
export function isProcessing(userId: string): boolean {
  const status = activeStatuses.get(userId);
  return status !== undefined && status.stage !== 'completed' && status.stage !== 'error';
}

// ==================== CALLBACKS ====================

/**
 * Register callback for status updates
 */
export function onStatusUpdate(userId: string, callback: StatusCallback): () => void {
  const callbacks = statusCallbacks.get(userId) || [];
  callbacks.push(callback);
  statusCallbacks.set(userId, callbacks);

  // Return unsubscribe function
  return () => {
    const current = statusCallbacks.get(userId) || [];
    const index = current.indexOf(callback);
    if (index > -1) {
      current.splice(index, 1);
      statusCallbacks.set(userId, current);
    }
  };
}

/**
 * Notify all callbacks for a user
 */
function notifyCallbacks(userId: string, status: ProcessingStatus): void {
  const callbacks = statusCallbacks.get(userId) || [];
  for (const callback of callbacks) {
    try {
      callback(status);
    } catch (error) {
      logger.error('[ProcessingStatus] Callback error', { userId, error });
    }
  }
}

// ==================== HELPERS ====================

/**
 * Get random message for stage
 */
function getRandomMessage(stage: ProcessingStage): string {
  const messages = STAGE_MESSAGES[stage];
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Get all active statuses (for monitoring)
 */
export function getAllActiveStatuses(): ProcessingStatus[] {
  return Array.from(activeStatuses.values());
}

/**
 * Get status summary for dashboard
 */
export function getStatusSummary(): {
  activeCount: number;
  byStage: Record<ProcessingStage, number>;
  avgProcessingTimeMs: number;
} {
  const statuses = Array.from(activeStatuses.values());
  
  const byStage: Record<ProcessingStage, number> = {
    receiving: 0,
    reading: 0,
    searching: 0,
    thinking: 0,
    preparing: 0,
    sending: 0,
    completed: 0,
    error: 0,
  };

  let totalTime = 0;
  let completedCount = 0;

  for (const status of statuses) {
    byStage[status.stage]++;
    
    if (status.stage === 'completed') {
      totalTime += status.lastUpdate - status.startTime;
      completedCount++;
    }
  }

  return {
    activeCount: statuses.filter(s => s.stage !== 'completed' && s.stage !== 'error').length,
    byStage,
    avgProcessingTimeMs: completedCount > 0 ? Math.round(totalTime / completedCount) : 0,
  };
}

// ==================== INTEGRATION HELPERS ====================

/**
 * Create a processing tracker for a message
 * Returns functions to update status at each stage
 */
export function createProcessingTracker(userId: string) {
  startProcessing(userId);

  return {
    reading: () => updateStage(userId, 'reading'),
    searching: () => updateStage(userId, 'searching'),
    thinking: () => updateStage(userId, 'thinking'),
    preparing: () => updateStage(userId, 'preparing'),
    sending: () => updateStage(userId, 'sending'),
    complete: () => completeProcessing(userId),
    error: (msg?: string) => errorProcessing(userId, msg),
    getStatus: () => getStatus(userId),
  };
}

// ==================== EXPORTS ====================

export default {
  startProcessing,
  updateStage,
  completeProcessing,
  errorProcessing,
  getStatus,
  isProcessing,
  onStatusUpdate,
  getAllActiveStatuses,
  getStatusSummary,
  createProcessingTracker,
};
