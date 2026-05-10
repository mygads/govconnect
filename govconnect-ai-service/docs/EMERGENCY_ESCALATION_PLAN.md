# Emergency Escalation Auto-Takeover — Plan (not implemented)

**Status:** DRAFT — untuk review user sebelum implementasi.

**Context:** Finding D6 dari audit 2026-05-10. Saat ini
`tool-executor.ts:toolGetEmergencyContacts` hanya mengembalikan nomor darurat
ketika user melaporkan situasi mengancam jiwa (`tolong rumah saya kebakaran`,
dsb). Tidak ada sinyal/alert otomatis ke admin atau takeover ke human agent
untuk kategori self-harm / ancaman nyawa yang membutuhkan intervensi manusia
langsung.

## Skop

Plan ini HANYA mencakup kasus di mana user menunjukkan:

1. **Self-harm risk** — kata kunci: "bunuh diri", "mau mati", "akhiri hidup",
   "loncat dari", "tidak sanggup lagi", "tidak ingin hidup", dll.
2. **Kekerasan aktif terhadap orang lain** — KDRT aktif, penculikan, ancaman
   pembunuhan.
3. **Cedera serius / kondisi medis yang mengancam nyawa** — sudah setengah
   tercover oleh emergency_contacts; plan ini menambahkan takeover wajib.

## Non-goal

- Pengaduan infrastruktur / keluhan layanan (tidak perlu takeover otomatis).
- Nada kasar / sentimen negatif → sudah ditangani `needsHumanEscalation` di
  sentiment-analysis.service (threshold berbeda).

## Desain

### 1. Detector layer

Ada di jalur fast-intent (`pre-agent-state-router.service.ts`). Detector
adalah regex + optional micro-LLM verifikasi:

- **Regex broad-signal** (false positive diterima karena ini mengarah ke
  klarifikasi, bukan langsung takeover): sinyal kuat eksplisit
  `/(bunuh\s+diri|bunuhdiri|mau\s+mati|akhiri\s+hidup|tidak\s+ingin\s+hidup|tidak\s+sanggup\s+lagi|(di|akan)\s+(bunuh|culik)|kdrt|dipukul(in)?)/i`.
- **Micro-LLM verification** pada message yang match regex, menggunakan
  lane `llm` dengan prompt super terbatas: "Apakah user saat ini
  menggambarkan bahaya jiwa / self-harm / kekerasan aktif yang butuh
  intervensi manusia? Jawab YES/NO + alasan 1 kalimat."

Micro-LLM dipanggil HANYA jika regex hit. Tidak ada overhead pada turn
biasa.

### 2. Response layer

Jika detector confirm **HIGH RISK**:

1. Balas ke user dengan template lembut yang mengakui perasaan + beri
   kontak hotline nasional:
   ```
   Tolong sabar ya, saya tahu ini berat. Untuk kondisi mendesak, mohon
   hubungi:
   • 119 (Ambulans)
   • 118 (Polisi/Darurat)
   • Into The Light / Kemenkes 1500-454 (konseling)

   Saya juga sudah meneruskan ke petugas desa agar dibantu langsung.
   ```
2. Trigger `startTakeoverForUser(userId, { reason: 'emergency_escalation',
   severity: 'high', signal: '<detector_label>' })`.
3. Kirim push/webhook ke admin channel (Slack, email, atau channel-service
   supervisor inbox) dengan: village_id, user identifier (masked),
   timestamp, snippet message (redacted), detector_label.

### 3. Observability

Rekam ke `ai_guardrail_events` dengan `guardStage: 'emergency_escalation'`,
`guardType: 'self_harm' | 'violence' | 'medical_crisis'`.

Jangan cache respon ini. Jangan biarkan answer-policy verifier menulis
ulang. Tambahkan `handledByGuard: true` supaya reconciler skip.

### 4. Throttle & audit

- Satu user hanya memicu takeover 1x per 15 menit (cegah spam).
- Setiap takeover wajib di-log di tabel khusus `ai_emergency_escalations`
  untuk audit:
  - id, village_id, user_identifier_hash, detector_label, signal_phrase
    (redacted), regex_matched, llm_verdict, action_taken
    (notified_admin | called_takeover | both), admin_ack_at.

### 5. Failure mode

- Jika `startTakeoverForUser` gagal → tetap kirim hotline response + log
  error. Admin-side tooling bisa monitoring error rate.
- Jika micro-LLM gagal verifikasi → LALUI regex decision sebagai fallback
  (prefer false positive over false negative untuk kategori ini).

## Threshold & tuning

- Regex broad-signal + LLM verified = **HARD ESCALATION**.
- Regex broad-signal + LLM says NO = **BALAS HOTLINE only** (tanpa
  takeover).
- `needsHumanEscalation(sentiment)` = HIGH + keyword "marah/kesal/
  buruk" = **TAKEOVER biasa** (tanpa hotline). Sudah ada di sentiment
  service; ini berbeda jalur.

## Open questions untuk user review

1. **Hotline**: Apakah pakai nomor nasional (119/118/1500-454) atau ada
   nomor khusus desa / pendamping sosial yang lebih tepat?
2. **Admin alert channel**: Slack, email, channel-service supervisor
   queue, atau semuanya?
3. **Throttle 15 menit**: apakah terlalu lama? Terlalu pendek? Adakah
   kebijakan resmi kelurahan?
4. **Consent logging**: apakah isi message (meski redacted) boleh
   disimpan untuk audit > 90 hari? Atau hanya retention pendek?
5. **False positive recovery**: kalau detector salah panggil takeover,
   apakah admin bisa "un-takeover" dan auto-resume AI session?
6. **Tiap village punya nomor pendamping lokal sendiri?** Kalau ya,
   ambil dari `important_contacts` dengan category `pendamping_sosial`.

## Implementation estimate

Setelah pertanyaan di atas dijawab:

| Fase | Item | Waktu estimasi |
|------|------|----------------|
| 1 | Regex detector + micro-LLM verifier | ~2 jam |
| 2 | Response template + hotline injection | ~1 jam |
| 3 | Takeover trigger + admin webhook | ~2 jam |
| 4 | Throttle + audit table migration | ~2 jam |
| 5 | Tests (detector + integration) | ~2 jam |

**Total: ~1 hari kerja** setelah keputusan threshold.

## Risiko implementasi

1. **False negative** (gagal detect bahaya) lebih berbahaya daripada false
   positive. Kalibrasi harus konservatif.
2. Template response terlalu formal bisa counter-productive pada user
   dalam krisis. Harus dites dengan konsultan/psikolog jika memungkinkan.
3. Takeover mendadak bisa membingungkan petugas desa jika mereka tidak
   siap. Perlu onboarding + SOP operator.
