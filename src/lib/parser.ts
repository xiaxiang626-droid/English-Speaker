import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth/mammoth.browser.min.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ParsedDocument {
  title: string;
  text: string;
}

const MAX_TEXT_LENGTH = 200_000;

export async function parseDocument(file: File): Promise<ParsedDocument> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const title = file.name.replace(/\.[^.]+$/, '') || '未命名文档';

  if (ext === 'txt' || ext === 'md') {
    return truncate({ title, text: await file.text() });
  }
  if (ext === 'docx') {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return truncate({ title, text: result.value });
  }
  if (ext === 'pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      );
    }
    const text = pages.join('\n');
    if (normalizeWs(text).length === 0) {
      throw new Error('没有从 PDF 中提取到文字。如果是扫描版 PDF，请先做 OCR 识别再上传。');
    }
    return truncate({ title, text });
  }
  throw new Error(`暂不支持 .${ext || '该'} 格式，请上传 TXT / MD / PDF / DOCX 文件`);
}

function truncate(doc: ParsedDocument): ParsedDocument {
  if (doc.text.length > MAX_TEXT_LENGTH) {
    return { ...doc, text: doc.text.slice(0, MAX_TEXT_LENGTH) };
  }
  return doc;
}

function normalizeWs(text: string): string {
  return text.replace(/\s+/g, '');
}

// 保护小数点与常见缩写里的点，避免错误分句
function protectDots(text: string): string {
  return text
    .replace(/(\d)\.(\d)/g, '$1$2')
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Fig|No)\./gi, '$1')
    .replace(/\b(e\.g|i\.e|a\.m|p\.m|U\.S|U\.K)\./gi, (m) => m.replace(/\./g, ''));
}
const restoreDots = (text: string) => text.replace(//g, '.');

const MAX_SENTENCE = 220;
const MIN_MERGE = 14;

/** 将原始文本切分为适合跟读的英文句子 */
export function splitIntoSentences(raw: string): string[] {
  const cleaned = protectDots(
    raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+/g, ' '),
  );
  const paragraphs = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean);

  const raw1: string[] = [];
  for (const para of paragraphs) {
    const matches = para.match(/[^.!?…]+[.!?…]+["'”’\)\]]*|[^.!?…]+$/g);
    const segs = matches ? matches.map((s) => s.trim()) : [para];
    for (const seg of segs) splitLong(seg, raw1);
  }

  // 超短片段并回上一句
  const merged: string[] = [];
  for (const s of raw1) {
    const t = restoreDots(s);
    if (
      merged.length > 0 &&
      t.length < MIN_MERGE &&
      merged[merged.length - 1].length + t.length < MAX_SENTENCE
    ) {
      merged[merged.length - 1] += ' ' + t;
    } else {
      merged.push(t);
    }
  }

  // 只保留含拉丁字母的句子（英语跟读材料）
  return merged.filter((s) => /[A-Za-z]/.test(s));
}

function splitLong(sentence: string, out: string[]): void {
  if (sentence.length <= MAX_SENTENCE) {
    out.push(sentence);
    return;
  }
  // 先按从句边界切
  const clauses = sentence.split(/(?<=[,;:，；：—–-])\s+/);
  let buf = '';
  for (const clause of clauses) {
    const candidate = buf ? `${buf} ${clause}` : clause;
    if (candidate.length > MAX_SENTENCE && buf) {
      out.push(buf);
      buf = clause;
    } else {
      buf = candidate;
    }
  }
  // 仍然过长则按词硬切
  if (buf.length > MAX_SENTENCE) {
    let cur = '';
    for (const word of buf.split(' ')) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (candidate.length > MAX_SENTENCE && cur) {
        out.push(cur);
        cur = word;
      } else {
        cur = candidate;
      }
    }
    buf = cur;
  }
  if (buf.trim()) out.push(buf.trim());
}
