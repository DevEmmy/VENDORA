// GENERATED from server/src/finance.js by scripts/sync-shared.mjs. Do not edit here.
// Business Score and loan maths.
// The Flutter app mirrors this in lib/services/finance.dart so offline estimates match the server.

const DAY = 24 * 60 * 60 * 1000;

/**
 * sales: [{amount, at(ms)}] for the last 30 days
 * debts: {collected, outstanding}
 * loans: {due, paidOnTime} counts of scheduled repayments (null if never borrowed)
 */
function businessScore({ sales = [], debts = { collected: 0, outstanding: 0 }, loans = null, verifiedShare = null, integrityOk = true, now = Date.now() }) {
  const from = now - 30 * DAY;
  const byDay = new Map();
  for (const s of sales) {
    if (s.at < from || s.at > now) continue;
    const d = Math.floor((s.at - from) / DAY);
    byDay.set(d, (byDay.get(d) || 0) + s.amount);
  }
  const daily = [...byDay.values()];
  const activeDays = daily.length;
  const mean = activeDays ? daily.reduce((a, b) => a + b, 0) / activeDays : 0;
  const sd = activeDays ? Math.sqrt(daily.reduce((a, b) => a + (b - mean) ** 2, 0) / activeDays) : 0;
  const cv = mean ? sd / mean : 1;

  // Weights: regular records 25, volume 20, steadiness 10, bank-verified sales 15, debt collection 10, repayment 20
  const consistency = Math.min(activeDays / 30, 1) * 25;
  const volume = Math.min(mean / 50000, 1) * 20;
  const stability = activeDays >= 3 ? (1 - Math.min(cv, 1)) * 10 : 0;
  const verified = (verifiedShare == null ? 0.6 : Math.max(0, Math.min(1, verifiedShare))) * 15;
  const owedTotal = debts.collected + debts.outstanding;
  const collection = owedTotal > 0 ? (debts.collected / owedTotal) * 10 : 8;
  const repayment = loans && loans.due > 0 ? (loans.paidOnTime / loans.due) * 20 : 14;

  let score = Math.round(consistency + volume + stability + verified + collection + repayment);
  // Records that were changed after the fact cannot be trusted for lending.
  if (integrityOk === false) score = Math.min(score, 25);
  const band = integrityOk === false ? 'Under review' : score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Building';
  return {
    score, band, activeDays, avgDailySales: Math.round(mean), integrityOk: integrityOk !== false,
    factors: [
      { key: 'consistency', label: 'Records kept every day', points: Math.round(consistency), max: 25 },
      { key: 'volume', label: 'Sales volume', points: Math.round(volume), max: 20 },
      { key: 'verified', label: 'Sales confirmed by Wema', points: Math.round(verified), max: 15 },
      { key: 'stability', label: 'Steady daily sales', points: Math.round(stability), max: 10 },
      { key: 'collection', label: 'Customers pay their debts', points: Math.round(collection), max: 10 },
      { key: 'repayment', label: 'Loan repayment history', points: Math.round(repayment), max: 20 },
    ],
  };
}

function loanOffer({ score, avgDailySales, activeDays, integrityOk = true }) {
  if (integrityOk === false) return { eligible: false, reason: 'Your records show changes after they were recorded, so a loan cannot be offered right now.' };
  if (score < 40 || activeDays < 14) {
    return { eligible: false, reason: score < 40 ? 'Keep recording sales to raise your score to 40.' : 'Record sales for at least 14 days to unlock loans.' };
  }
  const multiplier = score >= 80 ? 8 : score >= 60 ? 5 : 3;
  const rate = score >= 80 ? 0.025 : score >= 60 ? 0.03 : 0.035; // flat, per 30 days
  const limit = Math.min(Math.round((avgDailySales * multiplier) / 1000) * 1000, 2000000);
  return { eligible: limit >= 10000, limit, rate, tenorDays: 30, reason: limit < 10000 ? 'Sales too low for a loan yet.' : null };
}

function repaymentPlan(amount, rate, tenorDays) {
  const totalRepayable = Math.round(amount * (1 + rate));
  const daily = Math.ceil(totalRepayable / tenorDays / 50) * 50;
  return { totalRepayable, dailyRepayment: daily, tenorDays };
}

export { businessScore, loanOffer, repaymentPlan, DAY };
