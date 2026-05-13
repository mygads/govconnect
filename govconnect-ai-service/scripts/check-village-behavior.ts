import 'dotenv/config';
import { getVillageBehaviorConfig, formatVillageBehaviorConfig } from '../src/services/village-behavior.service';

(async () => {
  try {
    const cfg = await getVillageBehaviorConfig('cmkuvo1dk0000mj60h4u4bq1w');
    console.log('Config:', JSON.stringify(cfg, null, 2));
    if (cfg) {
      console.log('---');
      console.log('Formatted output for LLM prompt:');
      console.log(formatVillageBehaviorConfig(cfg));
    }
  } catch (e: any) {
    console.error('Error:', e.message, e.stack);
  }
  process.exit(0);
})();
