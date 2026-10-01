# Eval Harness

Framework evaluasi otomatis untuk pipeline AI GovConnect. Menjalankan kasus-kasus
natural **baru** (bukan ulangan golden set) terhadap pipeline dengan **LLM yang
di-mock** — tidak ada panggilan provider nyata, hasil deterministik.

## Menjalankan

```bash
npm run eval        # hanya harness ini
npm test            # seluruh suite (termasuk harness)
```

## Struktur

```
src/eval/
  types.ts            # EvalCase: id, category, input, expect, run()
  support.ts          # check(), scripted LLM/tool mocks, evalContext()
  cases/
    index.ts          # registry — tambah file kategori baru di sini
    intent-classification.ts   # klasifikasi intent + ekstraksi slot (dialek, typo, ambiguitas)
    multi-turn.ts              # FSM slot lintas turn + lane VERIFY deterministik
    tool-use.ts                # staged agent dengan LLM scripted (tool_calls)
    fallback.ts                # degradasi: fallback ticket, assessor outage, bahasa daerah
    anaphora.ts                # anafora: VERIFY pending guard, COLLECT protection
    correction.ts              # koreksi user: mid-collect fix, cancel, confirmation chain
    live-llm.ts                # kasus yang BUTUH LLM nyata → SKIP by default
  __tests__/
    eval-harness.test.ts       # runner vitest + tabel ringkasan
```

## Menambah case baru

1. Buat fungsi `run` di file kategori yang sesuai (atau file baru di `cases/`).
2. Gunakan `check(kondisi, 'pesan')` dari `support.ts` — gagal = FAIL dengan pesan.
3. Script perilaku LLM per case: `mockCallLlm().mockResolvedValueOnce(llmToolResult([...]))`.
4. Script perilaku tool: `mockGatewayExecute().mockImplementation(async (tool) => toolOk(...))`.
5. Daftarkan di `cases/index.ts`. Id case harus unik (`EVAL-<huruf><nn>`).

## Aturan

- Jangan mengulang kasus yang sudah pass di round-1 — buat varian baru
  (dialek, typo, multi-intent, anafora, koreksi, edge).
- Case yang butuh penilaian LLM nyata (bukan orkestrasi) → `liveLLM: true`,
  dilaporkan sebagai SKIP eksplisit, bukan diam-diam.
- `run()` tidak boleh menyentuh DB/RabbitMQ/provider — mock sudah disiapkan
  runner (lihat `__tests__/eval-harness.test.ts`).
