import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText } from '../src/lib/receipt.js';

test('typical Nigerian bank receipt', () => {
  const r = parseReceiptText(`Transaction Receipt
GTBank
Amount
₦12,500.00
Sender Name
CHINEDU OKEKE
Beneficiary
NGOZI PROVISIONS STORE
Wema Bank 0234187421
Session ID
100004251011193022184937265101
Date 11/10/2025 19:30`);
  assert.equal(r.amount, 12500);
  assert.equal(r.sender, 'CHINEDU OKEKE');
  assert.equal(r.reference, '100004251011193022184937265101');
  assert.equal(r.date, '11/10/2025');
  assert.equal(r.bank.toLowerCase(), 'gtbank');
});

test('same-line labels and NGN', () => {
  const r = parseReceiptText('Transfer successful\nAmount: NGN 5,000.00\nFrom: Tola Bello\nReference: OPY73HS82KD91');
  assert.equal(r.amount, 5000);
  assert.equal(r.sender, 'Tola Bello');
  assert.equal(r.reference, 'OPY73HS82KD91');
});
