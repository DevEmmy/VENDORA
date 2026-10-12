// Shop photos and videos for adverts. Kept in IndexedDB on the phone (too big for normal storage).
// In production they are uploaded to the Vendora server with the advert.
const DB = 'vendora-media', STORE = 'files';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const r = fn(t.objectStore(STORE)); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); });
}

export const MAX_VIDEO_MB = 40;
export const MAX_VIDEO_SECONDS = 60;

function shrinkImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('Could not read that picture.')), 'image/jpeg', 0.84);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that picture.')); };
    img.src = url;
  });
}
function videoSeconds(file) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); resolve(v.duration || 0); };
    v.onerror = () => resolve(0);
    v.src = URL.createObjectURL(file);
  });
}

/** Save a photo or video. Returns {id, kind}. Throws with a plain message if it's too big or long. */
export async function addMedia(file) {
  const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'photo' : null;
  if (!kind) throw new Error('Pick a photo or a video.');
  let blob = file;
  if (kind === 'photo') blob = await shrinkImage(file);
  else {
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error(`That video is too big. Keep it under ${MAX_VIDEO_MB} MB.`);
    const secs = await videoSeconds(file);
    if (secs > MAX_VIDEO_SECONDS + 1) throw new Error(`Keep the video under ${MAX_VIDEO_SECONDS} seconds.`);
  }
  const id = `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await tx('readwrite', s => s.put(blob, id));
  return { id, kind };
}
export async function removeMedia(id) { try { await tx('readwrite', s => s.delete(id)); } catch { /* already gone */ } }

const urls = new Map();
export async function mediaUrl(id) {
  if (urls.has(id)) return urls.get(id);
  try {
    const b = await tx('readonly', s => s.get(id));
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urls.set(id, u);
    return u;
  } catch { return null; }
}
