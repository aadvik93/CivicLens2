export type CheckFixStatus = 'reported' | 'under_review' | 'action_reported' | 'resolution_verified' | 'needs_more_evidence' | 'reopened';
export type CheckFixOutcome = 'possible_improvement' | 'problem_may_remain' | 'cannot_assess';
export type ReporterResponse = 'confirm_improvement' | 'dispute';

export const CHECK_FIX_STATUS_LABELS: Record<CheckFixStatus, string> = {
  reported: 'Reported',
  under_review: 'Under review',
  action_reported: 'Action reported',
  resolution_verified: 'Resolution verified',
  needs_more_evidence: 'Needs more evidence',
  reopened: 'Reopened',
};



export const CHECK_FIX_OUTCOME_LABELS: Record<CheckFixOutcome, string> = {
  possible_improvement: 'Possible improvement',
  problem_may_remain: 'Problem may remain',
  cannot_assess: 'Cannot assess — needs human review',
};

const ALLOWED_TRANSITIONS: Record<CheckFixStatus, readonly CheckFixStatus[]> = {
  reported: ['under_review'],
  under_review: ['needs_more_evidence'],
  action_reported: ['resolution_verified'],
  resolution_verified: [],
  needs_more_evidence: ['under_review'],
  reopened: ['under_review'],
};

export function canReviewerTransition(from: string, to: CheckFixStatus): boolean {
  const legacyTransitions: Record<string, readonly CheckFixStatus[]> = {
    new: ['under_review'], in_review: ['under_review'], needs_information: ['under_review'], closed_internal: ['reopened'],
  };
  if (from in legacyTransitions) return legacyTransitions[from].includes(to);
  return from in ALLOWED_TRANSITIONS && ALLOWED_TRANSITIONS[from as CheckFixStatus].includes(to);
}

/** Haversine distance. Coordinates are hints, not evidence of photo authenticity. */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function isCurrentAssessment(
  assessment: { evidence_id: string; before_object_path: string },
  latestEvidenceId: string | null,
  currentBeforePath: string,
): boolean {
  return Boolean(latestEvidenceId && assessment.evidence_id === latestEvidenceId && assessment.before_object_path === currentBeforePath);
}

export function validateCheckFixPhoto(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose a JPG, PNG, or WebP photograph.';
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) return 'Photograph must be larger than 0 bytes and no more than 5 MB.';
  return null;
}

export function isRecurrenceCandidate(input: {
  newCategory: string; priorCategory: string; priorStatus: string; newDataClass: string; priorDataClass: string;
  newCreatedAt: string; priorCreatedAt: string; newCoordinates?: { latitude: number; longitude: number } | null;
  priorCoordinates?: { latitude: number; longitude: number } | null; now?: number; radiusMeters?: number; lookbackDays?: number;
}): boolean {
  if (input.newCategory !== 'Garbage dump' || input.priorCategory !== 'Garbage dump' || input.priorStatus !== 'resolution_verified') return false;
  if (input.newDataClass !== input.priorDataClass || !input.newCoordinates || !input.priorCoordinates) return false;
  const now = input.now ?? Date.now();
  const newTime = Date.parse(input.newCreatedAt);
  const priorTime = Date.parse(input.priorCreatedAt);
  if (!Number.isFinite(newTime) || !Number.isFinite(priorTime) || priorTime >= newTime) return false;
  const lookbackMs = (input.lookbackDays ?? 90) * 24 * 60 * 60 * 1000;
  if (priorTime < now - lookbackMs) return false;
  return distanceMeters(input.newCoordinates, input.priorCoordinates) <= (input.radiusMeters ?? 150);
}
