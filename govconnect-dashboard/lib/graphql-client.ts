/**
 * GraphQL Client for Public Forms
 * 
 * Simple fetch-based client without heavy Apollo dependencies
 */

// Use dashboard's API proxy to avoid CORS issues
const GRAPHQL_ENDPOINT = '/api/graphql';

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

export async function graphqlFetch<T>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const result: GraphQLResponse<T> = await response.json();

  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0].message);
  }

  if (!result.data) {
    throw new Error('No data returned from GraphQL');
  }

  return result.data;
}

// ==================== QUERIES ====================

export const GET_SERVICES = `
  query GetServices {
    services {
      code
      name
      description
      category
      requirements
      estimated_duration
      daily_quota
      is_active
      is_online_available
      citizen_questions {
        field
        question
        type
        required
        options
      }
      all_questions {
        field
        question
        type
        required
        options
      }
    }
  }
`;

export const GET_SERVICE = `
  query GetService($code: String!) {
    service(code: $code) {
      code
      name
      description
      category
      requirements
      sop_steps
      estimated_duration
      daily_quota
      is_active
      is_online_available
      citizen_questions {
        field
        question
        type
        required
        options
      }
      all_questions {
        field
        question
        type
        required
        options
      }
    }
  }
`;

export const GET_AVAILABLE_SLOTS = `
  query GetAvailableSlots($serviceCode: String!, $date: String!) {
    availableSlots(serviceCode: $serviceCode, date: $date) {
      service_code
      date
      day_name
      is_open
      slots {
        time
        available
        remaining
      }
      daily_quota
      total_booked
    }
  }
`;

export const GET_COMPLAINT_CATEGORIES = `
  query GetComplaintCategories {
    complaintCategories {
      code
      name
      description
      icon
    }
  }
`;

// ==================== MUTATIONS ====================

export const CREATE_COMPLAINT = `
  mutation CreateComplaint($input: CreateComplaintInput!) {
    createComplaint(input: $input) {
      success
      complaint_id
      message
      error
    }
  }
`;

export const CREATE_RESERVATION = `
  mutation CreateReservation($input: CreateReservationInput!) {
    createReservation(input: $input) {
      success
      reservation_id
      queue_number
      message
      error
    }
  }
`;

// ==================== TYPES ====================

export interface CitizenQuestion {
  field: string;
  question: string;
  type: 'text' | 'number' | 'date' | 'select';
  required: boolean;
  options?: string[];
}

export interface Service {
  code: string;
  name: string;
  description: string;
  category: string;
  requirements: string[];
  sop_steps?: string[];
  estimated_duration: number;
  daily_quota: number;
  is_active?: boolean;
  is_online_available?: boolean;
  citizen_questions: CitizenQuestion[];
  all_questions: CitizenQuestion[];
}

export interface TimeSlot {
  time: string;
  available: boolean;
  remaining?: number;
}

export interface AvailableSlots {
  service_code: string;
  date: string;
  day_name: string;
  is_open: boolean;
  slots: TimeSlot[];
  daily_quota: number;
  total_booked: number;
}

export interface ComplaintCategory {
  code: string;
  name: string;
  description: string;
  icon: string;
}

export interface CreateComplaintInput {
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
  foto_url?: string;
  nama_pelapor: string;
  no_hp: string;
}

export interface CreateReservationInput {
  service_code: string;
  reservation_date: string;
  reservation_time: string;
  nama_lengkap: string;
  nik: string;
  alamat: string;
  no_hp: string;
  additional_data?: string;
}

export interface CreateComplaintResponse {
  success: boolean;
  complaint_id?: string;
  message?: string;
  error?: string;
}

export interface CreateReservationResponse {
  success: boolean;
  reservation_id?: string;
  queue_number?: number;
  message?: string;
  error?: string;
}
