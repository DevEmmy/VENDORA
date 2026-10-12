import React, { useState } from 'react';
import { Delete } from 'lucide-react';
import { haptic } from '../lib/voice.js';

export default function PinPad({ onDone, length = 4, badText = 'Wrong PIN. Try again.' }) {
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const press = k => {
    haptic(8);
    if (k === 'del') { setCode(c => c.slice(0, -1)); return; }
    const next = (code + k).slice(0, length);
    setCode(next); setBad(false);
    if (next.length === length) {
      const ok = onDone(next);
      if (ok === false) { setBad(true); haptic([60, 40, 60]); setTimeout(() => setCode(''), 450); }
      else setTimeout(() => setCode(''), 200);
    }
  };
  return (
    <div>
      <div className="dots" aria-label={`${code.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => <span key={i} className={i < code.length ? 'on' : ''} style={bad ? { background: 'var(--pepper)' } : undefined} />)}
      </div>
      {bad && <div className="error center" style={{ marginTop: 0 }}>{badText}</div>}
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) => k
          ? <button key={i} onClick={() => press(k)} aria-label={k === 'del' ? 'Delete' : k}>{k === 'del' ? <Delete size={22} style={{ margin: '0 auto' }} /> : k}</button>
          : <span key={i} />)}
      </div>
    </div>
  );
}
