// 基于浏览器内置 Web Speech API 的免费 TTS 封装
let voicesCache: SpeechSynthesisVoice[] = [];

function englishVoices(): SpeechSynthesisVoice[] {
  return window.speechSynthesis
    .getVoices()
    .filter((v) => /^en([-_]|$)/i.test(v.lang));
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const cached = englishVoices();
    if (cached.length > 0) {
      voicesCache = cached;
      resolve(cached);
      return;
    }
    const onChange = () => {
      const voices = englishVoices();
      if (voices.length > 0) {
        voicesCache = voices;
        window.speechSynthesis.removeEventListener('voiceschanged', onChange);
        resolve(voices);
      }
    };
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    // 兜底：1.5s 后返回当前可用的（可能为空）列表
    window.setTimeout(() => resolve(englishVoices()), 1500);
  });
}

export function speak(
  text: string,
  options: { rate: number; voiceURI?: string; accent: 'en-US' | 'en-GB' },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      reject(new Error('当前浏览器不支持语音合成'));
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const preferred =
      voicesCache.find((v) => v.voiceURI === options.voiceURI) ??
      voicesCache.find((v) => v.lang.replace('_', '-') === options.accent) ??
      voicesCache[0];
    if (preferred) {
      utterance.voice = preferred;
      utterance.lang = preferred.lang;
    } else {
      utterance.lang = options.accent;
    }
    utterance.rate = options.rate;
    utterance.pitch = 1;
    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      // 用户主动 cancel 触发的 interrupted/canceled 视为正常结束
      if (event.error === 'interrupted' || event.error === 'canceled') resolve();
      else reject(new Error(`朗读失败：${event.error}`));
    };
    synth.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
