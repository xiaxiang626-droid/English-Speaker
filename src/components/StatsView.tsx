import type { PracticeRecord } from '../lib/types';
import { IconBook, IconChart, IconFlame, IconCheck } from './icons';

interface StatsViewProps {
  history: PracticeRecord[];
}

const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const fmtDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const scoreClass = (v: number) => (v >= 85 ? 'score-good' : v >= 70 ? 'score-mid' : 'score-low');

export default function StatsView({ history }: StatsViewProps) {
  const totalAttempts = history.length;
  const docCount = new Set(history.map((r) => r.docId)).size;
  const recent = history.slice(0, 50);
  const avg = recent.length ? Math.round(recent.reduce((sum, r) => sum + r.overall, 0) / recent.length) : 0;

  // 连续打卡（以今天或昨天为结尾向前数）
  const days = new Set(history.map((r) => dateKey(new Date(r.date))));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // 最近 14 天柱状图
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const key = dateKey(d);
    const count = history.filter((r) => dateKey(new Date(r.date)) === key).length;
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, count, isToday: i === 13 };
  });
  const maxCount = Math.max(1, ...last14.map((d) => d.count));

  return (
    <div className="stats-view">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon stat-green"><IconCheck size={20} /></div>
          <div className="stat-value">{totalAttempts}</div>
          <div className="stat-label">累计跟读句数</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-blue"><IconBook size={20} /></div>
          <div className="stat-value">{docCount}</div>
          <div className="stat-label">练习过的文档</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-amber"><IconChart size={20} /></div>
          <div className="stat-value">{recent.length ? avg : '—'}</div>
          <div className="stat-label">最近 {recent.length} 练平均分</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-red"><IconFlame size={20} /></div>
          <div className="stat-value">{streak}<span className="stat-unit"> 天</span></div>
          <div className="stat-label">连续打卡</div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-card-head">
          <h3>最近 14 天练习量</h3>
        </div>
        <div className="bar-chart" role="img" aria-label="最近 14 天每日练习句数柱状图">
          {last14.map((day) => (
            <div key={day.label} className="bar-col">
              <div className="bar-value">{day.count > 0 ? day.count : ''}</div>
              <div className="bar-track">
                <div
                  className={`bar-fill${day.isToday ? ' today' : ''}`}
                  style={{ height: `${(day.count / maxCount) * 100}%` }}
                />
              </div>
              <div className="bar-label">{day.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-card-head">
          <h3>最近练习记录</h3>
        </div>
        {history.length === 0 ? (
          <div className="empty-state">
            <p>还没有练习记录。回到「跟读练习」，上传一篇文档或加载示例短文，开始第一次跟读吧。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>文档</th>
                  <th>句子</th>
                  <th>综合</th>
                  <th>准确度</th>
                  <th>流利度</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 15).map((record) => (
                  <tr key={record.id}>
                    <td>{fmtDate(record.date)}</td>
                    <td className="cell-doc" title={record.docTitle}>{record.docTitle}</td>
                    <td>#{record.sentenceIndex + 1}</td>
                    <td><span className={`score-pill ${scoreClass(record.overall)}`}>{record.overall}</span></td>
                    <td>{record.accuracy === null ? '—' : record.accuracy}</td>
                    <td>{record.fluency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
