/**
 * Interactive response id extraction (WhatsApp button/list clicks).
 *
 * P0-1 contract: the button id is AUTHORITATIVE for the G2/G3 confirmation
 * chain in ai-service (it binds `confirm_send` to the pending mutation).
 * The display text is not trustworthy for this purpose, so the id must be
 * forwarded explicitly as `button_id` — never inferred from the text.
 *
 * Dependency-free on purpose: this module is unit-tested with node:test
 * without pulling the webhook controller's server dependencies.
 */

function pickValue(value: any, ...keys: string[]): any {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return undefined;
}

function pickObject(value: any, ...keys: string[]): any {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] && typeof value[key] === 'object') return value[key];
  }
  return null;
}

function firstString(...values: any[]): string | null {
  const found = values.find((value) => typeof value === 'string' && value.trim());
  return found ? found.trim() : null;
}

/**
 * Extract the interactive button/row ID from a button or list response
 * object. ID fields are preferred over display-text fields (the reverse
 * priority of extractInteractiveResponseText). Returns null when absent.
 */
export function extractInteractiveResponseId(response: any): string | null {
  if (!response || typeof response !== 'object') return null;
  const direct = pickValue(
    response,
    'selectedButtonId',
    'selectedButtonID',
    'SelectedButtonId',
    'SelectedButtonID',
    'selectedRowId',
    'selectedRowID',
    'SelectedRowId',
    'SelectedRowID',
    'id',
    'Id',
    'ID',
  );
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  // WhatsApp Cloud API style: interactive.button_reply.id / list_reply.id
  const nestedReply = pickObject(
    response, 'button_reply', 'buttonReply', 'ButtonReply', 'list_reply', 'listReply', 'ListReply',
  );
  if (nestedReply && nestedReply !== response) {
    const nestedId = extractInteractiveResponseId(nestedReply);
    if (nestedId) return nestedId;
  }

  const nested = pickObject(
    response, 'Response', 'response', 'singleSelectReply', 'SingleSelectReply',
    'nativeFlowResponseMessage', 'NativeFlowResponseMessage', 'interactive', 'Interactive',
  );
  if (nested && nested !== response) {
    const nestedId = extractInteractiveResponseId(nested);
    if (nestedId) return nestedId;
  }

  const params = pickValue(response, 'paramsJson', 'ParamsJson', 'buttonParamsJSON', 'ButtonParamsJSON');
  if (typeof params === 'string') {
    try {
      const parsed = JSON.parse(params);
      return firstString(parsed.id, parsed.Id, parsed.ID);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Extract the button/row id from any interactive response sub-object of a
 * raw WhatsApp message (buttons, template buttons, lists, Cloud interactive).
 */
export function extractInteractiveResponseIdFromMessage(message: any): string | null {
  if (!message || typeof message !== 'object') return null;
  const responses = [
    pickObject(message, 'buttonsResponseMessage', 'ButtonsResponseMessage', 'templateButtonReplyMessage', 'TemplateButtonReplyMessage'),
    pickObject(message, 'listResponseMessage', 'ListResponseMessage'),
    pickObject(message, 'interactiveResponseMessage', 'InteractiveResponseMessage'),
    pickObject(message, 'interactive', 'Interactive'),
  ];
  for (const r of responses) {
    const id = extractInteractiveResponseId(r);
    if (id) return id;
  }
  return null;
}
