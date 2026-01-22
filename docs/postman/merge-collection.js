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
    description: "Complete API collection for GovConnect microservices.\n\n## Services\n- Case Service (Port 3003) - Complaints & Service Requests\n- Channel Service (Port 3001) - WhatsApp Channel & Live Chat\n- AI Service (Port 3002) - AI Orchestrator & Knowledge Base\n- Dashboard (Port 3000) - Admin Dashboard\n\n## Authentication\n- Internal API: X-Internal-API-Key header\n- Dashboard: Bearer token",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  variable: [
    { key: "base_url", value: "https://govconnect.my.id", type: "string" },
    { key: "case_service_url", value: "{{base_url}}/case", type: "string" },
    { key: "channel_service_url", value: "{{base_url}}/channel", type: "string" },
    { key: "ai_service_url", value: "{{base_url}}/ai", type: "string" },
    { key: "dashboard_url", value: "https://govconnect.my.id", type: "string" },
    { key: "internal_api_key", value: "govconnect-internal-2025-secret", type: "string" },
    { key: "auth_token", value: "", type: "string" },
    { key: "wa_user_id", value: "6281234567890", type: "string" },
    { key: "session_id", value: "web_form_1703260800000", type: "string" },
    { key: "complaint_id", value: "LP-20251222-001", type: "string" },
    { key: "request_number", value: "LAY-20251222-001", type: "string" },
    { key: "service_code", value: "SKD", type: "string" },
    { key: "knowledge_id", value: "kb-001", type: "string" }
  ],
  item: []
};

// Files to merge (in order)
const files = [
  'case-service.json',
  'statistics.json',
  'user.json',
  'channel-service.json',
  'ai-service.json'
];

// Merge all files
files.forEach(file => {
  try {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      baseCollection.item.push(content);
      console.log(`✅ Merged: ${file}`);
    } else {
      console.log(`⚠️ Skipped (not found): ${file}`);
    }
  } catch (err) {
    console.error(`❌ Error merging ${file}:`, err.message);
  }
});

// Write merged collection
const outputPath = path.join(__dirname, '..', 'GovConnect-API.postman_collection.json');
fs.writeFileSync(outputPath, JSON.stringify(baseCollection, null, 2));
console.log(`\n✅ Collection saved to: ${outputPath}`);
console.log(`📦 Total folders: ${baseCollection.item.length}`);
