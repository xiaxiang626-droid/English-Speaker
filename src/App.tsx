import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseDocument,
  splitIntoSentences,
} from './lib/parser';
import type { PracticeRecord, ScoreSettings, StoredDoc } from './lib/types';
import {
  appendHistory,
  deleteDoc,
  loadBestMap,
  loadDocs,
  loadHistory,
  loadSettings,
  recordBest,
  saveDoc,
  saveSettings,
  sentenceBest,
} from './lib/storage';
import { loadVoices, speak, stopSpeaking } from './lib/tts';
import type { ScoreResult } from './lib/scoring';
import PracticePanel from './components/PracticePanel';
import StatsView from './components/StatsView';
import GuideView from './components/GuideView';
import GradingView from './components/GradingView';
import {
  IconBook,
  IconChart,
  IconFile,
  IconInfo,
  IconListen,
  IconMic,
  IconPen,
  IconPlay,
  IconTrash,
  IconUpload,
  LogoMark,
  IconStop,
} from './components/icons';
import { SAMPLE_DOCS } from './data/samples';

type Tab = 'practice' | 'grading' | 'stats' | 'guide';

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const ACCEPTED_EXT = ['txt', 'md', 'pdf', 'docx'];

export default function App() {
  const [tab, setTab] = useState<Tab>('practice');
  const [docs, setDocs] = useState<StoredDoc[]>(() => loadDocs());
  const [currentDocId, setCurrentDocId] = useState<string | null>(() => loadDocs()[0]?.id ?? null);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [bestMap, setBestMap] = useState(() => loadBestMap());
  const [history, setHistory] = useState<PracticeRecord[]>(() => loadHistory());
  const [settings, setSettings] = useState<ScoreSettings>(() => loadSettings());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [playingAll, setPlayingAll] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const playAllRef = useRef({ cancelled: false });
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    loadVoices().then(setVoices);
  }, []);

  const currentDoc = docs.find((doc) => doc.id === currentDocId) ?? null;

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 6500);
  }, []);

  const selectDoc = useCallback((docId: string) => {
    stopSpeaking();
    playAllRef.current.cancelled = true;
    setPlayingAll(false);
    setCurrentDocId(docId);
    setSentenceIndex(0);
  }, []);

  const navigateSentence = useCallback((index: number) => {
    playAllRef.current.cancelled = true;
    setPlayingAll(false);
    setSentenceIndex(index);
  }, []);

  const handleSettingsChange = useCallback((next: ScoreSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).slice(0, 3);
      for (const file of list) {
        const ext = (file.name.split('.').pop() ?? '').toLowerCase();
        if (!ACCEPTED_EXT.includes(ext)) {
          showNotice(`「${file.name}」格式不支持，请上传 TXT / MD / PDF / DOCX。`);
          continue;
        }
        setParsing(true);
        try {
          const parsed = await parseDocument(file);
          const sentences = splitIntoSentences(parsed.text);
          if (sentences.length === 0) {
            showNotice(`「${file.name}」没有切分出英文句子，请确认文档包含英文正文。`);
            continue;
          }
          const doc: StoredDoc = {
            id: uuid(),
            title: parsed.title.trim() || '未命名文档',
            sentences,
            createdAt: Date.now(),
          };
          saveDoc(doc);
          setDocs((prev) => [doc, ...prev]);
          setCurrentDocId(doc.id);
          setSentenceIndex(0);
          showNotice(`已导入「${doc.title}」，共 ${sentences.length} 个句子。`);
        } catch (error) {
          showNotice(error instanceof Error ? error.message : `解析「${file.name}」失败。`);
        } finally {
          setParsing(false);
        }
      }
    },
    [showNotice],
  );

  const loadSample = useCallback((sample: (typeof SAMPLE_DOCS)[number]) => {
    const doc: StoredDoc = {
      id: uuid(),
      title: sample.title,
      sentences: [...sample.sentences],
      createdAt: Date.now(),
    };
    saveDoc(doc);
    setDocs((prev) => [doc, ...prev]);
    setCurrentDocId(doc.id);
    setSentenceIndex(0);
    setTab('practice');
  }, []);

  const removeDoc = useCallback(
    (docId: string) => {
      deleteDoc(docId);
      setDocs((prev) => prev.filter((doc) => doc.id !== docId));
      setBestMap(loadBestMap());
      if (currentDocId === docId) {
        setCurrentDocId(null);
        setSentenceIndex(0);
      }
    },
    [currentDocId],
  );

  const handleScored = useCallback(
    (sentenceIdx: number, score: ScoreResult, doc: StoredDoc) => {
      const record: PracticeRecord = {
        id: uuid(),
        docId: doc.id,
        docTitle: doc.title,
        sentenceIndex: sentenceIdx,
        sentenceText: doc.sentences[sentenceIdx],
        overall: score.overall,
        accuracy: score.accuracy,
        completeness: score.completeness,
        fluency: score.fluency,
        wpm: score.wpm,
        heardText: score.heardText,
        date: Date.now(),
      };
      setHistory(appendHistory(record));
      setBestMap(recordBest(doc.id, sentenceIdx, score));
    },
    [],
  );

  const stopPlayAll = useCallback(() => {
    playAllRef.current.cancelled = true;
    stopSpeaking();
    setPlayingAll(false);
  }, []);

  const playAll = useCallback(async () => {
    if (!currentDoc || playingAll) return;
    playAllRef.current.cancelled = true;
    stopSpeaking();
    playAllRef.current = { cancelled: false };
    setPlayingAll(true);
    for (let i = 0; i < currentDoc.sentences.length; i++) {
      if (playAllRef.current.cancelled) break;
      setSentenceIndex(i);
      // 等面板的句子切换副作用（停掉上一句朗读）完成后再播
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      if (playAllRef.current.cancelled) break;
      try {
        await speak(currentDoc.sentences[i], {
          rate: settings.rate,
          voiceURI: settings.voiceURI || undefined,
          accent: settings.accent,
        });
      } catch {
        break;
      }
    }
    setPlayingAll(false);
  }, [currentDoc, playingAll, settings.rate, settings.voiceURI, settings.accent]);

  const docStats = currentDoc
    ? (() => {
        let attempted = 0;
        let sum = 0;
        currentDoc.sentences.forEach((_, index) => {
          const best = sentenceBest(bestMap, currentDoc.id, index);
          if (best) {
            attempted += 1;
            sum += best.overall;
          }
        });
        return {
          attempted,
          total: currentDoc.sentences.length,
          avgBest: attempted ? Math.round(sum / attempted) : null,
        };
      })()
    : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <LogoMark size={38} />
          <div className="brand-text">
            <span className="brand-name">English Speaker</span>
            <span className="brand-tagline">上传文档 · AI 跟读 · 自动打分</span>
          </div>
        </div>
        <nav className="nav-tabs" aria-label="主导航">
          <button className={`nav-tab${tab === 'practice' ? ' active' : ''}`} onClick={() => setTab('practice')}>
            <IconMic size={16} /> 跟读练习
          </button>
          <button className={`nav-tab${tab === 'grading' ? ' active' : ''}`} onClick={() => setTab('grading')}>
            <IconPen size={16} /> AI 批阅
          </button>
          <button className={`nav-tab${tab === 'stats' ? ' active' : ''}`} onClick={() => setTab('stats')}>
            <IconChart size={16} /> 学习进度
          </button>
          <button className={`nav-tab${tab === 'guide' ? ' active' : ''}`} onClick={() => setTab('guide')}>
            <IconInfo size={16} /> 使用说明
          </button>
        </nav>
      </header>

      {notice && <div className="toast" role="status">{notice}</div>}

      <main className="app-main">
        {tab === 'practice' && (
          <div className="practice-layout">
            <aside className="sidebar">
              <button
                className={`upload-zone${dragActive ? ' dragging' : ''}${parsing ? ' busy' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
                }}
              >
                <IconUpload size={26} />
                <span className="upload-title">{parsing ? '正在解析文档…' : '上传英文文档'}</span>
                <span className="upload-hint">拖拽到此处，或点击选择文件<br />支持 TXT / MD / PDF / DOCX</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) void handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <div className="sample-row">
                <span className="sample-label">没文档？先试试：</span>
                    {SAMPLE_DOCS.map((sample) => (
                  <button key={sample.title} className="sample-btn" onClick={() => loadSample(sample)}>
                    {sample.hint} · {sample.sentences.length} 句
                  </button>
                ))}
              </div>

              <div className="doc-list-head">我的文档（{docs.length}）</div>
              <div className="doc-list">
                {docs.length === 0 && (
                  <div className="doc-list-empty">上传的文档只保存在你的浏览器里，不会上传到任何服务器。</div>
                )}
                {docs.map((doc) => {
                  const attempted = doc.sentences.filter((_, i) => sentenceBest(bestMap, doc.id, i)).length;
                  const pct = doc.sentences.length ? Math.round((attempted / doc.sentences.length) * 100) : 0;
                  return (
                    <div
                      key={doc.id}
                      role="button"
                      tabIndex={0}
                      className={`doc-item${doc.id === currentDocId ? ' active' : ''}`}
                      onClick={() => selectDoc(doc.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') selectDoc(doc.id);
                      }}
                    >
                      <IconFile size={17} className="doc-item-icon" />
                      <span className="doc-item-body">
                        <span className="doc-item-title" title={doc.title}>{doc.title}</span>
                        <span className="doc-item-meta">{doc.sentences.length} 句 · 已跟读 {attempted}/{doc.sentences.length}</span>
                        <span className="mini-progress"><span className="mini-progress-fill" style={{ width: `${pct}%` }} /></span>
                      </span>
                      <button
                        className="delete-btn"
                        title="删除文档及其进度"
                        aria-label={`删除 ${doc.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeDoc(doc.id);
                        }}
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </aside>

            <div className="practice-main">
              {currentDoc && docStats ? (
                <>
                  <div className="doc-header">
                    <div className="doc-header-main">
                      <h1 className="doc-title" title={currentDoc.title}>{currentDoc.title}</h1>
                      <div className="doc-progress-row">
                        <div className="progress-track" aria-label={`完成度 ${docStats.attempted}/${docStats.total}`}>
                          <div className="progress-fill" style={{ width: `${docStats.total ? (docStats.attempted / docStats.total) * 100 : 0}%` }} />
                        </div>
                        <span className="progress-text">
                          已跟读 {docStats.attempted}/{docStats.total} 句{docStats.avgBest !== null && ` · 平均最佳 ${docStats.avgBest} 分`}
                        </span>
                      </div>
                    </div>
                    <button
                      className={`btn ${playingAll ? 'btn-danger' : 'btn-secondary'}`}
                      onClick={playingAll ? stopPlayAll : () => void playAll()}
                    >
                      {playingAll ? <><IconStop size={15} /> 停止听读</> : <><IconListen size={17} /> 全文听读</>}
                    </button>
                  </div>

                  <PracticePanel
                    key={currentDoc.id}
                    doc={currentDoc}
                    sentenceIndex={sentenceIndex}
                    onNavigate={navigateSentence}
                    onScored={handleScored}
                    bestFor={(index) => sentenceBest(bestMap, currentDoc.id, index)}
                    settings={settings}
                    voices={voices}
                    onSettingsChange={handleSettingsChange}
                    onInterruptFullRead={stopPlayAll}
                  />
                </>
              ) : (
                <div className="hero-empty">
                  <LogoMark size={72} />
                  <h1>上传一篇英文文档，<br />开口跟读，AI 自动打分</h1>
                  <p>把 PDF / Word / TXT 扔进来，自动切分句子并生成英文朗读，你跟着读一遍，逐词给出对错与语速分析。</p>
                  <div className="hero-actions">
                    <button className="btn btn-primary btn-lg" onClick={() => fileInputRef.current?.click()}>
                      <IconUpload size={19} /> 上传文档
                    </button>
                    <button className="btn btn-ghost btn-lg" onClick={() => loadSample(SAMPLE_DOCS[0])}>
                      <IconPlay size={17} /> 用示例短文体验
                    </button>
                  </div>
                  <div className="hero-features">
                    <div className="hero-feature"><IconListen size={18} /> 浏览器免费 TTS，美式 / 英式音色可选，语速可调</div>
                    <div className="hero-feature"><IconMic size={18} /> 逐句跟读录音，漏读 / 错读 / 多读逐词标注</div>
                    <div className="hero-feature"><IconBook size={18} /> 进度本地保存，练习历史与连续打卡一目了然</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'grading' && <GradingView />}
        {tab === 'stats' && <StatsView history={history} />}
        {tab === 'guide' && <GuideView />}
      </main>

      <footer className="app-footer">
        English Speaker · 开源 MVP · 文档与录音仅保存在你的浏览器本地 · 跟读打分为免费文本级评估
      </footer>
    </div>
  );
}
