// Build-time settings. Traders never see or change these.
// Set VITE_SERVER_URL (and optionally VITE_API_KEY) when building to connect the Vendora server
// (live WhatsApp channel + Wema connection). Without it, Vendora runs fully on the phone.
export const SERVER_URL = (import.meta.env && import.meta.env.VITE_SERVER_URL) || '';
export const API_KEY = (import.meta.env && import.meta.env.VITE_API_KEY) || '';
// Natural Nigerian voice (YarnGPT). Best: route through the Vendora server, which holds the key (VITE_SERVER_URL).
// VITE_YARNGPT_KEY puts the key inside the website itself: only for short demos, since anyone can read it.
export const YARNGPT_KEY = (import.meta.env && import.meta.env.VITE_YARNGPT_KEY) || '';
export const YARNGPT_VOICE = (import.meta.env && import.meta.env.VITE_YARNGPT_VOICE) || 'idera';
