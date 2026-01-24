// Quick test script to check database
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.admin_sessions.findMany({
    orderBy: { created_at: 'desc' },
    take: 5,
    include: { admin: true }
  });
  
  console.log('Sessions found:', sessions.length);
  for (const s of sessions) {
    console.log({
      id: s.id,
      admin_id: s.admin_id,
      admin_name: s.admin?.name,
      admin_village_id: s.admin?.village_id,
      token_preview: s.token.substring(0, 50),
      expires_at: s.expires_at,
    });
  }
  
  // Check if the provided token exists
  const testToken = "eyJhbGciOiJIUzI1NiJ9.eyJhZG1pbklkIjoiY21rcnpuYjJwMDAwYW1yMDF1b2JxdzF6biIsInVzZXJuYW1lIjoibXlnYWRzIiwibmFtZSI6Ik11aGFtbWFkIFlvZ2EgQWRpIFNhcHV0cmEiLCJyb2xlIjoidmlsbGFnZV9hZG1pbiIsImlhdCI6MTc2OTIzOTcyMywiZXhwIjoxNzY5MzI2MTIzfQ.biI6jHo7qnzlQy5ts7WgGajtAhnXOTj9KiOxDV20KjE";
  
  const sessionWithToken = await prisma.admin_sessions.findUnique({
    where: { token: testToken },
    include: { admin: true }
  });
  
  console.log('\nLooking for token:', testToken.substring(0, 50) + '...');
  console.log('Session found:', sessionWithToken ? 'YES' : 'NO');
  if (sessionWithToken) {
    console.log('Session expired:', sessionWithToken.expires_at < new Date());
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
