-- CreateTable
CREATE TABLE "genfity_whatsapp_sessions" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "session_name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "logged_in" BOOLEAN NOT NULL DEFAULT false,
    "jid" TEXT,
    "qrcode" TEXT,
    "message" TEXT,
    "webhook" TEXT,
    "events" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genfity_whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "genfity_whatsapp_sessions_village_id_key" ON "genfity_whatsapp_sessions"("village_id");

-- CreateIndex
CREATE UNIQUE INDEX "genfity_whatsapp_sessions_session_id_key" ON "genfity_whatsapp_sessions"("session_id");

-- CreateIndex
CREATE INDEX "genfity_whatsapp_sessions_village_id_idx" ON "genfity_whatsapp_sessions"("village_id");

-- CreateIndex
CREATE INDEX "genfity_whatsapp_sessions_session_id_idx" ON "genfity_whatsapp_sessions"("session_id");

-- CreateIndex
CREATE INDEX "genfity_whatsapp_sessions_connected_idx" ON "genfity_whatsapp_sessions"("connected");
