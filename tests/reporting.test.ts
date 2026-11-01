import { describe, expect, it } from 'vitest';
import { makeComplaint, makeReportFingerprint, validatePhoto } from '../src/lib';

describe('photo validation', () => {
  it('accepts a small JPEG', () => {
    const file = new File(['image'], 'street.jpg', { type: 'image/jpeg' });
    expect(validatePhoto(file)).toBeNull();
  });
  it('rejects unsupported file types', () => {
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    expect(validatePhoto(file)).toContain('JPG, PNG, or WebP');
  });
  it('rejects files larger than 5 MB', () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    expect(validatePhoto(file)).toContain('5 MB');
  });
  it('rejects empty files', () => {
    const file = new File([], 'empty.png', { type: 'image/png' });
    expect(validatePhoto(file)).toContain('larger than 0 bytes');
  });
});

describe('complaint draft', () => {
  it('includes category, location, and observation in English', () => {
    const text = makeComplaint('Pothole', 'Large hole near the crossing', 'Sector Alpha', 'English');
    expect(text).toContain('Pothole');
    expect(text).toContain('Sector Alpha');
    expect(text).toContain('Large hole near the crossing');
  });
  it('creates a Hindi draft', () => {
    expect(makeComplaint('Open drain', 'Open drain visible', 'Block A', 'Hindi')).toContain('विषय');
  });
});


describe('report retry identity', () => {
  const submission = {
    category: 'Pothole' as const,
    description: 'Large pothole near the crossing',
    complaintText: 'Please inspect this pothole.',
    complaintLanguage: 'English' as const,
    locationLabel: 'Sector Alpha',
    latitude: 28.4744,
    longitude: 77.504,
    accuracy: 12,
    photoName: 'street.jpg',
    photoSize: 2048,
    photoLastModified: 1000,
    photoType: 'image/jpeg',
  };

  it('keeps an identical retry tied to the same payload', () => {
    expect(makeReportFingerprint(submission)).toBe(makeReportFingerprint({ ...submission }));
  });

  it('changes the fingerprint when report content changes', () => {
    expect(makeReportFingerprint(submission)).not.toBe(makeReportFingerprint({ ...submission, description: 'Different issue' }));
  });

  it('changes the fingerprint when the selected photo changes', () => {
    expect(makeReportFingerprint(submission)).not.toBe(makeReportFingerprint({ ...submission, photoLastModified: 1001 }));
  });
});
