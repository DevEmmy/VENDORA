import React from 'react';
import { keyFor } from '../lib/hub.js';

// Product illustrations drawn in code (no photos needed, crisp at any size).
// Each market staple gets its own packaging shape and colour so traders recognise items at a glance.
const PALETTE = {
  rice: { bg: '#f3f3f3', a: '#e7e7e7', b: '#727272', c: '#6b6b6b', label: 'RICE' },
  beans: { bg: '#ededed', a: '#d7d7d7', b: '#5a5a5a', c: '#3a3a3a', label: 'BEANS' },
  sugar: { bg: '#f2f2f2', a: '#ffffff', b: '#555555', c: '#b3b3b3', label: 'SUGAR' },
  flour: { bg: '#f1f1f1', a: '#fafafa', b: '#878787', c: '#1a1a1a', label: 'FLOUR' },
  garri: { bg: '#f4f4f4', a: '#d4d4d4', b: '#b4b4b4', c: '#ffffff' },
  indomie: { bg: '#f4f4f4', a: '#b4b4b4', b: '#7d7d7d', c: '#ffffff', label: 'NOODLES' },
  milk: { bg: '#f0f0f0', a: '#4d4d4d', b: '#ffffff', c: '#b3b3b3', label: 'MILK' },
  tomato: { bg: '#f1f1f1', a: '#5f5f5f', b: '#c4c4c4', c: '#696969', label: 'PASTE' },
  oil: { bg: '#f7f7f7', a: '#bcbcbc', b: '#6b6b6b', c: '#ffffff' },
  other: { bg: '#f1f1f1', a: '#a8a8a8', b: '#6f6f6f', c: '#1a1a1a' },
};

function Sack({ p }) {
  return (<g>
    <ellipse cx="50" cy="88" rx="30" ry="5" fill="#000" opacity=".08" />
    <path d="M26 30 q-4 28 0 54 q24 6 48 0 q4 -26 0 -54 q-24 -5 -48 0z" fill={p.a} stroke="#00000014" strokeWidth="1.5" />
    <path d="M28 30 q22 -9 44 0 l-4 -9 q-18 -5 -36 0z" fill={p.a} stroke="#00000014" strokeWidth="1.5" />
    <rect x="31" y="48" width="38" height="20" rx="4" fill={p.b} />
    <text x="50" y="62" textAnchor="middle" fontSize="9" fontWeight="800" fill={p.c} fontFamily="system-ui">{p.label}</text>
    <path d="M36 24 q14 4 28 0" stroke="#00000030" strokeWidth="2" fill="none" />
  </g>);
}
function Carton({ p }) {
  return (<g>
    <ellipse cx="50" cy="88" rx="32" ry="5" fill="#000" opacity=".08" />
    <path d="M18 38 l32 -12 l32 12 v42 l-32 8 l-32 -8z" fill={p.a} />
    <path d="M50 26 l32 12 v42 l-32 8z" fill="#000" opacity=".1" />
    <path d="M18 38 l32 12 l32 -12" stroke="#00000022" strokeWidth="1.5" fill="none" />
    <path d="M50 50 v38" stroke="#00000022" strokeWidth="1.5" />
    <g transform="skewY(20.56)">
      <rect x="22" y="44" width="25" height="12" rx="2" fill={p.b} />
      <text x="34.5" y="52.6" textAnchor="middle" fontSize="6.2" fontWeight="800" fill={p.c} fontFamily="system-ui">{p.label}</text>
    </g>
  </g>);
}
function Tin({ p }) {
  return (<g>
    <ellipse cx="50" cy="88" rx="26" ry="5" fill="#000" opacity=".08" />
    <rect x="28" y="28" width="44" height="56" rx="6" fill={p.a} />
    <ellipse cx="50" cy="28" rx="22" ry="6" fill="#dddddd" stroke="#00000018" />
    <rect x="28" y="46" width="44" height="22" fill={p.b} />
    <text x="50" y="61" textAnchor="middle" fontSize="8" fontWeight="800" fill={p.a === '#ffffff' ? '#4d4d4d' : '#fff'} fontFamily="system-ui">{p.label}</text>
    {p.c && <circle cx="62" cy="38" r="4" fill={p.c} />}
  </g>);
}
function Bucket({ p }) {
  return (<g>
    <ellipse cx="50" cy="88" rx="28" ry="5" fill="#000" opacity=".08" />
    <path d="M24 40 h52 l-5 44 h-42z" fill="#ffffff" stroke="#00000018" strokeWidth="1.5" />
    <ellipse cx="50" cy="40" rx="26" ry="7" fill={p.a} />
    {[0, 1, 2, 3, 4, 5, 6].map(i => <circle key={i} cx={34 + (i % 4) * 10 + (i > 3 ? 5 : 0)} cy={i > 3 ? 36 : 40} r="3" fill={p.b} opacity=".8" />)}
    <path d="M28 30 q22 -22 44 0" stroke="#a2a2a2" strokeWidth="2.5" fill="none" />
  </g>);
}
function Jerrycan({ p }) {
  return (<g>
    <ellipse cx="50" cy="88" rx="28" ry="5" fill="#000" opacity=".08" />
    <rect x="26" y="30" width="48" height="56" rx="8" fill={p.a} />
    <rect x="58" y="20" width="10" height="12" rx="2" fill={p.b} />
    <path d="M30 30 q0 -10 12 -10 h8 v10" stroke={p.a} strokeWidth="6" fill="none" />
    <rect x="32" y="50" width="36" height="20" rx="3" fill={p.b} />
    <text x="50" y="63" textAnchor="middle" fontSize="8" fontWeight="800" fill={p.c} fontFamily="system-ui">OIL</text>
  </g>);
}
function Box({ p }) {
  return (<g>
    <ellipse cx="50" cy="88" rx="30" ry="5" fill="#000" opacity=".08" />
    <rect x="22" y="34" width="56" height="50" rx="4" fill={p.a} />
    <rect x="22" y="34" width="56" height="10" fill={p.b} />
    <rect x="44" y="34" width="12" height="50" fill="#ffffff" opacity=".25" />
  </g>);
}

const SHAPE = { rice: Sack, beans: Sack, sugar: Sack, flour: Sack, garri: Bucket, indomie: Carton, milk: Tin, tomato: Tin, oil: Jerrycan, other: Box };

/** <ProductArt product={p} /> or <ProductArt k="rice" /> */
export default function ProductArt({ product, k, size = '100%', rounded = 16, plain = false }) {
  const key = k || (product && keyFor(product)) || 'other';
  const p = PALETTE[key] || PALETTE.other;
  const Shape = SHAPE[key] || Box;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} preserveAspectRatio="xMidYMid slice" role="img" aria-label={product?.name || key} style={{ display: 'block', borderRadius: rounded }}>
      {!plain && <rect width="100" height="100" fill={p.bg} />}
      {!plain && <circle cx="78" cy="18" r="26" fill="#fff" opacity=".45" />}
      <Shape p={p} />
    </svg>
  );
}
