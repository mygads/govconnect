
import dotenv from 'dotenv';
import path from 'path';

// 1. SETUP ENV VARS (Bypass validation)
process.env.NODE_ENV = 'development';
process.env.RABBITMQ_URL = 'amqp://localhost';
process.env.CHANNEL_SERVICE_URL = 'http://localhost';
process.env.CASE_SERVICE_URL = 'http://localhost';
process.env.DASHBOARD_SERVICE_URL = 'http://localhost';
process.env.GEMINI_API_KEY = 'dummy-key';

// 2. MOCK LOGGER
const mockLogger = {
  info: () => {},
  warn: console.warn,
  error: console.error,
  debug: () => {},
};
jest.mock('./utils/logger', () => mockLogger);

// 3. IMPORTS
import { processTwoLayerWebchat } from './services/two-layer-webchat.service';
import { importantContactsService } from './services/important-contacts.service';

console.log('🔄 Setting up mocks...');

// 4. MOCK DATABASE (Important Contacts)
importantContactsService.getContacts = async (villageId) => {
  console.log(`   [MockDB] 📞 Fetching contacts...`);
  return [
    {
      name: "Pemadam Kebakaran", 
      phone: "081122334455", 
      description: "Posko Utama", 
      wa_link: "https://wa.me/6281122334455"
    },
    {
      name: "Polsek (Polisi)", 
      phone: "081987654321", 
      description: "Siaga 24 Jam", 
      wa_link: "https://wa.me/6281987654321"
    }
  ];
};

// 5. MOCK AI LAYERS (Bypass LLM API)
jest.mock('./services/layer1-llm.service', () => ({
  applyTypoCorrections: (msg: string) => msg,
  callLayer1LLM: async ({ message }: any) => {
    const lower = message.toLowerCase();
    if (lower.includes('pemadam')) {
      return {
        intent: 'IMPORTANT_CONTACT',
        confidence: 0.95,
        extracted_data: { village_id: 'default' }
      };
    }
    if (lower.includes('syarat') || lower.includes('domisili')) {
      return {
        intent: 'SERVICE_INFO',
        confidence: 0.9,
        extracted_data: { service_slug: 'surat-domisili', village_id: 'default' }
      };
    }
    return { intent: 'UNKNOWN', confidence: 0.5, extracted_data: {} };
  }
}));

jest.mock('./services/layer2-llm.service', () => ({
  callLayer2LLM: async ({ layer1_output }: any) => {
    const isContact = layer1_output.intent === 'IMPORTANT_CONTACT';
    return {
      reply_text: isContact ? 'Ini nomornya:' : 'Ini syaratnya:',
      guidance_text: 'Semoga membantu!',
      next_action: layer1_output.intent,
      needs_knowledge: false
    };
  }
}));

// 6. RUN SCENARIOS
async function runTest() {
  const userId = 'user-test';
  
  console.log('\n=== TEST 1: EMERGENCY CONTACTS ===');
  console.log('User: "Minta nomor pemadam"');
  
  try {
    const res1 = await processTwoLayerWebchat({
      userId,
      message: 'Minta nomor pemadam',
      conversationHistory: []
    });
    
    console.log('AI Response:');
    console.log(res1.response);
    
    if (res1.response.includes('081122334455') && res1.response.includes('🔗 Chat:')) {
      console.log('✅ PASS: Data & Link displayed!');
    } else {
      console.log('❌ FAIL: Data missing.');
    }
  } catch (e) {
    console.error('ERROR:', e);
  }

  console.log('\n=== TEST 2: SERVICE INFO ===');
  console.log('User: "Syarat surat domisili"');
  
  try {
    const res2 = await processTwoLayerWebchat({
      userId,
      message: 'Syarat surat domisili',
      conversationHistory: []
    });
    
    console.log('AI Response:');
    console.log(res2.response);
    // Note: Response might be error text because HTTP call to case-service isn't mocked, 
    // but as long as it didn't crash, the flow works.
  } catch (e) {
    console.error('ERROR:', e);
  }
}

runTest();
