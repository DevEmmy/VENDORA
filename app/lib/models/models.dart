// Plain data models. Everything serialises to JSON so the whole store can live offline in Hive.

String newId(String prefix) =>
    '${prefix}_${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}${_counter++}';
int _counter = 0;

double _d(dynamic v) => v == null ? 0 : (v as num).toDouble();
int _i(dynamic v) => v == null ? 0 : (v as num).toInt();
List<String> _sl(dynamic v) => v == null ? <String>[] : List<String>.from(v as List);

class Profile {
  String name;
  String phone;
  String email;
  String businessName;
  String businessType;
  String city;
  String country;
  String currency;
  String language; // en | pcm | yo | ig | ha
  String? accountNumber;
  String? accountName;
  bool onboarded;
  bool premium;
  bool consentShareData;
  bool whatsappLinked;
  bool whatsappAlerts;
  bool speakReplies;
  String serverUrl; // empty = fully offline demo mode (simulated Wema)
  String apiKey;

  Profile({
    this.name = '',
    this.phone = '',
    this.email = '',
    this.businessName = '',
    this.businessType = '',
    this.city = '',
    this.country = 'Nigeria',
    this.currency = 'NGN',
    this.language = 'en',
    this.accountNumber,
    this.accountName,
    this.onboarded = false,
    this.premium = false,
    this.consentShareData = false,
    this.whatsappLinked = false,
    this.whatsappAlerts = true,
    this.speakReplies = true,
    this.serverUrl = '',
    this.apiKey = '',
  });

  String get firstName => name.trim().isEmpty ? 'there' : name.trim().split(' ').first;

  Map<String, dynamic> toJson() => {
        'name': name, 'phone': phone, 'email': email, 'businessName': businessName,
        'businessType': businessType, 'city': city, 'country': country, 'currency': currency,
        'language': language, 'accountNumber': accountNumber, 'accountName': accountName,
        'onboarded': onboarded, 'premium': premium, 'consentShareData': consentShareData,
        'whatsappLinked': whatsappLinked, 'whatsappAlerts': whatsappAlerts, 'speakReplies': speakReplies,
        'serverUrl': serverUrl, 'apiKey': apiKey,
      };

  factory Profile.fromJson(Map<String, dynamic> j) => Profile(
        name: j['name'] ?? '', phone: j['phone'] ?? '', email: j['email'] ?? '',
        businessName: j['businessName'] ?? '', businessType: j['businessType'] ?? '',
        city: j['city'] ?? '', country: j['country'] ?? 'Nigeria', currency: j['currency'] ?? 'NGN',
        language: j['language'] ?? 'en', accountNumber: j['accountNumber'], accountName: j['accountName'],
        onboarded: j['onboarded'] ?? false, premium: j['premium'] ?? false,
        consentShareData: j['consentShareData'] ?? false, whatsappLinked: j['whatsappLinked'] ?? false,
        whatsappAlerts: j['whatsappAlerts'] ?? true, speakReplies: j['speakReplies'] ?? true,
        serverUrl: j['serverUrl'] ?? '', apiKey: j['apiKey'] ?? '',
      );
}

class Product {
  String id;
  String name;
  List<String> aliases;
  String unit;
  double price; // selling price per unit
  double cost; // cost price per unit
  double qty;
  double lowAt;
  DateTime updatedAt;

  Product({
    required this.id,
    required this.name,
    List<String>? aliases,
    this.unit = 'piece',
    this.price = 0,
    this.cost = 0,
    this.qty = 0,
    this.lowAt = 3,
    DateTime? updatedAt,
  })  : aliases = aliases ?? [],
        updatedAt = updatedAt ?? DateTime.now();

  bool get isOut => qty <= 0;
  bool get isLow => !isOut && qty <= lowAt;

  Map<String, dynamic> toJson() => {
        'id': id, 'name': name, 'aliases': aliases, 'unit': unit, 'price': price, 'cost': cost,
        'qty': qty, 'lowAt': lowAt, 'updatedAt': updatedAt.millisecondsSinceEpoch,
      };

  factory Product.fromJson(Map<String, dynamic> j) => Product(
        id: j['id'], name: j['name'], aliases: _sl(j['aliases']), unit: j['unit'] ?? 'piece',
        price: _d(j['price']), cost: _d(j['cost']), qty: _d(j['qty']), lowAt: _d(j['lowAt'] ?? 3),
        updatedAt: DateTime.fromMillisecondsSinceEpoch(_i(j['updatedAt'])),
      );
}

class LineItem {
  String productId;
  String name;
  double qty;
  String unit;
  double price;
  double cost;

  LineItem({required this.productId, required this.name, required this.qty, this.unit = '', this.price = 0, this.cost = 0});

  double get total => qty * price;

  Map<String, dynamic> toJson() =>
      {'productId': productId, 'name': name, 'qty': qty, 'unit': unit, 'price': price, 'cost': cost};

  factory LineItem.fromJson(Map<String, dynamic> j) => LineItem(
      productId: j['productId'], name: j['name'], qty: _d(j['qty']), unit: j['unit'] ?? '',
      price: _d(j['price']), cost: _d(j['cost']));
}

enum TxnType { sale, restock, debtPayment, income, loanRepayment, savings }

enum PayStatus { cash, verified, unverified, pending, credit }

class Txn {
  String id;
  TxnType type;
  List<LineItem> items;
  double amount; // sale total / restock cost / payment amount
  double paid; // for sales: amount received now
  String? customerId;
  String? customerName;
  String? staffId;
  String? staffName;
  String source; // voice | whatsapp | manual | transfer | system
  PayStatus payStatus;
  String? paymentRef;
  String note;
  DateTime at;

  Txn({
    required this.id,
    required this.type,
    List<LineItem>? items,
    this.amount = 0,
    this.paid = 0,
    this.customerId,
    this.customerName,
    this.staffId,
    this.staffName,
    this.source = 'manual',
    this.payStatus = PayStatus.cash,
    this.paymentRef,
    this.note = '',
    DateTime? at,
  })  : items = items ?? [],
        at = at ?? DateTime.now();

  double get balance => (amount - paid).clamp(0, double.infinity).toDouble();
  double get costOfGoods => items.fold(0, (s, i) => s + i.qty * i.cost);
  double get profit => type == TxnType.sale ? amount - costOfGoods : 0;

  String get title {
    final who = customerName != null && customerName!.isNotEmpty ? '$customerName – ' : '';
    if (items.isEmpty) return '$who${note.isEmpty ? _typeLabel : note}';
    final first = items.first;
    final more = items.length > 1 ? ' +${items.length - 1}' : '';
    return '$who${first.name} ${_fmtQty(first.qty)} ${first.unit}${first.qty == 1 ? '' : 's'}$more'.trim();
  }

  String get _typeLabel => switch (type) {
        TxnType.sale => 'Sale',
        TxnType.restock => 'Restock',
        TxnType.debtPayment => 'Debt payment',
        TxnType.income => 'Money received',
        TxnType.loanRepayment => 'Loan repayment',
        TxnType.savings => 'Savings',
      };

  Map<String, dynamic> toJson() => {
        'id': id, 'type': type.name, 'items': items.map((e) => e.toJson()).toList(), 'amount': amount,
        'paid': paid, 'customerId': customerId, 'customerName': customerName, 'staffId': staffId,
        'staffName': staffName, 'source': source, 'payStatus': payStatus.name, 'paymentRef': paymentRef,
        'note': note, 'at': at.millisecondsSinceEpoch,
      };

  factory Txn.fromJson(Map<String, dynamic> j) => Txn(
        id: j['id'], type: TxnType.values.byName(j['type']),
        items: (j['items'] as List? ?? []).map((e) => LineItem.fromJson(Map<String, dynamic>.from(e))).toList(),
        amount: _d(j['amount']), paid: _d(j['paid']), customerId: j['customerId'], customerName: j['customerName'],
        staffId: j['staffId'], staffName: j['staffName'], source: j['source'] ?? 'manual',
        payStatus: PayStatus.values.byName(j['payStatus'] ?? 'cash'), paymentRef: j['paymentRef'],
        note: j['note'] ?? '', at: DateTime.fromMillisecondsSinceEpoch(_i(j['at'])),
      );
}

String _fmtQty(double q) => q == q.roundToDouble() ? q.toInt().toString() : q.toStringAsFixed(1);

class Customer {
  String id;
  String name;
  String phone;
  double balance; // what they owe the trader

  Customer({required this.id, required this.name, this.phone = '', this.balance = 0});

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'phone': phone, 'balance': balance};
  factory Customer.fromJson(Map<String, dynamic> j) =>
      Customer(id: j['id'], name: j['name'], phone: j['phone'] ?? '', balance: _d(j['balance']));
}

class Staff {
  String id;
  String name;
  String pin;
  bool isOwner;

  Staff({required this.id, required this.name, required this.pin, this.isOwner = false});

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'pin': pin, 'isOwner': isOwner};
  factory Staff.fromJson(Map<String, dynamic> j) =>
      Staff(id: j['id'], name: j['name'], pin: j['pin'] ?? '', isOwner: j['isOwner'] ?? false);
}

class Supplier {
  String id;
  String name;
  String bank;
  String accountNumber;
  Supplier({required this.id, required this.name, this.bank = '', required this.accountNumber});
  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'bank': bank, 'accountNumber': accountNumber};
  factory Supplier.fromJson(Map<String, dynamic> j) =>
      Supplier(id: j['id'], name: j['name'], bank: j['bank'] ?? '', accountNumber: j['accountNumber'] ?? '');
}

class PaymentRequest {
  String ref;
  double amount;
  String virtualAccountNumber;
  String status; // pending | paid | part_paid | expired
  String? saleId;
  DateTime createdAt;
  DateTime expiresAt;

  PaymentRequest({
    required this.ref,
    required this.amount,
    required this.virtualAccountNumber,
    this.status = 'pending',
    this.saleId,
    required this.createdAt,
    required this.expiresAt,
  });

  Map<String, dynamic> toJson() => {
        'ref': ref, 'amount': amount, 'virtualAccountNumber': virtualAccountNumber, 'status': status,
        'saleId': saleId, 'createdAt': createdAt.millisecondsSinceEpoch, 'expiresAt': expiresAt.millisecondsSinceEpoch,
      };

  factory PaymentRequest.fromJson(Map<String, dynamic> j) => PaymentRequest(
        ref: j['ref'], amount: _d(j['amount']), virtualAccountNumber: j['virtualAccountNumber'] ?? '',
        status: j['status'] ?? 'pending', saleId: j['saleId'],
        createdAt: DateTime.fromMillisecondsSinceEpoch(_i(j['createdAt'])),
        expiresAt: DateTime.fromMillisecondsSinceEpoch(_i(j['expiresAt'])),
      );
}

/// Money that arrived in the trader's Wema account.
class Credit {
  String id;
  double amount;
  String senderName;
  String senderBank;
  DateTime at;
  String? paymentRequestRef;
  String? saleId;
  bool handled;
  String? linkedTxnId;

  Credit({
    required this.id,
    required this.amount,
    required this.senderName,
    this.senderBank = 'Bank transfer',
    required this.at,
    this.paymentRequestRef,
    this.saleId,
    this.handled = false,
    this.linkedTxnId,
  });

  Map<String, dynamic> toJson() => {
        'id': id, 'amount': amount, 'senderName': senderName, 'senderBank': senderBank,
        'at': at.millisecondsSinceEpoch, 'paymentRequestRef': paymentRequestRef, 'saleId': saleId,
        'handled': handled, 'linkedTxnId': linkedTxnId,
      };

  factory Credit.fromJson(Map<String, dynamic> j) => Credit(
        id: j['id'], amount: _d(j['amount']), senderName: j['senderName'] ?? 'Unknown sender',
        senderBank: j['senderBank'] ?? 'Bank transfer', at: DateTime.fromMillisecondsSinceEpoch(_i(j['at'])),
        paymentRequestRef: j['paymentRequestRef'], saleId: j['saleId'], handled: j['handled'] ?? false,
        linkedTxnId: j['linkedTxnId'],
      );
}

class Loan {
  String id;
  double principal;
  double rate;
  double totalRepayable;
  double dailyRepayment;
  int tenorDays;
  double repaid;
  String status; // active | repaid
  String supplierName;
  String supplierAccount;
  DateTime createdAt;
  DateTime dueAt;
  DateTime? lastAutoRepayDay;

  Loan({
    required this.id,
    required this.principal,
    required this.rate,
    required this.totalRepayable,
    required this.dailyRepayment,
    required this.tenorDays,
    this.repaid = 0,
    this.status = 'active',
    required this.supplierName,
    required this.supplierAccount,
    required this.createdAt,
    required this.dueAt,
    this.lastAutoRepayDay,
  });

  double get remaining => (totalRepayable - repaid).clamp(0, double.infinity).toDouble();
  double get progress => totalRepayable == 0 ? 0 : (repaid / totalRepayable).clamp(0, 1).toDouble();

  Map<String, dynamic> toJson() => {
        'id': id, 'principal': principal, 'rate': rate, 'totalRepayable': totalRepayable,
        'dailyRepayment': dailyRepayment, 'tenorDays': tenorDays, 'repaid': repaid, 'status': status,
        'supplierName': supplierName, 'supplierAccount': supplierAccount,
        'createdAt': createdAt.millisecondsSinceEpoch, 'dueAt': dueAt.millisecondsSinceEpoch,
        'lastAutoRepayDay': lastAutoRepayDay?.millisecondsSinceEpoch,
      };

  factory Loan.fromJson(Map<String, dynamic> j) => Loan(
        id: j['id'], principal: _d(j['principal']), rate: _d(j['rate']), totalRepayable: _d(j['totalRepayable']),
        dailyRepayment: _d(j['dailyRepayment']), tenorDays: _i(j['tenorDays']), repaid: _d(j['repaid']),
        status: j['status'] ?? 'active', supplierName: j['supplierName'] ?? '', supplierAccount: j['supplierAccount'] ?? '',
        createdAt: DateTime.fromMillisecondsSinceEpoch(_i(j['createdAt'])),
        dueAt: DateTime.fromMillisecondsSinceEpoch(_i(j['dueAt'])),
        lastAutoRepayDay: j['lastAutoRepayDay'] == null ? null : DateTime.fromMillisecondsSinceEpoch(_i(j['lastAutoRepayDay'])),
      );
}

class Savings {
  bool enabled;
  double percent; // share of each day's sales
  double balance;
  DateTime? lastSavedDay;

  Savings({this.enabled = false, this.percent = 5, this.balance = 0, this.lastSavedDay});

  Map<String, dynamic> toJson() => {
        'enabled': enabled, 'percent': percent, 'balance': balance,
        'lastSavedDay': lastSavedDay?.millisecondsSinceEpoch,
      };
  factory Savings.fromJson(Map<String, dynamic> j) => Savings(
        enabled: j['enabled'] ?? false, percent: _d(j['percent'] ?? 5), balance: _d(j['balance']),
        lastSavedDay: j['lastSavedDay'] == null ? null : DateTime.fromMillisecondsSinceEpoch(_i(j['lastSavedDay'])),
      );
}

class ChatMessage {
  bool fromUser;
  String text;
  DateTime at;
  ChatMessage({required this.fromUser, required this.text, DateTime? at}) : at = at ?? DateTime.now();
  Map<String, dynamic> toJson() => {'fromUser': fromUser, 'text': text, 'at': at.millisecondsSinceEpoch};
  factory ChatMessage.fromJson(Map<String, dynamic> j) =>
      ChatMessage(fromUser: j['fromUser'] ?? false, text: j['text'] ?? '', at: DateTime.fromMillisecondsSinceEpoch(_i(j['at'])));
}
