import { describe, expect, it } from 'vitest';
import { parseVisionAssessment } from '../supabase/functions/_shared/assessment';
import { canReviewerTransition, distanceMeters, isCurrentAssessment, isRecurrenceCandidate, validateCheckFixPhoto } from '../src/checkFix';

const now = Date.parse('2026-10-30T12:00:00Z');
const baseRecurrence = {
  newCategory: 'Garbage dump', priorCategory: 'Garbage dump', priorStatus: 'resolution_verified',
  newDataClass: 'test', priorDataClass: 'test', newCreatedAt: '2026-10-29T12:00:00Z', priorCreatedAt: '2026-10-20T12:00:00Z',
  newCoordinates: { latitude: 28.4744, longitude: 77.5040 },
  priorCoordinates: { latitude: 28.4745, longitude: 77.5041 }, now,
};

describe('Check the Fix workflow guards', () => {
  it('allows only defined reviewer transitions', () => {
    expect(canReviewerTransition('reported', 'under_review')).toBe(true);
    expect(canReviewerTransition('under_review', 'needs_more_evidence')).toBe(true);
    expect(canReviewerTransition('action_reported', 'resolution_verified')).toBe(true);
    expect(canReviewerTransition('reported', 'resolution_verified')).toBe(false);
    expect(canReviewerTransition('resolution_verified', 'under_review')).toBe(false);
  });

  it('calculates distance as metres and recognizes a nearby point', () => {
    expect(distanceMeters(baseRecurrence.newCoordinates, baseRecurrence.priorCoordinates)).toBeGreaterThan(0);
    expect(distanceMeters(baseRecurrence.newCoordinates, baseRecurrence.priorCoordinates)).toBeLessThan(150);
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeGreaterThan(100_000);
  });

  it('suggests a likely recurrence only for same-category, same-data-class, verified nearby prior incidents', () => {
    expect(isRecurrenceCandidate(baseRecurrence)).toBe(true);
    expect(isRecurrenceCandidate({ ...baseRecurrence, priorCategory: 'Pothole' })).toBe(false);
    expect(isRecurrenceCandidate({ ...baseRecurrence, priorStatus: 'action_reported' })).toBe(false);
    expect(isRecurrenceCandidate({ ...baseRecurrence, priorDataClass: 'pilot' })).toBe(false);
    expect(isRecurrenceCandidate({ ...baseRecurrence, priorCoordinates: { latitude: 28.6, longitude: 77.7 } })).toBe(false);
    expect(isRecurrenceCandidate({ ...baseRecurrence, priorCreatedAt: '2026-06-01T00:00:00Z' })).toBe(false);
    expect(isRecurrenceCandidate({ ...baseRecurrence, priorCoordinates: null })).toBe(false);
  });

  it('invalidates assessments when after-photo or original-photo version changes', () => {
    expect(isCurrentAssessment({ evidence_id: 'e1', before_object_path: 'before-1.jpg' }, 'e1', 'before-1.jpg')).toBe(true);
    expect(isCurrentAssessment({ evidence_id: 'e1', before_object_path: 'before-1.jpg' }, 'e2', 'before-1.jpg')).toBe(false);
    expect(isCurrentAssessment({ evidence_id: 'e1', before_object_path: 'before-1.jpg' }, 'e1', 'before-2.jpg')).toBe(false);
    expect(isCurrentAssessment({ evidence_id: 'e1', before_object_path: 'before-1.jpg' }, null, 'before-1.jpg')).toBe(false);
  });

  it('validates advisory AI output and abstains when images are not comparable', () => {
    expect(parseVisionAssessment({ comparable: true, outcome: 'possible_improvement', rationale: 'Visible debris appears reduced.' })).toEqual({ comparable: true, outcome: 'possible_improvement', rationale: 'Visible debris appears reduced.' });
    expect(parseVisionAssessment({ comparable: false, outcome: 'possible_improvement', rationale: 'Different views.' })?.outcome).toBe('cannot_assess');
    expect(parseVisionAssessment({ comparable: true, outcome: 'fraud_detected', rationale: 'No.' })).toBeNull();
    expect(parseVisionAssessment({ comparable: true, outcome: 'problem_may_remain', rationale: '   ' })).toBeNull();
    expect(parseVisionAssessment({ comparable: true, outcome: 'possible_improvement', rationale: 'x', confidence: 99 })).not.toHaveProperty('confidence');
  });

  it('validates after-photo file type and size', () => {
    expect(validateCheckFixPhoto(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))).toBeNull();
    expect(validateCheckFixPhoto(new File(['x'], 'x.svg', { type: 'image/svg+xml' }))).toContain('JPG, PNG, or WebP');
    expect(validateCheckFixPhoto(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }))).toContain('5 MB');
  });
});
