import type { BestEntry, GradingAISettings, GradingResult, GradingTopic, PracticeRecord, ScoreSettings, StoredDoc } from './types';
import { DEFAULT_GRADING_AI_SETTINGS } from './grading';

const KEYS = {
  docs: 'english-speaker.docs.v1',
  best: 'english-speaker.best.v1',
  history: 'english-speaker.history.v1',
  settings: 'english-speaker.settings.v1',
  topics: 'english-speaker.topics.v1',
  grades: 'english-speaker.grades.v1',
  gradingAI: 'english-speaker.grading-ai.v1',
} as const;

const bestKey = (docId: string, index: number) => `${docId}:${index}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('localStorage 写入失败（可能超出配额）', error);
  }
}

// ---------- 文档 ----------
export function loadDocs(): StoredDoc[] {
  const docs = readJson<StoredDoc[]>(KEYS.docs, []);
  return [...docs].sort((a, b) => b.createdAt - a.createdAt);
}

export function saveDoc(doc: StoredDoc): void {
  const docs = readJson<StoredDoc[]>(KEYS.docs, []);
  writeJson(KEYS.docs, [doc, ...docs]);
}

export function deleteDoc(docId: string): void {
  const docs = readJson<StoredDoc[]>(KEYS.docs, []);
  writeJson(KEYS.docs, docs.filter((d) => d.id !== docId));
  const best = readJson<Record<string, BestEntry>>(KEYS.best, {});
  for (const key of Object.keys(best)) {
    if (key.startsWith(`${docId}:`)) delete best[key];
  }
  writeJson(KEYS.best, best);
}

// ---------- 每句最佳成绩 ----------
export function loadBestMap(): Record<string, BestEntry> {
  return readJson<Record<string, BestEntry>>(KEYS.best, {});
}

export function recordBest(
  docId: string,
  sentenceIndex: number,
  score: { overall: number; accuracy: number | null; completeness: number | null; fluency: number },
): Record<string, BestEntry> {
  const best = readJson<Record<string, BestEntry>>(KEYS.best, {});
  const key = bestKey(docId, sentenceIndex);
  const prev = best[key];
  const entry: BestEntry = {
    overall: prev ? Math.max(prev.overall, score.overall) : score.overall,
    accuracy: score.accuracy ?? prev?.accuracy ?? 0,
    completeness: score.completeness ?? prev?.completeness ?? 0,
    fluency: prev ? Math.max(prev.fluency, score.fluency) : score.fluency,
    attempts: (prev?.attempts ?? 0) + 1,
    date: Date.now(),
  };
  best[key] = entry;
  writeJson(KEYS.best, best);
  return best;
}

export function sentenceBest(
  best: Record<string, BestEntry>,
  docId: string,
  sentenceIndex: number,
): BestEntry | undefined {
  return best[bestKey(docId, sentenceIndex)];
}

// ---------- 练习历史 ----------
export function loadHistory(): PracticeRecord[] {
  return readJson<PracticeRecord[]>(KEYS.history, []);
}

export function appendHistory(record: PracticeRecord): PracticeRecord[] {
  const history = readJson<PracticeRecord[]>(KEYS.history, []);
  const next = [record, ...history].slice(0, 300);
  writeJson(KEYS.history, next);
  return next;
}

// ---------- 设置 ----------
export const DEFAULT_SETTINGS: ScoreSettings = {
  voiceURI: '',
  rate: 1,
  accent: 'en-US',
};

export function loadSettings(): ScoreSettings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<ScoreSettings>>(KEYS.settings, {}) };
}

export function saveSettings(settings: ScoreSettings): void {
  writeJson(KEYS.settings, settings);
}

// ---------- AI 批阅：话题库 ----------
export function loadTopics(): GradingTopic[] {
  const topics = readJson<GradingTopic[]>(KEYS.topics, []);
  return [...topics].sort((a, b) => b.createdAt - a.createdAt);
}

export function saveTopic(topic: GradingTopic): GradingTopic[] {
  const topics = readJson<GradingTopic[]>(KEYS.topics, []);
  const next = [topic, ...topics];
  writeJson(KEYS.topics, next);
  return next;
}

export function deleteTopic(topicId: string): GradingTopic[] {
  const topics = readJson<GradingTopic[]>(KEYS.topics, []);
  const next = topics.filter((t) => t.id !== topicId);
  writeJson(KEYS.topics, next);
  return next;
}

// ---------- AI 批阅：批阅记录 ----------
export function loadGrades(): GradingResult[] {
  return readJson<GradingResult[]>(KEYS.grades, []);
}

export function appendGrade(result: GradingResult): GradingResult[] {
  const grades = readJson<GradingResult[]>(KEYS.grades, []);
  const next = [result, ...grades].slice(0, 100);
  writeJson(KEYS.grades, next);
  return next;
}

export function deleteGrade(id: string): GradingResult[] {
  const grades = readJson<GradingResult[]>(KEYS.grades, []);
  const next = grades.filter((g) => g.id !== id);
  writeJson(KEYS.grades, next);
  return next;
}

// ---------- AI 批阅：AI 设置 ----------
export function loadGradingAISettings(): GradingAISettings {
  return { ...DEFAULT_GRADING_AI_SETTINGS, ...readJson<Partial<GradingAISettings>>(KEYS.gradingAI, {}) };
}

export function saveGradingAISettings(settings: GradingAISettings): void {
  writeJson(KEYS.gradingAI, settings);
}
