/**
 * Conversation Finite State Machine Service
 * 
 * Mengelola state percakapan untuk multi-turn conversation handling.
 * Memastikan flow percakapan konsisten dan tidak terputus.
 * 
 * States:
 * - IDLE: Tidak ada percakapan aktif
 * - COLLECTING_COMPLAINT_DATA: Mengumpulkan data laporan
 * - CONFIRMING_COMPLAINT: Menunggu konfirmasi laporan
 * - COLLECTING_SERVICE_REQUEST_DATA: Mengumpulkan data permohonan layanan
 * - CONFIRMING_SERVICE_REQUEST: Menunggu konfirmasi permohonan layanan
 * - AWAITING_ADDRESS_DETAIL: Menunggu detail alamat
 * - AWAITING_CONFIRMATION: Menunggu konfirmasi umum
 */

import logger from '../utils/logger';

// ==================== TYPES ====================

export type ConversationState =
  | 'IDLE'
  | 'COLLECTING_COMPLAINT_DATA'
  | 'CONFIRMING_COMPLAINT'
  | 'COLLECTING_SERVICE_REQUEST_DATA'
  | 'CONFIRMING_SERVICE_REQUEST'
  | 'AWAITING_ADDRESS_DETAIL'
  | 'AWAITING_CONFIRMATION'
  | 'CHECK_STATUS_FLOW'
  | 'CANCELLATION_FLOW';

export type ConversationTrigger =
  | 'CREATE_COMPLAINT'
  | 'CREATE_SERVICE_REQUEST'
  | 'CHECK_STATUS'
  | 'CANCEL'
  | 'DATA_COMPLETE'
  | 'DATA_INCOMPLETE'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'ADDRESS_PROVIDED'
  | 'ADDRESS_VAGUE'
  | 'TIMEOUT'
  | 'RESET';

export interface CollectedData {
  // Complaint data
  kategori?: string;
  alamat?: string;
  deskripsi?: string;
  rt_rw?: string;
  foto_url?: string;
  
  // Service request data
  service_id?: string;
  service_slug?: string;
  request_number?: string;
  
  // Status check data
  complaint_id?: string;
  
  // Metadata
  lastUpdated?: number;
  messageCount?: number;
}

export interface ConversationContext {
  userId: string;
  state: ConversationState;
  previousState: ConversationState;
  collectedData: CollectedData;
  missingFields: string[];
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastIntent: string;
}

interface StateTransition {
  from: ConversationState | ConversationState[];
  to: ConversationState;
  trigger: ConversationTrigger;
  condition?: (ctx: ConversationContext) => boolean;
  action?: (ctx: ConversationContext) => void;
}

// ==================== STATE TRANSITIONS ====================

const TRANSITIONS: StateTransition[] = [
  // === COMPLAINT FLOW ===
  {
    from: 'IDLE',
    to: 'COLLECTING_COMPLAINT_DATA',
    trigger: 'CREATE_COMPLAINT',
  },
  {
    from: 'COLLECTING_COMPLAINT_DATA',
    to: 'AWAITING_ADDRESS_DETAIL',
    trigger: 'ADDRESS_VAGUE',
  },
  {
    from: 'AWAITING_ADDRESS_DETAIL',
    to: 'COLLECTING_COMPLAINT_DATA',
    trigger: 'ADDRESS_PROVIDED',
  },
  {
    from: 'AWAITING_ADDRESS_DETAIL',
    to: 'CONFIRMING_COMPLAINT',
    trigger: 'CONFIRMED',
  },
  {
    from: 'COLLECTING_COMPLAINT_DATA',
    to: 'CONFIRMING_COMPLAINT',
    trigger: 'DATA_COMPLETE',
  },
  {
    from: 'CONFIRMING_COMPLAINT',
    to: 'IDLE',
    trigger: 'CONFIRMED',
    action: (ctx) => {
      logger.info('[FSM] Complaint confirmed, resetting state', { userId: ctx.userId });
    },
  },
  {
    from: 'CONFIRMING_COMPLAINT',
    to: 'COLLECTING_COMPLAINT_DATA',
    trigger: 'REJECTED',
  },
  
  // === SERVICE REQUEST FLOW ===
  {
    from: 'IDLE',
    to: 'COLLECTING_SERVICE_REQUEST_DATA',
    trigger: 'CREATE_SERVICE_REQUEST',
  },
  {
    from: 'COLLECTING_SERVICE_REQUEST_DATA',
    to: 'CONFIRMING_SERVICE_REQUEST',
    trigger: 'DATA_COMPLETE',
  },
  {
    from: 'CONFIRMING_SERVICE_REQUEST',
    to: 'IDLE',
    trigger: 'CONFIRMED',
    action: (ctx) => {
      logger.info('[FSM] Service request confirmed, resetting state', { userId: ctx.userId });
    },
  },
  {
    from: 'CONFIRMING_SERVICE_REQUEST',
    to: 'COLLECTING_SERVICE_REQUEST_DATA',
    trigger: 'REJECTED',
  },
  
  // === STATUS CHECK FLOW ===
  {
    from: 'IDLE',
    to: 'CHECK_STATUS_FLOW',
    trigger: 'CHECK_STATUS',
  },
  {
    from: 'CHECK_STATUS_FLOW',
    to: 'IDLE',
    trigger: 'CONFIRMED',
  },
  
  // === CANCELLATION FLOW ===
  {
    from: 'IDLE',
    to: 'CANCELLATION_FLOW',
    trigger: 'CANCEL',
  },
  {
    from: 'CANCELLATION_FLOW',
    to: 'AWAITING_CONFIRMATION',
    trigger: 'DATA_COMPLETE',
  },
  {
    from: 'AWAITING_CONFIRMATION',
    to: 'IDLE',
    trigger: 'CONFIRMED',
  },
  {
    from: 'AWAITING_CONFIRMATION',
    to: 'IDLE',
    trigger: 'REJECTED',
  },
  
  // === GLOBAL TRANSITIONS ===
  {
    from: ['COLLECTING_COMPLAINT_DATA', 'COLLECTING_SERVICE_REQUEST_DATA', 'CONFIRMING_COMPLAINT', 'CONFIRMING_SERVICE_REQUEST', 'AWAITING_ADDRESS_DETAIL', 'AWAITING_CONFIRMATION', 'CHECK_STATUS_FLOW', 'CANCELLATION_FLOW'],
    to: 'IDLE',
    trigger: 'TIMEOUT',
  },
  {
    from: ['COLLECTING_COMPLAINT_DATA', 'COLLECTING_SERVICE_REQUEST_DATA', 'CONFIRMING_COMPLAINT', 'CONFIRMING_SERVICE_REQUEST', 'AWAITING_ADDRESS_DETAIL', 'AWAITING_CONFIRMATION', 'CHECK_STATUS_FLOW', 'CANCELLATION_FLOW'],
    to: 'IDLE',
    trigger: 'RESET',
  },
];

// ==================== REQUIRED FIELDS ====================

const COMPLAINT_REQUIRED_FIELDS = ['kategori', 'alamat'];
const COMPLAINT_OPTIONAL_FIELDS = ['deskripsi', 'rt_rw', 'foto_url'];

const SERVICE_REQUEST_REQUIRED_FIELDS = ['service_slug'];
const SERVICE_REQUEST_OPTIONAL_FIELDS = ['service_id'];

// ==================== STORAGE ====================

// In-memory storage (use Redis in production)
const conversationContexts = new Map<string, ConversationContext>();

// Cleanup expired contexts (older than 30 minutes)
const CONTEXT_TTL = 30 * 60 * 1000; // 30 minutes

setInterval(() => {
  const now = Date.now();
  for (const [userId, ctx] of conversationContexts.entries()) {
    if (now - ctx.updatedAt > CONTEXT_TTL) {
      conversationContexts.delete(userId);
      logger.debug('[FSM] Cleaned up expired context', { userId });
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// ==================== CORE FUNCTIONS ====================

/**
 * Get or create conversation context for a user
 */
export function getContext(userId: string): ConversationContext {
  let ctx = conversationContexts.get(userId);
  
  if (!ctx) {
    ctx = createInitialContext(userId);
    conversationContexts.set(userId, ctx);
  }
  
  return ctx;
}

/**
 * Create initial context
 */
function createInitialContext(userId: string): ConversationContext {
  return {
    userId,
    state: 'IDLE',
    previousState: 'IDLE',
    collectedData: {},
    missingFields: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
    lastIntent: '',
  };
}

/**
 * Transition to a new state based on trigger
 */
export function transition(userId: string, trigger: ConversationTrigger): ConversationContext {
  const ctx = getContext(userId);
  
  // Find matching transition
  const matchingTransition = TRANSITIONS.find(t => {
    const fromStates = Array.isArray(t.from) ? t.from : [t.from];
    const fromMatches = fromStates.includes(ctx.state);
    const triggerMatches = t.trigger === trigger;
    const conditionPasses = t.condition ? t.condition(ctx) : true;
    
    return fromMatches && triggerMatches && conditionPasses;
  });
  
  if (matchingTransition) {
    const previousState = ctx.state;
    ctx.previousState = previousState;
    ctx.state = matchingTransition.to;
    ctx.updatedAt = Date.now();
    
    // Execute action if defined
    if (matchingTransition.action) {
      matchingTransition.action(ctx);
    }
    
    logger.info('[FSM] State transition', {
      userId,
      from: previousState,
      to: ctx.state,
      trigger,
    });
    
    // Reset collected data if going back to IDLE
    if (ctx.state === 'IDLE') {
      ctx.collectedData = {};
      ctx.missingFields = [];
    }
  } else {
    logger.debug('[FSM] No matching transition', {
      userId,
      currentState: ctx.state,
      trigger,
    });
  }
  
  conversationContexts.set(userId, ctx);
  return ctx;
}

/**
 * Update collected data
 */
export function updateCollectedData(userId: string, data: Partial<CollectedData>): ConversationContext {
  const ctx = getContext(userId);
  
  ctx.collectedData = {
    ...ctx.collectedData,
    ...data,
    lastUpdated: Date.now(),
  };
  ctx.updatedAt = Date.now();
  ctx.messageCount++;
  
  // Recalculate missing fields
  ctx.missingFields = calculateMissingFields(ctx);
  
  conversationContexts.set(userId, ctx);
  
  logger.debug('[FSM] Data updated', {
    userId,
    state: ctx.state,
    collectedFields: Object.keys(ctx.collectedData).filter(k => ctx.collectedData[k as keyof CollectedData]),
    missingFields: ctx.missingFields,
  });
  
  return ctx;
}

/**
 * Calculate missing required fields based on current state
 */
function calculateMissingFields(ctx: ConversationContext): string[] {
  const missing: string[] = [];
  
  if (ctx.state === 'COLLECTING_COMPLAINT_DATA' || ctx.state === 'CONFIRMING_COMPLAINT' || ctx.state === 'AWAITING_ADDRESS_DETAIL') {
    for (const field of COMPLAINT_REQUIRED_FIELDS) {
      if (!ctx.collectedData[field as keyof CollectedData]) {
        missing.push(field);
      }
    }
  }
  
  if (ctx.state === 'COLLECTING_SERVICE_REQUEST_DATA' || ctx.state === 'CONFIRMING_SERVICE_REQUEST') {
    for (const field of SERVICE_REQUEST_REQUIRED_FIELDS) {
      if (!ctx.collectedData[field as keyof CollectedData]) {
        missing.push(field);
      }
    }
  }
  
  return missing;
}

/**
 * Check if data is complete for current flow
 */
export function isDataComplete(userId: string): boolean {
  const ctx = getContext(userId);
  return ctx.missingFields.length === 0;
}

/**
 * Get next question to ask based on missing fields
 */
export function getNextQuestion(userId: string): string | null {
  const ctx = getContext(userId);
  
  if (ctx.missingFields.length === 0) {
    return null;
  }
  
  const nextField = ctx.missingFields[0];
  
  const questionMap: Record<string, string> = {
    // Complaint fields
    'kategori': 'Jenis masalah apa yang ingin dilaporkan? (jalan rusak, lampu mati, sampah, dll)',
    'alamat': 'Di mana lokasi masalahnya? Sebutkan alamat atau patokan terdekat.',
    'deskripsi': 'Bisa jelaskan lebih detail masalahnya?',
    
    // Service request fields
    'service_slug': 'Layanan apa yang ingin Bapak/Ibu ajukan?',
    'service_id': 'Boleh sebutkan nama layanan yang dimaksud?',
  };
  
  return questionMap[nextField] || null;
}

/**
 * Set last intent
 */
export function setLastIntent(userId: string, intent: string): void {
  const ctx = getContext(userId);
  ctx.lastIntent = intent;
  ctx.updatedAt = Date.now();
  conversationContexts.set(userId, ctx);
}

/**
 * Reset context for a user
 */
export function resetContext(userId: string): void {
  conversationContexts.delete(userId);
  logger.info('[FSM] Context reset', { userId });
}

/**
 * Get all active contexts (for monitoring)
 */
export function getAllActiveContexts(): ConversationContext[] {
  return Array.from(conversationContexts.values());
}

/**
 * Get FSM statistics
 */
export function getFSMStats(): {
  activeContexts: number;
  stateDistribution: Record<ConversationState, number>;
  avgMessageCount: number;
} {
  const contexts = Array.from(conversationContexts.values());
  
  const stateDistribution: Record<ConversationState, number> = {
    'IDLE': 0,
    'COLLECTING_COMPLAINT_DATA': 0,
    'CONFIRMING_COMPLAINT': 0,
    'COLLECTING_SERVICE_REQUEST_DATA': 0,
    'CONFIRMING_SERVICE_REQUEST': 0,
    'AWAITING_ADDRESS_DETAIL': 0,
    'AWAITING_CONFIRMATION': 0,
    'CHECK_STATUS_FLOW': 0,
    'CANCELLATION_FLOW': 0,
  };
  
  let totalMessages = 0;
  
  for (const ctx of contexts) {
    stateDistribution[ctx.state]++;
    totalMessages += ctx.messageCount;
  }
  
  return {
    activeContexts: contexts.length,
    stateDistribution,
    avgMessageCount: contexts.length > 0 ? totalMessages / contexts.length : 0,
  };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Determine trigger from intent
 */
export function intentToTrigger(intent: string): ConversationTrigger | null {
  const mapping: Record<string, ConversationTrigger> = {
    'CREATE_COMPLAINT': 'CREATE_COMPLAINT',
    'CREATE_SERVICE_REQUEST': 'CREATE_SERVICE_REQUEST',
    'CHECK_STATUS': 'CHECK_STATUS',
    'CANCEL_COMPLAINT': 'CANCEL',
    'CONFIRMATION': 'CONFIRMED',
    'REJECTION': 'REJECTED',
  };
  
  return mapping[intent] || null;
}

/**
 * Check if user is in active flow
 */
export function isInActiveFlow(userId: string): boolean {
  const ctx = getContext(userId);
  return ctx.state !== 'IDLE';
}

/**
 * Get current flow type
 */
export function getCurrentFlowType(userId: string): 'complaint' | 'service' | 'status' | 'cancel' | 'none' {
  const ctx = getContext(userId);
  
  if (ctx.state.includes('COMPLAINT')) return 'complaint';
  if (ctx.state.includes('SERVICE_REQUEST')) return 'service';
  if (ctx.state === 'CHECK_STATUS_FLOW') return 'status';
  if (ctx.state === 'CANCELLATION_FLOW') return 'cancel';
  
  return 'none';
}

export default {
  getContext,
  transition,
  updateCollectedData,
  isDataComplete,
  getNextQuestion,
  setLastIntent,
  resetContext,
  getAllActiveContexts,
  getFSMStats,
  intentToTrigger,
  isInActiveFlow,
  getCurrentFlowType,
};
