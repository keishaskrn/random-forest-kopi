// Pengujian sederhana: node tests/test.js
const assert = require('assert'), fs = require('fs'), path = require('path');
const RF = require('../js/rf.js');
const data = RF.parseCSV(fs.readFileSync(path.join(__dirname, '../data/dataset.csv'), 'utf8'));
// 1. Entropy total 5 Tidak : 9 Ya = 0,940286
const e = RF.entropy(RF.countClasses(data.rows, data.classes), 14);
assert.strictEqual(RF.fmt(e), '0,940286');
// 2. Hasil harus deterministik untuk seed yang sama
const a = RF.buildForest(data, { nTrees: 3, m: 2, seed: 31 }), b = RF.buildForest(data, { nTrees: 3, m: 2, seed: 31 });
assert.deepStrictEqual(a.trees.map(t => t.idx), b.trees.map(t => t.idx));
assert.deepStrictEqual(a.trees.map(t => t.root.feature), ['Uang Saku', 'Waktu', 'Mengantuk']);
// 3. Semua daun murni (atau atribut habis) dan jumlah data daun = jumlah data bootstrap
a.trees.forEach(t => {
  const leaves = RF.leafNodes(t.root);
  assert.strictEqual(leaves.reduce((s, l) => s + l.n, 0), 14);
  leaves.forEach(l => assert.ok(l.reason === 'murni' || l.reason === 'atribut habis'));
});
// 4. Prediksi mayoritas vote untuk data uji contoh
const p = RF.predictForest(a, { 'Waktu': 'Malam', 'Uang Saku': 'Sedang', 'Mengantuk': 'Ya', 'Cuaca': 'Hujan' });
assert.deepStrictEqual(p.results.map(r => r.label), ['Ya', 'Tidak', 'Ya']);
assert.strictEqual(p.winner, 'Ya');
console.log('Semua pengujian lulus ✔');
