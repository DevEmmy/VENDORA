// Phone permissions and precise location, in one place.
// Every request is triggered by a tap (browsers ignore permission requests that aren't).

/** 'granted' | 'denied' | 'prompt' | 'unsupported' */
export async function permissionState(name) {
  try {
    if (!navigator.permissions?.query) return 'prompt';
    const r = await navigator.permissions.query({ name });
    return r.state;
  } catch { return 'prompt'; }
}

export function secure() { return typeof window !== 'undefined' && window.isSecureContext; }

/** Ask for the microphone. Returns 'granted' | 'denied' | 'nomic' | 'insecure' | 'unsupported'. */
export async function requestMic() {
  if (!secure()) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    return 'granted';
  } catch (e) {
    if (e?.name === 'NotFoundError') return 'nomic';
    return 'denied';
  }
}

/** Ask for the camera (for scanning receipts). */
export async function requestCamera() {
  if (!secure()) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    s.getTracks().forEach(t => t.stop());
    return 'granted';
  } catch (e) {
    if (e?.name === 'NotFoundError') return 'nocam';
    return 'denied';
  }
}

/** Precise GPS position of the shop. Resolves {lat, lng, accuracy, at} or rejects with a plain message. */
export function preciseLocation() {
  return new Promise((resolve, reject) => {
    if (!secure()) return reject(new Error('Location needs Vendora to be opened from its web link (https).'));
    if (!navigator.geolocation) return reject(new Error('This phone cannot share its location.'));
    let best = null, done = false;
    const finish = () => {
      if (done) return; done = true;
      navigator.geolocation.clearWatch(watch);
      if (best) resolve(best); else reject(new Error("Couldn't get your location. Go outside or near a window and try again."));
    };
    const watch = navigator.geolocation.watchPosition(p => {
      const fix = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy), at: Date.now() };
      if (!best || fix.accuracy < best.accuracy) best = fix;
      if (best.accuracy <= 25) finish(); // good enough: within 25 metres
    }, e => {
      if (done) return;
      done = true; navigator.geolocation.clearWatch(watch);
      reject(new Error(e.code === 1 ? 'Location is blocked. Tap the lock icon next to the web address, allow Location, then try again.' : "Couldn't get your location. Turn on Location (GPS) on your phone and try again."));
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    setTimeout(finish, 12000); // take the best fix after 12 seconds
  });
}

export function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const mapsUrl = ({ lat, lng }) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const fmtCoord = ({ lat, lng }) => `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(5)}°${lng >= 0 ? 'E' : 'W'}`;
