import React, { useEffect, useRef, useState } from 'react';

/*
 * Picture story on the sign-in screens: four short scenes of what Vendora does in a shop.
 * Changes every few seconds; tap the bars or swipe to move, hold to pause.
 * Each scene's own animation replays when it comes on screen.
 */

const C = { ink: '#1a1a1a', royal: '#555555', royal2: '#717171', kola: '#b3b3b3', leaf: '#6b6b6b', pepper: '#727272', cream: '#f3f3f3', sand: '#dfdfdf', wood: '#6f6f6f' };

function Awning({ y = 0 }) {
  return (
    <g transform={`translate(0 ${y})`}>
      {Array.from({ length: 11 }, (_, i) => (
        <path key={i} d={`M${i * 30} 0 h30 v20 q-15 10 -30 0 z`} fill={i % 2 ? '#fff' : C.royal} />
      ))}
    </g>
  );
}

function Phone({ x, y, children, w = 92, h = 150 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx="14" fill={C.ink} />
      <rect x="5" y="9" width={w - 10} height={h - 18} rx="9" fill="#fff" />
      <rect x={w / 2 - 12} y="3" width="24" height="3" rx="1.5" fill="#3b3b3b" />
      {children}
    </g>
  );
}

/* 1. Say the sale out loud, it becomes a record. */
function VoiceScene() {
  return (
    <svg viewBox="0 0 320 190" aria-hidden="true">
      <rect width="320" height="190" fill={C.cream} />
      <Awning y={0} />
      <rect x="0" y="160" width="320" height="30" fill={C.sand} />
      {/* rice sacks on the counter */}
      {[0, 1, 2].map(i => (
        <g key={i} transform={`translate(${196 + i * 34} 120)`}>
          <path d="M2 40 q-3 -28 8 -36 h14 q11 8 8 36 z" fill="#e3e3e3" stroke="#b5b5b5" strokeWidth="1.5" />
          <rect x="8" y="16" width="18" height="8" rx="2" fill={C.royal} opacity=".85" />
        </g>
      ))}
      <Phone x={34} y={30}>
        <circle className="vas-pulse" cx="46" cy="64" r="22" fill={C.royal} opacity=".18" />
        <circle cx="46" cy="64" r="16" fill={C.royal} />
        <rect x="42" y="54" width="8" height="13" rx="4" fill="#fff" />
        <path d="M38 64 q8 10 16 0 M46 72 v5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <rect key={i} className="vas-wave" style={{ animationDelay: `${i * 0.09}s` }} x={18 + i * 8.5} y="96" width="4.5" height="18" rx="2.2" fill={C.royal2} />
        ))}
      </Phone>
      <g className="vas-pop" style={{ animationDelay: '.35s' }}>
        <path d="M140 34 h150 a10 10 0 0 1 10 10 v30 a10 10 0 0 1 -10 10 h-138 l-12 10 v-10 a10 10 0 0 1 -10 -10 v-30 a10 10 0 0 1 10 -10 z" fill="#fff" stroke={C.ink} strokeOpacity=".12" />
        <text x="150" y="55" fontSize="12.5" fontWeight="700" fill={C.ink}>"Sold 2 bags of rice</text>
        <text x="150" y="72" fontSize="12.5" fontWeight="700" fill={C.ink}>to Mama Ngozi"</text>
      </g>
      <g className="vas-rise" style={{ animationDelay: '1.3s' }}>
        <rect x="140" y="102" width="132" height="34" rx="17" fill={C.leaf} />
        <circle cx="158" cy="119" r="9" fill="#fff" />
        <path className="vas-draw" style={{ animationDelay: '1.6s' }} d="M153.5 119 l3.2 3.2 l6 -6.4" stroke={C.leaf} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="173" y="123.5" fontSize="12" fontWeight="800" fill="#fff">Saved ₦152,000</text>
      </g>
    </svg>
  );
}

/* 2. Every transfer alert is checked with Wema before goods leave. */
function TransferScene() {
  return (
    <svg viewBox="0 0 320 190" aria-hidden="true">
      <rect width="320" height="190" fill="#efefef" />
      {[0, 1, 2, 3, 4].map(i => <circle key={i} cx={30 + i * 70} cy={170 - (i % 2) * 12} r={38} fill="#e5e5e5" />)}
      {/* the fake alert, struck out */}
      <g className="vas-fake" transform="translate(178 34) rotate(7)">
        <rect width="118" height="62" rx="12" fill="#fff" stroke={C.pepper} strokeOpacity=".35" />
        <text x="12" y="22" fontSize="10.5" fontWeight="700" fill="#939393">Credit alert</text>
        <text x="12" y="42" fontSize="15" fontWeight="800" fill="#939393">₦80,000</text>
        <g className="vas-pop" style={{ animationDelay: '1.4s' }}>
          <rect x="-6" y="44" width="92" height="22" rx="11" fill={C.pepper} />
          <text x="6" y="59" fontSize="10.5" fontWeight="800" fill="#fff">Fake, blocked</text>
        </g>
      </g>
      <Phone x={40} y={22} w={120} h={156}>
        <text x="16" y="34" fontSize="10.5" fontWeight="700" fill="#565656">Money in</text>
        <text x="16" y="58" fontSize="20" fontWeight="800" fill={C.ink}>₦45,000</text>
        <text x="16" y="76" fontSize="10.5" fill="#565656">from Tunde A.</text>
        <g className="vas-stamp" style={{ animationDelay: '.5s' }}>
          <circle cx="60" cy="104" r="22" fill={C.leaf} />
          <path className="vas-draw" style={{ animationDelay: '.85s' }} d="M50 104 l7 7 l13 -14" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <text className="vas-fade" style={{ animationDelay: '1s' }} x="60" y="140" fontSize="9.5" fontWeight="800" fill={C.leaf} textAnchor="middle">Checked with Wema</text>
      </Phone>
    </svg>
  );
}

/* 3. Stock counts itself down and warns before it runs out. */
function StockScene() {
  const items = [
    { x: 40, h: 62, c: C.royal, n: 'Rice' },
    { x: 92, h: 84, c: C.kola, n: 'Oil' },
    { x: 144, h: 48, c: C.leaf, n: 'Beans' },
    { x: 196, h: 18, c: C.pepper, n: 'Milo', low: true },
    { x: 248, h: 70, c: '#787878', n: 'Sugar' },
  ];
  return (
    <svg viewBox="0 0 320 190" aria-hidden="true">
      <rect width="320" height="190" fill={C.cream} />
      <rect x="24" y="148" width="272" height="8" rx="3" fill={C.wood} />
      <line x1="24" y1="70" x2="296" y2="70" stroke={C.ink} strokeOpacity=".08" strokeDasharray="4 5" />
      {items.map((it, i) => (
        <g key={it.n}>
          <rect className={'vas-bar' + (it.low ? ' vas-low' : '')} style={{ animationDelay: `${0.1 + i * 0.12}s` }}
            x={it.x} y={148 - it.h} width="34" height={it.h} rx="6" fill={it.c} />
          <text x={it.x + 17} y="172" fontSize="11" fontWeight="700" fill={C.ink} textAnchor="middle">{it.n}</text>
        </g>
      ))}
      <g className="vas-pop" style={{ animationDelay: '1.1s' }}>
        <path d="M110 14 h176 a10 10 0 0 1 10 10 v18 a10 10 0 0 1 -10 10 h-67 l-6 8 l-6 -8 h-97 a10 10 0 0 1 -10 -10 v-18 a10 10 0 0 1 10 -10 z" fill={C.ink} />
        <text x="198" y="37" fontSize="12" fontWeight="800" fill="#fff" textAnchor="middle">Only 3 Milo left. Restock?</text>
      </g>
    </svg>
  );
}

/* 4. Good records grow the Business Score, which unlocks restock money from Wema. */
function LoanScene() {
  const arc = 'M36 146 A78 78 0 0 1 192 146';
  return (
    <svg viewBox="0 0 320 190" aria-hidden="true">
      <rect width="320" height="190" fill={C.ink} />
      {Array.from({ length: 18 }, (_, i) => <circle key={i} cx={(i * 53) % 320} cy={(i * 37) % 120 + 10} r={i % 3 ? 1 : 1.6} fill="#fff" opacity=".35" />)}
      <path d={arc} stroke="#333333" strokeWidth="16" fill="none" strokeLinecap="round" />
      <path className="vas-gauge" d={arc} stroke={C.kola} strokeWidth="16" fill="none" strokeLinecap="round" pathLength="100" />
      <text x="114" y="132" fontSize="34" fontWeight="800" fill="#fff" textAnchor="middle">742</text>
      <text x="114" y="151" fontSize="10.5" fontWeight="700" fill="#c9c9c9" textAnchor="middle">Business Score</text>
      {[0, 1, 2].map(i => (
        <g key={i} className="vas-coin" style={{ animationDelay: `${1 + i * 0.25}s` }}>
          <circle cx={262 + (i - 1) * 14} cy="70" r="9" fill={C.kola} stroke="#909090" strokeWidth="2" />
          <text x={262 + (i - 1) * 14} y="74" fontSize="10" fontWeight="800" fill="#575757" textAnchor="middle">₦</text>
        </g>
      ))}
      <g className="vas-rise" style={{ animationDelay: '1.7s' }}>
        <rect x="222" y="112" width="84" height="40" rx="10" fill={C.leaf} />
        <text x="264" y="129" fontSize="10" fontWeight="800" fill="#fff" textAnchor="middle">₦300,000</text>
        <text x="264" y="143" fontSize="8.5" fontWeight="700" fill="#ebebeb" textAnchor="middle">to your seller</text>
      </g>
    </svg>
  );
}

const SCENES = [
  { Art: VoiceScene, title: 'Say the sale. It is recorded.', body: 'Speak, tap or send a WhatsApp. Vendora writes it down.' },
  { Art: TransferScene, title: 'No more fake transfer alerts.', body: 'Every alert is checked with Wema before goods leave.' },
  { Art: StockScene, title: 'Stock that counts itself.', body: 'Know what is running low before customers ask.' },
  { Art: LoanScene, title: 'Records that earn you money.', body: 'Your Business Score unlocks restock loans, paid to your seller.' },
];

const DURATION = 5200;

export default function AuthScenes({ compact = false }) {
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(false);
  const paused = hover || held || hidden;
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const start = useRef(null);
  const reduced = useRef(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  const go = (i) => setIndex((i + SCENES.length) % SCENES.length);

  // Pause while the tab is hidden, so the story doesn't race ahead in the background.
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const down = (e) => { start.current = { x: e.clientX, t: Date.now() }; setHeld(true); };
  const up = (e) => {
    setHeld(false);
    const s = start.current; start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
    else if (Date.now() - s.t < 250) {
      // A quick tap: right side moves on, left side goes back.
      const r = e.currentTarget.getBoundingClientRect();
      go(index + (e.clientX - r.left > r.width / 3 ? 1 : -1));
    }
  };
  const move = (e) => {
    if (reduced.current || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    setTilt({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
  };

  const scene = SCENES[index];
  return (
    <section
      className={'vas' + (compact ? ' vas-compact' : '') + (paused ? ' vas-paused' : '')}
      aria-roledescription="carousel"
      aria-label="What Vendora does"
      style={{ '--vas-ms': `${DURATION}ms` }}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') go(index + 1); if (e.key === 'ArrowLeft') go(index - 1); }}
    >
      <div className="vas-bars" role="tablist" aria-label="Choose a picture">
        {SCENES.map((s, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={s.title}
            className={'vas-tick' + (i < index ? ' done' : '') + (i === index ? ' now' : '')}
            onClick={() => go(i)}
          >
            <span onAnimationEnd={i === index ? () => go(index + 1) : undefined} />
          </button>
        ))}
      </div>
      <div
        className="vas-stage"
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={() => { start.current = null; setHeld(false); setHover(false); setTilt({ x: 0, y: 0 }); }}
        onPointerMove={move}
        onMouseEnter={() => setHover(true)}
        style={{ transform: `perspective(700px) rotateY(${tilt.x * 6}deg) rotateX(${-tilt.y * 6}deg)` }}
      >
        {SCENES.map(({ Art }, i) => (
          <div key={i} className={'vas-slide' + (i === index ? ' on' : '')} aria-hidden={i !== index}>
            <Art />
          </div>
        ))}
      </div>
      <div className="vas-caption" aria-live="polite">
        <strong key={'t' + index}>{scene.title}</strong>
        <span key={'b' + index}>{scene.body}</span>
      </div>
    </section>
  );
}
