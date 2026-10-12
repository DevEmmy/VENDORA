import React from 'react';
import { keyFor } from '../lib/hub.js';

// Product illustrations drawn in code (no photos needed, crisp at any size).
// Each market staple gets its own packaging shape and colour so traders recognise items at a glance.
const PALETTE = {
  rice: { bg: '#fdf3dc', a: '#f4e7c3', b: '#e0443e', c: '#0f9d58', label: 'RICE' },
  beans: { bg: '#f7ebe1', a: '#ead2bd', b: '#8a4b2a', c: '#5b2f18', label: 'BEANS' },
  sugar: { bg: '#eef3fb', a: '#ffffff', b: '#1f55e0', c: '#f5b400', label: 'SUGAR' },
  flour: { bg: '#f3f1ea', a: '#fbfaf5', b: '#d97706', c: '#0a1a47', label: 'FLOUR' },
  garri: { bg: '#fff5d6', a: '#f8d66b', b: '#e7b52a', c: '#ffffff' },
  indomie: { bg: '#fff1e6', a: '#f2b705', b: '#e8562a', c: '#ffffff', label: 'NOODLES' },
  milk: { bg: '#e9f0ff', a: '#1d4fbf', b: '#ffffff', c: '#f5b400', label: 'MILK' },
  tomato: { bg: '#fdecea', a: '#d62d24', b: '#f6c445', c: '#2f8f3a', label: 'PASTE' },
  oil: { bg: '#fff8dc', a: '#f5c400', b: '#0f9d58', c: '#ffffff' },
  other: { bg: '#eef1f7', a: '#c9a36b', b: '#8f6a39', c: '#0a1a47' },
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
    <ellipse cx="50" cy="28" rx="22" ry="6" fill="#d9dde6" stroke="#00000018" />
    <rect x="28" y="46" width="44" height="22" fill={p.b} />
    <text x="50" y="61" textAnchor="middle" fontSize="8" fontWeight="800" fill={p.a === '#ffffff' ? '#1d4fbf' : '#fff'} fontFamily="system-ui">{p.label}</text>
    {p.c && <circle cx="62" cy="38" r="4" fill={p.c} />}
  </g>);
}
function Bucket({ p }) {
  return (<g>
    <ellipse cx="50" cy="88" rx="28" ry="5" fill="#000" opacity=".08" />
    <path d="M24 40 h52 l-5 44 h-42z" fill="#ffffff" stroke="#00000018" strokeWidth="1.5" />
    <ellipse cx="50" cy="40" rx="26" ry="7" fill={p.a} />
    {[0, 1, 2, 3, 4, 5, 6].map(i => <circle key={i} cx={34 + (i % 4) * 10 + (i > 3 ? 5 : 0)} cy={i > 3 ? 36 : 40} r="3" fill={p.b} opacity=".8" />)}
    <path d="M28 30 q22 -22 44 0" stroke="#9aa3b5" strokeWidth="2.5" fill="none" />
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
