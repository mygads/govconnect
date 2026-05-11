export interface AuthoritativeComplaintClassification {
  type_id: string;
  category_id: string;
  is_urgent: boolean;
  require_address: boolean;
}

export interface ComplaintClassificationInput {
  type_id?: string;
  category_id?: string;
  is_urgent?: boolean;
  require_address?: boolean;
}

export function mergeComplaintClassification(
  input: ComplaintClassificationInput,
  authoritative: AuthoritativeComplaintClassification | null,
): Required<ComplaintClassificationInput> {
  if (authoritative) {
    return {
      type_id: authoritative.type_id,
      category_id: authoritative.category_id,
      is_urgent: authoritative.is_urgent,
      require_address: authoritative.require_address,
    };
  }

  return {
    type_id: input.type_id || '',
    category_id: input.category_id || '',
    is_urgent: input.is_urgent ?? false,
    require_address: input.require_address ?? false,
  };
}
