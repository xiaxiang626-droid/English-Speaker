// 免费、离线的跟读打分：基于浏览器语音识别结果与参考文本做对齐评分
// 注意：这是文本级/流利度级评分，不等同于音素级 GOP 评测
// （精确音素级评分可对接 Azure Pronunciation Assessment / SpeechSuper，见 docs/feasibility-study.md）

export type WordStatus = 'match' | 'sub' | 'del' | 'ins';

export interface WordMark {
  /** 参考文本中的词（ins 时为空字符串） */
  ref: string;
  /** 识别听到的词（del 时为 null） */
  heard: string | null;
  status: WordStatus;
}

export interface ScoreResult {
  overall: number;
  /** 准确度（null = 语音识别不可用，未参与打分） */
  accuracy: number | null;
  /** 完整度（null = 语音识别不可用，未参与打分） */
  completeness: number | null;
  fluency: number;
  wpm: number;
  /** 有效语音占比 0-1 */
  activeRatio: number;
  heardText: string | null;
  counts: { match: number; sub: number; del: number; ins: number };
  marks: WordMark[];
  feedback: string[];
}

export function normalizeTokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []
  );
}

/** 参考词与识别词的编辑距离对齐 */
export function alignTokens(ref: string[], hyp: string[]): WordMark[] {
  const n = ref.length;
  const m = hyp.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = i;
  for (let j = 1; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j - 1] + cost, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }
  const marks: WordMark[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      if (dp[i][j] === dp[i - 1][j - 1] + cost) {
        marks.push({ ref: ref[i - 1], heard: hyp[j - 1], status: cost === 0 ? 'match' : 'sub' });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      marks.push({ ref: ref[i - 1], heard: null, status: 'del' });
      i -= 1;
      continue;
    }
    marks.push({ ref: '', heard: hyp[j - 1], status: 'ins' });
    j -= 1;
  }
  marks.reverse();
  return marks;
}

const clamp = (v: number, min = 0, max = 100) => Math.min(max, Math.max(min, v));

export function scoreReading(
  refText: string,
  heardText: string | null,
  durationMs: number,
  activeMs: number,
): ScoreResult {
  const ref = normalizeTokens(refText);
  const refCount = Math.max(1, ref.length);
  const durationMin = Math.max(durationMs / 60000, 1 / 60);
  const wpm = Math.round(refCount / durationMin);
  const activeRatio = durationMs > 0 ? clamp(activeMs / durationMs, 0, 1) : 0;

  // 流利度：语速接近 125 wpm 满分；有效语音占比过低则扣分
  const wpmScore = Math.max(0, 100 - 0.85 * Math.abs(wpm - 125));
  const pausePenalty = activeRatio >= 0.6 ? 0 : Math.round((0.6 - activeRatio) * 120);
  const fluency = clamp(Math.round(wpmScore - pausePenalty));

  const feedback: string[] = [];

  if (heardText === null) {
    feedback.push('语音识别不可用：本次只评估语速与连贯性，未评估发音准确度。');
    feedback.push('请使用 Microsoft Edge 浏览器（国内可直连微软语音服务）获得完整打分。');
    return {
      overall: fluency,
      accuracy: null,
      completeness: null,
      fluency,
      wpm,
      activeRatio,
      heardText: null,
      counts: { match: 0, sub: 0, del: 0, ins: 0 },
      marks: [],
      feedback,
    };
  }

  const hyp = normalizeTokens(heardText);
  const marks = alignTokens(ref, hyp);
  const counts = { match: 0, sub: 0, del: 0, ins: 0 };
  for (const mark of marks) counts[mark.status] += 1;

  const accuracy = clamp(Math.round((100 * (counts.match + 0.25 * counts.sub)) / refCount));
  const completeness = clamp(Math.round((100 * (refCount - counts.del)) / refCount));
  const overall = clamp(Math.round(0.55 * accuracy + 0.25 * completeness + 0.2 * fluency));

  if (hyp.length === 0) {
    feedback.push('没有识别到语音。请检查麦克风权限、离麦克风近一些，在安静环境朗读。');
  } else {
    if (counts.del > 0) {
      const missed = marks.filter((m) => m.status === 'del').slice(0, 5).map((m) => m.ref);
      feedback.push(`漏读 ${counts.del} 个词：${missed.join('、')}${counts.del > 5 ? '…' : ''}`);
    }
    if (counts.sub > 0) {
      const subs = marks.filter((m) => m.status === 'sub').slice(0, 4);
      const examples = subs.map((m) => `“${m.ref}”听成了“${m.heard}”`);
      feedback.push(`${counts.sub} 个词可能读错：${examples.join('；')}`);
    }
    if (counts.ins > 0) {
      feedback.push(`多读了 ${counts.ins} 个参考文本里没有的词。`);
    }
    if (counts.del === 0 && counts.sub === 0) {
      feedback.push('逐词匹配完美，完整度与准确度都很好！');
    }
  }

  feedback.push(`语速约 ${wpm} wpm（跟读建议 100–150 wpm）。`);
  if (activeRatio < 0.6 && hyp.length > 0) {
    feedback.push(`静音/停顿偏多（有效语音占比 ${Math.round(activeRatio * 100)}%），试着一气呵成地读。`);
  }
  if (overall >= 90) feedback.push('非常出色！可以挑战更快的语速或更长的段落。');
  else if (overall >= 75) feedback.push('不错！重点打磨标红的词，再跟读几遍。');
  else feedback.push('建议：先用 0.75x 慢速跟读，准确后再提速到 1.0x。');

  return {
    overall,
    accuracy,
    completeness,
    fluency,
    wpm,
    activeRatio,
    heardText,
    counts,
    marks,
    feedback,
  };
}
