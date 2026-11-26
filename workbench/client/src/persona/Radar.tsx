import React from 'react';
import type { Profile } from './model';

export function Radar({
  profile,
  large = false,
  onSelect,
}: {
  profile: Profile;
  large?: boolean;
  onSelect?: (i: number) => void;
}) {
  const r = large ? 77 : 61;
  const cx = large ? 140 : 72,
    cy = large ? 110 : 72;
  const point = (i: number, scale: number) => {
    const angle = (i * Math.PI) / 3 - Math.PI / 2;
    return [cx + r * scale * Math.cos(angle), cy + r * scale * Math.sin(angle)];
  };
  const indices = [0, 1, 2, 3, 4, 5];
  const grid = (s: number) =>
    indices.map((i) => point(i, s).join(',')).join(' ');
  const values = profile.axes.map((a) => a.score);
  const dots = values.map((v, i) => (v === null ? null : point(i, v / 100)));
  return (
    <svg
      className={large ? 'radar large' : 'radar mini'}
      viewBox={large ? '0 0 280 220' : '0 0 144 144'}
      role="img"
      aria-label={profile.name + '六维画像'}
    >
      <title>
        {profile.axes
          .map((a) => a.name + ' ' + (a.score ?? '数据不足'))
          .join('，')}
      </title>
      {[0.25, 0.5, 0.75, 1].map((s) => (
        <polygon key={s} className="gridline" points={grid(s)} />
      ))}
      {indices.map((i) => (
        <line
          key={i}
          className="spoke"
          x1={cx}
          y1={cy}
          x2={point(i, 1)[0]}
          y2={point(i, 1)[1]}
        />
      ))}
      {dots.every(Boolean) && (
        <polygon
          className="shape"
          points={dots.map((p) => p!.join(',')).join(' ')}
        />
      )}
      {dots.map((p, i) => {
        const next = dots[(i + 1) % 6];
        return (
          p && (
            <g key={i}>
              {next && (
                <line
                  className="edge"
                  x1={p[0]}
                  y1={p[1]}
                  x2={next[0]}
                  y2={next[1]}
                />
              )}
              <circle
                cx={p[0]}
                cy={p[1]}
                r={large ? 3.3 : 2.5}
                className="dot"
              />
            </g>
          )
        );
      })}
      {large &&
        profile.axes.map((a, i) => {
          const [x, y] = point(i, 1.16);
          return (
            <text
              key={a.name}
              x={x}
              y={y + 4}
              className="axistext"
              textAnchor={
                i === 0 || i === 3 ? 'middle' : i < 3 ? 'start' : 'end'
              }
              onClick={() => onSelect?.(i)}
            >
              {a.name}
            </text>
          );
        })}
    </svg>
  );
}
