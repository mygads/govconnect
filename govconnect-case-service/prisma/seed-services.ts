import { PrismaClient } from '@prisma/client';
import { GOVERNMENT_SERVICES } from '../dist/config/services';

const prisma = new PrismaClient();

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function main() {
  console.log('🌱 Seeding government services...\n');

  const villageId = (process.env.VILLAGE_ID || process.env.DEFAULT_VILLAGE_ID || '').trim();
  if (!villageId) {
    throw new Error('VILLAGE_ID atau DEFAULT_VILLAGE_ID wajib di-set untuk menjalankan seed-services');
  }

  // Ensure categories exist (by village + name)
  const categoryIdByName = new Map<string, string>();
  const categories = Array.from(new Set(GOVERNMENT_SERVICES.map((s) => s.category)));
  for (const categoryName of categories) {
    const existingCategory = await prisma.serviceCategory.findFirst({
      where: { village_id: villageId, name: categoryName },
    });

    const category =
      existingCategory ||
      (await prisma.serviceCategory.create({
        data: {
          village_id: villageId,
          name: categoryName,
          description: `Kategori layanan: ${categoryName}`,
          is_active: true,
        },
      }));

    categoryIdByName.set(categoryName, category.id);
  }

  for (const serviceDef of GOVERNMENT_SERVICES) {
    const categoryId = categoryIdByName.get(serviceDef.category);
    if (!categoryId) {
      throw new Error(`Category not found/created: ${serviceDef.category}`);
    }

    const slug = slugify(`${serviceDef.code}-${serviceDef.name}`);

    const service = await prisma.serviceItem.upsert({
      where: { slug },
      update: {
        village_id: villageId,
        category_id: categoryId,
        name: serviceDef.name,
        description: serviceDef.description,
        is_active: true,
      },
      create: {
        village_id: villageId,
        category_id: categoryId,
        name: serviceDef.name,
        description: serviceDef.description,
        slug,
        mode: 'both',
        is_active: true,
      },
    });

    // Seed requirements as file uploads (dokumen persyaratan)
    // Idempotent: upsert by (service_id + label) is not unique in schema, so we do findFirst+create.
    for (let index = 0; index < serviceDef.requirements.length; index++) {
      const label = serviceDef.requirements[index];
      const existingRequirement = await prisma.serviceRequirement.findFirst({
        where: { service_id: service.id, label },
      });

      if (!existingRequirement) {
        await prisma.serviceRequirement.create({
          data: {
            service_id: service.id,
            label,
            field_type: 'file',
            is_required: true,
            order_index: index,
            help_text: null,
            options_json: null,
          },
        });
      }
    }

    console.log(`✅ Upserted service: ${serviceDef.code} - ${serviceDef.name}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Government services seeding completed!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Error seeding services:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
