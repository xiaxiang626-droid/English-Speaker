import type { GradingResult, GradingTopic, GradingAISettings } from './types';

export interface GradingProvider {
  id: string;
  label: string;
  baseURL: string;
  model: string;
}

/** OpenAI 兼容接口预设 */
export const GRADING_PROVIDERS: GradingProvider[] = [
  { id: 'deepseek', label: 'DeepSeek（便宜，约 ¥1/百万 token）', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'zhipu', label: '智谱 GLM-4-Flash（免费）', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'qwen', label: '通义千问 DashScope（免费额度）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'kimi', label: 'Kimi · 月之暗面', baseURL: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'custom', label: '自定义（OpenAI 兼容接口）', baseURL: '', model: '' },
];

export const DEFAULT_GRADING_AI_SETTINGS: GradingAISettings = {
  provider: 'deepseek',
  baseURL: GRADING_PROVIDERS[0].baseURL,
  apiKey: '',
  model: GRADING_PROVIDERS[0].model,
  ltEnabled: true,
  ltBaseUrl: 'https://languagetool.org/api/v2/check',
};

// ---------- 文本统计 ----------
export interface TextStats {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLen: number;
  uniqueWords: number;
  typeTokenRatio: number;
}

export function collectStats(text: string): TextStats {
  const tokens = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const sentences = (text.match(/[.!?…]+/g) ?? []).length;
  const wordCount = tokens.length;
  const uniqueWords = new Set(tokens).size;
  return {
    wordCount,
    sentenceCount: Math.max(1, sentences),
    avgSentenceLen: Math.round((wordCount / Math.max(1, sentences)) * 10) / 10,
    uniqueWords,
    typeTokenRatio: wordCount === 0 ? 0 : Math.round((uniqueWords / wordCount) * 1000) / 1000,
  };
}

const STOPWORDS = new Set(
  ('a an the and or but of to in on at for with about as by from up down over under again further then once here there when where why how all any both each few more most other some such no nor not only own same so than too very can will just should now is are was were be been being have has had having do does did doing would could ought i you he she it we they them his her its our your their this that these those am').split(' '),
);

/** 从话题中提取内容关键词（去停用词、长度≥4） */
export function keywordsOf(...sources: string[]): string[] {
  const tokens = sources
    .join(' ')
    .toLowerCase()
    .match(/[a-z]+/g) ?? [];
  const result: string[] = [];
  for (const token of tokens) {
    if (token.length >= 4 && !STOPWORDS.has(token) && !result.includes(token)) result.push(token);
    if (result.length >= 15) break;
  }
  return result;
}

/** 话题关键词在作文中的覆盖率（前缀匹配，宽容词形变化） */
export function topicCoverage(essay: string, keywords: string[]): number {
  if (keywords.length === 0) return 0.6;
  const essayTokens = essay.toLowerCase().match(/[a-z]+/g) ?? [];
  if (essayTokens.length === 0) return 0;
  let hit = 0;
  for (const kw of keywords) {
    const matched = essayTokens.some((t) => t === kw || t.startsWith(kw) || kw.startsWith(t));
    if (matched) hit += 1;
  }
  return Math.round((hit / keywords.length) * 100) / 100;
}

// ---------- LanguageTool 免费语法检查 ----------
export interface LTMatch {
  category: '拼写' | '语法' | '其他';
  original: string;
  correction: string;
  explanation: string;
}

export async function checkWithLanguageTool(text: string, baseUrl: string): Promise<LTMatch[]> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const body = new URLSearchParams({ text: text.slice(0, 20000), language: 'en-US' });
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`LanguageTool HTTP ${response.status}`);
    const data = (await response.json()) as {
      matches?: Array<{
        message?: string;
        offset?: number;
        length?: number;
        replacements?: Array<{ value: string }>;
        rule?: { issueType?: string; category?: { id?: string } };
        context?: { text?: string };
      }>;
    };
    const matches = data.matches ?? [];
    return matches.slice(0, 20).map((match) => {
      const issueType = (match.rule?.issueType ?? '').toLowerCase();
      const categoryId = (match.rule?.category?.id ?? '').toUpperCase();
      const category: LTMatch['category'] =
        issueType === 'misspelling' || categoryId === 'TYPOS'
          ? '拼写'
          : issueType === 'grammar' || categoryId.includes('GRAMMAR')
            ? '语法'
            : '其他';
      const original =
        typeof match.offset === 'number' && typeof match.length === 'number'
          ? text.slice(match.offset, match.offset + match.length)
          : (match.context?.text ?? '').trim();
      const correction = (match.replacements ?? []).slice(0, 3).map((r) => r.value).join(' / ');
      return {
        category,
        original,
        correction: correction || '（无直接建议）',
        explanation: match.message ?? '',
      };
    });
  } finally {
    window.clearTimeout(timer);
  }
}

// ---------- LLM 批阅提示词 ----------
export function buildGradingPrompt(topic: GradingTopic, essay: string): { system: string; user: string } {
  const system =
    '你是一位有十年经验的英语写作批改老师，熟悉中国学生的常见错误（中式表达、时态混用、冠词、单复数、介词搭配、拼写）。' +
    '你的批改严格但鼓励式，反馈具体、可操作。只输出 JSON，不要输出任何其他内容。';
  const user = [
    `话题：${topic.title}`,
    `要求：${topic.requirements || '无额外要求'}`,
    '',
    '学生作文：',
    '```',
    essay,
    '```',
    '',
    '请按照下面的 JSON schema 输出（所有字段必须存在）：',
    '{',
    '  "score": <0-100 的整数，总分>,',
    '  "taskAchievement": <0-100，是否完成话题要求>,',
    '  "coherence": <0-100，连贯性与结构>,',
    '  "grammar": <0-100，语法正确性>,',
    '  "vocabulary": <0-100，词汇运用>,',
    '  "errors": [{ "type": "语法|拼写|词汇|内容", "original": "原句中的错误片段", "correction": "修正后的写法", "explanation": "用简体中文解释为什么错" }],   // 最多 12 条最关键的',
    '  "strengths": ["用简体中文列出 2-4 个优点"],',
    '  "improvements": ["用简体中文列出 2-4 条最重要的改进建议"],',
    '  "overallComment": "用简体中文写 80 字以内的总体评语"',
    '}',
  ].join('\n');
  return { system, user };
}

/** 从 LLM 返回内容中稳健地提取 JSON */
export function extractJSON(content: string): Record<string, unknown> {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error('AI 返回的内容不是有效 JSON');
  }
}

// ---------- 批阅主流程 ----------
const clamp = (v: number, min = 0, max = 100) => Math.min(max, Math.max(min, Math.round(v)));

interface LLMGradeShape {
  score?: number;
  taskAchievement?: number;
  coherence?: number;
  grammar?: number;
  vocabulary?: number;
  errors?: Array<{ type?: string; original?: string; correction?: string; explanation?: string }>;
  strengths?: string[];
  improvements?: string[];
  overallComment?: string;
}

export async function testLLMConnection(settings: GradingAISettings): Promise<void> {
  if (!settings.apiKey.trim()) throw new Error('请先填写 API Key');
  const response = await fetchWithTimeout(
    `${settings.baseURL.replace(/\/+$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        max_tokens: 16,
        messages: [{ role: 'user', content: '只回复 JSON：{"ok":true}' }],
      }),
    },
    30000,
  );
  if (!response.ok) {
    throw new Error(`连接失败：HTTP ${response.status} ${await readErrorBody(response)}`);
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: string } };
    return data?.error?.message ?? '';
  } catch {
    return '';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') {
      throw new Error('请求超时，请检查网络或稍后重试');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function runLLMRequest(
  settings: GradingAISettings,
  system: string,
  user: string,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(
    `${settings.baseURL.replace(/\/+$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        max_tokens: 2400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
    90000,
  );
  if (!response.ok) {
    throw new Error(`AI 接口返回 HTTP ${response.status}：${await readErrorBody(response)}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('AI 没有返回内容');
  return extractJSON(content);
}

export async function runAIGrading(
  settings: GradingAISettings,
  topic: GradingTopic,
  essay: string,
  fileName: string,
): Promise<GradingResult> {
  const stats = collectStats(essay);
  const { system, user } = buildGradingPrompt(topic, essay);
  const raw = (await runLLMRequest(settings, system, user)) as LLMGradeShape;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v) : null);

  const errors = Array.isArray(raw.errors) ? raw.errors : [];
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `g-${Date.now()}`,
    topicId: topic.id,
    topicTitle: topic.title,
    fileName,
    mode: 'ai',
    score: num(raw.score) ?? 0,
    dimensions: [
      { label: '任务完成度', value: num(raw.taskAchievement) },
      { label: '连贯与结构', value: num(raw.coherence) },
      { label: '语法', value: num(raw.grammar) },
      { label: '词汇', value: num(raw.vocabulary) },
    ],
    errors: errors.slice(0, 12).map((e) => ({
      type: String(e?.type ?? '其他'),
      original: String(e?.original ?? ''),
      correction: String(e?.correction ?? ''),
      explanation: String(e?.explanation ?? ''),
    })),
    strengths: Array.isArray(raw.strengths) ? raw.strengths.map(String) : [],
    improvements: Array.isArray(raw.improvements) ? raw.improvements.map(String) : [],
    comment: String(raw.overallComment ?? ''),
    wordCount: stats.wordCount,
    createdAt: Date.now(),
  };
}

/** 免费基础批阅：LanguageTool（可选）+ 统计 + 话题关键词覆盖 */
export function runBasicGrading(
  topic: GradingTopic,
  essay: string,
  fileName: string,
  ltMatches: LTMatch[] | null,
): GradingResult {
  const stats = collectStats(essay);
  const keywords = keywordsOf(topic.title, topic.requirements);
  const coverage = topicCoverage(essay, keywords);

  const matches = ltMatches ?? [];
  const grammarErrs = matches.filter((m) => m.category === '语法' || m.category === '其他').length;
  const spellingErrs = matches.filter((m) => m.category === '拼写').length;
  const totalErrs = matches.length;

  let score = 100;
  score -= Math.min(60, spellingErrs * 3 + grammarErrs * 3.5);
  if (stats.typeTokenRatio < 0.3) score -= 10;
  else if (stats.typeTokenRatio < 0.4) score -= 5;
  if (stats.avgSentenceLen > 30) score -= 8;
  else if (stats.avgSentenceLen > 24) score -= 4;
  if (stats.avgSentenceLen < 6 && stats.sentenceCount > 3) score -= 5;
  if (stats.wordCount < 80) score -= 8;
  if (coverage < 0.4) score -= 12;
  else if (coverage < 0.6) score -= 6;
  score = clamp(score);

  const dimensions = [
    { label: '任务相关性（话题覆盖）', value: clamp(coverage * 100) },
    { label: '语法', value: clamp(100 - grammarErrs * 4) },
    { label: '拼写', value: clamp(100 - spellingErrs * 3) },
    { label: '词汇多样性', value: clamp((stats.typeTokenRatio / 0.55) * 100) },
    {
      label: '流畅度（句长）',
      value: clamp(100 - Math.max(0, Math.abs(stats.avgSentenceLen - 16) - 6) * 4),
    },
  ];

  const strengths: string[] = [];
  const improvements: string[] = [];
  if (grammarErrs === 0 && spellingErrs === 0) strengths.push('未检测到语法和拼写错误，基础表达很扎实。');
  if (stats.typeTokenRatio >= 0.45) strengths.push(`词汇多样性不错（独立词 ${stats.uniqueWords}/${stats.wordCount}）。`);
  if (coverage >= 0.7) strengths.push('内容紧扣话题，关键词覆盖良好。');
  if (stats.wordCount >= 150) strengths.push(`篇幅充足（${stats.wordCount} 词）。`);

  if (ltMatches === null) improvements.push('免费语法检查服务不可用，本次只做了基础统计；配置 AI Key 可获得完整批阅。');
  if (spellingErrs > 0) improvements.push(`有 ${spellingErrs} 处拼写问题，见下表逐项修正。`);
  if (grammarErrs > 0) improvements.push(`有 ${grammarErrs} 处语法问题，重点检查时态、冠词、单复数和介词。`);
  if (stats.typeTokenRatio < 0.4) improvements.push('词汇重复较多，尝试替换常用词（good→excellent/rewarding，very happy→thrilled）。');
  if (stats.avgSentenceLen > 24) improvements.push('句子普遍偏长，拆成短句会让表达更清晰。');
  if (coverage < 0.6) improvements.push('内容与话题关联偏弱，注意紧扣话题要点展开。');

  const commentParts = [
    `全文 ${stats.wordCount} 词、${stats.sentenceCount} 句，平均句长 ${stats.avgSentenceLen} 词，词汇多样性 ${Math.round(stats.typeTokenRatio * 100)}%，话题关键词覆盖 ${Math.round(coverage * 100)}%。`,
  ];
  if (ltMatches !== null) {
    commentParts.push(`语言工具检测到 ${totalErrs} 处问题（语法 ${grammarErrs}、拼写 ${spellingErrs}）。`);
  }
  commentParts.push('这是免费基础评估，仅考察语法、拼写与统计特征；配置 AI Key 后可获得任务完成度、连贯性、词汇运用等维度的专业批阅。');

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `g-${Date.now()}`,
    topicId: topic.id,
    topicTitle: topic.title,
    fileName,
    mode: 'basic',
    score,
    dimensions,
    errors: matches.map((m) => ({
      type: m.category,
      original: m.original,
      correction: m.correction,
      explanation: m.explanation,
    })),
    strengths,
    improvements,
    comment: commentParts.join(''),
    wordCount: stats.wordCount,
    createdAt: Date.now(),
  };
}

/** 生成可复制的纯文本版批阅报告 */
export function buildReportText(result: GradingResult): string {
  const lines: string[] = [
    `【AI 批阅报告】${result.fileName}`,
    `话题：${result.topicTitle}`,
    `评分：${result.score} 分（${result.mode === 'ai' ? 'AI 深度批阅' : '免费基础批阅'}）· ${result.wordCount} 词`,
    '',
    '维度：' + result.dimensions.map((d) => `${d.label} ${d.value === null ? '—' : d.value}`).join('；'),
    '',
  ];
  if (result.errors.length) {
    lines.push('错误与修正：');
    for (const e of result.errors) {
      lines.push(`- [${e.type}] ${e.original} → ${e.correction}${e.explanation ? `（${e.explanation}）` : ''}`);
    }
    lines.push('');
  }
  if (result.strengths.length) {
    lines.push('优点：' + result.strengths.join('；'));
  }
  if (result.improvements.length) {
    lines.push('改进建议：' + result.improvements.join('；'));
  }
  lines.push('总体评语：' + result.comment);
  return lines.join('\n');
}
