'use strict';
const express = require('express');

function createBusinessRouter() {
  const router = express.Router();
  router.post('/api/tts', async (req, res) => {
    const key = process.env.YARNGPT_API_KEY;
    if (!key) return res.status(503).json({ error: 'Natural voice is unavailable' });
    const text = req.body.text;
    const voice = process.env.YARNGPT_VOICE || 'idera';
    const prepare = body => fetch('https://api.yarngpt.ai/api/v1/tts/prepare', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    try {
      let response = await prepare({ text, voice, output_format: 'mp3' });
      if (response.status === 400 || response.status === 404) response = await prepare({ text, output_format: 'mp3' });
      const data = await response.json();
      if (!response.ok || typeof data.stream_url !== 'string' || !data.stream_url.startsWith('/api/v1/tts/stream/')) return res.status(502).json({ error: 'Voice service unavailable' });
      res.json({ url: 'https://api.yarngpt.ai' + data.stream_url, expiresIn: data.expires_in || 300 });
    } catch { res.status(502).json({ error: 'Voice service unavailable' }); }
  });
  return router;
}
module.exports = { createBusinessRouter };
