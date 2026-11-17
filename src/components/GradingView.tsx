import { useCallback, useEffect, useRef, useState } from 'react';
import type { GradingAISettings, GradingResult, GradingTopic } from '../lib/types';
import {
  appendGrade,
  deleteGrade,
  deleteTopic,
  loadGrades,
  loadGradingAISettings,
  loadTopics,
  saveGradingAISettings,
  saveTopic,
} from '../lib/storage';
import {
  GRADING_PROVIDERS,
  buildReportText,
  checkWithLanguageTool,
  collectStats,
  runAIGrading,
  runBasicGrading,
  testLLMConnection,
} from '../lib/grading';
import { parseDocument } from '../lib/parser';
import ScoreRing from './ScoreRing';
import ScoreBar from './ScoreBar';
import { IconCheck, IconCopy, IconFile, IconInfo, IconPen, IconTrash, IconUpload } from './icons';
import { SAMPLE_ESSAY, SAMPLE_GRADING_TOPIC } from '../data/samples';

interface EssayFile {
  name: string;
  text: string;
  wordCount: number;
}

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const scoreClass = (v: number) => (v >= 85 ? 'score-good' : v >= 70 ? 'score-mid' : 'score-low');
const ACCEPTED = '.txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ACCEPTED_EXT = ['txt', 'md', 'pdf', 'docx'];

export default function GradingView() {
  const [topics, setTopics] = useState<GradingTopic[]>(() => loadTopics());
  const [grades, setGrades] = useState<GradingResult[]>(() => loadGrades());
  const [aiSettings, setAISettings] = useState<GradingAISettings>(() => loadGradingAISettings());
  const [selectedTopicId, setSelectedTopicId] = useState<string>(() => loadTopics()[0]?.id ?? '');
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicReq, setNewTopicReq] = useState('');
  const [essay, setEssay] = useState<EssayFile | null>(null);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [phaseText, setPhaseText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef<number | null>(null);

  const showNotice = useCallback((message: string, ms = 6500) => {
    setNotice(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);

  const aiOn = aiSettings.apiKey.trim().length > 0;

  // ---------- 话题 ----------
  const addTopic = useCallback(
    (title: string, requirements: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        showNotice('请先填写话题标题。');
        return null;
      }
      const topic: GradingTopic = { id: uuid(), title: trimmed, requirements: requirements.trim(), createdAt: Date.now() };
      const next = saveTopic(topic);
      setTopics(next);
      setSelectedTopicId(topic.id);
      return topic;
    },
    [showNotice],
  );

  const handleCreateTopic = useCallback(() => {
    const topic = addTopic(newTopicTitle, newTopicReq);
    if (topic) {
      setNewTopicTitle('');
      setNewTopicReq('');
      showNotice(`话题「${topic.title.slice(0, 40)}」已保存。`);
    }
  }, [addTopic, newTopicReq, newTopicTitle, showNotice]);

  const handleDeleteTopic = useCallback((topic: GradingTopic, event: React.MouseEvent) => {
    event.stopPropagation();
    setTopics(deleteTopic(topic.id));
    setSelectedTopicId((prev) => (prev === topic.id ? '' : prev));
  }, []);

  const loadSample = useCallback(() => {
    const topic = addTopic(SAMPLE_GRADING_TOPIC.title, SAMPLE_GRADING_TOPIC.requirements);
    setEssay({ name: 'sample-essay.txt', text: SAMPLE_ESSAY, wordCount: collectStats(SAMPLE_ESSAY).wordCount });
    setResult(null);
    if (topic) showNotice('已载入示例话题与满是典型错误的示例作文。');
  }, [addTopic, showNotice]);

  // ---------- 文件 ----------
  const handleEssayFile = useCallback(
    async (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (!file) return;
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      if (!ACCEPTED_EXT.includes(ext)) {
        showNotice(`「${file.name}」格式不支持，请上传 TXT / MD / PDF / DOCX。`);
        return;
      }
      setParsing(true);
      try {
        const parsed = await parseDocument(file);
        const wordCount = collectStats(parsed.text).wordCount;
        if (wordCount < 20) {
          showNotice('文件里几乎没有英文内容，请确认上传的是英文作文。');
          return;
        }
        setEssay({ name: file.name, text: parsed.text, wordCount });
        setResult(null);
        showNotice(`已载入「${file.name}」（${wordCount} 词）。`);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '文件解析失败。');
      } finally {
        setParsing(false);
      }
    },
    [showNotice],
  );

  // ---------- 批阅 ----------
  const handleGrade = useCallback(async () => {
    const topic = topics.find((t) => t.id === selectedTopicId);
    if (!topic) {
      showNotice('请先选择或新建一个话题。');
      return;
    }
    if (!essay) {
      showNotice('请先上传作文文件。');
      return;
    }
    setGrading(true);
    setNotice(null);
    try {
      let graded: GradingResult;
      if (aiOn) {
        setPhaseText(`AI 批阅中（${aiSettings.model}），通常需要 20–60 秒……`);
        graded = await runAIGrading(aiSettings, topic, essay.text, essay.name);
      } else {
        let matches = null;
        if (aiSettings.ltEnabled) {
          setPhaseText('语言工具语法检查中……');
          try {
            matches = await checkWithLanguageTool(essay.text, aiSettings.ltBaseUrl);
          } catch {
            showNotice('免费语法检查服务不可用（网络/限流），已仅输出基础统计；配置 AI Key 可获得完整批阅。', 8000);
          }
        }
        graded = runBasicGrading(topic, essay.text, essay.name, matches);
      }
      setGrades(appendGrade(graded));
      setResult(graded);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '批阅失败，请稍后重试。', 8000);
    } finally {
      setGrading(false);
      setPhaseText('');
    }
  }, [aiOn, aiSettings, essay, selectedTopicId, showNotice, topics]);

  const selectedTopic = topics.find((t) => t.id === selectedTopicId) ?? null;

  const copyReport = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildReportText(result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showNotice('复制失败，请手动选择文本复制。');
    }
  }, [result, showNotice]);

  const applyProvider = useCallback((providerId: string) => {
    const preset = GRADING_PROVIDERS.find((p) => p.id === providerId);
    setAISettings((prev) => ({
      ...prev,
      provider: providerId,
      baseURL: preset?.baseURL ?? prev.baseURL,
      model: preset?.model ?? prev.model,
    }));
  }, []);

  const testConnection = useCallback(async () => {
    setTesting(true);
    try {
      await testLLMConnection(aiSettings);
      showNotice('连接成功！保存设置后即可开始 AI 批阅。');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '连接失败。', 8000);
    } finally {
      setTesting(false);
    }
  }, [aiSettings, showNotice]);

  const modeLabel = aiOn ? 'AI 深度批阅' : '免费基础批阅';

  return (
    <div className="grading-view">
      {notice && <div className="toast" role="status">{notice}</div>}

      {/* ===== AI / 基础模式设置 ===== */}
      <details className="panel-card settings-details" open={!aiOn}>
        <summary>
          <IconInfo size={17} />
          <span>AI 批阅设置 <em>{modeLabel}</em></span>
        </summary>
        <div className="settings-details-body">
          <p className="settings-hint">
            填入支持 OpenAI 兼容接口的 API Key 即可获得<strong>任务完成度 / 连贯性 / 语法 / 词汇</strong>维度的专业批阅与逐条修改建议。
            Key 只保存在你浏览器的 localStorage，直连厂商接口，不经过任何第三方服务器。
            <strong> 不填则为免费基础批阅</strong>（LanguageTool 免费语法检查 + 统计特征，零配置）。
          </p>
          <div className="grading-form-grid">
            <label className="field">
              <span>服务商</span>
              <select value={aiSettings.provider} onChange={(e) => applyProvider(e.target.value)}>
                {GRADING_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="field field-grow">
              <span>Base URL</span>
              <input value={aiSettings.baseURL} onChange={(e) => setAISettings({ ...aiSettings, baseURL: e.target.value })} placeholder="https://api.example.com/v1" spellCheck={false} />
            </label>
            <label className="field">
              <span>模型</span>
              <input value={aiSettings.model} onChange={(e) => setAISettings({ ...aiSettings, model: e.target.value })} placeholder="模型名" spellCheck={false} />
            </label>
            <label className="field field-grow">
              <span>API Key</span>
              <input type="password" value={aiSettings.apiKey} onChange={(e) => setAISettings({ ...aiSettings, apiKey: e.target.value })} placeholder="sk-……" autoComplete="off" spellCheck={false} />
            </label>
          </div>
          <div className="lt-row">
            <label className="check-line">
              <input type="checkbox" checked={aiSettings.ltEnabled} onChange={(e) => setAISettings({ ...aiSettings, ltEnabled: e.target.checked })} />
              基础模式启用 LanguageTool 语法检查（免费，文本会发送到该服务；国内可改成自建地址或关闭）
            </label>
            {aiSettings.ltEnabled && (
              <input className="lt-input" value={aiSettings.ltBaseUrl} onChange={(e) => setAISettings({ ...aiSettings, ltBaseUrl: e.target.value })} spellCheck={false} aria-label="LanguageTool 接口地址" />
            )}
          </div>
          <div className="settings-actions">
            <button className="btn btn-secondary" onClick={() => { saveGradingAISettings(aiSettings); showNotice('AI 批阅设置已保存。'); }}>保存设置</button>
            <button className="btn btn-ghost" onClick={testConnection} disabled={testing || !aiSettings.apiKey.trim()}>
              {testing ? '连接中……' : '测试连接'}
            </button>
          </div>
        </div>
      </details>

      <div className="grading-layout">
        {/* ===== 左列：话题 + 上传 ===== */}
        <div className="grading-side">
          <section className="panel-card">
            <div className="panel-card-head grading-card-head">
              <h3>① 话题（批阅标准）</h3>
              <button className="sample-btn" onClick={loadSample}>载入示例</button>
            </div>
            {topics.length > 0 && (
              <div className="topic-list">
                {topics.map((topic) => (
                  <div
                    key={topic.id}
                    role="button"
                    tabIndex={0}
                    className={`topic-item${topic.id === selectedTopicId ? ' active' : ''}`}
                    onClick={() => setSelectedTopicId(topic.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTopicId(topic.id); }}
                  >
                    <span className="topic-item-body">
                      <span className="topic-item-title" title={topic.title}>{topic.title}</span>
                      {topic.requirements && <span className="topic-item-req" title={topic.requirements}>{topic.requirements}</span>}
                    </span>
                    <button className="delete-btn" title="删除话题" aria-label={`删除话题 ${topic.title}`} onClick={(e) => handleDeleteTopic(topic, e)}>
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="topic-form">
              <input className="topic-input" value={newTopicTitle} onChange={(e) => setNewTopicTitle(e.target.value)} placeholder="新话题，如：Describe an unforgettable trip you took." />
              <textarea className="topic-input topic-textarea" value={newTopicReq} onChange={(e) => setNewTopicReq(e.target.value)} placeholder="批阅要求（可选）：字数、要点、时态要求……" rows={2} />
              <button className="btn btn-secondary" onClick={handleCreateTopic}>保存为新话题</button>
            </div>
          </section>

          <section className="panel-card">
            <div className="panel-card-head"><h3>② 上传作文文件</h3></div>
            <button
              className={`upload-zone${dragActive ? ' dragging' : ''}${parsing ? ' busy' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files.length) void handleEssayFile(e.dataTransfer.files); }}
            >
              <IconUpload size={24} />
              <span className="upload-title">{parsing ? '正在解析文件…' : '上传学生作文'}</span>
              <span className="upload-hint">TXT / MD / PDF / DOCX，单个文件</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              hidden
              onChange={(e) => { if (e.target.files?.length) void handleEssayFile(e.target.files); e.target.value = ''; }}
            />
            {essay && (
              <div className="essay-file-chip">
                <IconFile size={16} />
                <span className="essay-file-name" title={essay.name}>{essay.name}</span>
                <span className="essay-file-meta">{essay.wordCount} 词</span>
                <button className="delete-btn" title="移除文件" aria-label="移除已上传文件" onClick={() => { setEssay(null); setResult(null); }}>
                  <IconTrash size={14} />
                </button>
              </div>
            )}
            <button className="btn btn-primary btn-lg btn-block" onClick={handleGrade} disabled={grading || !selectedTopicId || !essay}>
              <IconPen size={18} />
              {grading ? '批阅中……' : `开始批阅（${modeLabel}）`}
            </button>
            {grading && <div className="grading-phase">{phaseText}</div>}
            <p className="micro-copy">作文内容只发送给你自己选择的 AI 服务（配置了 Key 时）或 LanguageTool（默认开启），否则完全在本地计算。</p>
          </section>
        </div>

        {/* ===== 右列：批阅结果 + 记录 ===== */}
        <div className="grading-main">
          {result ? (
            <section className="panel-card grade-result">
              <div className="panel-card-head grading-card-head">
                <h3>批阅结果 · {result.fileName}</h3>
                <button className="btn btn-ghost btn-sm" onClick={copyReport}>
                  {copied ? <><IconCheck size={15} /> 已复制</> : <><IconCopy size={15} /> 复制报告</>}
                </button>
              </div>
              <div className="result-top">
                <ScoreRing value={result.score} size={140} label="总分" />
                <div className="result-bars">
                  {result.dimensions.map((d) => <ScoreBar key={d.label} label={d.label} value={d.value} />)}
                  <div className="result-meta">
                    话题：{result.topicTitle.slice(0, 60)} · {result.wordCount} 词 · {result.mode === 'ai' ? 'AI 深度批阅' : '免费基础批阅'}
                  </div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="errors-block">
                  <div className="marks-title">错误与修正（{result.errors.length} 条）</div>
                  <div className="table-wrap">
                    <table className="history-table errors-table">
                      <thead><tr><th>类型</th><th>原文</th><th>修正</th><th>说明</th></tr></thead>
                      <tbody>
                        {result.errors.map((e, i) => (
                          <tr key={i}>
                            <td><span className="chip chip-ins error-type-chip">{e.type}</span></td>
                            <td className="error-original">{e.original}</td>
                            <td className="error-correction">{e.correction}</td>
                            <td className="error-explanation">{e.explanation}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grade-lists">
                {result.strengths.length > 0 && (
                  <div className="grade-list">
                    <div className="marks-title marks-ok">优点</div>
                    <ul className="feedback-list strengths-list">{result.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {result.improvements.length > 0 && (
                  <div className="grade-list">
                    <div className="marks-title marks-sub">改进建议</div>
                    <ul className="feedback-list improvements-list">{result.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </div>

              <div className="heard-box"><strong>总体评语：</strong>{result.comment}</div>
            </section>
          ) : (
            <section className="panel-card grade-placeholder">
              <IconPen size={34} />
              <h3>批阅结果会显示在这里</h3>
              <p>先选左边的话题，再上传一篇学生作文，点「开始批阅」。<br />不配置 AI Key 也能批阅（免费基础模式）；配置后是完整的 AI 专业批阅。</p>
              <button className="sample-btn" onClick={loadSample}>不想等，先载入示例看效果</button>
            </section>
          )}

          <section className="panel-card">
            <div className="panel-card-head"><h3>③ 批阅记录（{grades.length}）</h3></div>
            {grades.length === 0 ? (
              <div className="empty-state">还没有批阅记录。完成批阅后，结果会保存在这里（仅存本地浏览器）。</div>
            ) : (
              <div className="table-wrap">
                <table className="history-table">
                  <thead><tr><th>时间</th><th>文件 / 话题</th><th>模式</th><th>分数</th><th></th></tr></thead>
                  <tbody>
                    {grades.slice(0, 10).map((grade) => (
                      <tr key={grade.id}>
                        <td>{fmtDate(grade.createdAt)}</td>
                        <td className="cell-doc" title={`${grade.fileName} · ${grade.topicTitle}`}><strong>{grade.fileName}</strong><br /><span className="cell-sub">{grade.topicTitle}</span></td>
                        <td><span className={`mode-pill ${grade.mode === 'ai' ? 'mode-ai' : 'mode-basic'}`}>{grade.mode === 'ai' ? 'AI' : '基础'}</span></td>
                        <td><span className={`score-pill ${scoreClass(grade.score)}`}>{grade.score}</span></td>
                        <td><button className="delete-btn" title="删除记录" aria-label="删除批阅记录" onClick={() => setGrades(deleteGrade(grade.id))}><IconTrash size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
