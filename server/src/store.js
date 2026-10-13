// Tiny JSON-file store. Good enough for a pilot; swap for Postgres before scale.
'use strict';
const fs = require('fs');
const path = require('path');

const EMPTY = () => ({
  traders: {},          // phone -> {phone, name, businessName, accountNumber, inventory, customers, updatedAt}
  accounts: {},         // accountNumber -> {accountNumber, accountName, phone, balance}
  paymentRequests: {},  // ref -> {...}
  credits: [],          // incoming payments
  loans: {},            // id -> loan
  inbox: [],            // ops created from WhatsApp, pulled by the app
  outbox: [],           // WhatsApp messages sent (or queued in dev mode)
  seq: 1,
});

function createStore(file) {
  let data = EMPTY();
  if (file && fs.existsSync(file)) {
    data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  let timer = null;
  function save() {
    if (!file) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(data));
      fs.renameSync(file + '.tmp', file);
    }, 200);
  }
  return {
    get data() { return data; },
    nextId(prefix) { return `${prefix}_${Date.now().toString(36)}${(data.seq++).toString(36)}`; },
    save,
  };
}

module.exports = { createStore };
