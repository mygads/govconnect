import type { Prisma } from '@prisma/client';

export type ServiceRequestFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'radio' | 'file';
export type CitizenFieldValidationKind = 'nik' | 'wa_phone';
export type CanonicalServiceMode = 'ONLINE' | 'OFFLINE' | 'BOTH';
export type PublicServiceMode = 'online' | 'offline' | 'both';

export interface CitizenFieldDefinition {
  key: string;
  label: string;
  field_type: Exclude<ServiceRequestFieldType, 'file'>;
  is_required: boolean;
  help_text?: string | null;
  options?: string[];
  validation?: CitizenFieldValidationKind | null;
}

export interface RequirementFieldDefinition {
  key: string;
  label: string;
  field_type: ServiceRequestFieldType;
  is_required: boolean;
  help_text?: string | null;
  options?: string[];
}

export interface UploadedRequirementFile {
  url: string;
  internal_url?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  size?: number | null;
  storage_key?: string | null;
}

export type RequirementFieldValue = string | UploadedRequirementFile;

export interface ServiceRequestSchema {
  submissionPolicy: {
    mode: PublicServiceMode;
    allowsPublicSubmission: boolean;
  };
  citizenFields: CitizenFieldDefinition[];
  requirementFields: RequirementFieldDefinition[];
}

export interface ServiceRequestValidationResult {
  ok: boolean;
  citizenData: Record<string, string>;
  requirementData: Record<string, RequirementFieldValue>;
  errors: string[];
}

const SERVICE_MODE_LABELS: Record<CanonicalServiceMode, PublicServiceMode> = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  BOTH: 'both',
};

export function normalizeServiceMode(value: unknown): CanonicalServiceMode | null {
  if (typeof value !== 'string') return null;

  switch (value.trim().toLowerCase()) {
    case 'online':
      return 'ONLINE';
    case 'offline':
      return 'OFFLINE';
    case 'both':
      return 'BOTH';
    default:
      return null;
  }
}

export function serializeServiceMode(value: unknown): PublicServiceMode {
  const normalized = normalizeServiceMode(value);
  return normalized ? SERVICE_MODE_LABELS[normalized] : 'offline';
}

export function allowsPublicServiceSubmission(value: unknown): boolean {
  const normalized = normalizeServiceMode(value);
  return normalized === 'ONLINE' || normalized === 'BOTH';
}

const CITIZEN_FIELD_CATALOG: Record<string, Omit<CitizenFieldDefinition, 'is_required'>> = {
  nama_lengkap: {
    key: 'nama_lengkap',
    label: 'Nama Lengkap',
    field_type: 'text',
    help_text: 'Nama pemohon sesuai identitas.',
    validation: null,
  },
  nik: {
    key: 'nik',
    label: 'NIK',
    field_type: 'text',
    help_text: '16 digit Nomor Induk Kependudukan.',
    validation: 'nik',
  },
  alamat: {
    key: 'alamat',
    label: 'Alamat',
    field_type: 'textarea',
    help_text: 'Alamat domisili lengkap pemohon.',
    validation: null,
  },
  no_hp: {
    key: 'no_hp',
    label: 'Nomor WhatsApp',
    field_type: 'text',
    help_text: 'Nomor aktif yang bisa dihubungi petugas.',
    validation: 'wa_phone',
  },
  tempat_lahir: {
    key: 'tempat_lahir',
    label: 'Tempat Lahir',
    field_type: 'text',
    help_text: null,
    validation: null,
  },
  tanggal_lahir: {
    key: 'tanggal_lahir',
    label: 'Tanggal Lahir',
    field_type: 'date',
    help_text: null,
    validation: null,
  },
  jenis_kelamin: {
    key: 'jenis_kelamin',
    label: 'Jenis Kelamin',
    field_type: 'radio',
    help_text: null,
    options: ['Laki-laki', 'Perempuan'],
    validation: null,
  },
  pekerjaan: {
    key: 'pekerjaan',
    label: 'Pekerjaan',
    field_type: 'text',
    help_text: null,
    validation: null,
  },
  agama: {
    key: 'agama',
    label: 'Agama',
    field_type: 'select',
    help_text: null,
    options: ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu', 'Lainnya'],
    validation: null,
  },
  kewarganegaraan: {
    key: 'kewarganegaraan',
    label: 'Kewarganegaraan',
    field_type: 'text',
    help_text: null,
    validation: null,
  },
  status_perkawinan: {
    key: 'status_perkawinan',
    label: 'Status Perkawinan',
    field_type: 'select',
    help_text: null,
    options: ['Belum Kawin', 'Kawin', 'Cerai Hidup', 'Cerai Mati'],
    validation: null,
  },
};

const DEFAULT_CITIZEN_FIELDS: CitizenFieldDefinition[] = [
  { ...CITIZEN_FIELD_CATALOG.nama_lengkap, is_required: true },
  { ...CITIZEN_FIELD_CATALOG.nik, is_required: true },
  { ...CITIZEN_FIELD_CATALOG.alamat, is_required: true },
  { ...CITIZEN_FIELD_CATALOG.no_hp, is_required: true },
];

const ALLOWED_REQUIREMENT_FILE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_REQUIREMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function toStringArray(value: unknown): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map((item) => String(item).trim()).filter(Boolean);
  }
  return undefined;
}

function normalizeObjectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeFieldType(value: unknown, fallback: ServiceRequestFieldType): ServiceRequestFieldType {
  if (typeof value !== 'string') return fallback;
  if (['text', 'textarea', 'number', 'date', 'select', 'radio', 'file'].includes(value)) {
    return value as ServiceRequestFieldType;
  }
  return fallback;
}

function normalizeCitizenFieldType(value: unknown, fallback: Exclude<ServiceRequestFieldType, 'file'>): Exclude<ServiceRequestFieldType, 'file'> {
  const normalized = normalizeFieldType(value, fallback);
  return normalized === 'file' ? fallback : normalized;
}

function normalizeCitizenFieldDefinition(raw: unknown): CitizenFieldDefinition | null {
  const record = normalizeObjectInput(raw);
  const key = typeof record.key === 'string' ? record.key.trim() : '';
  if (!key) return null;

  const preset = CITIZEN_FIELD_CATALOG[key];
  const label = typeof record.label === 'string' && record.label.trim()
    ? record.label.trim()
    : preset?.label || key;
  const field_type = normalizeCitizenFieldType(record.field_type, preset?.field_type || 'text');
  const options = toStringArray(record.options || record.options_json) || preset?.options;
  const validation = typeof record.validation === 'string'
    ? (record.validation === 'nik' || record.validation === 'wa_phone' ? record.validation : null)
    : preset?.validation || null;

  return {
    key,
    label,
    field_type,
    is_required: normalizeBoolean(record.is_required, true),
    help_text: typeof record.help_text === 'string' ? (record.help_text.trim() || null) : (preset?.help_text ?? null),
    options,
    validation,
  };
}

export function getCitizenFieldCatalog(): CitizenFieldDefinition[] {
  return Object.values(CITIZEN_FIELD_CATALOG).map((field) => ({
    ...field,
    is_required: field.key === 'nama_lengkap' || field.key === 'nik' || field.key === 'alamat' || field.key === 'no_hp',
  }));
}

export function normalizeCitizenFieldDefinitions(raw: Prisma.JsonValue | null | undefined): CitizenFieldDefinition[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_CITIZEN_FIELDS;
  }

  const fields = raw
    .map((item) => normalizeCitizenFieldDefinition(item))
    .filter((item): item is CitizenFieldDefinition => !!item);

  return fields.length > 0 ? fields : DEFAULT_CITIZEN_FIELDS;
}

export function buildServiceRequestSchema(service: {
  mode: unknown;
  citizen_fields_json?: Prisma.JsonValue | null;
  requirements?: Array<{
    id: string;
    label: string;
    field_type: string;
    is_required: boolean;
    help_text?: string | null;
    options_json?: Prisma.JsonValue | null;
  }>;
}): ServiceRequestSchema {
  return {
    submissionPolicy: {
      mode: serializeServiceMode(service.mode),
      allowsPublicSubmission: allowsPublicServiceSubmission(service.mode),
    },
    citizenFields: normalizeCitizenFieldDefinitions(service.citizen_fields_json),
    requirementFields: (service.requirements || []).map((requirement) => ({
      key: requirement.id,
      label: requirement.label,
      field_type: normalizeFieldType(requirement.field_type, 'text'),
      is_required: !!requirement.is_required,
      help_text: requirement.help_text || null,
      options: toStringArray(requirement.options_json),
    })),
  };
}

function normalizeStringFieldValue(value: unknown): string {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeUploadedRequirementFile(value: unknown): UploadedRequirementFile | null {
  if (typeof value === 'string') {
    const url = value.trim();
    return url ? { url } : null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const url = normalizeStringFieldValue(record.url);
  if (!url) return null;

  const internalUrl = normalizeStringFieldValue(record.internal_url);
  const fileName = normalizeStringFieldValue(record.file_name || record.fileName);
  const mimeType = normalizeStringFieldValue(record.mime_type || record.mimeType);
  const storageKey = normalizeStringFieldValue(record.storage_key || record.storageKey);
  const sizeRaw = record.size;
  const size = typeof sizeRaw === 'number'
    ? sizeRaw
    : typeof sizeRaw === 'string' && sizeRaw.trim() && !Number.isNaN(Number(sizeRaw))
      ? Number(sizeRaw)
      : null;

  return {
    url,
    internal_url: internalUrl || null,
    file_name: fileName || null,
    mime_type: mimeType || null,
    size: size !== null && Number.isFinite(size) ? size : null,
    storage_key: storageKey || null,
  };
}

function hasFilledValue(value: string): boolean {
  return !!value.trim();
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateUploadedRequirementFile(field: RequirementFieldDefinition, file: UploadedRequirementFile): string | null {
  if (!isValidHttpUrl(file.url)) {
    return `${field.label} harus berupa file upload yang valid.`;
  }

  if (file.internal_url && !isValidHttpUrl(file.internal_url)) {
    return `${field.label} memiliki internal_url yang tidak valid.`;
  }

  if (file.file_name && (file.file_name.length > 255 || /[\r\n]/.test(file.file_name))) {
    return `${field.label} memiliki nama file yang tidak valid.`;
  }

  if (file.mime_type) {
    const normalizedMime = file.mime_type.trim().toLowerCase();
    if (!ALLOWED_REQUIREMENT_FILE_MIME_TYPES.has(normalizedMime)) {
      return `${field.label} memiliki tipe file yang tidak didukung.`;
    }
    file.mime_type = normalizedMime;
  }

  if (file.size !== null && typeof file.size !== 'undefined') {
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_REQUIREMENT_FILE_SIZE_BYTES) {
      return `${field.label} memiliki ukuran file yang tidak valid.`;
    }
    file.size = Math.trunc(file.size);
  }

  if (file.storage_key && (file.storage_key.length > 512 || /[\r\n]/.test(file.storage_key))) {
    return `${field.label} memiliki storage_key yang tidak valid.`;
  }

  return null;
}

function validateFieldType(field: CitizenFieldDefinition | RequirementFieldDefinition, value: string): string | null {
  if (!hasFilledValue(value)) return null;

  if (field.field_type === 'number' && Number.isNaN(Number(value))) {
    return `${field.label} harus berupa angka.`;
  }

  if (field.field_type === 'date' && Number.isNaN(Date.parse(value))) {
    return `${field.label} harus berupa tanggal yang valid.`;
  }

  if ((field.field_type === 'select' || field.field_type === 'radio') && field.options?.length && !field.options.includes(value)) {
    return `${field.label} harus memilih salah satu opsi yang tersedia.`;
  }

  return null;
}

function validateCitizenField(field: CitizenFieldDefinition, value: string): string | null {
  const typeError = validateFieldType(field, value);
  if (typeError) return typeError;
  if (!hasFilledValue(value)) return null;

  if (field.validation === 'nik' && !/^\d{16}$/.test(value)) {
    return `${field.label} harus terdiri dari 16 digit.`;
  }

  if (field.validation === 'wa_phone') {
    const digits = value.replace(/\D/g, '');
    if (!/^(08\d{8,12}|628\d{8,12})$/.test(digits)) {
      return `${field.label} harus berupa nomor WhatsApp Indonesia yang valid.`;
    }
  }

  return null;
}

function validateRequirementField(
  field: RequirementFieldDefinition,
  value: unknown,
): { normalized: RequirementFieldValue | null; error: string | null } {
  if (field.field_type === 'file') {
    const file = normalizeUploadedRequirementFile(value);
    if (field.is_required && !file) {
      return { normalized: null, error: `${field.label} wajib diisi.` };
    }
    if (!file) {
      return { normalized: null, error: null };
    }

    const fileError = validateUploadedRequirementFile(field, file);
    if (fileError) {
      return { normalized: null, error: fileError };
    }

    return { normalized: file, error: null };
  }

  const normalized = normalizeStringFieldValue(value);
  if (field.is_required && !hasFilledValue(normalized)) {
    return { normalized: null, error: `${field.label} wajib diisi.` };
  }
  const validationError = validateFieldType(field, normalized);
  if (validationError) {
    return { normalized: null, error: validationError };
  }
  return {
    normalized: hasFilledValue(normalized) ? normalized : null,
    error: null,
  };
}

export function validateServiceRequestPayload(
  schema: ServiceRequestSchema,
  citizenDataInput: unknown,
  requirementDataInput: unknown,
): ServiceRequestValidationResult {
  const citizenInput = normalizeObjectInput(citizenDataInput);
  const requirementInput = normalizeObjectInput(requirementDataInput);
  const citizenData: Record<string, string> = {};
  const requirementData: Record<string, RequirementFieldValue> = {};
  const errors: string[] = [];

  for (const field of schema.citizenFields) {
    const value = normalizeStringFieldValue(citizenInput[field.key]);
    if (field.is_required && !hasFilledValue(value)) {
      errors.push(`${field.label} wajib diisi.`);
      continue;
    }
    const validationError = validateCitizenField(field, value);
    if (validationError) {
      errors.push(validationError);
      continue;
    }
    if (hasFilledValue(value)) {
      citizenData[field.key] = value;
    }
  }

  for (const field of schema.requirementFields) {
    const { normalized, error } = validateRequirementField(field, requirementInput[field.key]);
    if (error) {
      errors.push(error);
      continue;
    }
    if (normalized !== null) {
      requirementData[field.key] = normalized;
    }
  }

  return {
    ok: errors.length === 0,
    citizenData,
    requirementData,
    errors,
  };
}
