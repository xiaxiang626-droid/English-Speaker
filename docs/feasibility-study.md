# 英语跟读打分 APP — 可行性调研报告

> 调研日期：2026-11-17 · 目标：上传英文文档 → AI 生成英语音频 → 用户跟读 → AI 自动打分

## 一、结论先行

**能做，而且每个环节都有成熟的现成方案，不需要从零造轮子。**

核心链路已经非常清晰：

```
英文文档(PDF/Word/TXT/EPUB)
   ↓ ① 文档解析 + 智能分句
句子列表（文本）
   ↓ ② TTS 合成（可带逐词时间轴）
英语音频 + 时间轴
   ↓ ③ 跟读播放器（播放 / 倍速 / AB复读 / 逐词高亮 / 录音）
用户录音
   ↓ ④ 发音评估 API（与参考文本对齐，输出打分）
得分报告（总分 + 准确度/流利度/完整度/韵律 + 逐词逐音素诊断）
   ↓
前端展示 + 学习记录
```

唯一需要"选型决策"的硬骨头是**第④步打分引擎**（第三方 API 效果好但有成本；开源自研免费但需语音工程能力），下文详细对比。

---

## 二、分环节技术方案与选型

### ① 文档解析与分句（难度：低）

| 方案 | 说明 |
|---|---|
| Python：`pdfplumber` / `pypdf`（PDF）、`python-docx`（Word）、`ebooklib`（EPUB） | 适合后端服务做解析 |
| Node：`pdf-parse`（PDF）、`mammoth`（Word） | 适合全 Node 技术栈 |
| 分句：正则 + NLP（`nltk` / `spaCy` / `Intl.Segmenter`） | 按句号、问号、感叹号、引号边界切分，再做长度合并（过长的句子切到 ≤ ~200 音素） |
| 注意 | 扫描版 PDF 需 OCR（如 Tesseract）；混排公式/图表的文档需人工清洗；长难句建议交 LLM 做可读性改写（可选增强） |

输出：`{ docId, sentences: [{ index, text }] }` 入库，异步任务生成音频。

### ② TTS 生成英语音频（难度：低，选型多）

| 方案 | 价格（参考 2026-11） | 免费额度 | 逐词时间轴 | 备注 |
|---|---|---|---|---|
| **Azure Speech Neural TTS** | ≈ $15–16 / 1M 字符 | 0.5M 字符/月 | ✅ SDK 支持 word boundary 事件，天然适合"卡拉 OK"式逐词高亮 | 140+ 语言，SSML 可控语速/音高，支持自定义 Neural Voice |
| **Google Cloud TTS** | Standard $4 / Neural2 $16 / Chirp 3 HD $30（每 1M 字符） | 1M–4M 字符/月 | ❌ 需自行用 WhisperX 对齐 | 免费额度最大，英语口音多（en-US/en-GB/en-AU…） |
| **OpenAI TTS** | $15（tts-1）/ $30（tts-1-hd） | 无 | ❌ | 音质好但**官方将退役 tts-1 系列（2027-01-06 前后）**，新接入建议慎重 |
| **ElevenLabs** | $40（Turbo/Flash）– $80（v3/Multilingual）/ 1M 字符 | 10K credits/月 | ❌ | 音质最自然、情感最好，成本最高 |
| 开源自建：**Kokoro-82M**（Apache 2.0）、**Piper**（MIT） | 0（自有 GPU/CPU） | 无限制 | ❌（需对齐） | 零 API 费用、可离线；音质 Kokoro 不错，Piper 偏"够用" |
| 非官方：edge-tts（微软 Edge 免费 TTS 接口） | 免费 | — | ⚠️ 部分支持 | 无官方 SLA，接口可能随时变动，**不建议用于生产**，可用来做原型验证 |

**关键点：时间轴**。跟读 UI 想做"跟着读、逐词高亮、复读某一句"，需要知道每个词的起止时间：
- Azure TTS：SDK 直接返回 word boundary（offset/duration），最方便；
- 其他 TTS：用 **WhisperX**（BSD-2-Clause）对生成的音频做强制对齐（wav2vec2），实测可拿到词级时间戳；也可以直接用 TTS 引擎"逐句生成"，句级时间戳 = 各句音频时长累加，无需对齐，实现最简单。

### ③ 跟读播放器（难度：中，纯前端可做）

Web / 小程序 / App 均可实现，核心能力：

- 播放器：play/pause、倍速（0.75/1/1.25/1.5x）、逐句跳转、**AB 复读单句**、循环听；
- 文本区：句子高亮跟随音频（句级或词级 karaoke 高亮）；
- 录音：`MediaRecorder`（浏览器）/ `flutter_sound` / 小程序 `RecorderManager` 采集；
- 音频格式统一为 **16kHz / 16bit / 单声道 WAV**（Azure 评分要求；浏览器默认 webm/opus，后端需 ffmpeg 转码或前端用 Web Audio 转 PCM）；
- 录音质量：静音检测（VAD）自动起止、降噪、录音权限引导、录音时长上限（建议按句 30s 内）。

### ④ 跟读打分引擎（难度：高，核心选型）

对比三条路线：

#### 路线 A：Azure AI Speech — Pronunciation Assessment（推荐 MVP）

- **机制**：scripted 模式，传入【参考文本 + 用户录音】，基于 GOP（Goodness of Pronunciation）算法给出评分；
- **输出**：总体 Pronunciation Score + 准确度（Accuracy）/ 流利度（Fluency）/ 完整度（Completeness）/ 韵律（Prosody，需开启 EnableProsodyAssessment）；**逐词、逐音节、逐音素**得分；错误类型标记：`Omission`（漏读）/ `Insertion`（多读）/ `Mispronunciation`（读错）；可开启 Miscue 检测（enableMiscue）；
- **粒度**：FullText / Word / Phoneme 三档；**Dimension=Comprehensive** 才有流利度/完整度等全量维度；
- **模式**：流式（SDK，实时，适合"边读边反馈"）或短音频 REST/SDK（≤30s 的句子评测）；**注意 fast transcription（批量/快速转写）端点不支持发音评估**，评估走标准实时转写通道；
- **价格**：按 STT 时长计费，约 **$1–1.32/音频小时**，**每月 5 小时免费**；量小（原型/早期）几乎免费；
- **优点**：效果业内标杆级、接入快（官方 SDK，Python/C#/JS/Java 等）、中文文档全；
- **缺点**：需要 Azure 账号与境外网络（国内访问建议用 Azure 中国区 21Vianet 或选路线 B）；无免费商用额度之外的大免费量。

#### 路线 B：专业语音评测厂商（国内场景推荐）

- **SpeechSuper**（国内团队，100+ 企业客户）：英语"句子评测""段落评测"API，输出整体/发音/流利度/完整度/节奏/语速(wpm) + **词级与音素级**得分，还支持音节重音、连读（liaison）、失去爆破、句尾升降调、IELTS/PTE 分数估算；
  - 计费：scripted 约 **$0.004–0.008/次**，无月费 $20 起（10,000 次约 $60/月；100,000 次约 $600/月或预付更便宜）；unscripted（口语仿 IELTS）按次更贵；
  - 对**中文学习者**的错音模式（/θ/→/s/，/l,r/，/v,w/ 等）有专门优化，国内直连，合规友好。
- **Speechace**：偏欧美企业市场，$40/月起步，10,000 次/月约 $80；SDK 成熟。
- **TonePerfect**：scripted-only，$10/月起步，100,000 次也才 ~$310，极致性价比但灵活性低。
- 参考成本对比（2026-09 实测表）：1,000 段录音 Azure ≈ $1.4 << SpeechSuper ≈ $20（含最低消费）< Speechace $40。

#### 路线 C：开源自研 GOP（长期/离线/成本敏感场景）

- 经典方案：**espeak-ng G2P**（文本→音素）→ **wav2vec2-lv-60-espeak-cv-ft** 音素识别 → **CTC 强制对齐** → 逐音素 GOP 分数；
- 真实案例：Windows 桌面版 [PronunciationCoach](https://github.com/audiophrases/PronunciationCoach)（同款技术栈：faster-whisper + wav2vec2 + espeak-ng）；学术复现 [phoneme-mispronunciation-detection](https://github.com/Victus0904/phoneme-mispronunciation-detection) 在 speechocean762 上 Pearson r ≈ 0.43；浏览器端 [soundcheck](https://github.com/ayrball/soundcheck) 用 Transformers.js 跑 8-bit ONNX（~320MB）实现纯前端打分；
- 轻量替代：Whisper 识别 → 与参考文本做 diff（WER/CER + 词级 confidence）→ 粗粒度"完整度/流利度"分；**给不了音素级发音质量分**；
- **优点**：零 API 费用、数据可控、可离线、可私有化；
- **缺点**：需要 ML 工程 + GPU 推理资源 + 大量阈值校准和 speechocean762（中文学习者）数据微调；准确度短期内碰不到 Azure；迭代周期 1–3 个月+。

**建议**：MVP 走 **路线 A 或 B** 快速验证产品；如果月打分量级 > 10 万次或必须离线/私有化，再评估路线 C。TTS 免费先用 Google/Azure 免费额度，完全零成本跑通原型。

---

## 三、成本估算（以打分为主，TTS 几乎可忽略）

假设：一篇 2,000 词文档 ≈ 10,000 字符 ≈ TTS 成本 $0.15（Azure/Google）。打分按 5 秒一句计：

| 日活用户 | 人均打分时长/天 | 月打分时长 | Azure PA（≈$1.32/h） | SpeechSuper（≈$0.006/句，按5s/句） |
|---|---|---|---|---|
| 10（原型） | 5 min | 25 h | **免费额度内（5h/月×? 不够用，实际 ≈ $33）** | ≈ $18 |
| 100 | 5 min | 250 h | ≈ $330 | ≈ $180 |
| 1,000 | 5 min | 2,500 h | ≈ $3,300 | ≈ $1,800 |

> 注：Azure 每月仅 5 小时免费额度；SpeechSuper 有最低消费 $20/月；按句计费在大流量下显著便宜。精确价格以签约时官方价为准。

---

## 四、APP 的产品形态与风险

### 产品形态建议（MVP 范围）
1. 上传文档（PDF/Word/TXT）→ 自动分句 → 生成音频（选择美/英音、语速）；
2. 练习页：听原文 → 逐句跟读 → 每句即录即评 → 逐词变色（绿/橙/红）+ 总评分；
3. 完整度/流利度/准确度三维雷达图 + 常见错音提示（针对中式发音：θ/ð、l/r、v/w、鼻音等）；
4. 学习记录：每日打卡、历史曲线、"错音本"（把被评为 Mispronunciation 的词汇沉淀复习）。

### 主要风险与对策

| 风险 | 对策 |
|---|---|
| 录音含噪声/回音导致误判 | 端上降噪（noisereduce / RNNoise）、VAD 截取有效语音、提示用户戴耳机 |
| 浏览器录音格式≠评分要求 | 后端 ffmpeg 统一转 16k/16bit/mono WAV |
| 打分对中文口音偏严/偏松 | 设置评分宽容度（SpeechSuper 支持 strict/lenient、年龄档）；用自己用户数据回归校准阈值 |
| 文档版权 | 用户上传仅用于其本人练习（合理使用立场），平台不二传；可内置无版权公共领域内容（如 Project Gutenberg）作样例 |
| API 可用性/合规（国内） | 上线国内优先 SpeechSuper/Azure 中国区；海外用 Azure 全球版 |
| 成本失控 | 每用户每日打分次数配额；句级短音频；免费额度用尽自动降级为"完整度"粗评分 |
| OpenAI TTS 退役等供应链风险 | TTS 抽象为 Provider 接口，Azure/Google/开源可互换 |

---

## 五、推荐技术栈与路线图

**技术栈（最快落地）**
- 前端：Web 优先 —— Next.js (React) + Tailwind；若必须 App：uni-app（一套代码出小程序+App）或 Flutter；
- 后端：Python **FastAPI**（文档解析/TTS/评分编排最顺手）+ PostgreSQL + 本地磁盘/OSS 存音频；
- 任务队列：MVP 同步；批量文档生成音频用后台任务（arq / Celery / BullMQ）；
- 第三方：Azure Speech（或 SpeechSuper 打分 + Azure/Google TTS）。凭一对 key 即可跑通。

**路线图**
- **第 1 周**：脚手架 + 文档解析 + 分句入库；
- **第 2 周**：TTS 生成 + 跟读播放器（句级高亮、AB 复读、倍速）；
- **第 3 周**：录音上传 + 发音评估接入 + 打分结果页（逐词变色）；
- **第 4 周**：历史记录/打卡 + 部署上线 + 邀请种子用户。

**后续增强**：词级 karaoke 高亮（Azure word boundary）、错音素跟读专项、LLM 生成的中文讲解、个性化"错音本"、离线开源 GOP 降本。

---

## 六、需要你决策的问题

1. **目标平台**：Web 网站 / 微信小程序 / iOS+Android App？（决定前端选型）
2. **上线地域**：国内还是海外？（决定评分服务：SpeechSuper vs Azure）
3. **预算**：能否接受按量付费 API？还是要求纯开源/离线？
4. **内容来源**：只做"用户自传文档"，还是也内置题库？
5. **账号体系**：要不要登录/云同步学习进度？

## 七、下一步

如果你认可这个方向，我可以直接在本仓库里搭建一个可运行的 **MVP 原型**（建议：Next.js 前端 + FastAPI 后端，TTS 与评分用免费额度/占位 key 可直接替换），先把"上传文档 → 生成音频 → 跟读 → 打分"整条链路跑通。

---

## 参考资料

- Azure Pronunciation Assessment：[概览](https://ai.azure.com/explore/aiservices/speech/pronunciationassessment) · [REST API 短音频（不支持 PA 的说明）](https://docs.azure.cn/en-us/ai-services/speech-service/rest-speech-to-text-short) · [Foundry 门户评测结果说明](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/pronunciation-assessment-tool) · [PA 计费问答（标准 STT 费率、5h/月免费）](https://learn.microsoft.com/en-us/answers/questions/5608069/pricing-and-usage-of-pronunciation-assessment-feat) · [fast 端点不支持 PA](https://learn.microsoft.com/en-us/answers/questions/5574771/can-i-use-the-azure-speech-to-text-fast-transcript)
- PA 各维度参数（Miscue / Prosody / Comprehensive）：[Azure Connectors 文档](https://learn.microsoft.com/en-us/connectors/azurespeechpronuncia/)
- TTS 对比与价格：[verli.app 2026-11 对比](https://verli.app/blog/choosing-a-text-to-speech-api) · [texttolab 2026-05](https://texttolab.com/blog/best-text-to-speech-api) · [tooljunction 2026-11（OpenAI tts-1 2027-01-06 退役）](https://www.tooljunction.io/blog/top-10-text-to-speech-api-providers-2026) · [Novita 免费额度对比](https://blogs.novita.ai/best-text-to-speech-api-2026)
- 评测厂商定价对比（2026-09）：[SpeechSuper vs Speechace vs Azure](https://api.toneperfect.app/blog/pronunciation-assessment-api-pricing-compared/)
- SpeechSuper API：[GitHub 示例（句子/段落/雅思口语 CoreType）](https://github.com/speechsuper/SpeechSuper-API-Samples) · [英文句子评测 Demo](https://www.speechsuper.com/demo/english/sentence-evaluation.html) · [什么是语音评测（GOP 原理）](http://blog.speechsuper.com/2022/03/blog-post.html)
- WhisperX 强制对齐与词级时间戳：[2026 指南](https://localaimaster.com/blog/whisperx-guide) · [align() 可传入自有文本（如 TTS 脚本）](https://github.com/m-bain/whisperX/issues/1311)
- 开源 GOP 打分：[PronunciationCoach（wav2vec2+GOP）](https://github.com/audiophrases/PronunciationCoach) · [phoneme-mispronunciation-detection（speechocean762, r≈0.43）](https://github.com/Victus0904/phoneme-mispronunciation-detection) · [soundcheck（纯前端 Transformers.js 打分）](https://github.com/ayrball/soundcheck)
