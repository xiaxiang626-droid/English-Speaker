export interface StoredDoc {
  id: string;
  title: string;
  sentences: string[];
  createdAt: number;
}

export interface BestEntry {
  overall: number;
  accuracy: number;
  completeness: number;
  fluency: number;
  attempts: number;
  date: number;
}

export interface PracticeRecord {
  id: string;
  docId: string;
  docTitle: string;
  sentenceIndex: number;
  sentenceText: string;
  overall: number;
  accuracy: number | null;
  completeness: number | null;
  fluency: number;
  wpm: number;
  heardText: string | null;
  date: number;
}

export interface ScoreSettings {
  voiceURI: string;
  rate: number; // 语速倍率 0.5 - 1.5
  accent: 'en-US' | 'en-GB';
}
