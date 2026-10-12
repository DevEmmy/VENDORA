// Reads a bank transfer receipt (photo or screenshot) and pulls out amount, sender, reference and date.
// OCR runs on the phone (Tesseract). Files are bundled in /ocr so it also works offline once the app is installed;
// if they are missing (single-file build), it falls back to the public CDN.
import { sha256 } from './sha256.js';

let workerP = null;
async function worker(onProgress) {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import('tesseract.js');
      const local = new URL('ocr/', window.location.href).href;
      const haveLocal = await fetch(local + 'worker.min.js', { method: 'HEAD' }).then(r => r.ok).catch(() => false);
      const opts = haveLocal
        ? { workerPath: local + 'worker.min.js', corePath: local, langPath: local, gzip: true, logger: m => onProgress?.(m) }
        : { logger: m => onProgress?.(m) };
      return createWorker('eng', 1, opts);
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

/** Shrink big camera photos before OCR (faster, and a stable fingerprint). */
export function loadImage(file, max = 1600) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const g = c.getContext('2d');
      g.filter = 'grayscale(1) contrast(1.25)';
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res({ canvas: c, dataUrl: c.toDataURL('image/jpeg', 0.85) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not a picture we can read.')); };
    img.src = url;
  });
}

/** Fingerprint of the picture: the same screenshot can't be used twice. */
export const imageFingerprint = dataUrl => sha256(dataUrl.slice(0, 200000)).slice(0, 24);

export async function readReceipt(file, onProgress) {
  const { canvas, dataUrl } = await loadImage(file);
  const w = await worker(onProgress);
  const { data } = await w.recognize(canvas);
  return { ...parseReceiptText(data.text || ''), text: data.text || '', fingerprint: imageFingerprint(dataUrl), preview: dataUrl };
}

const MONEY = /(?:₦|NGN|N(?=\s?\d)|naira)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i;
export function parseReceiptText(text) {
  const t = text.replace(/[ \t]+/g, ' ');
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const out = { amount: null, sender: null, reference: null, date: null, bank: null };

  // Amount: prefer a line that says "amount", else the first naira figure, else the largest number with decimals
  const amtLine = lines.find(l => /amount|total|sum/i.test(l) && /\d/.test(l));
  const pick = s => { const m = s && (s.match(MONEY) || s.match(/([0-9]{1,3}(?:,[0-9]{3})+(?:\.\d{2})?|[0-9]+\.\d{2})/)); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };
  out.amount = pick(amtLine) || pick(lines.find(l => MONEY.test(l)));
  if (!out.amount) {
    const nums = [...t.matchAll(/([0-9]{1,3}(?:,[0-9]{3})+\.\d{2})/g)].map(m => parseFloat(m[1].replace(/,/g, '')));
    if (nums.length) out.amount = Math.max(...nums);
  }

  // Sender: "From", "Sender", "Sender name", "Originator", "Account name" (when labelled as sender side)
  const nameAfter = re => {
    const i = lines.findIndex(l => re.test(l));
    if (i < 0) return null;
    const same = lines[i].replace(re, '').replace(/^[\s:.-]+/, '').trim();
    const cand = same && /[a-z]{2}/i.test(same) ? same : lines[i + 1] || '';
    const clean = cand.replace(/[^A-Za-z .'-]/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.length >= 3 ? clean.split(' ').slice(0, 4).join(' ') : null;
  };
  out.sender = nameAfter(/^(sender name|sender|from|originator|paid by|debit account name)\b/i);

  // Reference / session ID: long digit run or labelled reference
  const refLine = lines.find(l => /(session|reference|ref\b|transaction id|trans id|txn)/i.test(l));
  const refM = (refLine && refLine.match(/([A-Z0-9]{10,})/i)) || t.match(/\b(\d{20,32})\b/);
  out.reference = refM ? refM[1] : null;

  const dateM = t.match(/(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*,?\s+\d{4})/i);
  out.date = dateM ? dateM[1] : null;
  const bankM = t.match(/\b(wema|alat|gtbank|gtco|access|zenith|uba|first bank|opay|palmpay|moniepoint|kuda|fidelity|sterling|union|fcmb|stanbic|ecobank|polaris|keystone)\b/i);
  out.bank = bankM ? bankM[1] : null;
  return out;
}
