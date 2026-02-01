
import { PrismaClient as DashboardPrisma } from '../govconnect-dashboard/node_modules/@prisma/client';
import { PrismaClient as ChannelPrisma } from '../govconnect-channel-service/node_modules/@prisma/client';

async function check() {
  const dashboard = new DashboardPrisma({
    datasourceUrl: process.env.DASHBOARD_DATABASE_URL
  });
  const channel = new ChannelPrisma({
    datasourceUrl: process.env.CHANNEL_DATABASE_URL
  });

  try {
    const villages = await dashboard.villages.findMany();
    console.log('Villages in Dashboard:', villages.map(v => ({ id: v.id, name: v.name, is_active: v.is_active })));

    const accounts = await channel.channel_accounts.findMany();
    console.log('Channel Accounts in Channel Service:', accounts.map(a => ({ village_id: a.village_id, enabled_webchat: a.enabled_webchat })));
  } catch (e) {
    console.error('Error checking DB:', e);
  } finally {
    await dashboard.$disconnect();
    await channel.$disconnect();
  }
}

check();
