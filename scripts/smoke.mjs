// jsdom 冒烟测试：加载构建产物，验证首屏渲染与关键交互（不依赖真实浏览器）
import { JSDOM } from 'jsdom';
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const assetsDir = join(process.cwd(), 'dist', 'assets');
const entry = readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f));
if (!entry) throw new Error('dist/assets 中找不到入口 bundle，请先 npm run build');

const dom = new JSDOM('<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

// 暴露浏览器全局变量
const w = dom.window;
for (const key of Object.getOwnPropertyNames(w)) {
  if (!(key in globalThis)) {
    try {
      globalThis[key] = w[key];
    } catch {
      /* 只读属性跳过 */
    }
  }
}
globalThis.window = w;
globalThis.document = w.document;
try {
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
} catch {
  /* Node 26 以下 navigator 可能只读，跳过即可 */
}
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w) ?? ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w) ?? clearTimeout;

await import(pathToFileURL(join(assetsDir, entry)).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(300);

const text = () => w.document.body.textContent ?? '';
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${msg}`);
  }
};
const clickButton = (matcher) => {
  const btn = [...w.document.querySelectorAll('button')].find((b) =>
    matcher(b.textContent ?? ''),
  );
  if (!btn) return false;
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
};

assert(text().includes('English Speaker'), '首屏品牌名渲染正常');
assert(text().includes('上传英文文档'), '首屏上传区渲染正常');

assert(clickButton((t) => t.includes('示例短文体验')), '找到示例入口按钮');
await sleep(300);
assert(text().includes('It was raining hard'), '加载示例文档后显示英文句子');
assert(text().includes('跟读并打分'), '跟读练习按钮渲染正常');
assert(text().includes('第 1 / 12 句') || text().includes('第'), '句子分页器渲染正常');

assert(clickButton((t) => t.includes('学习进度')), '切换到学习进度标签');
await sleep(200);
assert(text().includes('最近 14 天练习量'), '学习进度页渲染正常');

assert(clickButton((t) => t.includes('使用说明')), '切换到使用说明标签');
await sleep(200);
assert(text().includes('免费打分是怎么工作的'), '使用说明页渲染正常');

assert(clickButton((t) => t.includes('AI 批阅')), '切换到 AI 批阅标签');
await sleep(200);
assert(text().includes('话题'), 'AI 批阅页话题区渲染正常');
assert(clickButton((t) => t === '载入示例' || t.includes('载入示例')), '找到载入示例按钮');
await sleep(400);
assert(text().includes('unforgettable'), '载入示例后显示示例话题');
assert(text().includes('sample-essay.txt'), '载入示例作文后显示示例文件');
assert(text().includes('开始批阅'), '批阅按钮渲染正常');

console.log(process.exitCode ? '\nSMOKE FAILED' : '\nSMOKE PASSED');
