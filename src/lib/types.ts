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

export interface GradingTopic {
  id: string;
  title: string;
  requirements: string;
  createdAt: number;
}

export type GradingMode = 'ai' | 'basic';

export interface GradingError {
  type: string;
  original: string;
  correction: string;
  explanation: string;
}

export interface GradingDimension {
  label: string;
  value: number | null;
}

export interface GradingResult {
  id: string;
  topicId: string;
  topicTitle: string;
  fileName: string;
  mode: GradingMode;
  score: number;
  dimensions: GradingDimension[];
  errors: GradingError[];
  strengths: string[];
  improvements: string[];
  comment: string;
  wordCount: number;
  createdAt: number;
}

export interface GradingAISettings {
  /** deepseek | zhipu | qwen | kimi | openai | custom */
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** 是否启用 LanguageTool 免费语法检查（基础模式） */
  ltEnabled: boolean;
  ltBaseUrl: string;
}
