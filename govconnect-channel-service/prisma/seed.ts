/// <reference types="node" />

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient() as any;

type DummyCitizen = {
  name: string;
  wa: string;
  webchatSession: string;
};

const DUMMY_CITIZENS: DummyCitizen[] = [
  { name: 'Andi Saputra', wa: '6281200001001', webchatSession: 'webchat-sanreseng-001' },
  { name: 'Siti Rahma', wa: '6281200001002', webchatSession: 'webchat-sanreseng-002' },
  { name: 'Budi Hartono', wa: '6281200001003', webchatSession: 'webchat-sanreseng-003' },
  { name: 'Nur Aisyah', wa: '6281200001004', webchatSession: 'webchat-sanreseng-004' },
  { name: 'Rian Pratama', wa: '6281200001005', webchatSession: 'webchat-sanreseng-005' },
  { name: 'Maya Lestari', wa: '6281200001006', webchatSession: 'webchat-sanreseng-006' },
  { name: 'Dedi Kurniawan', wa: '6281200001007', webchatSession: 'webchat-sanreseng-007' },
  { name: 'Intan Permata', wa: '6281200001008', webchatSession: 'webchat-sanreseng-008' },
  { name: 'Fajar Hidayat', wa: '6281200001009', webchatSession: 'webchat-sanreseng-009' },
  { name: 'Lina Marlina', wa: '6281200001010', webchatSession: 'webchat-sanreseng-010' },
];

async function main() {
  const villageId = process.env.VILLAGE_ID || 'desa-sanreseng-ade';

  console.log('🌱 Seeding Channel Service inbox chat data...');
  console.log(`🏘️ Village ID: ${villageId}`);

  for (let i = 0; i < DUMMY_CITIZENS.length; i++) {
    const citizen = DUMMY_CITIZENS[i];
    const waMessageId = `seed-wa-in-${i + 1}`;
    const webchatMessageId = `seed-webchat-in-${i + 1}`;

    await prisma.message.upsert({
      where: { message_id: waMessageId },
      update: {
        village_id: villageId,
        wa_user_id: citizen.wa,
        channel: 'WHATSAPP',
        channel_identifier: citizen.wa,
        message_text: `Halo admin, saya ${citizen.name}. Mau lapor kondisi jalan rusak di sekitar rumah.`,
        direction: 'IN',
        source: 'WA_WEBHOOK',
      },
      create: {
        village_id: villageId,
        wa_user_id: citizen.wa,
        channel: 'WHATSAPP',
        channel_identifier: citizen.wa,
        message_id: waMessageId,
        message_text: `Halo admin, saya ${citizen.name}. Mau lapor kondisi jalan rusak di sekitar rumah.`,
        direction: 'IN',
        source: 'WA_WEBHOOK',
      },
    });

    await prisma.message.upsert({
      where: { message_id: webchatMessageId },
      update: {
        village_id: villageId,
        wa_user_id: null,
        channel: 'WEBCHAT',
        channel_identifier: citizen.webchatSession,
        message_text: `Saya ${citizen.name} dari webchat, ingin ajukan layanan administrasi.`,
        direction: 'IN',
        source: 'WEBCHAT',
      },
      create: {
        village_id: villageId,
        wa_user_id: null,
        channel: 'WEBCHAT',
        channel_identifier: citizen.webchatSession,
        message_id: webchatMessageId,
        message_text: `Saya ${citizen.name} dari webchat, ingin ajukan layanan administrasi.`,
        direction: 'IN',
        source: 'WEBCHAT',
      },
    });

    await prisma.conversation.upsert({
      where: {
        village_id_channel_channel_identifier: {
          village_id: villageId,
          channel: 'WHATSAPP',
          channel_identifier: citizen.wa,
        },
      },
      update: {
        wa_user_id: citizen.wa,
        user_name: citizen.name,
        user_phone: citizen.wa,
        last_message: `Halo admin, saya ${citizen.name}. Mau lapor kondisi jalan rusak di sekitar rumah.`,
        unread_count: 1,
        is_takeover: false,
        ai_status: null,
      },
      create: {
        village_id: villageId,
        wa_user_id: citizen.wa,
        channel: 'WHATSAPP',
        channel_identifier: citizen.wa,
        user_name: citizen.name,
        user_phone: citizen.wa,
        last_message: `Halo admin, saya ${citizen.name}. Mau lapor kondisi jalan rusak di sekitar rumah.`,
        unread_count: 1,
        is_takeover: false,
        ai_status: null,
      },
    });

    await prisma.conversation.upsert({
      where: {
        village_id_channel_channel_identifier: {
          village_id: villageId,
          channel: 'WEBCHAT',
          channel_identifier: citizen.webchatSession,
        },
      },
      update: {
        wa_user_id: null,
        user_name: citizen.name,
        user_phone: citizen.wa,
        last_message: `Saya ${citizen.name} dari webchat, ingin ajukan layanan administrasi.`,
        unread_count: 1,
        is_takeover: false,
        ai_status: null,
      },
      create: {
        village_id: villageId,
        wa_user_id: null,
        channel: 'WEBCHAT',
        channel_identifier: citizen.webchatSession,
        user_name: citizen.name,
        user_phone: citizen.wa,
        last_message: `Saya ${citizen.name} dari webchat, ingin ajukan layanan administrasi.`,
        unread_count: 1,
        is_takeover: false,
        ai_status: null,
      },
    });

    await prisma.pendingMessage.upsert({
      where: { message_id: waMessageId },
      update: {
        village_id: villageId,
        wa_user_id: citizen.wa,
        channel: 'WHATSAPP',
        channel_identifier: citizen.wa,
        message_text: `Halo admin, saya ${citizen.name}. Mau lapor kondisi jalan rusak di sekitar rumah.`,
        status: 'pending',
      },
      create: {
        village_id: villageId,
        wa_user_id: citizen.wa,
        channel: 'WHATSAPP',
        channel_identifier: citizen.wa,
        message_id: waMessageId,
        message_text: `Halo admin, saya ${citizen.name}. Mau lapor kondisi jalan rusak di sekitar rumah.`,
        status: 'pending',
      },
    });

    await prisma.pendingMessage.upsert({
      where: { message_id: webchatMessageId },
      update: {
        village_id: villageId,
        wa_user_id: null,
        channel: 'WEBCHAT',
        channel_identifier: citizen.webchatSession,
        message_text: `Saya ${citizen.name} dari webchat, ingin ajukan layanan administrasi.`,
        status: 'pending',
      },
      create: {
        village_id: villageId,
        wa_user_id: null,
        channel: 'WEBCHAT',
        channel_identifier: citizen.webchatSession,
        message_id: webchatMessageId,
        message_text: `Saya ${citizen.name} dari webchat, ingin ajukan layanan administrasi.`,
        status: 'pending',
      },
    });
  }

  console.log('✅ Channel Service dummy inbox data seeded');
  console.log('   - 10 chat masuk WhatsApp');
  console.log('   - 10 chat masuk Webchat');
  console.log('   - 20 conversation inbox');
  console.log('   - 20 pending messages');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('❌ Error seeding channel service:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
