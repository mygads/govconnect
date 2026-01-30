import fs from 'fs';
import path from 'path';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:3002';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'govconnect-internal-2025-secret';

const goldenSetPath = path.join(__dirname, 'golden-set.json');

async function main() {
  const raw = fs.readFileSync(goldenSetPath, 'utf-8');
  const items = JSON.parse(raw);

  const response = await fetch(`${AI_SERVICE_URL}/stats/golden-set/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-api-key': INTERNAL_API_KEY,
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to run golden set evaluation: ${text}`);
  }

  const result = await response.json();
  console.log('✅ Golden set evaluation result');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('❌ Golden set evaluation failed');
  console.error(error.message || error);
  process.exit(1);
});
