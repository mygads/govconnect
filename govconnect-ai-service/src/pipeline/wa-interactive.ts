/**
 * WhatsApp interactive message builders (ai-service side).
 *
 * Design (arsitektur-final §5.5 UX WA-native, v5):
 * - Triage/ambiguity → interactive LIST of categories.
 * - Missing enumerable slot → LIST of options.
 * - VERIFY summary → reply BUTTONS (Benar kirim / Ubah / Batal).
 * - Everything degrades to plain text: the payload is OPTIONAL metadata on
 *   the reply; the text body always carries the full meaning.
 *
 * Shapes match the channel-service interactive convention
 * (see normalizeInteractivePayload in livechat.controller.ts):
 *   buttons → { type:'buttons', body, buttons:[{type:'reply', title, id}], footer? }
 *   list    → { type:'list', body, buttonText, sections:[{title, rows:[{title, desc, RowId}]}] }
 *
 * Limits enforced (WhatsApp):
 * - buttons: max 3, title ≤ 20 chars
 * - list: buttonText ≤ 20 chars, ≤ 10 rows per section, title ≤ 24 chars
 */

export type InteractivePayload =
  | {
      type: 'buttons';
      body: string;
      buttons: Array<{ type: 'reply'; id: string; title: string }>;
      footer?: string;
    }
  | {
      type: 'list';
      body: string;
      buttonText: string;
      sections: Array<{
        title?: string;
        rows: Array<{ title: string; desc?: string; RowId?: string }>;
      }>;
      footer?: string;
    };

const trunc = (s: string, n: number): string =>
  s.length > n ? s.slice(0, n - 1) + '…' : s;

/** VERIFY: confirm / edit / cancel buttons. */
export function confirmButtons(body: string): InteractivePayload {
  return {
    type: 'buttons',
    body,
    buttons: [
      { type: 'reply', id: 'confirm_send', title: '✅ Benar, kirim' },
      { type: 'reply', id: 'edit_data', title: '✏️ Ubah' },
      { type: 'reply', id: 'cancel_request', title: '❌ Batal' },
    ],
    footer: 'Pilih salah satu di atas.',
  };
}

/** Simple yes/no quick reply. */
export function yesNoButtons(body: string): InteractivePayload {
  return {
    type: 'buttons',
    body,
    buttons: [
      { type: 'reply', id: 'confirm_yes', title: 'Ya' },
      { type: 'reply', id: 'confirm_no', title: 'Tidak' },
    ],
  };
}

export interface ListOption { id: string; title: string; description?: string }

/**
 * Generic option list. Degrades gracefully: options beyond 10 are dropped
 * (the text body still lists everything).
 */
export function optionList(
  body: string,
  buttonText: string,
  sectionTitle: string,
  options: ListOption[],
  footer?: string,
): InteractivePayload {
  return {
    type: 'list',
    body,
    buttonText: trunc(buttonText, 20),
    sections: [
      {
        title: trunc(sectionTitle, 24),
        rows: options.slice(0, 10).map((o) => ({
          title: trunc(o.title, 24),
          desc: o.description ? trunc(o.description, 72) : undefined,
          RowId: o.id,
        })),
      },
    ],
    footer,
  };
}

/** Complaint categories offered when TRIAGE is ambiguous. */
export const COMPLAINT_CATEGORY_OPTIONS: ListOption[] = [
  { id: 'cat_jalan', title: 'Jalan rusak', description: 'Jalan berlubang, rusak, atau jembatan' },
  { id: 'cat_sampah', title: 'Sampah', description: 'Sampah menumpuk atau tidak diangkut' },
  { id: 'cat_air', title: 'Air bersih', description: 'Air mati, PDAM, atau kekeringan' },
  { id: 'cat_lampu', title: 'Penerangan jalan', description: 'Lampu jalan mati atau gelap' },
  { id: 'cat_banjir', title: 'Banjir / drainase', description: 'Banjir atau saluran mampet' },
  { id: 'cat_admin', title: 'Administrasi', description: 'KTP, KK, surat-surat' },
  { id: 'cat_lain', title: 'Lainnya', description: 'Keperluan lain, tulis manual' },
];

/** TRIAGE ambiguity → category list. */
export function categoryList(body: string): InteractivePayload {
  return optionList(
    body,
    'Pilih kategori',
    'Kategori laporan',
    COMPLAINT_CATEGORY_OPTIONS,
    'Kalau tidak ada yang cocok, balas saja dengan kata-katamu sendiri.',
  );
}

/** Validate an interactive payload before it leaves ai-service. */
export function validateInteractive(p: InteractivePayload): boolean {
  if (p.type === 'buttons') {
    return p.buttons.length >= 1 && p.buttons.length <= 3 &&
      p.buttons.every((b) => b.id.length > 0 && b.title.length > 0 && b.title.length <= 20);
  }
  const rows = p.sections.flatMap((s) => s.rows);
  return p.buttonText.length > 0 && p.buttonText.length <= 20 &&
    rows.length >= 1 && rows.length <= 10 &&
    rows.every((r) => r.title.length > 0);
}
