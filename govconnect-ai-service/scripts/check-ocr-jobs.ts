const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.$queryRawUnsafe(
    "SELECT id, type, status, retry_count, error_message, last_error_code, created_at FROM ai.embedding_jobs WHERE type = 'document_ocr' ORDER BY created_at DESC LIMIT 5"
  );
  console.log(JSON.stringify(jobs, null, 2));
  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e.message);
  await prisma.$disconnect();
  process.exit(1);
});
