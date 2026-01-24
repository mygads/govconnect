export function normalizeTo628(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

export function isValidCitizenWaNumber(value: string): boolean {
  return /^628\d{8,12}$/.test(value);
}

export function normalizeCitizenWaForStorage(input: string): string {
  return normalizeTo628(input);
}

export function sameCitizenWa(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeTo628(a || '');
  const nb = normalizeTo628(b || '');
  if (!na || !nb) return false;
  return na === nb;
}
