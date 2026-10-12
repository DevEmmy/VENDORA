import React, { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { mediaUrl } from '../lib/media.js';

/** Shows a saved shop photo or video. */
export default function Media({ m, controls = false, alt = 'Shop photo' }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let on = true; mediaUrl(m.id).then(u => on && setUrl(u)); return () => { on = false; }; }, [m.id]);
  if (!url) return <div className="skel" style={{ width: '100%', height: '100%', borderRadius: 0 }} />;
  if (m.kind === 'video') {
    return controls
      ? <video src={url} controls playsInline preload="metadata" />
      : <div style={{ position: 'relative', width: '100%', height: '100%' }}><video src={url} muted playsInline preload="metadata" /><span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff' }}><Play size={30} fill="#fff" /></span></div>;
  }
  return <img src={url} alt={alt} />;
}
