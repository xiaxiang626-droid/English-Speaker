export default function GuideView() {
  return (
    <div className="guide-view">
      <div className="panel-card">
        <div className="panel-card-head">
          <h3>一、免费打分是怎么工作的？</h3>
        </div>
        <div className="guide-body">
          <p>本原型不依赖任何付费 API，打分流程完全在你的浏览器里完成：</p>
          <ol>
            <li><strong>朗读示范</strong>：浏览器内置的 Speech Synthesis（Web Speech API）生成英文语音，零成本、无需联网模型。</li>
            <li><strong>跟读录音</strong>：通过 MediaRecorder 采集你的声音，并实时分析有效语音时长（静音占比）。</li>
            <li><strong>语音识别</strong>：浏览器内置的 Speech Recognition 把你读的内容转写为文本（免费，无需 key）。</li>
            <li><strong>逐词对齐</strong>：用编辑距离算法把「识别文本」和「参考原文」对齐，逐词判定读对 / 可能读错 / 漏读 / 多读。</li>
            <li><strong>综合得分</strong> = 0.55 × 准确度 + 0.25 × 完整度 + 0.20 × 流利度（语速接近 125 wpm 得分最高，静音停顿过多会扣分）。</li>
          </ol>
          <div className="guide-callout">
            <strong>局限性（请知悉）</strong>
            <ul>
              <li>这是文本级 + 流利度级评估，<em>不是音素级（phoneme-level）发音评测</em>，无法精确判断某个音素发得对不对。</li>
              <li>识别引擎对重度口音、极轻微的声音可能识别不准，准确度分数会偏低——建议在安静的环境、按正常音量朗读。</li>
              <li>准确度 = 读对词数 + 0.25×读错词数，除以原文总词数；完整度 =（原文词数 − 漏读词数）÷ 原文总词数。</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-card-head">
          <h3>二、国内使用与上线部署</h3>
        </div>
        <div className="guide-body">
          <p><strong>浏览器建议：优先使用 Microsoft Edge。</strong> Edge 的语音合成与语音识别走微软 Azure 通道，在国内可以直接使用、无需梯子；Chrome 桌面版的语音识别默认走 Google 服务，国内通常不可用（本应用会自动降级为「只评估语速连贯性」模式并提示你）。</p>
          <p><strong>麦克风权限：</strong>浏览器要求通过 HTTPS（或 localhost / 127.0.0.1）访问才能使用麦克风。本地开发用 <code>http://localhost:5173</code> 即可；线上部署必须开 HTTPS。</p>
          <p><strong>静态部署（本应用是纯前端静态站，无后端、无需数据库）：</strong></p>
          <ul>
            <li><code>npm run build</code> 后把 <code>dist/</code> 上传到任意静态托管：阿里云 OSS + CDN、腾讯云 COS、又拍云、七牛云、Cloudflare Pages、Vercel 均可；</li>
            <li>面向中国内地用户时，域名需要 ICP 备案，否则无法在内地 CDN 正常对外服务；也可只先在个人服务器用 nginx 静态托管 + HTTPS。</li>
            <li>所有练习数据（文档、成绩、历史）都保存在用户自己的浏览器 localStorage 中，不上传任何服务器，天然没有合规风险。</li>
          </ul>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-card-head">
          <h3>三、如何升级为「专业级」打分？</h3>
        </div>
        <div className="guide-body">
          <p>当免费的浏览器方案不够用时，只需要替换 <code>src/lib/scoring.ts</code> 一个模块，把录音发给专用发音评估 API，即可获得音素级反馈：</p>
          <ul>
            <li><strong>SpeechSuper（国内可直连）</strong>：句子/段落评测，输出整体、发音、流利、完整、节奏分 + 词级/音素级分数，支持音节重音、连读、失去爆破、句子升降调、IELTS 估分，按次计费（约 $0.004–0.008/句）。</li>
            <li><strong>Azure AI Speech · Pronunciation Assessment</strong>：accuracy / fluency / completeness / prosody 四维 + 逐词/逐音素分数 + Omission/Insertion/Mispronunciation 标记，按 STT 时长计费（约 $1–1.32/音频小时，每月 5 小时免费）。</li>
            <li><strong>开源离线方案</strong>：wav2vec2 音素模型 + espeak-ng G2P + CTC 强制对齐，计算 GOP（Goodness of Pronunciation）；零 API 费用、可私有化，但需要 ML 工程和校准数据（如 speechocean762）。</li>
          </ul>
          <p>完整对比见仓库内的 <code>docs/feasibility-study.md</code>《可行性调研报告》。</p>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-card-head">
          <h3>四、AI 批阅（作文批改）怎么用？</h3>
        </div>
        <div className="guide-body">
          <p><strong>流程</strong>：① 左侧先新建/选择话题和批阅要求（可保存多条，组成话题库）→ ② 上传学生作文文件（TXT / MD / PDF / DOCX）→ ③ 点「开始批阅」，结果含总分、维度评分、逐条错误修正、优点、改进建议和总体评语，可一键复制报告。</p>
          <p><strong>两种模式</strong>：</p>
          <ul>
            <li><strong>AI 深度批阅（推荐）</strong>：在「AI 批阅设置」里填入 OpenAI 兼容接口的 API Key。支持 DeepSeek（约 ¥1/百万 token）、智谱 GLM-4-Flash（免费）、通义千问 DashScope（免费额度）、Kimi、OpenAI 或自定义接口。输出任务完成度 / 连贯性 / 语法 / 词汇四维 + 逐条「原文 → 修正 → 中文说明」。Key 只存浏览器 localStorage，直连厂商接口，不经过任何第三方服务器。</li>
            <li><strong>免费基础批阅（零配置）</strong>：LanguageTool 免费语法/拼写检查（可关闭、可改自建地址）+ 统计特征（词数、句长、词汇多样性、话题关键词覆盖率），给出基础分和错误清单。局限：不考察内容深度与连贯性，评分偏粗。</li>
          </ul>
          <p><strong>数据与隐私</strong>：话题与批阅记录只存浏览器 localStorage；作文文本仅在（a）配置了 AI Key 时发给你选择的厂商、或（b）开启 LanguageTool 时发给该语法检查服务，否则全程留在本机。</p>
          <p><strong>国内部署建议</strong>：选智谱 GLM-4-Flash（免费）或 DeepSeek，并关闭 / 自建 LanguageTool——全程走国内可直连的接口。</p>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-card-head">
          <h3>五、常见问题</h3>
        </div>
        <div className="guide-body">
          <dl className="faq">
            <dt>听不到朗读声音？</dt>
            <dd>检查系统音量；在上方「音色」下拉框切换其他 English 音色（不同系统可用音色不同）；确认浏览器没有静音该标签页。</dd>
            <dt>每次识别结果都不准？</dt>
            <dd>尽量用 Edge、安静的环境、正常音量、贴近麦克风的标准跟读；口音较重时识别引擎本身的置信度有限，这是免费方案的固有局限。</dd>
            <dt>上传了 PDF 却没有内容？</dt>
            <dd>扫描版（图片型）PDF 不含文字层，请先用 OCR 工具转成可复制文本；加密 PDF 需要先解除密码。</dd>
            <dt>我的数据存在哪里？</dt>
            <dd>全部存在浏览器 localStorage，换浏览器/换设备不互通；清空浏览器数据会丢失进度。录音只在页面内用于回放，不会被保存或上传。</dd>
            <dt>可以商用吗？</dt>
            <dd>代码随意取用；但你上传的文档内容版权归原作者所有，请只练习你有权使用的材料。</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
