'use strict';
const path = require('path');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 8080);
const app = createApp({ dataFile: process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json') });

// Send grouped WhatsApp confirmations that have waited long enough.
setInterval(() => app.locals.wa.flushDue().catch(e => console.error(e)), 60 * 1000).unref();

app.listen(port, () => console.log(`Vendora server on http://localhost:${port} (Wema mode: ${process.env.WEMA_MODE || 'mock'})`));
