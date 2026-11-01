export type CheckFixOutcome = 'possible_improvement' | 'problem_may_remain' | 'cannot_assess';

export function parseVisionAssessment(value: unknown): { comparable: boolean; outcome: CheckFixOutcome; rationale: string } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.comparable !== 'boolean' || typeof candidate.rationale !== 'string') return null;
  if (!['possible_improvement', 'problem_may_remain', 'cannot_assess'].includes(String(candidate.outcome))) return null;
  const rationale = candidate.rationale.trim().slice(0, 1600);
  if (!rationale) return null;
  return {
    comparable: candidate.comparable,
    outcome: candidate.comparable ? candidate.outcome as CheckFixOutcome : 'cannot_assess',
    rationale,
  };
}

