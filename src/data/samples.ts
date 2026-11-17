import type { StoredDoc } from '../lib/types';

/** 原创示例短文（Level A2–B1），可直接用于体验跟读打分 */
export const SAMPLE_DOCS: Array<Pick<StoredDoc, 'title' | 'sentences'> & { hint: string }> = [
  {
    title: 'The Lost Umbrella（示例短文）',
    hint: '伞 · B1',
    sentences: [
      'It was raining hard when Emma left the library.',
      'She did not have her umbrella with her, so she put up her jacket and ran for the bus.',
      'On the bus, she noticed a black umbrella under the seat in front of her.',
      'She looked around, but nobody was sitting nearby.',
      'Emma decided to take the umbrella to the lost and found office.',
      'The woman at the office smiled and asked for her name and phone number.',
      'Two days later, Emma received a phone call from the library.',
      'Someone had found her umbrella and remembered her phone number.',
      'The umbrella was blue, not black, but it was definitely hers.',
      'Emma was very happy, and she thanked the librarian warmly.',
      'From that day on, she always checked the lost and found office after work.',
      'She also put a small sticker on her umbrella with her name on it.',
    ],
  },
  {
    title: 'Morning Routine（示例短文 · 初级）',
    hint: '晨间 · A2',
    sentences: [
      'I wake up at six thirty every morning.',
      'First, I drink a big glass of water.',
      'Then I make a cup of coffee and open the window.',
      'The morning air is fresh and cool.',
      'I usually read the news while I eat breakfast.',
      'After breakfast, I go for a short walk in the park.',
      'Walking helps me think about the day ahead.',
      'At eight o’clock, I sit down at my desk and start work.',
    ],
  },
];

/** AI 批阅示例：话题 + 一篇带典型错误的作文 */
export const SAMPLE_GRADING_TOPIC = {
  title: 'Describe an unforgettable trip you took.',
  requirements: '不少于 100 词；涵盖时间、地点、同行人、个人感受；注意时态一致与冠词使用。',
};

export const SAMPLE_ESSAY =
  'Last summer, I go to Hangzhou with my parents. We see the West Lake and take a lot of photo there. ' +
  'The weather is very hot, and i dont like to bringing a umbrella. We visit many places, and the view was really beautiful. ' +
  'I forget to bring my shoes, so my mother buy me a new pair in a shop. Everyone in my family like the trip very much, ' +
  'because it is truly unforgettable and i will never forget it. I think it is the best trip in my life. ' +
  'If i will have time, i want go again next year with my best friend Tom.';
