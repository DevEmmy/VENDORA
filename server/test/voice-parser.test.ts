import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VoiceParser, MockLlm, confidence, matchProducts, normalize, readback, resolveCommand } from '../src/voice/parser';
const products = [
  { id: randomUUID(), name: 'Rice', aliases: ['bag of rice'], unit: 'bag' },
  { id: randomUUID(), name: 'Brown beans', aliases: ['beans'], unit: 'bag' },
  { id: randomUUID(), name: 'White beans', aliases: ['beans'], unit: 'bag' },
];
test('parser repairs invalid JSON once, then fails safely', async () => {
  let calls = 0;
  const parser = new VoiceParser({ complete: async () => { calls++; return 'bad'; } });
  assert.equal((await parser.parse('rice', products)).action, 'unknown'); assert.equal(calls, 2);
  let repair = false;
  const good = await new VoiceParser(new MockLlm()).parse('I sold two bags of rice', products);
  const repaired = await new VoiceParser({ complete: async system => { if (!repair) { repair = true; return '{}'; }
    assert.match(system, /Repair/); return JSON.stringify(good); } }).parse('rice', products);
  assert.equal(repaired.items[0]!.quantity, 2);
});
test('number words, Pidgin, signed spoilage, units and multi item fixture handling', async () => {
  const parser = new VoiceParser(new MockLlm());
  for (const [text, action, qty] of [['I don sell three bags rice', 'sale', 3], ['abeg add ten bags rice', 'restock', 10], ['two bags rice e don spoil', 'adjustment', -2]] as const) {
    const parsed = await parser.parse(text, products); assert.equal(parsed.action, action); assert.equal(parsed.items[0]!.quantity, qty);
  }
  assert.equal((await parser.parse('I sold a dozen rice', products)).needs_clarification, true);
  assert.equal(resolveCommand(await parser.parse('I sold 2 crates rice', products), products).status, 'needs_clarification');
  assert.equal((await parser.parse('I sold 2 bags rice and 1 bag beans', products)).items.length, 2);
});
test('deterministic matching rejects foreign ids and clarifies beans', async () => {
  assert.equal(normalize('Bags of Rice!'), 'rice');
  assert.equal(matchProducts('rice', products)[0]!.score, 1);
  const parser = new VoiceParser(new MockLlm());
  assert.equal(resolveCommand(await parser.parse('I sold 2 bags rice', products), products).status, 'pending');
  assert.equal(resolveCommand(await parser.parse('I sold 2 bags beans', products), products).status, 'needs_clarification');
  assert.equal(resolveCommand(await parser.parse('gobbledygook', products), products).status, 'failed');
  const parsed = await parser.parse('I sold 2 bags rice', products);
  parsed.items[0]!.product_id = randomUUID(); assert.throws(() => resolveCommand(parsed, products), /CROSS_BUSINESS/);
});
test('confidence weights and readback are deterministic', async () => {
  assert.equal(confidence(1, 0, true, true), 1);
  assert.equal(confidence(1, 1, true, true), .8);
  const parsed = resolveCommand(await new VoiceParser(new MockLlm()).parse('I sold 2 bags rice', products), products).parsed;
  assert.equal(readback(parsed, products), 'Sold 2 bags of Rice. Is that correct?');
});
test('dozens convert only for appropriate catalog units and absolute counts require review', async () => {
  const parser = new VoiceParser(new MockLlm());
  const pieces = [{ id: randomUUID(), name: 'Eggs', aliases: ['eggs'], unit: 'piece' }];
  const dozen = await parser.parse('I sold a dozen eggs', pieces);
  assert.equal(dozen.items[0]!.quantity, 12); assert.equal(dozen.items[0]!.unit, 'piece');
  assert.equal(resolveCommand(dozen, pieces).status, 'pending');
  const absolute = await parser.parse('correct rice to 8 bags', products);
  assert.equal(absolute.needs_clarification, true);
  assert.equal(resolveCommand(absolute, products).status, 'failed');
});
test('Coastal resolves to Coaster; sizes, Unicode names, packs and sachets retain meaning', async () => {
  const catalog = [{ id: randomUUID(), name: 'Coaster Biscuit', aliases: [], unit: 'pack' },
    { id: randomUUID(), name: 'Cabin Biscuit', aliases: [], unit: 'pack' }];
  const parser = new VoiceParser(new MockLlm());
  const parsed = await parser.parse('I don sell five packs of Coastal biscuit', []);
  const result = resolveCommand(parsed, catalog);
  assert.equal(result.parsed.items[0]!.product_id, catalog[0]!.id);
  assert.equal(result.parsed.items[0]!.quantity, 5);
  assert.equal(normalize('Ọṣẹ 1.5kg'), 'ọṣẹ 1.5kg');
  assert.notEqual(normalize('Milk 500g'), normalize('Milk 50g'));
});
test('canonical Nigerian market voice commands resolve to correct products, quantities, and actions', async () => {
  const catalog = [
    { id: randomUUID(), name: 'Coaster Biscuit', aliases: ['coastal biscuit'], unit: 'pack' },
    { id: randomUUID(), name: 'Eggs', aliases: ['egg', 'crates of eggs'], unit: 'crate' },
    { id: randomUUID(), name: 'Indomie', aliases: ['noodles'], unit: 'carton' },
    { id: randomUUID(), name: 'Rice', aliases: ['bag of rice'], unit: 'bag' },
    { id: randomUUID(), name: 'Peak milk', aliases: ['milk'], unit: 'carton' }
  ];
  const parser = new VoiceParser(new MockLlm());

  // 1. "I just sold five packs of Coaster biscuit."
  const res1 = resolveCommand(await parser.parse('I just sold five packs of Coaster biscuit.', catalog), catalog);
  assert.equal(res1.parsed.action, 'sale');
  assert.equal(res1.parsed.items[0]!.product_id, catalog[0]!.id);
  assert.equal(res1.parsed.items[0]!.quantity, 5);
  assert.equal(res1.parsed.items[0]!.unit, 'pack');

  // 2. "I sell two crates of egg."
  const res2 = resolveCommand(await parser.parse('I sell two crates of egg.', catalog), catalog);
  assert.equal(res2.parsed.action, 'sale');
  assert.equal(res2.parsed.items[0]!.product_id, catalog[1]!.id);
  assert.equal(res2.parsed.items[0]!.quantity, 2);

  // 3. "Remove three cartons of Indomie."
  const res3 = resolveCommand(await parser.parse('Remove three cartons of Indomie.', catalog), catalog);
  assert.equal(res3.parsed.action, 'adjustment');
  assert.equal(res3.parsed.items[0]!.product_id, catalog[2]!.id);
  assert.equal(res3.parsed.items[0]!.quantity, -3);

  // 4. "I don sell five bags of rice."
  const res4 = resolveCommand(await parser.parse('I don sell five bags of rice.', catalog), catalog);
  assert.equal(res4.parsed.action, 'sale');
  assert.equal(res4.parsed.items[0]!.product_id, catalog[3]!.id);
  assert.equal(res4.parsed.items[0]!.quantity, 5);

  // 5. "How many bags of rice I get left?"
  const res5 = resolveCommand(await parser.parse('How many bags of rice I get left?', catalog), catalog);
  assert.equal(res5.parsed.action, 'check_stock');
  assert.equal(res5.parsed.items[0]!.product_id, catalog[3]!.id);

  // 6. "Add ten cartons of milk to my stock."
  const res6 = resolveCommand(await parser.parse('Add ten cartons of milk to my stock.', catalog), catalog);
  assert.equal(res6.parsed.action, 'restock');
  assert.equal(res6.parsed.items[0]!.product_id, catalog[4]!.id);
  assert.equal(res6.parsed.items[0]!.quantity, 10);
});
test('stock queries and canonical dozen conversion are read-only intents and validated units', async () => {
  const parser = new VoiceParser(new MockLlm());
  const parsed = await parser.parse('How many bags of rice I get left?', []);
  assert.equal(parsed.action, 'check_stock');
  assert.equal(resolveCommand(parsed, products).status, 'pending'); // Service completes it without confirmation.
  const eggs = [{ id: randomUUID(), name: 'Eggs', aliases: ['egg'], unit: 'piece' }];
  const dozen = resolveCommand(await parser.parse('I sold a dozen eggs', []), eggs);
  assert.equal(dozen.parsed.items[0]!.quantity, 12); assert.equal(dozen.parsed.items[0]!.unit, 'piece');
});
test('semantic suggestions cannot return an invented product ID', async () => {
  const parser = new VoiceParser({ complete: async () => JSON.stringify({ product_id: randomUUID(), uncertain: false }) });
  await assert.rejects(parser.suggest('coastal biscuit', products), /CROSS_BUSINESS_PRODUCT/);
});
test('sourced Yoruba/Igbo and an authored code-switch preserve Unicode across the structured pipeline', async () => {
  const fixtures = JSON.parse(readFileSync(resolve(__dirname, '../eval/verified-languages.json'), 'utf8')) as {
    language: string; transcript: string; product_phrase: string; quantity: number; unit: string; source: string;
  }[];
  for (const fixture of [...fixtures, { ...fixtures[0]!, transcript: `${fixtures[0]!.transcript} — two yams sold` }]) {
    const catalog = [{ id: randomUUID(), name: fixture.product_phrase, unit: fixture.unit, aliases: [] }];
    // This tests transport, validation and resolution with a stub model, not multilingual model accuracy.
    const parser = new VoiceParser({ complete: async (system, input) => {
      assert.match(system, /Yoruba, Igbo and code-switched/);
      assert.equal((JSON.parse(input) as { transcript: string }).transcript, fixture.transcript);
      return JSON.stringify({ action: 'sale', items: [{ spoken_name: fixture.product_phrase, quantity: fixture.quantity, unit: fixture.unit, product_id: null }], needs_clarification: false, clarification_question: null });
    } });
    const result = resolveCommand(await parser.parse(fixture.transcript, []), catalog);
    assert.equal(result.status, 'pending'); assert.equal(result.parsed.items[0]!.product_id, catalog[0]!.id);
    assert.equal(result.parsed.items[0]!.quantity, fixture.quantity);
  }
});
