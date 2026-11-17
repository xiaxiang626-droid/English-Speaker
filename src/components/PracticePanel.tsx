import { useCallback, useEffect, useRef, useState } from 'react';
import type { BestEntry, ScoreSettings, StoredDoc } from '../lib/types';
import { scoreReading, type ScoreResult } from '../lib/scoring';
import { speak, stopSpeaking } from '../lib/tts';
import ScoreRing from './ScoreRing';
import {
  IconChevronLeft,
  IconChevronRight,
  IconListen,
  IconMic,
  IconPlay,
  IconStop,
} from './icons';

type Phase = 'idle' | 'playing' | 'recording';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

export interface PracticePanelProps {
  doc: StoredDoc;
  sentenceIndex: number;
  onNavigate: (index: number) => void;
  onScored: (sentenceIndex: number, result: ScoreResult, doc: StoredDoc) => void;
  bestFor: (index: number) => BestEntry | undefined;
  settings: ScoreSettings;
  voices: SpeechSynthesisVoice[];
  onSettingsChange: (settings: ScoreSettings) => void;
  /** 用户在面板内主动操作时，用于打断「全文听读」 */
  onInterruptFullRead?: () => void;
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const display = value === null ? 0 : value;
  const color =
    value === null ? '#c9c6b8' : value >= 85 ? '#16a34a' : value >= 70 ? '#d97706' : '#dc2626';
  return (
    <div className="score-bar">
      <div className="score-bar-head">
        <span>{label}</span>
        <span className="score-bar-value">{value === null ? '未评估' : `${value}`}</span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${display}%`, background: color }} />
      </div>
    </div>
  );
}

export default function PracticePanel({
  doc,
  sentenceIndex,
  onNavigate,
  onScored,
  bestFor,
  settings,
  voices,
  onSettingsChange,
  onInterruptFullRead,
}: PracticePanelProps) {
  const sentence = doc.sentences[sentenceIndex];
  const total = doc.sentences.length;

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [asrNotice, setAsrNotice] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const autoStopRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const srStartedRef = useRef(false);
  const asrFailedRef = useRef(false);
  const finalTextRef = useRef('');
  const startTimeRef = useRef(0);
  const activeMsRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);

  const cleanupCapture = useCallback(() => {
    if (levelTimerRef.current !== null) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    if (autoStopRef.current !== null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* noop */
      }
      recognitionRef.current = null;
    }
    srStartedRef.current = false;
    if (recorderRef.current) {
      const recorder = recorderRef.current;
      // 切换句子/文档时放弃本次录音，避免产生无效打分记录
      recorder.onstop = null;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* noop */
        }
      }
      recorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setLevel(0);
  }, []);

  // 切换句子 / 切换文档时重置一切
  useEffect(() => {
    stopSpeaking();
    cleanupCapture();
    setPhase('idle');
    setResult(null);
    setInterim('');
    setElapsed(0);
    setMicError(null);
    setAsrNotice(null);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      audioUrlRef.current = null;
      return null;
    });
    return () => {
      stopSpeaking();
      cleanupCapture();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentenceIndex, doc.id]);

  const playSentence = useCallback(
    async (rate: number) => {
      if (phase === 'recording') return;
      onInterruptFullRead?.();
      setPhase('playing');
      try {
        await speak(sentence, { rate, voiceURI: settings.voiceURI || undefined, accent: settings.accent });
      } catch {
        /* 朗读被中断时忽略 */
      } finally {
        setPhase('idle');
      }
    },
    [phase, sentence, settings.voiceURI, settings.accent, onInterruptFullRead],
  );

  const finalizeRecording = useCallback(() => {
    const recorder = recorderRef.current;
    const blob = new Blob(chunksRef.current, { type: recorder?.mimeType || 'audio/webm' });
    chunksRef.current = [];
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    setAudioUrl(url);

    const durationMs = performance.now() - startTimeRef.current;
    const finalText = finalTextRef.current.trim();
    const heard: string | null =
      finalText.length > 0 ? finalText : asrFailedRef.current ? null : srStartedRef.current ? '' : null;

    const score = scoreReading(sentence, heard, durationMs, activeMsRef.current);
    setInterim(heard ?? '');
    setResult(score);
    setPhase('idle');
    onScored(sentenceIndex, score, doc);
  }, [doc, onScored, sentence, sentenceIndex]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (levelTimerRef.current !== null) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    if (autoStopRef.current !== null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* noop */
      }
    }
    if (recorder) {
      recorder.onstop = () => {
        // 识别结果需要等 onresult 收尾，稍等再打分
        window.setTimeout(finalizeRecording, 350);
      };
      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        window.setTimeout(finalizeRecording, 350);
      }
    } else {
      window.setTimeout(finalizeRecording, 100);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setLevel(0);
  }, [finalizeRecording]);

  const beginRecording = useCallback(async () => {
    if (phase === 'recording') return;
    onInterruptFullRead?.();
    setMicError(null);
    setAsrNotice(null);
    setResult(null);
    setInterim('');
    setElapsed(0);
    asrFailedRef.current = false;
    srStartedRef.current = false;
    finalTextRef.current = '';
    activeMsRef.current = 0;

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('当前浏览器不支持麦克风采集，请使用新版 Edge / Chrome 并通过 HTTPS 或 localhost 访问。');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const name = (error as DOMException)?.name;
      setMicError(
        name === 'NotAllowedError'
          ? '麦克风权限被拒绝了。请点击地址栏的小锁图标，允许本网站使用麦克风后重试。'
          : '无法打开麦克风，请检查设备连接和系统权限设置。',
      );
      return;
    }
    streamRef.current = stream;

    // 音量检测 + 有效语音时长统计
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtor) {
      const audioCtx = new AudioCtor();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      startTimeRef.current = performance.now();
      levelTimerRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        setLevel(Math.min(1, rms * 3.4));
        if (rms > 0.02) activeMsRef.current += 100;
        setElapsed((performance.now() - startTimeRef.current) / 1000);
      }, 100);
    } else {
      startTimeRef.current = performance.now();
    }

    // 录音
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      window.setTimeout(finalizeRecording, 350);
    };
    recorderRef.current = recorder;

    // 语音识别（免费额度，无需 key）
    const RecognitionCtor = getSpeechRecognitionCtor();
    if (RecognitionCtor) {
      try {
        const recognition = new RecognitionCtor();
        recognition.lang = settings.accent;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onresult = (event) => {
          let interimText = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const item = event.results[i];
            if (item.isFinal) finalTextRef.current += `${item[0].transcript} `;
            else interimText += item[0].transcript;
          }
          setInterim(`${finalTextRef.current}${interimText}`.trim());
        };
        recognition.onerror = (event) => {
          const code = event?.error ?? 'unknown';
          if (code === 'network') {
            asrFailedRef.current = true;
            setAsrNotice('语音识别服务连接失败（国内 Chrome 可能无法访问 Google 语音服务）。本次只评估语速与连贯性；完整打分请使用 Edge 浏览器。');
          } else if (code === 'not-allowed' || code === 'service-not-allowed') {
            asrFailedRef.current = true;
            setAsrNotice('浏览器禁止了语音识别服务，本次只评估语速与连贯性。');
          } else if (code !== 'no-speech' && code !== 'aborted') {
            setAsrNotice(`语音识别提示：${code}`);
          }
        };
        recognition.start();
        recognitionRef.current = recognition;
        srStartedRef.current = true;
      } catch {
        setAsrNotice('无法启动语音识别，本次只评估语速与连贯性。');
      }
    } else {
      setAsrNotice('当前浏览器不支持语音识别（需要 Edge 或 Chrome），本次只评估语速与连贯性。');
    }

    recorder.start(250);
    setPhase('recording');
    autoStopRef.current = window.setTimeout(() => stopRecording(), 45000);
  }, [phase, settings.accent, finalizeRecording, stopRecording, onInterruptFullRead]);

  const shadowAndScore = useCallback(async () => {
    if (phase !== 'idle') return;
    onInterruptFullRead?.();
    setPhase('playing');
    try {
      await speak(sentence, { rate: settings.rate, voiceURI: settings.voiceURI || undefined, accent: settings.accent });
    } catch {
      /* 忽略播放错误，直接进入录音 */
    }
    setPhase('idle');
    window.setTimeout(() => {
      void beginRecording();
    }, 350);
  }, [phase, sentence, settings.rate, settings.voiceURI, settings.accent, beginRecording, onInterruptFullRead]);

  const best = bestFor(sentenceIndex);
  const activeVoice = voices.find((v) => v.voiceURI === settings.voiceURI);

  return (
    <section className="practice-panel">
      <div className="panel-toolbar">
        <button className="icon-btn" onClick={() => onNavigate(sentenceIndex - 1)} disabled={sentenceIndex === 0} aria-label="上一句">
          <IconChevronLeft size={18} />
        </button>
        <div className="sentence-pager">
          第 <strong>{sentenceIndex + 1}</strong> / {total} 句
          {best && <span className="best-chip">历史最佳 {best.overall} 分 · 已练 {best.attempts} 次</span>}
        </div>
        <button className="icon-btn" onClick={() => onNavigate(sentenceIndex + 1)} disabled={sentenceIndex === total - 1} aria-label="下一句">
          <IconChevronRight size={18} />
        </button>
      </div>

      <div className="sentence-card">
        <div className="sentence-label">跟读句子 · Sentence {sentenceIndex + 1}</div>
        <p className="sentence-text">{sentence}</p>
      </div>

      <div className="settings-strip">
        <label className="field">
          <span>发音</span>
          <select value={settings.accent} onChange={(e) => onSettingsChange({ ...settings, accent: e.target.value as ScoreSettings['accent'], voiceURI: '' })}>
            <option value="en-US">美式 en-US</option>
            <option value="en-GB">英式 en-GB</option>
          </select>
        </label>
        <label className="field field-grow">
          <span>音色{voices.length === 0 ? '（正在加载…）' : `（${voices.length} 个可用）`}</span>
          <select value={settings.voiceURI} onChange={(e) => onSettingsChange({ ...settings, voiceURI: e.target.value })} disabled={voices.length === 0}>
            <option value="">系统默认{activeVoice ? '' : '（自动匹配）'}</option>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} · {voice.lang}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>语速</span>
          <div className="rate-group" role="group" aria-label="语速">
            {[0.75, 0.9, 1, 1.25].map((rate) => (
              <button
                key={rate}
                className={`rate-btn${settings.rate === rate ? ' active' : ''}`}
                onClick={() => onSettingsChange({ ...settings, rate })}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="action-row">
        <button className="btn btn-ghost" onClick={() => playSentence(settings.rate)} disabled={phase !== 'idle'}>
          <IconListen size={18} /> 听原文
        </button>
        <button className="btn btn-ghost" onClick={() => playSentence(0.75)} disabled={phase !== 'idle'}>
          <IconPlay size={16} /> 慢速 0.75x
        </button>
        <button className="btn btn-primary btn-lg" onClick={shadowAndScore} disabled={phase !== 'idle'}>
          <IconMic size={18} /> 跟读并打分
        </button>
      </div>

      {phase === 'playing' && (
        <div className="status-banner playing">
          <div className="eq" aria-hidden="true"><span /><span /><span /><span /><span /></div>
          正在朗读，请仔细听……读完后会自动开始录音
        </div>
      )}

      {phase === 'recording' && (
        <div className="recording-box">
          <div className="recording-head">
            <span className="rec-dot" aria-hidden="true" />
            正在录音 {elapsed.toFixed(1)}s <span className="recording-hint">（最长 45 秒，读完可随时停止）</span>
          </div>
          <div className="level-meter" aria-hidden="true">
            <div className="level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          {interim && <div className="interim-text">“{interim}”</div>}
          <button className="btn btn-danger" onClick={stopRecording}>
            <IconStop size={15} /> 停止录音并打分
          </button>
        </div>
      )}

      {micError && <div className="notice notice-error">{micError}</div>}
      {asrNotice && <div className="notice notice-warn">{asrNotice}</div>}

      {phase === 'idle' && !result && (
        <div className="idle-footer">
          <button className="btn btn-secondary" onClick={beginRecording}>
            <IconMic size={17} /> 跳过示范，直接录音
          </button>
          <p className="micro-copy">免费打分 = 浏览器语音识别 + 逐词对齐（非音素级）。建议使用 Microsoft Edge，国内可直连微软语音服务。</p>
        </div>
      )}

      {result && (
        <div className="result-card">
          <div className="result-top">
            <ScoreRing value={result.overall} size={148} />
            <div className="result-bars">
              <ScoreBar label="发音准确度" value={result.accuracy} />
              <ScoreBar label="完整度（没漏词）" value={result.completeness} />
              <ScoreBar label="流利度（语速·连贯）" value={result.fluency} />
              <div className="result-meta">
                语速 {result.wpm} wpm · 有效语音占比 {Math.round(result.activeRatio * 100)}%
              </div>
            </div>
          </div>

          {result.marks.length > 0 && (
            <div className="marks-block">
              <div className="marks-title">逐词诊断</div>
              <div className="word-chips">
                {result.marks.map((mark, i) => {
                  if (mark.status === 'ins') {
                    return (
                      <span key={i} className="chip chip-ins" title="多读的词（原文没有）">
                        +{mark.heard}
                      </span>
                    );
                  }
                  const cls =
                    mark.status === 'match' ? 'chip-ok' : mark.status === 'sub' ? 'chip-sub' : 'chip-del';
                  const tip =
                    mark.status === 'match'
                      ? '读对了'
                      : mark.status === 'sub'
                        ? `可能读错了（听成“${mark.heard}”）`
                        : '漏读了这个词';
                  return (
                    <span key={i} className={`chip ${cls}`} title={tip}>
                      {mark.ref}
                    </span>
                  );
                })}
              </div>
              <div className="chip-legend">
                <span><i className="dot dot-ok" />读对</span>
                <span><i className="dot dot-sub" />可能读错</span>
                <span><i className="dot dot-del" />漏读</span>
                <span><i className="dot dot-ins" />多读</span>
              </div>
            </div>
          )}

          {result.heardText !== null && (
            <div className="heard-box">
              <strong>识别结果：</strong>
              {result.heardText ? `“${result.heardText}”` : '（没有识别到语音）'}
            </div>
          )}

          <ul className="feedback-list">
            {result.feedback.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>

          <div className="result-actions">
            {audioUrl && <audio className="audio-player" controls src={audioUrl} preload="metadata" />}
            <button className="btn btn-primary" onClick={beginRecording}>
              <IconMic size={17} /> 再读一次
            </button>
            {sentenceIndex < total - 1 && (
              <button className="btn btn-ghost" onClick={() => onNavigate(sentenceIndex + 1)}>
                下一句 <IconChevronRight size={16} />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
