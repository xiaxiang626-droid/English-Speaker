# English Speaker · 英语跟读打分

上传一篇英文文档，AI 生成英语朗读音频，逐句跟读录音，自动打分——免费、开源、纯前端，无需任何 API key。

![demo flow](docs/feasibility-study.md)

## 功能特性

- **上传文档即跟读**：支持 TXT / MD / PDF / DOCX（PDF 需含文字层），浏览器内完成解析与分句（自动处理小数、缩写、超长句子从句切分）
- **AI 朗读示范**：浏览器内置 Web Speech API（speechSynthesis），美式 / 英式音色可选、语速 0.75x–1.25x 可调，全文听读模式
- **跟读并自动打分**（免费模式）：
  - MediaRecorder 采集录音 + 实时音量 / 有效语音占比分析
  - 浏览器内置 Speech Recognition 把跟读转写为文本（免费，无需 key）
  - 编辑距离逐词对齐，标注**读对 / 可能读错 / 漏读 / 多读**
  - 综合分 = 0.55×准确度 + 0.25×完整度 + 0.20×流利度（语速锚点 125 wpm）
  - 回放自己的录音，和示范音频对比
- **学习进度**：每句历史最佳、文档级进度条、连续打卡、近 14 天练习量、最近练习记录
- **本地优先**：文档、成绩、历史全部保存在浏览器 localStorage，不上传任何服务器，天然规避隐私与合规风险

> ⚠️ 免费打分是**文本级 + 流利度级**评估，不是音素级（phoneme-level）发音评测，且依赖浏览器语音识别的质量。
> 升级到专业级评分（SpeechSuper / Azure Pronunciation Assessment，音素级、支持重音 / 连读 / 韵律）只需替换 `src/lib/scoring.ts`，
> 详见 `docs/feasibility-study.md`《可行性调研报告》。

## 快速开始

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 产出静态文件到 dist/
npm run preview    # 预览生产构建 http://localhost:4173
npm run typecheck  # TypeScript 检查
npm run smoke      # jsdom 冒烟测试（构建后运行，验证首屏渲染与关键交互）
```

> 麦克风需要 HTTPS 或 localhost 访问才会被浏览器放行。本地开发用 `http://localhost:5173` 即可。
>
> **注意（云端沙箱 / Arena 环境）**：应用跑在沙箱里，你自己电脑的 `localhost` 上没有这个服务，直接输入 `localhost:5173` 会得到 ERR_CONNECTION_REFUSED。
> 请改用平台生成的 Live Preview 地址（形如 `https://<端口>-<沙箱ID>.e2b.app`，Arena 界面里会有对应按钮），
> 或把仓库克隆到自己电脑上再 `npm install && npm run dev`，那时 `http://localhost:5173` 才有效。

## 国内使用 / 上线部署

- **浏览器**：优先 **Microsoft Edge**（语音合成 + 语音识别走微软通道，国内直连、无需代理）。
  Chrome 桌面版的语音识别走 Google 服务，国内通常不可用——本应用会自动降级为「仅评估语速连贯性」并给出提示。
- **部署**：本应用是纯静态站点，`npm run build` 后把 `dist/` 传到任意静态托管即可：
  阿里云 OSS + CDN、腾讯云 COS、又拍云、七牛、Cloudflare Pages、Vercel 等。
  面向中国内地用户时域名需 **ICP 备案**方可对外提供服务；也可先在个人服务器用 nginx + HTTPS 静态托管。
- **成本**：TTS 和语音识别使用浏览器内置免费能力，部署后没有按量 API 费用。

## 目录结构

```
├── index.html               # 入口（中文 meta、内联 SVG favicon）
├── src/
│   ├── App.tsx              # 应用外壳：侧边栏 + 跟读 / 进度 / 说明三个标签页
│   ├── components/
│   │   ├── PracticePanel.tsx  # 核心跟读面板：播放 / 录音 / 打分 / 逐词诊断
│   │   ├── StatsView.tsx      # 学习进度（打卡、柱状图、历史表）
│   │   ├── GuideView.tsx      # 使用说明（打分原理、国内部署、升级路径、FAQ）
│   │   ├── ScoreRing.tsx      # 综合分圆环（SVG 动画）
│   │   └── icons.tsx          # 内联 SVG 图标
│   ├── lib/
│   │   ├── parser.ts        # PDF/DOCX/TXT 解析 + 英文分句（小数/缩写保护）
│   │   ├── tts.ts           # Web Speech API 封装（音色加载、朗读）
│   │   ├── scoring.ts       # 免费打分：语音识别文本归一化 + 编辑距离对齐 + 三维分数
│   │   └── storage.ts       # localStorage 持久化（文档 / 每句最佳 / 历史 / 设置）
│   ├── data/samples.ts      # 原创示例短文（The Lost Umbrella 等）
│   └── styles.css           # 设计系统（纸张质感 + 深绿主题）
├── scripts/smoke.mjs        # jsdom 冒烟测试
├── docs/feasibility-study.md  # 可行性调研报告（技术选型、成本、MVP 路线图）
└── .github/                 # （如需 CI，可自行添加）
```

## 路线图

- [x] MVP：文档上传 → TTS 朗读 → 跟读录音 → 免费打分 → 进度/打卡
- [ ] 接入 SpeechSuper / Azure Pronunciation Assessment（音素级评分，需 API key）
- [ ] 逐词 karaoke 高亮（Azure TTS word boundary 或 WhisperX 强制对齐）
- [ ] 错音专项训练（/θ,ð/、/l,r/ 对照练习）
- [ ] 后端账号体系 + 跨设备同步（可选，目前刻意保持纯前端）

## 许可

代码随便取用；你上传的文档版权归原作者所有，请只练习你有权使用的材料。示例短文为本项目原创。
