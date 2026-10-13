'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { businessScore, loanOffer, repaymentPlan, DAY } = require('../src/finance');

test('Business score and loan offer maths', () => {
  const now = Date.now(); const sales = [];
  for (let d = 0; d < 28; d++) sales.push({ amount: 40000 + (d % 3) * 5000, at: now - d * DAY - 1000 });
  const score = businessScore({ sales, debts: { collected: 90000, outstanding: 10000 }, now });
  assert.ok(score.score >= 60 && score.score <= 100); assert.equal(score.activeDays, 28);
  const offer = loanOffer(score); assert.equal(offer.eligible, true); assert.ok(offer.limit >= 100000);
  const plan = repaymentPlan(100000, 0.03, 30); assert.equal(plan.totalRepayable, 103000); assert.equal(plan.dailyRepayment, 3450);
  assert.equal(loanOffer({ score: 30, avgDailySales: 50000, activeDays: 20 }).eligible, false);
});
