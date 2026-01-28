const fs = require('fs');

const p = process.env.TARGET_FILE || '/app/dist/services/unified-message-processor.service.js';
let s = fs.readFileSync(p, 'utf8');

const re = /const usedFor = context\.match\([\s\S]*?return lines\.join\('\\n'\);\n\s*\}\n\s*\}/m;
if (!re.test(s)) {
  console.error('patch_target_not_found');
  process.exit(1);
}

const replacement = [
  'const usedForProses = context.match(/data\\s+digunakan\\s+untuk\\s+(proses\\s+layanan[^\\n]*)/i);',
  '                const usedForGeneric = context.match(/data\\s+digunakan\\s+untuk\\s+([^\\n]+)/i);',
  '                const usedTail = (usedForProses?.[1] || usedForGeneric?.[1])?.trim();',
  '                const accessedBy = context.match(/data\\s+hanya\\s+diakses\\s+oleh\\s+([^\\n]+)/i);',
  '                if (usedTail || accessedBy?.[1]) {',
  "                    const lines = ['Tujuan penggunaan data layanan digital:'];",
  '                    if (usedTail)',
  '                        lines.push(`- Data digunakan untuk ${usedTail}`);',
  '                    if (accessedBy?.[1])',
  '                        lines.push(`- Data hanya diakses oleh ${accessedBy[1].trim()}`);',
  "                    return lines.join('\\n');",
  '                }',
  '            }'
].join('\n');

s = s.replace(re, replacement);
fs.writeFileSync(p, s, 'utf8');
console.log('patched_ok');
