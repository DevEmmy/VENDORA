// Wema / ALAT integration layer.
// - MockWemaApi: simulates the bank on the phone, so the whole product works offline for demos.
// - HttpWemaApi: talks to the Vendora server (server/src/wema.js), which simulates Wema today
//   and is where Wema's real APIs plug in once access is granted.
import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:http/http.dart' as http;

import '../models/models.dart';
import 'finance.dart';

class WemaAccount {
  final String accountNumber;
  final String accountName;
  const WemaAccount(this.accountNumber, this.accountName);
}

class VerifyResult {
  final bool verified;
  final String message;
  final Credit? credit;
  const VerifyResult(this.verified, this.message, [this.credit]);
}

class WemaException implements Exception {
  final String message;
  WemaException(this.message);
  @override
  String toString() => message;
}

abstract class WemaApi {
  /// Money arriving in the trader's account (pushed by the mock immediately, or by sync for HTTP).
  Stream<Credit> get credits;
  Future<WemaAccount> openAccount({required String name, required String phone, required String idNumber, String? businessName});
  Future<PaymentRequest> createPaymentRequest(String accountNumber, double amount, {String? saleId});
  Future<PaymentRequest?> getPaymentRequest(String ref);
  Future<VerifyResult> verifyTransfer(String accountNumber, double amount, {String? senderName});
  Future<LoanOffer> loanOffer(String accountNumber, BusinessScore score);
  Future<Loan> takeLoan(String accountNumber, double amount, Supplier supplier, BusinessScore score);
  Future<Loan> repay(String loanId, double amount);

  /// Sandbox only: pretend a customer sent money (to a pay-per-sale account or directly).
  Future<Credit> simulateCustomerPayment({String? accountNumber, String? virtualAccountNumber, required double amount, required String senderName});
  void dispose();
}

String _digits(int n) {
  final r = math.Random();
  return List.generate(n, (_) => r.nextInt(10)).join();
}

// ---------------------------------------------------------------------------
class MockWemaApi implements WemaApi {
  /// Persisted by AppState (part of the offline store).
  final Map<String, dynamic> state;
  final void Function() onChanged;
  final _credits = StreamController<Credit>.broadcast();

  MockWemaApi(this.state, this.onChanged) {
    state.putIfAbsent('accounts', () => <String, dynamic>{});
    state.putIfAbsent('requests', () => <String, dynamic>{});
    state.putIfAbsent('credits', () => <dynamic>[]);
    state.putIfAbsent('loans', () => <String, dynamic>{});
  }

  Map<String, dynamic> get _accounts => Map<String, dynamic>.from(state['accounts'] as Map);
  Map<String, dynamic> get _requests => state['requests'] as Map<String, dynamic>;
  Map<String, dynamic> get _loans => state['loans'] as Map<String, dynamic>;

  @override
  Stream<Credit> get credits => _credits.stream;

  Future<void> _latency() => Future.delayed(const Duration(milliseconds: 450));

  @override
  Future<WemaAccount> openAccount({required String name, required String phone, required String idNumber, String? businessName}) async {
    await _latency();
    if (!RegExp(r'^\d{11}$').hasMatch(idNumber)) throw WemaException('Enter a valid 11-digit BVN or NIN.');
    for (final a in _accounts.values) {
      final m = Map<String, dynamic>.from(a as Map);
      if (m['phone'] == phone) return WemaAccount(m['accountNumber'], m['accountName']);
    }
    final acct = '02${_digits(8)}';
    final accountName = (businessName != null && businessName.isNotEmpty ? businessName : name).toUpperCase();
    final accounts = Map<String, dynamic>.from(state['accounts'] as Map);
    accounts[acct] = {'accountNumber': acct, 'accountName': accountName, 'phone': phone, 'balance': 0};
    state['accounts'] = accounts;
    onChanged();
    return WemaAccount(acct, accountName);
  }

  @override
  Future<PaymentRequest> createPaymentRequest(String accountNumber, double amount, {String? saleId}) async {
    await _latency();
    if (amount <= 0) throw WemaException('Amount must be more than zero.');
    final now = DateTime.now();
    final pr = PaymentRequest(
      ref: newId('pr'), amount: amount.roundToDouble(), virtualAccountNumber: '99${_digits(8)}', saleId: saleId,
      createdAt: now, expiresAt: now.add(const Duration(hours: 2)),
    );
    _requests[pr.ref] = pr.toJson();
    onChanged();
    return pr;
  }

  @override
  Future<PaymentRequest?> getPaymentRequest(String ref) async {
    final j = _requests[ref];
    return j == null ? null : PaymentRequest.fromJson(Map<String, dynamic>.from(j as Map));
  }

  @override
  Future<Credit> simulateCustomerPayment({String? accountNumber, String? virtualAccountNumber, required double amount, required String senderName}) async {
    await _latency();
    PaymentRequest? pr;
    if (virtualAccountNumber != null) {
      for (final j in _requests.values) {
        final p = PaymentRequest.fromJson(Map<String, dynamic>.from(j as Map));
        if (p.virtualAccountNumber == virtualAccountNumber) pr = p;
      }
      if (pr == null) throw WemaException('Unknown pay-per-sale account.');
      if (amount >= pr.amount && pr.status == 'pending' && DateTime.now().isBefore(pr.expiresAt)) {
        pr.status = 'paid';
      } else if (pr.status == 'pending' && amount < pr.amount) {
        pr.status = 'part_paid';
      }
      _requests[pr.ref] = pr.toJson();
    }
    final c = Credit(
      id: newId('cr'), amount: amount.roundToDouble(), senderName: senderName, at: DateTime.now(),
      paymentRequestRef: pr?.ref, saleId: pr?.saleId,
    );
    (state['credits'] as List).add(c.toJson());
    onChanged();
    _credits.add(c);
    return c;
  }

  @override
  Future<VerifyResult> verifyTransfer(String accountNumber, double amount, {String? senderName}) async {
    await _latency();
    final since = DateTime.now().subtract(const Duration(minutes: 60));
    String norm(String? s) => (s ?? '').toLowerCase().replaceAll(RegExp(r'[^a-z]'), '');
    final list = (state['credits'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList().reversed;
    for (final j in list) {
      final c = Credit.fromJson(j);
      if (j['claimed'] == true || c.at.isBefore(since) || c.amount != amount.roundToDouble()) continue;
      final sn = norm(senderName);
      if (sn.isNotEmpty && !norm(c.senderName).contains(sn.substring(0, math.min(4, sn.length)))) continue;
      j['claimed'] = true;
      final all = (state['credits'] as List);
      final idx = all.indexWhere((e) => (e as Map)['id'] == c.id);
      if (idx >= 0) all[idx] = j;
      onChanged();
      return VerifyResult(true, 'Confirmed by Wema: ₦${amount.toStringAsFixed(0)} from ${c.senderName}.', c);
    }
    return const VerifyResult(false, 'No matching payment has reached your Wema account. Do not release goods yet.');
  }

  @override
  Future<LoanOffer> loanOffer(String accountNumber, BusinessScore score) async {
    await _latency();
    final active = _loans.values.map((e) => Loan.fromJson(Map<String, dynamic>.from(e as Map))).where((l) => l.status == 'active');
    if (active.isNotEmpty) return const LoanOffer(eligible: false, reason: 'You already have an active loan.');
    return computeLoanOffer(score);
  }

  @override
  Future<Loan> takeLoan(String accountNumber, double amount, Supplier supplier, BusinessScore score) async {
    final offer = await loanOffer(accountNumber, score);
    if (!offer.eligible) throw WemaException(offer.reason ?? 'Not eligible yet.');
    if (amount > offer.limit) throw WemaException('Maximum available is ₦${offer.limit.toStringAsFixed(0)}.');
    final plan = repaymentPlan(amount, offer.rate, offer.tenorDays);
    final now = DateTime.now();
    final loan = Loan(
      id: newId('ln'), principal: amount.roundToDouble(), rate: offer.rate, totalRepayable: plan.totalRepayable,
      dailyRepayment: plan.dailyRepayment, tenorDays: plan.tenorDays, supplierName: supplier.name,
      supplierAccount: supplier.accountNumber, createdAt: now, dueAt: now.add(Duration(days: plan.tenorDays)),
    );
    _loans[loan.id] = loan.toJson();
    onChanged();
    return loan;
  }

  @override
  Future<Loan> repay(String loanId, double amount) async {
    await _latency();
    final j = _loans[loanId];
    if (j == null) throw WemaException('Loan not found.');
    final loan = Loan.fromJson(Map<String, dynamic>.from(j as Map));
    loan.repaid = math.min(loan.totalRepayable, loan.repaid + amount.roundToDouble());
    if (loan.repaid >= loan.totalRepayable) loan.status = 'repaid';
    _loans[loanId] = loan.toJson();
    onChanged();
    return loan;
  }

  @override
  void dispose() => _credits.close();
}

// ---------------------------------------------------------------------------
class HttpWemaApi implements WemaApi {
  final String baseUrl;
  final String apiKey;
  final _credits = StreamController<Credit>.broadcast();
  final http.Client _client = http.Client();

  HttpWemaApi(String base, this.apiKey) : baseUrl = base.endsWith('/') ? base.substring(0, base.length - 1) : base;

  @override
  Stream<Credit> get credits => _credits.stream;

  /// Called by SyncService when the server reports new credits.
  void pushCredit(Credit c) => _credits.add(c);

  Map<String, String> get _headers => {'content-type': 'application/json', if (apiKey.isNotEmpty) 'x-vendora-key': apiKey};

  Future<dynamic> _call(String method, String path, [Map<String, dynamic>? body]) async {
    final uri = Uri.parse('$baseUrl$path');
    late final http.Response r;
    try {
      r = method == 'GET'
          ? await _client.get(uri, headers: _headers).timeout(const Duration(seconds: 15))
          : await _client.post(uri, headers: _headers, body: jsonEncode(body ?? {})).timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw WemaException('Network is slow. Try again.');
    } catch (_) {
      throw WemaException('No connection to Wema right now. Try again when you have network.');
    }
    final data = r.body.isEmpty ? null : jsonDecode(r.body);
    if (r.statusCode >= 400) throw WemaException((data is Map && data['error'] != null) ? data['error'] : 'Request failed (${r.statusCode})');
    return data;
  }

  static Credit creditFromServer(Map<String, dynamic> j) => Credit(
        id: j['id'], amount: (j['amount'] as num).toDouble(), senderName: j['senderName'] ?? 'Unknown sender',
        senderBank: j['senderBank'] ?? 'Bank transfer', at: DateTime.fromMillisecondsSinceEpoch((j['at'] as num).toInt()),
        paymentRequestRef: j['paymentRequestRef'], saleId: j['saleId'],
      );

  static PaymentRequest _pr(Map<String, dynamic> j) => PaymentRequest(
        ref: j['ref'], amount: (j['amount'] as num).toDouble(), virtualAccountNumber: j['virtualAccountNumber'],
        status: j['status'], saleId: j['saleId'],
        createdAt: DateTime.fromMillisecondsSinceEpoch((j['createdAt'] as num).toInt()),
        expiresAt: DateTime.fromMillisecondsSinceEpoch((j['expiresAt'] as num).toInt()),
      );

  static Loan _loan(Map<String, dynamic> j) => Loan(
        id: j['id'], principal: (j['principal'] as num).toDouble(), rate: (j['rate'] as num).toDouble(),
        totalRepayable: (j['totalRepayable'] as num).toDouble(), dailyRepayment: (j['dailyRepayment'] as num).toDouble(),
        tenorDays: (j['tenorDays'] as num).toInt(), repaid: (j['repaid'] as num).toDouble(), status: j['status'],
        supplierName: (j['supplier'] as Map)['name'], supplierAccount: (j['supplier'] as Map)['accountNumber'],
        createdAt: DateTime.fromMillisecondsSinceEpoch((j['createdAt'] as num).toInt()),
        dueAt: DateTime.fromMillisecondsSinceEpoch((j['dueAt'] as num).toInt()),
      );

  Map<String, dynamic> _scoreBody(BusinessScore s) =>
      {'score': s.score, 'avgDailySales': s.avgDailySales, 'activeDays': s.activeDays};

  @override
  Future<WemaAccount> openAccount({required String name, required String phone, required String idNumber, String? businessName}) async {
    final j = await _call('POST', '/wema/accounts', {
      'name': name, 'phone': phone, 'businessName': businessName,
      if (idNumber.length == 11) 'bvn': idNumber,
    });
    return WemaAccount(j['accountNumber'], j['accountName']);
  }

  @override
  Future<PaymentRequest> createPaymentRequest(String accountNumber, double amount, {String? saleId}) async =>
      _pr(Map<String, dynamic>.from(await _call('POST', '/wema/payment-requests', {'accountNumber': accountNumber, 'amount': amount, 'saleId': saleId})));

  @override
  Future<PaymentRequest?> getPaymentRequest(String ref) async {
    try {
      return _pr(Map<String, dynamic>.from(await _call('GET', '/wema/payment-requests/$ref')));
    } on WemaException {
      return null;
    }
  }

  @override
  Future<VerifyResult> verifyTransfer(String accountNumber, double amount, {String? senderName}) async {
    final j = await _call('POST', '/wema/verify', {'accountNumber': accountNumber, 'amount': amount, 'senderName': senderName});
    return VerifyResult(j['verified'] == true, j['message'] ?? '', j['credit'] == null ? null : creditFromServer(Map<String, dynamic>.from(j['credit'])));
  }

  @override
  Future<LoanOffer> loanOffer(String accountNumber, BusinessScore score) async {
    final j = await _call('POST', '/wema/loans/offer', {'accountNumber': accountNumber, ..._scoreBody(score)});
    return LoanOffer(
      eligible: j['eligible'] == true, limit: ((j['limit'] ?? 0) as num).toDouble(), rate: ((j['rate'] ?? 0) as num).toDouble(),
      tenorDays: ((j['tenorDays'] ?? 30) as num).toInt(), reason: j['reason'],
    );
  }

  @override
  Future<Loan> takeLoan(String accountNumber, double amount, Supplier supplier, BusinessScore score) async {
    final j = await _call('POST', '/wema/loans', {
      'accountNumber': accountNumber, 'amount': amount, 'consent': true,
      'supplier': {'name': supplier.name, 'accountNumber': supplier.accountNumber, 'bank': supplier.bank},
      ..._scoreBody(score),
    });
    return _loan(Map<String, dynamic>.from(j));
  }

  @override
  Future<Loan> repay(String loanId, double amount) async =>
      _loan(Map<String, dynamic>.from(await _call('POST', '/wema/loans/$loanId/repay', {'amount': amount})));

  @override
  Future<Credit> simulateCustomerPayment({String? accountNumber, String? virtualAccountNumber, required double amount, required String senderName}) async {
    final j = await _call('POST', '/wema/simulate/credit', {
      if (accountNumber != null) 'accountNumber': accountNumber,
      if (virtualAccountNumber != null) 'virtualAccountNumber': virtualAccountNumber,
      'amount': amount, 'senderName': senderName,
    });
    final c = creditFromServer(Map<String, dynamic>.from(j));
    _credits.add(c);
    return c;
  }

  @override
  void dispose() {
    _credits.close();
    _client.close();
  }
}
