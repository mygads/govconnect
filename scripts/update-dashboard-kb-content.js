const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const id = process.env.KB_ID;
  const filePath = process.env.KB_FILE;

  if (!id) throw new Error('KB_ID is required');
  if (!filePath) throw new Error('KB_FILE is required');

  const content = fs.readFileSync(filePath, 'utf8');
  const prisma = new PrismaClient();

  await prisma.knowledge_base.update({
    where: { id },
    data: { content },
  });

  await prisma.$disconnect();
  console.log('updated_ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
