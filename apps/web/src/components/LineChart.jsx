import React from "react";

export function LineChart({ data = [] }) {
  const chartData = Array.isArray(data) ? data : [];
  const width = 520;
  const height = 190;

  if (chartData.length === 0) {
    return (
      <div className="line-chart-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: `${height}px`, color: "var(--muted)" }}>
        暂无趋势数据
      </div>
    );
  }

  const max = Math.max(...chartData, 1);
  const points = chartData.map((value, index) => {
    const x = 24 + (index * (width - 48)) / Math.max(1, chartData.length - 1);
    const y = height - 24 - (value / max) * (height - 54);
    return [x, y];
  });

  return (
    <div className="line-chart-wrap">
      <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="收入趋势图">
        {[0, 1, 2, 3].map((line) => (
          <line key={line} x1="20" x2={width - 20} y1={28 + line * 40} y2={28 + line * 40} />
        ))}
        <polyline points={points.map(([x, y]) => `${x},${y}`).join(" ")} />
        {points.map(([x, y], index) => <circle key={`${x}-${index}`} cx={x} cy={y} r="4" />)}
      </svg>
    </div>
  );
}
