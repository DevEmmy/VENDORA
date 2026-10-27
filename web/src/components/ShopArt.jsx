import React from 'react';

/** Illustrated storefront for sellers who haven't uploaded photos yet. Goods drawn from what they sell. */
export default function ShopArt({ color = '#555555', keys = [], label = '' }) {
  const sacks = keys.some(k => ['rice', 'beans', 'sugar', 'flour', 'garri'].includes(k));
  const cartons = keys.some(k => ['indomie', 'milk', 'tomato'].includes(k));
  const oil = keys.includes('oil');
  const stripes = Array.from({ length: 9 }, (_, i) => i);
  return (
    <svg viewBox="0 0 320 180" role="img" aria-label={label ? `Illustration of ${label}` : 'Shop illustration'} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`sky${color}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f3f3f3" /><stop offset="1" stopColor="#e3e3e3" /></linearGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#sky${color})`} />
      <rect x="0" y="150" width="320" height="30" fill="#c1c1c1" />
      {/* stall frame */}
      <rect x="30" y="40" width="8" height="112" fill="#464646" /><rect x="282" y="40" width="8" height="112" fill="#464646" />
      <rect x="38" y="62" width="244" height="88" fill="#f8f8f8" />
      {/* awning */}
      {stripes.map(i => <path key={i} d={`M${20 + i * 31} 28 h31 v26 q-15.5 12 -31 0 z`} fill={i % 2 ? '#ffffff' : color} />)}
      <rect x="20" y="22" width="280" height="8" rx="3" fill={color} />
      {/* shelves */}
      <rect x="44" y="104" width="232" height="5" fill="#8f8f8f" /><rect x="44" y="140" width="232" height="10" fill="#6f6f6f" />
      {/* goods */}
      {sacks && [0, 1, 2].map(i => (
        <g key={'s' + i} transform={`translate(${56 + i * 34} 112)`}>
          <path d="M2 28 q-2 -20 6 -26 h16 q8 6 6 26 z" fill="#e3e3e3" stroke="#b5b5b5" strokeWidth="1.5" />
          <rect x="7" y="12" width="18" height="7" rx="2" fill={color} opacity=".85" />
        </g>
      ))}
      {cartons && [0, 1, 2, 3].map(i => (
        <g key={'c' + i} transform={`translate(${160 + (i % 2) * 30} ${i < 2 ? 116 : 76})`}>
          <rect width="28" height="24" rx="2" fill={i % 2 ? '#7d7d7d' : '#b4b4b4'} />
          <rect y="9" width="28" height="5" fill="#fff" opacity=".7" />
        </g>
      ))}
      {oil && [0, 1, 2].map(i => (
        <g key={'o' + i} transform={`translate(${226 + i * 15} 112)`}>
          <rect x="2" y="4" width="11" height="24" rx="3" fill="#bcbcbc" opacity=".9" /><rect x="5" y="0" width="5" height="5" fill="#6b6b6b" />
        </g>
      ))}
      {!sacks && !cartons && !oil && <rect x="120" y="112" width="80" height="26" rx="4" fill={color} opacity=".4" />}
      {[0, 1, 2, 3, 4].map(i => <rect key={'t' + i} x={58 + i * 44} y="78" width="26" height="22" rx="3" fill={color} opacity={0.18 + (i % 3) * 0.12} />)}
    </svg>
  );
}
