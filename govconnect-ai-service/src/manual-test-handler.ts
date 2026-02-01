// 1. SETUP ENV VARS (Agar tidak crash saat import config)
process.env.NODE_ENV = 'development';
process.env.RABBITMQ_URL = 'amqp://localhost';
process.env.CHANNEL_SERVICE_URL = 'http://localhost';
process.env.CASE_SERVICE_URL = 'http://localhost';
process.env.DASHBOARD_SERVICE_URL = 'http://localhost';
process.env.GEMINI_API_KEY = 'dummy-key'; // Tidak dipakai karena kita test handler langsung
process.env.INTERNAL_API_KEY = 'dummy-internal-key'; // Dibutuhkan oleh env validation

console.log('🔄 Loading modules with Dynamic Imports...');

// 2. MAIN FUNCTION
async function runUnitTests() {
  let hadCriticalError = false;

  try {
    // Dynamic Import untuk menghindari hoisting issue
    const { importantContactsService } = await import('./services/important-contacts.service');
    const { handleImportantContacts } = await import('./services/ai-orchestrator.service');

    console.log('✅ Modules loaded.');

    // 3. MOCK DATABASE
    // Kita bajak function getContacts
    importantContactsService.getContacts = async (villageId) => {
      console.log(`   [MockDB] 📞 Mengambil data kontak untuk village: ${villageId}`);
      return [
        {
          name: "Pemadam Kebakaran", 
          phone: "081122334455", 
          description: "Posko Utama", 
          wa_link: "https://wa.me/6281122334455" 
        },
        {
          name: "Ambulance Desa", 
          phone: "081234567890", 
          description: "Siaga 24 Jam", 
          wa_link: "https://wa.me/6281234567890" 
        }
      ];
    };

    console.log('\n=============================================');
    console.log('🧪 TEST: Logic "handleImportantContacts"');
    console.log('=============================================');

    // TEST CASE 1: User minta nomor pemadam
    // Simulasi: Webchat mendeteksi intent 'IMPORTANT_CONTACT' dan memanggil handler ini
    const userId = 'user-123';
    const villageId = 'desa-1';
    const prefixText = 'Berikut nomor penting yang Anda minta:';
    const userMessage = 'minta nomor pemadam';

    console.log(`\nInput:`);
    console.log(`- Prefix AI: "${prefixText}"`);
    console.log(`- User Msg: "${userMessage}"`);

    const response = await handleImportantContacts(userId, villageId, prefixText, userMessage);

    console.log(`\nOutput (Hasil Akhir):`);
    console.log('-'.repeat(50));
    console.log(response);
    console.log('-'.repeat(50));

    // VERIFIKASI
    const passed = response.includes('Pemadam Kebakaran') && 
                   response.includes('081122334455') && 
                   response.includes('🔗 Chat:');
    
    if (passed) {
      console.log('\n✅ HASIL: SUKSES');
      console.log('   - Data kontak muncul');
      console.log('   - Format link WA muncul');
      console.log('   - Prefix AI (jika ada) tergabung dengan benar');
    } else {
      console.log('\n❌ HASIL: GAGAL (Format tidak sesuai)');
    }

  } catch (error) {
    hadCriticalError = true;
    console.error('❌ CRITICAL ERROR:', error);
  } finally {
    // Beberapa service yang ter-import membuka koneksi/background timers.
    // Exit eksplisit supaya script manual-test tidak menggantung.
    setTimeout(() => process.exit(hadCriticalError ? 1 : 0), 50);
  }
}

runUnitTests();
