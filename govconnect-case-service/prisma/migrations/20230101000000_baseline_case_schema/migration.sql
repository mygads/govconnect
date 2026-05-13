-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'WEBCHAT');

-- CreateTable
CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "complaint_id" TEXT NOT NULL,
    "wa_user_id" TEXT,
    "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
    "channel_identifier" TEXT,
    "kategori" TEXT NOT NULL,
    "category_id" TEXT,
    "type_id" TEXT,
    "deskripsi" TEXT NOT NULL,
    "alamat" TEXT,
    "rt_rw" TEXT,
    "foto_url" TEXT,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "require_address" BOOLEAN NOT NULL DEFAULT false,
    "reporter_name" TEXT,
    "reporter_phone" TEXT,
    "village_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "admin_notes" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_categories" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaint_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_types" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "require_address" BOOLEAN NOT NULL DEFAULT false,
    "send_important_contacts" BOOLEAN NOT NULL DEFAULT false,
    "important_contact_category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaint_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_updates" (
    "id" TEXT NOT NULL,
    "complaint_id" TEXT NOT NULL,
    "admin_id" TEXT,
    "note_text" TEXT NOT NULL,
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services_dynamic" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'both',
    "estimated_cost" TEXT,
    "estimated_processing_time" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_dynamic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requirements" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "options_json" JSONB,
    "help_text" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "request_number" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "village_id" TEXT,
    "wa_user_id" TEXT,
    "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
    "channel_identifier" TEXT,
    "citizen_data_json" JSONB NOT NULL,
    "requirement_data_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "admin_notes" TEXT,
    "result_file_url" TEXT,
    "result_file_name" TEXT,
    "result_description" TEXT,
    "edit_token" TEXT,
    "edit_token_expires_at" TIMESTAMP(3),
    "edit_token_used_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "complaints_complaint_id_key" ON "complaints"("complaint_id");

-- CreateIndex
CREATE INDEX "complaints_wa_user_id_idx" ON "complaints"("wa_user_id");

-- CreateIndex
CREATE INDEX "complaints_channel_channel_identifier_idx" ON "complaints"("channel", "channel_identifier");

-- CreateIndex
CREATE INDEX "complaints_status_idx" ON "complaints"("status");

-- CreateIndex
CREATE INDEX "complaints_kategori_idx" ON "complaints"("kategori");

-- CreateIndex
CREATE INDEX "complaints_category_id_idx" ON "complaints"("category_id");

-- CreateIndex
CREATE INDEX "complaints_type_id_idx" ON "complaints"("type_id");

-- CreateIndex
CREATE INDEX "complaints_village_id_idx" ON "complaints"("village_id");

-- CreateIndex
CREATE INDEX "complaints_created_at_idx" ON "complaints"("created_at");

-- CreateIndex
CREATE INDEX "complaints_rt_rw_idx" ON "complaints"("rt_rw");

-- CreateIndex
CREATE INDEX "complaints_deleted_at_idx" ON "complaints"("deleted_at");

-- CreateIndex
CREATE INDEX "complaint_categories_village_id_idx" ON "complaint_categories"("village_id");

-- CreateIndex
CREATE INDEX "complaint_categories_name_idx" ON "complaint_categories"("name");

-- CreateIndex
CREATE INDEX "complaint_types_category_id_idx" ON "complaint_types"("category_id");

-- CreateIndex
CREATE INDEX "complaint_types_name_idx" ON "complaint_types"("name");

-- CreateIndex
CREATE INDEX "complaint_updates_complaint_id_idx" ON "complaint_updates"("complaint_id");

-- CreateIndex
CREATE INDEX "service_categories_village_id_idx" ON "service_categories"("village_id");

-- CreateIndex
CREATE INDEX "service_categories_name_idx" ON "service_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "services_dynamic_slug_key" ON "services_dynamic"("slug");

-- CreateIndex
CREATE INDEX "services_dynamic_village_id_idx" ON "services_dynamic"("village_id");

-- CreateIndex
CREATE INDEX "services_dynamic_category_id_idx" ON "services_dynamic"("category_id");

-- CreateIndex
CREATE INDEX "services_dynamic_mode_idx" ON "services_dynamic"("mode");

-- CreateIndex
CREATE INDEX "service_requirements_service_id_idx" ON "service_requirements"("service_id");

-- CreateIndex
CREATE INDEX "service_requirements_field_type_idx" ON "service_requirements"("field_type");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_request_number_key" ON "service_requests"("request_number");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_edit_token_key" ON "service_requests"("edit_token");

-- CreateIndex
CREATE INDEX "service_requests_wa_user_id_idx" ON "service_requests"("wa_user_id");

-- CreateIndex
CREATE INDEX "service_requests_channel_channel_identifier_idx" ON "service_requests"("channel", "channel_identifier");

-- CreateIndex
CREATE INDEX "service_requests_service_id_idx" ON "service_requests"("service_id");

-- CreateIndex
CREATE INDEX "service_requests_status_idx" ON "service_requests"("status");

-- CreateIndex
CREATE INDEX "service_requests_village_id_idx" ON "service_requests"("village_id");

-- CreateIndex
CREATE INDEX "service_requests_created_at_idx" ON "service_requests"("created_at");

-- CreateIndex
CREATE INDEX "service_requests_deleted_at_idx" ON "service_requests"("deleted_at");

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "complaint_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "complaint_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_types" ADD CONSTRAINT "complaint_types_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "complaint_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_updates" ADD CONSTRAINT "complaint_updates_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services_dynamic" ADD CONSTRAINT "services_dynamic_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requirements" ADD CONSTRAINT "service_requirements_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services_dynamic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services_dynamic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

