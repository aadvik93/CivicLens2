export type IssueCategory =
  | 'Garbage dump' | 'Pothole' | 'Waterlogging'
  | 'Broken streetlight' | 'Open drain' | 'Other / Needs review';

export type ReportStatus = 'Draft' | 'Prepared' | 'Submitted internally';

export interface CivicReport {
  id: string;
  category: IssueCategory;
  description: string;
  complaint: string;
  language: 'English' | 'Hindi';
  locationText: string;
  latitude: number | null;
  longitude: number | null;
  photoName: string | null;
  createdAt: string;
  status: ReportStatus;
  dataClass: 'DEMO';
}

export const CATEGORIES: IssueCategory[] = [
  'Garbage dump', 'Pothole', 'Waterlogging',
  'Broken streetlight', 'Open drain', 'Other / Needs review'
];
