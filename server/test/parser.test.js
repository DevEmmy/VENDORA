'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, normalize } = require('../src/parser');

const inventory = [
  { id: 'rice', name: 'Rice (50kg)', aliases: ['iresi', 'osikapa', 'shinkafa'], unit: 'bag', price: 8500 },
  { id: 'milk', name: 'Peak Milk', aliases: [], unit: 'carton', price: 8400 },
  { id: 'indomie', name: 'Indomie', aliases: ['noodles'], unit: 'carton', price: 6000 },
  { id: 'tomato', name: 'Tomato Paste', aliases: [], unit: 'carton', price: 3600 },
  { id: 'sugar', name: 'Sugar (50kg)', aliases: [], unit: 'bag', price: 19000 },
  { id: 'oil', name: 'Vegetable Oil', aliases: [], unit: 'crate', price: 14400 },
  { id: 'garri', name: 'Yellow Garri', aliases: [], unit: 'bag', price: 25000 },
];
const customers = [{ id: 'c1', name: 'Baba Ayo' }, { id: 'c2', name: 'Mama Chidi' }];
const ctx = { inventory, customers };
const P = t => parse(t, ctx);

test('normalize handles naira, commas and k', () => {
  assert.equal(normalize('₦5,000'), 'naira 5000');
  assert.equal(normalize('I sold for 5k'), 'i sold for 5000');
  assert.equal(normalize('Mo ta ọkan'), 'mo ta okan');
});

test('English sale with customer', () => {
  const r = P('I have sold three bags of yellow garri to Mummy Chidi');
  assert.equal(r.type, 'sale');
  assert.deepEqual(r.items.map(i => [i.productId, i.qty]), [['garri', 3]]);
  assert.equal(r.customer.name, 'Mummy Chidi');
  assert.equal(r.total, 75000);
});

test('Sale on part payment creates balance', () => {
  const r = P('I just sold two cartons of noodles for five thousand naira to Baba Ayo, but he paid three thousand');
  assert.equal(r.type, 'sale');
  assert.deepEqual(r.items.map(i => [i.productId, i.qty]), [['indomie', 2]]);
  assert.equal(r.total, 5000);
  assert.equal(r.paid, 3000);
  assert.equal(r.balance, 2000);
  assert.equal(r.customer.id, 'c1');
});

test('Pidgin sale', () => {
  const r = P('I don sell 2 bag rice and 1 carton peak milk');
  assert.equal(r.type, 'sale');
  assert.deepEqual(r.items.map(i => [i.productId, i.qty]), [['rice', 2], ['milk', 1]]);
});

test('Yoruba sale with number after unit', () => {
  const r = P('Mo ta bags meji ti rice ati ọkan carton Peak Milk');
  assert.equal(r.type, 'sale');
  assert.deepEqual(r.items.map(i => [i.productId, i.qty]), [['rice', 2], ['milk', 1]]);
});

test('Yoruba local product name', () => {
  const r = P('mo ta apo iresi meta');
  assert.deepEqual(r.items.map(i => [i.productId, i.qty]), [['rice', 3]]);
});

test('Igbo sale', () => {
  const r = P('Erere m akpa osikapa abuo');
  assert.equal(r.type, 'sale');
  assert.deepEqual(r.items.map(i => [i.productId, i.qty]), [['rice', 2]]);
});

test('Hausa sale vs buy', () => {
  const s = P('Na sayar da buhu shinkafa biyu');
  assert.equal(s.type, 'sale');
  assert.deepEqual(s.items.map(i => [i.productId, i.qty]), [['rice', 2]]);
  const b = P('Na saya buhu sugar uku');
  assert.equal(b.type, 'restock');
  assert.deepEqual(b.items.map(i => [i.productId, i.qty]), [['sugar', 3]]);
});

test('Restock with cost', () => {
  const r = P('I bought 5 bags of rice for 400000');
  assert.equal(r.type, 'restock');
  assert.deepEqual(r.items.map(i => [i.productId, i.qty]), [['rice', 5]]);
  assert.equal(r.cost, 400000);
});

test('Debt payment', () => {
  const r = P('Baba Ayo paid 2000');
  assert.equal(r.type, 'debt_payment');
  assert.equal(r.customer.id, 'c1');
  assert.equal(r.amount, 2000);
  const y = P('Mama Chidi san egberun meji');
  assert.equal(y.type, 'debt_payment');
  assert.equal(y.amount, 2000);
  assert.equal(y.customer.id, 'c2');
});

test('Credit sale', () => {
  const r = P('sold 1 carton indomie to mama chidi on credit');
  assert.equal(r.type, 'sale');
  assert.equal(r.paid, 0);
  assert.equal(r.balance, 6000);
});

test('Queries', () => {
  assert.equal(P('How market today?').type, 'query_sales');
  assert.equal(P('Which item slow today?').type, 'query_slow');
  const s = P('How much Indomie remain?');
  assert.equal(s.type, 'query_stock'); assert.equal(s.productId, 'indomie');
  assert.equal(P('Who dey owe me?').type, 'query_debts');
  assert.equal(P('What is my best seller this week?').type, 'query_best');
  assert.equal(P('How much profit I make yesterday?').period, 'yesterday');
  assert.equal(P('melo ni iresi to ku').type, 'query_stock');
  assert.equal(P('nawa shinkafa ya rage').type, 'query_stock');
});

test('Unknown product is reported, not dropped', () => {
  const r = P('I sold 3 packs of biscuit');
  assert.equal(r.type, 'sale');
  assert.equal(r.items.length, 0);
  assert.equal(r.unknown[0].name, 'biscuit');
  assert.equal(r.unknown[0].qty, 3);
});

test('Gibberish is unknown', () => {
  assert.equal(P('hello there').type, 'unknown');
});

test('More real-world phrasing', () => {
  const a = P('sell 2 rice give Emeka 17k he pay 10k');
  assert.equal(a.type, 'sale');
  assert.deepEqual(a.items.map(i => [i.productId, i.qty]), [['rice', 2]]);
  assert.equal(a.total, 17000); assert.equal(a.paid, 10000); assert.equal(a.balance, 7000);
  assert.equal(a.customer.name, 'Emeka');
  const b = P('Emeka don pay 5k');
  assert.equal(b.type, 'debt_payment'); assert.equal(b.amount, 5000); assert.equal(b.customer.name, 'Emeka');
  const c = P('I sold one crate of vegetable oil');
  assert.deepEqual(c.items.map(i => [i.productId, i.qty]), [['oil', 1]]);
  const d = P('Restock tomato paste 10 cartons');
  assert.equal(d.type, 'restock');
  assert.deepEqual(d.items.map(i => [i.productId, i.qty]), [['tomato', 10]]);
});
