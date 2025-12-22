/**
 * Script to merge all Postman collection parts into one file
 * Run: node merge-collection.js
 */

const fs = require('fs');
const path = require('path');

const baseCollection = {
  info: {
    _postman_id: "govconnect-api-collection",
    name: "GovConnect API",
    description: "Complete API collection for GovConnect microservices.\n\n## Services\n- Case Service (Port 3003)\n- Channel Service (Port 3001)\n- AI Service (Port 3002)\n- Dashboard (Port 3000)\n\n## Authentication\n- Internal API: X-Internal-API-Key header\n- Dashboard: Bearer token",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  variable: [
    { key: "base_url", value: "http://localhost", type: "string" },
    { key: "prod_url", value: "https://api.govconnect.my.id", type: "string" },
    { key: "case_service_url", value: "{{base_url}}:3003", type: "string" },
    { key: "channel_service_url", value: "{{base_url}}:3001", type: "string" },
    { key: "ai_service_url", value: "{{base_url}}:3002", type: "string" },
    { key: "dashboard_url", value: "{{base_url}}:3000", type: "string" },
    { key: "internal_api_key", value: "your-internal-api-key", type: "string" },
    { key: "auth_token", value: "", type: "string" },
    { key: "wa_user_id", value: "6281234567890", type: "string" },
    { key: "session_id", value: "web_form_1234567890", type: "string" },
    { key: "complaint_id", value: "LP-20251222-001", type: "string" },
    { key: "reservation_id", value: "RSV-20251222-001", type: "string" }
  ],
  item: []
};

// Files to merge
const files = [
  'case-service.json',
  'reservations.json',
  'channel-service.json',
  'ai-service.json',
  'graphql.json'
];

// Merge all files
files.forEach(file => {
  try {
    const filePath = path.join(__dirname, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    baseCollection.item.push(content);
    console.log(`✅ Merged: ${file}`);
  } catch (err) {
    console.error(`❌ Error merging ${file}:`, err.message);
  }
});

// Write merged collection
const outputPath = path.join(__dirname, '..', 'GovConnect-API.postman_collection.json');
fs.writeFileSync(outputPath, JSON.stringify(baseCollection, null, 2));
console.log(`\n✅ Collection saved to: ${outputPath}`);
