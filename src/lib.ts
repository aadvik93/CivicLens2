import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isSupabaseConfigured = Boolean(url && anonKey);
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export const PHOTO_BUCKET = 'civiclens-private-photos';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const CATEGORIES = [
  'Garbage dump', 'Pothole', 'Waterlogging', 'Broken streetlight', 'Open drain', 'Other / Needs review',
] as const;
export type IssueCategory = typeof CATEGORIES[number];
export const INTERNAL_STATUSES = ['new', 'in_review', 'needs_information', 'closed_internal'] as const;
export const CHECK_FIX_STATUSES = ['reported', 'under_review', 'action_reported', 'resolution_verified', 'needs_more_evidence', 'reopened'] as const;
export type InternalStatus = typeof INTERNAL_STATUSES[number] | typeof CHECK_FIX_STATUSES[number];
export const STATUS_LABELS: Record<InternalStatus, string> = {
  new: 'New', in_review: 'In review', needs_information: 'Needs information', closed_internal: 'Closed internally',
  reported: 'Reported', under_review: 'Under review', action_reported: 'Action reported', resolution_verified: 'Resolution verified',
  needs_more_evidence: 'Needs more evidence', reopened: 'Reopened',
};

export interface ReportHistory {
  id: number;
  report_id: string;
  actor_id: string;
  actor_role?: 'resident' | 'reviewer' | 'system' | null;
  internal_status_old: InternalStatus | null;
  internal_status_new: InternalStatus;
  note: string;
  created_at: string;
}
export interface CivicReport {
  id: string;
  reporter_id: string;
  category: IssueCategory;
  description: string;
  complaint_text: string;
  complaint_language: 'English' | 'Hindi';
  location_label: string;
  latitude: number;
  longitude: number;
  location_accuracy_m: number | null;
  photo_object_path: string;
  internal_status: InternalStatus;
  data_class: 'demo' | 'test' | 'pilot';
  created_at: string;
  updated_at: string;
  report_history?: ReportHistory[];
}

export function makeReportFingerprint(input: {
  category: IssueCategory;
  description: string;
  complaintText: string;
  complaintLanguage: 'English' | 'Hindi';
  locationLabel: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  photoName: string;
  photoSize: number;
  photoLastModified: number;
  photoType: string;
}): string {
  return JSON.stringify(input);
}

export function validatePhoto(file: File): string | null {
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) return 'Choose a JPG, PNG, or WebP photograph.';
  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) return 'Photograph must be larger than 0 bytes and no more than 5 MB.';
  return null;
}

export function makeComplaint(category: IssueCategory, description: string, location: string, language: 'English' | 'Hindi') {
  if (language === 'Hindi') {
    return `विषय: ${category} से संबंधित नागरिक समस्या\n\nमहोदय/महोदया,\nकृपया ${location || 'दिए गए स्थान'} पर दर्ज ${category} की समस्या की जाँच करें। विवरण: ${description || 'कृपया संलग्न फोटो और स्थान की समीक्षा करें।'}\n\nकृपया आवश्यक कार्रवाई और स्थिति के बारे में जानकारी दें।\nधन्यवाद।`;
  }
  return `Subject: Civic issue — ${category}\n\nDear Sir/Madam,\nPlease review the ${category.toLowerCase()} issue reported at ${location || 'the indicated location'}. Details: ${description || 'Please review the attached photograph and location.'}\n\nKindly investigate and share the action taken and complaint status.\nThank you.`;
}
