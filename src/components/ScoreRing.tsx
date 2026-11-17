import { useEffect, useState } from 'react';

interface ScoreRingProps {
  value: number | null;
  size?: number;
  label?: string;
}

export default function ScoreRing({ value, size = 150, label = '综合得分' }: ScoreRingProps) {
  const target = Math.max(0, Math.min(100, value ?? 0));
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setProgress(target));
    return () => window.cancelAnimationFrame(raf);
  }, [target]);

  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  const color = target >= 85 ? '#16a34a' : target >= 70 ? '#d97706' : '#dc2626';

  return (
    <div className="score-ring" role="img" aria-label={`${label} ${target} 分`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#e9e6da"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="score-ring-text">
        <div className="score-ring-value" style={{ color }}>
          {value === null ? '—' : Math.round(value)}
        </div>
        <div className="score-ring-label">{label}</div>
      </div>
    </div>
  );
}
