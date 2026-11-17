export default function ScoreBar({ label, value }: { label: string; value: number | null }) {
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
