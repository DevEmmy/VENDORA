// Business Score + loan maths. Mirrors server/src/finance.js so offline estimates match the server.
import 'dart:math' as math;

class ScoreFactor {
  final String key;
  final String label;
  final int points;
  final int max;
  const ScoreFactor(this.key, this.label, this.points, this.max);
}

class BusinessScore {
  final int score;
  final String band;
  final int activeDays;
  final double avgDailySales;
  final List<ScoreFactor> factors;
  const BusinessScore(this.score, this.band, this.activeDays, this.avgDailySales, this.factors);
}

class LoanOffer {
  final bool eligible;
  final double limit;
  final double rate;
  final int tenorDays;
  final String? reason;
  const LoanOffer({required this.eligible, this.limit = 0, this.rate = 0, this.tenorDays = 30, this.reason});
}

class RepaymentPlan {
  final double totalRepayable;
  final double dailyRepayment;
  final int tenorDays;
  const RepaymentPlan(this.totalRepayable, this.dailyRepayment, this.tenorDays);
}

/// sales: (amount, time) pairs. debtsCollected/outstanding in naira. loanDue/loanPaidOnTime: counts of
/// scheduled daily repayments (null when the trader has never borrowed).
BusinessScore computeBusinessScore({
  required List<MapEntry<double, DateTime>> sales,
  double debtsCollected = 0,
  double debtsOutstanding = 0,
  int? loanDue,
  int? loanPaidOnTime,
  DateTime? now,
}) {
  final n = now ?? DateTime.now();
  final from = n.subtract(const Duration(days: 30));
  final byDay = <int, double>{};
  for (final s in sales) {
    if (s.value.isBefore(from) || s.value.isAfter(n)) continue;
    final d = s.value.difference(from).inDays;
    byDay[d] = (byDay[d] ?? 0) + s.key;
  }
  final daily = byDay.values.toList();
  final active = daily.length;
  final mean = active > 0 ? daily.reduce((a, b) => a + b) / active : 0.0;
  final sd = active > 0 ? math.sqrt(daily.fold<double>(0, (a, b) => a + (b - mean) * (b - mean)) / active) : 0.0;
  final cv = mean > 0 ? sd / mean : 1.0;

  final consistency = math.min(active / 30, 1.0) * 30;
  final volume = math.min(mean / 50000, 1.0) * 20;
  final stability = active >= 3 ? (1 - math.min(cv, 1.0)) * 15 : 0.0;
  final owed = debtsCollected + debtsOutstanding;
  final collection = owed > 0 ? (debtsCollected / owed) * 15 : 12.0;
  final repayment = (loanDue != null && loanDue > 0) ? ((loanPaidOnTime ?? 0) / loanDue) * 20 : 14.0;

  final score = (consistency + volume + stability + collection + repayment).round();
  final band = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Building';
  return BusinessScore(score, band, active, mean.roundToDouble(), [
    ScoreFactor('consistency', 'Records kept regularly', consistency.round(), 30),
    ScoreFactor('volume', 'Sales volume', volume.round(), 20),
    ScoreFactor('stability', 'Steady daily sales', stability.round(), 15),
    ScoreFactor('collection', 'Customers pay their debts', collection.round(), 15),
    ScoreFactor('repayment', 'Loan repayment history', repayment.round(), 20),
  ]);
}

LoanOffer computeLoanOffer(BusinessScore s) {
  if (s.score < 40 || s.activeDays < 14) {
    return LoanOffer(
      eligible: false,
      reason: s.score < 40 ? 'Keep recording sales to raise your score to 40.' : 'Record sales for at least 14 days to unlock loans.',
    );
  }
  final multiplier = s.score >= 80 ? 8 : s.score >= 60 ? 5 : 3;
  final rate = s.score >= 80 ? 0.025 : s.score >= 60 ? 0.03 : 0.035;
  final limit = math.min(((s.avgDailySales * multiplier) / 1000).round() * 1000.0, 2000000.0);
  return LoanOffer(eligible: limit >= 10000, limit: limit, rate: rate, tenorDays: 30, reason: limit < 10000 ? 'Sales too low for a loan yet.' : null);
}

RepaymentPlan repaymentPlan(double amount, double rate, int tenorDays) {
  final total = (amount * (1 + rate)).roundToDouble();
  final daily = (total / tenorDays / 50).ceil() * 50.0;
  return RepaymentPlan(total, daily, tenorDays);
}
