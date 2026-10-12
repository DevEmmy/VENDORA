// Multilingual command parser (English, Pidgin, Yoruba, Igbo, Hausa).
// Line-for-line port of server/src/parser.js, whose tests (server/test/parser.test.js)
// define the expected behaviour. Mirror tests live in test/command_parser_test.dart.

import 'dart:math' as math;

import '../models/models.dart';

class ParsedItem {
  final String productId;
  final String name;
  double qty;
  final String? unit;
  final double price;
  ParsedItem({required this.productId, required this.name, required this.qty, this.unit, this.price = 0});
}

class UnknownItem {
  final String name;
  final double qty;
  final String? unit;
  UnknownItem({required this.name, required this.qty, this.unit});
}

class ParsedCustomer {
  final String? id;
  final String name;
  final bool isNew;
  ParsedCustomer({this.id, required this.name, required this.isNew});
}

class ParseResult {
  final String type; // sale | restock | debt_payment | query_* | unknown
  final List<ParsedItem> items;
  final List<UnknownItem> unknown;
  final double total;
  final double paid;
  final double balance;
  final double? cost;
  final double amount;
  final ParsedCustomer? customer;
  final String? productId;
  final String? productName;
  final String period;
  final String text;

  ParseResult({
    required this.type,
    this.items = const [],
    this.unknown = const [],
    this.total = 0,
    this.paid = 0,
    this.balance = 0,
    this.cost,
    this.amount = 0,
    this.customer,
    this.productId,
    this.productName,
    this.period = 'today',
    this.text = '',
  });

  bool get isQuery => type.startsWith('query_');
  bool get isCommand => type == 'sale' || type == 'restock' || type == 'debt_payment';
}

// ---------- normalisation ----------
const Map<String, String> _accentMap = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ā': 'a', 'ǎ': 'a',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ě': 'e', 'ẹ': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ī': 'i', 'ǐ': 'i', 'ị': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ō': 'o', 'ǒ': 'o', 'ọ': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ū': 'u', 'ǔ': 'u', 'ụ': 'u',
  'ń': 'n', 'ǹ': 'n', 'ṅ': 'n', 'ñ': 'n', 'ḿ': 'm', 'ṣ': 's', 'ś': 's',
  'ɓ': 'b', 'ɗ': 'd', 'ƙ': 'k', 'ƴ': 'y', 'ç': 'c',
};

String stripDiacritics(String s) {
  final b = StringBuffer();
  for (final r in s.runes) {
    final ch = String.fromCharCode(r);
    if (r >= 0x0300 && r <= 0x036f) continue; // combining marks (tones, dot below)
    // precomposed letters with dot below + tone (e.g. ẹ́ = U+1EB9 + U+0301 handled above)
    if (r >= 0x1EA0 && r <= 0x1EF9) {
      b.write(_accentMap[ch] ?? _latinExtended(r));
      continue;
    }
    b.write(_accentMap[ch] ?? ch);
  }
  return b.toString();
}

// Vietnamese/Yoruba range U+1EA0–U+1EF9 base letters
String _latinExtended(int r) {
  if (r <= 0x1EB7) return 'a';
  if (r <= 0x1EC7) return 'e';
  if (r <= 0x1ECB) return 'i';
  if (r <= 0x1EE3) return 'o';
  if (r <= 0x1EF1) return 'u';
  return 'y';
}

String normalize(String text) {
  var t = stripDiacritics(text.toLowerCase());
  t = t.replaceAll('₦', ' naira ');
  final comma = RegExp(r'(\d),(\d{3})');
  t = t.replaceAllMapped(comma, (m) => '${m[1]}${m[2]}');
  t = t.replaceAllMapped(comma, (m) => '${m[1]}${m[2]}');
  t = t.replaceAllMapped(RegExp(r'(\d+(?:\.\d+)?)\s*k\b'), (m) => (double.parse(m[1]!) * 1000).round().toString());
  t = t.replaceAllMapped(RegExp(r'\bn(\d+)'), (m) => m[1]!);
  t = t.replaceAll(RegExp(r'[^a-z0-9\s]'), ' ');
  return t.replaceAll(RegExp(r'\s+'), ' ').trim();
}

// ---------- vocabularies ----------
const Map<String, double> numberWords = {
  // English / Pidgin
  'one': 1, 'a': 1, 'an': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8,
  'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'fifteen': 15, 'twenty': 20, 'thirty': 30, 'forty': 40,
  'fifty': 50, 'half': 0.5,
  // Yoruba
  'okan': 1, 'kan': 1, 'meji': 2, 'meta': 3, 'merin': 4, 'marun': 5, 'mefa': 6, 'meje': 7, 'mejo': 8,
  'mesan': 9, 'mewa': 10, 'ogun': 20, 'ogbon': 30,
  // Igbo
  'otu': 1, 'abuo': 2, 'ato': 3, 'ano': 4, 'ise': 5, 'isii': 6, 'asaa': 7, 'asato': 8, 'itoolu': 9, 'iri': 10,
  // Hausa
  'daya': 1, 'biyu': 2, 'uku': 3, 'hudu': 4, 'biyar': 5, 'shida': 6, 'bakwai': 7, 'takwas': 8, 'tara': 9,
  'goma': 10, 'ashirin': 20,
};
const _thousandWords = ['thousand', 'egberun', 'puku', 'dubu'];
const _hundredWords = ['hundred', 'ogorun', 'nari', 'dari'];
const _ambiguousNumbers = ['a', 'an', 'kan', 'na', 'ise', 'ji', 'tara', 'da'];

const Map<String, String> unitWords = {
  'bag': 'bag', 'bags': 'bag', 'apo': 'bag', 'akpa': 'bag', 'buhu': 'bag', 'sack': 'bag', 'sacks': 'bag',
  'carton': 'carton', 'cartons': 'carton', 'katon': 'carton',
  'crate': 'crate', 'crates': 'crate', 'tin': 'tin', 'tins': 'tin', 'can': 'tin', 'cans': 'tin',
  'pack': 'pack', 'packs': 'pack', 'packet': 'pack', 'packets': 'pack', 'piece': 'piece', 'pieces': 'piece',
  'pcs': 'piece', 'bottle': 'bottle', 'bottles': 'bottle', 'gallon': 'gallon', 'gallons': 'gallon',
  'keg': 'gallon', 'kegs': 'gallon', 'kg': 'kg', 'kilo': 'kg', 'kilos': 'kg', 'paint': 'paint', 'paints': 'paint',
  'mudu': 'mudu', 'derica': 'derica', 'dericas': 'derica', 'roll': 'roll', 'rolls': 'roll', 'dozen': 'dozen',
  'box': 'box', 'boxes': 'box',
};

const Map<String, String> productAliases = {
  'iresi': 'rice', 'osikapa': 'rice', 'shinkafa': 'rice', 'raisi': 'rice',
  'ewa': 'beans', 'agwa': 'beans', 'wake': 'beans',
  'epo': 'oil', 'mmanu': 'oil', 'manu': 'oil', 'mai': 'oil',
  'gari': 'garri', 'garri': 'garri', 'suga': 'sugar', 'sukari': 'sugar',
  'iyo': 'salt', 'nnu': 'salt', 'gishiri': 'salt', 'ata': 'pepper', 'ose': 'pepper', 'barkono': 'pepper',
  'tomati': 'tomato', 'tumatur': 'tomato', 'isu': 'yam', 'ji': 'yam', 'doya': 'yam',
  'elubo': 'flour', 'fulawa': 'flour', 'flawa': 'flour', 'indomie': 'indomie', 'noodles': 'indomie',
  'noodle': 'indomie', 'wara': 'milk', 'mmiri': 'water', 'omi': 'water', 'ruwa': 'water',
  'sabulu': 'soap', 'ncha': 'soap',
};

const _saleVerbs = ['sold', 'sell', 'sale', 'selling', 'ta', 'tita', 'ree', 'rere', 'erere', 'rerela', 'erele', 'sayar', 'sayarwa'];
const _restockVerbs = ['bought', 'buy', 'restock', 'restocked', 'received', 'ra', 'rara', 'zuru', 'zutara', 'zuta', 'saya', 'sayo', 'sayi', 'collect', 'collected', 'supply', 'supplied'];
const _payVerbs = ['paid', 'pay', 'payed', 'san', 'sanwo', 'kwuru', 'kwuo', 'kwughachiri', 'biya', 'balance'];
const _allVerbs = [..._saleVerbs, ..._restockVerbs, ..._payVerbs];
const _creditWords = ['credit', 'gbese', 'bashi', 'ugwo', 'owe', 'owing', 'later'];
const _andWords = ['and', 'ati', 'pelu', 'na', 'da', 'plus'];
const _customerMarkers = ['to', 'fun', 'nye', 'wa', 'ga', 'give'];
const Set<String> _stopForName = {
  'for', 'at', 'naira', 'and', 'ati', 'na', 'da', 'paid', 'pay', 'he', 'she', 'but', 'o', 'e', 'today', 'loni',
  'taa', 'yau', 'on', 'with', 'balance', 'san', 'biya', 'kwuru',
};
const _filler = ['i', 'mo', 'm', 'na', 'don', 'have', 'has', 'just', 'ti', 'ka', 'ya', 'e', 'o', 'of', 'the', 'my', 'some', 'nke', 'ni'];
const _remainWords = ['remain', 'remaining', 'left', 'ku', 'seku', 'foduru', 'rage', 'stock', 'dey', 'how many', 'how much'];

// ---------- helpers ----------
List<String> tokenize(String t) => t.split(' ').where((s) => s.isNotEmpty).toList();
final _digits = RegExp(r'^\d+(\.\d+)?$');
final _intDigits = RegExp(r'^\d+$');
bool _isDigitStart(String s) => s.isNotEmpty && s.codeUnitAt(0) >= 48 && s.codeUnitAt(0) <= 57;

int _levenshtein(String a, String b) {
  final m = a.length, n = b.length;
  if (m == 0) return n;
  if (n == 0) return m;
  var prev = List<int>.generate(n + 1, (j) => j);
  for (var i = 1; i <= m; i++) {
    final cur = List<int>.filled(n + 1, 0);
    cur[0] = i;
    for (var j = 1; j <= n; j++) {
      cur[j] = math.min(math.min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

double similar(String a, String b) {
  if (a == b) return 1;
  final l = math.max(a.length, b.length);
  return l == 0 ? 0 : 1 - _levenshtein(a, b) / l;
}

String? _at(List<String> t, int i) => (i >= 0 && i < t.length) ? t[i] : null;

class _Num {
  final double value;
  final int next;
  _Num(this.value, this.next);
}

bool _isNumericContext(List<String> tokens, int j) {
  final nx = _at(tokens, j + 1);
  return nx != null && unitWords.containsKey(nx);
}

_Num? _readSimple(List<String> tokens, int i) {
  final tk = _at(tokens, i);
  if (tk == null) return null;
  if (_intDigits.hasMatch(tk)) return _Num(double.parse(tk), i + 1);
  if (numberWords.containsKey(tk)) return _Num(numberWords[tk]!, i + 1);
  return null;
}

_Num? readNumber(List<String> tokens, int i) {
  double total = 0;
  double? cur;
  var j = i;
  var used = false;
  while (j < tokens.length) {
    final tk = tokens[j];
    if (_digits.hasMatch(tk)) {
      if (cur != null && used) break;
      cur = (cur ?? 0) + double.parse(tk);
      used = true;
      j++;
      continue;
    }
    if (numberWords.containsKey(tk) && !(_ambiguousNumbers.contains(tk) && !_isNumericContext(tokens, j))) {
      cur = (cur ?? 0) + numberWords[tk]!;
      used = true;
      j++;
      continue;
    }
    if (_thousandWords.contains(tk)) {
      if (cur != null) {
        total += cur * 1000;
        cur = null;
        j++;
        used = true;
        continue;
      }
      final nx = _readSimple(tokens, j + 1);
      if (nx != null) {
        total += nx.value * 1000;
        j = nx.next;
        used = true;
        continue;
      }
      total += 1000;
      j++;
      used = true;
      continue;
    }
    if (_hundredWords.contains(tk)) {
      if (cur != null) {
        cur = cur * 100;
        j++;
        used = true;
        continue;
      }
      final nx = _readSimple(tokens, j + 1);
      if (nx != null) {
        total += nx.value * 100;
        j = nx.next;
        used = true;
        continue;
      }
      cur = 100;
      j++;
      used = true;
      continue;
    }
    break;
  }
  if (!used) return null;
  return _Num(total + (cur ?? 0), j);
}

// ---------- product matching ----------
List<String> _productKeywords(Product p) {
  final words = <String>{};
  for (final src in [p.name, ...p.aliases]) {
    for (final w in tokenize(normalize(src))) {
      if (w.length > 1 && !unitWords.containsKey(w) && !_intDigits.hasMatch(w) && w != 'kg') words.add(w);
    }
  }
  return words.toList();
}

class _Match {
  final Product product;
  final double score;
  final int at;
  _Match(this.product, this.score, this.at);
}

_Match? _matchProduct(List<String> tokens, int from, int to, List<Product> inventory) {
  _Match? best;
  for (var i = from; i < to; i++) {
    final tk = tokens[i];
    if (unitWords.containsKey(tk) || numberWords.containsKey(tk) || _stopForName.contains(tk)) continue;
    final canon = productAliases[tk] ?? tk;
    for (final p in inventory) {
      final kws = _productKeywords(p);
      for (final kw in kws) {
        var s = math.max(similar(canon, kw), similar(tk, kw));
        if (i + 1 < to) s = math.max(s, similar(tk + tokens[i + 1], kws.join('')));
        if (kw.length <= 3 && s < 1) s = 0;
        if (s >= 0.8 && (best == null || s > best.score)) best = _Match(p, s, i);
      }
    }
  }
  return best;
}

// ---------- customer ----------
String _titleCase(String s) => s.split(' ').map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1)).join(' ');

ParsedCustomer _resolveCustomer(String raw, List<Customer> customers) {
  Customer? best;
  double bestS = 0;
  for (final c in customers) {
    final s = similar(normalize(c.name), normalize(raw));
    if (s >= 0.75 && s > bestS) {
      best = c;
      bestS = s;
    }
  }
  return best != null
      ? ParsedCustomer(id: best.id, name: best.name, isNew: false)
      : ParsedCustomer(name: _titleCase(raw), isNew: true);
}

ParsedCustomer? _findCustomer(List<String> tokens, List<Customer> customers) {
  for (var i = 0; i < tokens.length - 1; i++) {
    if (!_customerMarkers.contains(tokens[i])) continue;
    final words = <String>[];
    for (var j = i + 1; j < tokens.length && words.length < 3; j++) {
      final tk = tokens[j];
      if (_stopForName.contains(tk) || _isDigitStart(tk) || numberWords.containsKey(tk) || unitWords.containsKey(tk)) break;
      words.add(tk);
    }
    if (words.isNotEmpty) return _resolveCustomer(words.join(' '), customers);
  }
  return null;
}

// ---------- amounts ----------
class _Amount {
  final double value;
  final String role; // paid | total
  final int at;
  final int end;
  _Amount(this.value, this.role, this.at, this.end);
}

List<_Amount> _findAmounts(List<String> tokens) {
  final out = <_Amount>[];
  for (var i = 0; i < tokens.length; i++) {
    final n = readNumber(tokens, i);
    if (n == null) continue;
    final prev = _at(tokens, i - 1), next = _at(tokens, n.next);
    final isMoney = n.value >= 50 || next == 'naira' || prev == 'naira' ||
        _thousandWords.contains(tokens[i]) || _thousandWords.contains(_at(tokens, n.next - 1));
    final beforeUnit = next != null && unitWords.containsKey(next);
    if (isMoney && !beforeUnit) {
      final back = tokens.sublist(math.max(0, i - 3), i);
      final role = back.any(_payVerbs.contains) ? 'paid' : 'total';
      out.add(_Amount(n.value, role, i, n.next));
    }
    i = n.next - 1;
  }
  return out;
}

// ---------- line items ----------
class _Tok {
  final String tk;
  final int i;
  _Tok(this.tk, this.i);
}

List<List<_Tok>> _splitSegments(List<String> tokens) {
  final segs = <List<_Tok>>[];
  var cur = <_Tok>[];
  for (var i = 0; i < tokens.length; i++) {
    final tk = tokens[i];
    final isAnd = _andWords.contains(tk) &&
        !(tk == 'da' && _saleVerbs.contains(_at(tokens, i - 1))) &&
        !(tk == 'na' && i == 0);
    if (isAnd) {
      if (cur.isNotEmpty) segs.add(cur);
      cur = <_Tok>[];
      continue;
    }
    cur.add(_Tok(tk, i));
  }
  if (cur.isNotEmpty) segs.add(cur);
  return segs;
}

class _Items {
  final List<ParsedItem> items;
  final List<UnknownItem> unknown;
  _Items(this.items, this.unknown);
}

_Items _extractItems(List<String> tokens, List<Product> inventory, List<_Amount> amounts) {
  final moneyIdx = <int>{};
  for (final a in amounts) {
    for (var k = a.at; k < a.end; k++) {
      moneyIdx.add(k);
    }
  }
  final items = <ParsedItem>[];
  final unknown = <UnknownItem>[];
  for (final seg in _splitSegments(tokens)) {
    final segTokens = seg.map((s) => s.tk).toList();
    final base = seg.first.i;
    double? qty;
    String? unit;
    for (var k = 0; k < segTokens.length; k++) {
      if (moneyIdx.contains(base + k)) continue;
      final n = readNumber(segTokens, k);
      if (n != null) {
        final after = _at(segTokens, n.next);
        if (after != null && unitWords.containsKey(after)) {
          qty = n.value;
          unit = unitWords[after];
          break;
        }
        if (n.value < 1000 && qty == null) qty = n.value;
        k = n.next - 1;
      } else if (unitWords.containsKey(segTokens[k]) && qty == null) {
        final n2 = readNumber(segTokens, k + 1);
        if (n2 != null && !moneyIdx.contains(base + k + 1)) {
          qty = n2.value;
          unit = unitWords[segTokens[k]];
          break;
        }
        unit = unitWords[segTokens[k]];
      }
    }
    final m = _matchProduct(tokens, base, base + segTokens.length, inventory);
    if (m != null) {
      if (qty == null) {
        final after = readNumber(tokens, m.at + 1);
        if (after != null && after.value < 1000 && !moneyIdx.contains(m.at + 1)) qty = after.value;
      }
      final existing = items.where((it) => it.productId == m.product.id);
      if (existing.isNotEmpty) {
        existing.first.qty += qty ?? 1.0;
      } else {
        items.add(ParsedItem(
            productId: m.product.id, name: m.product.name, qty: qty ?? 1.0, unit: unit ?? m.product.unit, price: m.product.price));
      }
    } else if (qty != null) {
      final guess = <String>[];
      for (var k = 0; k < segTokens.length; k++) {
        final w = segTokens[k];
        if (moneyIdx.contains(base + k) || unitWords.containsKey(w) || numberWords.containsKey(w) || _isDigitStart(w) ||
            _allVerbs.contains(w) || _stopForName.contains(w) || _customerMarkers.contains(w) || _filler.contains(w)) {
          continue;
        }
        guess.add(w);
      }
      if (guess.isNotEmpty) unknown.add(UnknownItem(name: guess.take(3).join(' '), qty: qty, unit: unit));
    }
  }
  return _Items(items, unknown);
}

// ---------- queries ----------
bool _re(String pattern, String t) => RegExp(pattern).hasMatch(t);

String _period(String t) {
  if (_re(r'\b(yesterday|ana|unyahu|jiya)\b', t)) return 'yesterday';
  if (_re(r'\b(week|ose|izu|mako)\b', t)) return 'week';
  if (_re(r'\b(month|osu|onwa|wata)\b', t)) return 'month';
  return 'today';
}

ParseResult? _detectQuery(List<String> tokens, String t, List<Product> inventory) {
  final isQuestion = _re(r'\b(how|what|which|who|wetin|melo|elo|kini|tani|ole|kedu|onye|nawa|wane|wa ne|me|abin)\b', t) ||
      _remainWords.any((w) => t.contains(w));
  if (!isQuestion) return null;
  if (_re(r'\b(owe|owing|debt|gbese|bashi|ugwo|credit)\b', t)) return ParseResult(type: 'query_debts', text: t);
  if (_re(r'\b(slow|no dey move|not moving|o lo|ko ta|adighi|baya tafiya)\b', t)) return ParseResult(type: 'query_slow', text: t);
  if (_re(r'\b(best|top|pass|sell pass|most)\b', t)) return ParseResult(type: 'query_best', period: _period(t), text: t);
  final m = _matchProduct(tokens, 0, tokens.length, inventory);
  if (_re(r'\b(finish|finishing|low|almost|tan|n tan|agwu|kare|karewa)\b', t) && m == null) {
    return ParseResult(type: 'query_low_stock', text: t);
  }
  if (_re(r'\b(profit|gain|ere|uru|riba)\b', t)) return ParseResult(type: 'query_profit', period: _period(t), text: t);
  if (m != null && _re(r'\b(remain|remaining|left|ku|seku|foduru|rage|stock|many|much|melo|ole|nawa|dey)\b', t)) {
    return ParseResult(type: 'query_stock', productId: m.product.id, productName: m.product.name, text: t);
  }
  if (_re(r'\b(market|sell|sold|sales|sale|ta|ree|sayar|make|made|money|owo|ego|kudi)\b', t)) {
    return ParseResult(type: 'query_sales', period: _period(t), text: t);
  }
  return null;
}

// ---------- main ----------
ParseResult parseCommand(String text, {List<Product> inventory = const [], List<Customer> customers = const []}) {
  final t = normalize(text);
  final tokens = tokenize(t);
  if (tokens.isEmpty) return ParseResult(type: 'unknown', text: t);

  bool has(List<String> list) => tokens.any(list.contains);
  String? verb;
  if (has(_saleVerbs) || _re(r'\bdon sell\b', t)) {
    verb = 'sale';
  } else if (has(_restockVerbs)) {
    verb = 'restock';
  } else if (has(_payVerbs)) {
    verb = 'pay';
  }

  final endsWithQ = text.trim().endsWith('?');
  final q = (verb == null || endsWithQ) ? _detectQuery(tokens, t, inventory) : null;
  if (q != null && (verb == null || _re(r'^(how|what|which|who|wetin|melo|elo|ole|nawa)\b', t))) return q;

  final amounts = _findAmounts(tokens);
  final ex = _extractItems(tokens, inventory, amounts);
  final customer = _findCustomer(tokens, customers);

  if (verb == 'pay' && ex.items.isEmpty && ex.unknown.isEmpty) {
    var cust = customer;
    if (cust == null) {
      final pi = tokens.indexWhere(_payVerbs.contains);
      final nameWords = tokens.sublist(0, math.max(0, pi)).where((w) => !['i', 'mo', 'na', 'don', 'has', 'have', 'just', 'o', 'ti', 'e'].contains(w)).toList();
      if (nameWords.isNotEmpty) {
        cust = _resolveCustomer(nameWords.sublist(math.max(0, nameWords.length - 3)).join(' '), customers);
      }
    }
    if (amounts.isNotEmpty) return ParseResult(type: 'debt_payment', customer: cust, amount: amounts.first.value, text: t);
  }

  if ((verb == 'sale' || verb == 'pay') && (ex.items.isNotEmpty || ex.unknown.isNotEmpty)) {
    final calc = ex.items.fold<double>(0, (s, it) => s + it.qty * it.price);
    final totalAmt = amounts.where((a) => a.role == 'total');
    final paidAmt = amounts.where((a) => a.role == 'paid');
    final total = totalAmt.isNotEmpty ? totalAmt.first.value : calc;
    final credit = has(_creditWords);
    final paid = paidAmt.isNotEmpty ? paidAmt.first.value : (credit ? 0.0 : total);
    return ParseResult(
      type: 'sale', items: ex.items, unknown: ex.unknown, total: total, paid: paid,
      balance: math.max(0.0, total - paid), customer: customer, text: t,
    );
  }
  if (verb == 'restock' && (ex.items.isNotEmpty || ex.unknown.isNotEmpty)) {
    final amt = amounts.where((a) => a.role == 'total');
    return ParseResult(type: 'restock', items: ex.items, unknown: ex.unknown, cost: amt.isNotEmpty ? amt.first.value : null, text: t);
  }
  if (q != null) return q;
  return ParseResult(type: 'unknown', text: t);
}
