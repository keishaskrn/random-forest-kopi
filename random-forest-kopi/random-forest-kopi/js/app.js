/* app.js — antarmuka web simulasi Random Forest (tanpa server). */
(function () {
  'use strict';
  const { fmt, esc, F } = RF;
  const $ = s => document.querySelector(s);
  const DEFAULT_CSV = `No,Waktu,Uang Saku,Mengantuk,Cuaca,Beli Kopi
1,Pagi,Tinggi,Tidak,Cerah,Tidak
2,Pagi,Tinggi,Tidak,Hujan,Tidak
3,Siang,Tinggi,Tidak,Cerah,Ya
4,Malam,Sedang,Tidak,Cerah,Ya
5,Malam,Rendah,Ya,Cerah,Ya
6,Malam,Rendah,Ya,Hujan,Tidak
7,Siang,Rendah,Ya,Hujan,Ya
8,Pagi,Sedang,Tidak,Cerah,Tidak
9,Pagi,Rendah,Ya,Cerah,Ya
10,Malam,Sedang,Ya,Cerah,Ya
11,Pagi,Sedang,Ya,Hujan,Ya
12,Siang,Sedang,Tidak,Hujan,Ya
13,Siang,Tinggi,Ya,Cerah,Ya
14,Malam,Sedang,Tidak,Hujan,Tidak`;
  const DEFAULT_SAMPLE = { 'Waktu': 'Malam', 'Uang Saku': 'Sedang', 'Mengantuk': 'Ya', 'Cuaca': 'Hujan' };
  let data = null, forest = null, sample = null, tabSeq = 0;

  /* ---------- helper tampilan ---------- */
  function table(headers, rows, rowCls) {
    return `<div class="tw"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
      rows.map((r, i) => `<tr class="${rowCls && rowCls[i] || ''}">${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') + `</tbody></table></div>`;
  }
  function svgBox(svg) { return `<div class="svgbox">${svg.replace('<svg ', '<svg style="max-width:100%;height:auto" ')}</div>`; }
  function tabs(labels, panes) {
    const id = 't' + (++tabSeq);
    return `<div class="tabs" id="${id}"><div class="tb">${labels.map((l, i) => `<button type="button" class="${i ? '' : 'on'}" data-i="${i}">${esc(l)}</button>`).join('')}</div>` +
      panes.map((p, i) => `<div class="pane ${i ? '' : 'on'}" data-i="${i}">${p}</div>`).join('') + `</div>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.tabs > .tb > button'); if (!b) return;
    const box = b.closest('.tabs'), i = b.dataset.i;
    box.querySelectorAll(':scope > .tb > button').forEach(x => x.classList.toggle('on', x === b));
    box.querySelectorAll(':scope > .pane').forEach(x => x.classList.toggle('on', x.dataset.i === i));
  });
  const condText = n => n.cond.length ? n.cond.map(c => `${esc(c.feature)} = ${esc(c.value)}`).join(' &amp; ') : 'akar (seluruh data bootstrap)';

  /* ---------- 1. data ---------- */
  function loadData(text) {
    try {
      data = RF.parseCSV(text); $('#msg').textContent = '';
      $('#data-view').innerHTML = `<p class="hint">${data.rows.length} data · ${data.features.length} atribut · kelas: ${data.classes.map(esc).join(' / ')}</p>` +
        table(['No', ...data.features, data.target], data.rows.map(r => [r.no, ...data.features.map(f => esc(r.x[f])), `<b>${esc(r.y)}</b>`]));
      $('#p-m').max = data.features.length;
      if (+$('#p-m').value > data.features.length) $('#p-m').value = Math.min(2, data.features.length);
      return true;
    } catch (err) { $('#msg').textContent = err.message; return false; }
  }

  /* ---------- 3. bootstrap ---------- */
  function renderBootstrap() {
    const d = forest.data;
    $('#boot-view').innerHTML = `<p class="hint">Dari ${d.rows.length} data asli diambil ${d.rows.length} data secara acak <b>dengan pengembalian</b>, sehingga ada data yang muncul lebih dari sekali dan ada yang tidak terambil (<i>out-of-bag</i>).</p>` +
      tabs(forest.trees.map(t => 'Pohon ' + t.index), forest.trees.map(t => {
        const cnt = {}; t.idx.forEach(i => cnt[i] = (cnt[i] || 0) + 1);
        const dup = Object.keys(cnt).filter(k => cnt[k] > 1).map(k => `No ${d.rows[k].no} (${cnt[k]}×)`);
        return table(['Urutan', 'No asli', ...d.features, d.target], t.sample.map((r, i) => [i + 1, r.no, ...d.features.map(f => esc(r.x[f])), esc(r.y)])) +
          `<p><b>Data berulang:</b> ${dup.join(', ') || '-'}<br><b>Out-of-bag (tidak terambil):</b> ${t.oob.map(r => 'No ' + r.no).join(', ') || '-'}</p>`;
      }));
  }

  /* ---------- 4. pohon ---------- */
  function nodeSummary(node, cls) {
    const rows = [], cc = [];
    rows.push(['Total', '', node.n, ...cls.map(k => node.counts[k]), fmt(node.entropy), '', '', '']); cc.push('tot');
    node.candidates.forEach(c => {
      const pick = c.feature === node.feature;
      rows.push([`<b>${esc(c.feature)}</b>`, '', '', ...cls.map(() => ''), '', fmt(c.gain), fmt(c.splitInfo), fmt(c.gainRatio)]); cc.push(pick ? 'pick' : 'feat');
      c.branches.forEach(b => { rows.push(['', esc(b.value), b.n, ...cls.map(k => b.counts[k]), fmt(b.entropy), '', fmt(b.splitTerm, 5), '']); cc.push(''); });
    });
    return table(['Atribut', 'Nilai', 'Jumlah', ...cls, 'Entropy', 'Gain', 'Split Info', 'Gain Ratio'], rows, cc);
  }
  function nodeDetail(t, node, k, order) {
    const d = forest.data, cls = d.classes, sub = node.subset;
    const processed = new Set(order.slice(0, k + 1).map(n => n.id));
    let h = `<p>Node <b>${node.id}</b> — kondisi: ${condText(node)}. Terdapat <b>${node.n}</b> data. Atribut terpilih secara acak (m = ${forest.m}): <b>${sub.map(esc).join(', ')}</b>.</p>`;
    h += table(['No', ...sub, d.target], node.rows.map(r => [r.no, ...sub.map(f => esc(r.x[f])), esc(r.y)]));
    h += `<p><b>a. Entropy</b> &nbsp;<small>(0·log₂0 dianggap 0)</small></p><div class="calc"><div>Entropy (Total) = ${F.entropy(node.counts, cls, node.n)} = <span class="r">${fmt(node.entropy)}</span></div>`;
    node.candidates.forEach(c => {
      h += `<div>&nbsp;</div><div><i>Entropy ${esc(c.feature)}</i></div>` + c.branches.map(b => `<div>${esc(b.value)} = ${F.entropy(b.counts, cls, b.n)} = <span class="r">${fmt(b.entropy)}</span></div>`).join('');
    });
    h += `</div><p><b>b. Gain</b></p><div class="calc">` + node.candidates.map(c => `<div>Gain ${esc(c.feature)} = ${F.gain(node.entropy, c.branches, node.n)} = <span class="r">${fmt(c.gain)}</span></div>`).join('') + `</div>`;
    h += `<p><b>c. Split Info</b></p><div class="calc">` + node.candidates.map(c => `<div>Split Info ${esc(c.feature)} = ${F.splitInfo(c.branches, node.n)} = <span class="r">${fmt(c.splitInfo)}</span></div>`).join('') + `</div>`;
    h += `<p><b>d. Gain Ratio</b></p><div class="calc">` + node.candidates.map(c => `<div>Gain Ratio ${esc(c.feature)} = ${F.gainRatio(c)} = <span class="r">${fmt(c.gainRatio)}</span></div>`).join('') + `</div>`;
    h += nodeSummary(node, cls);
    h += `<p>Gain Ratio tertinggi: <b>${esc(node.feature)}</b> (${fmt(node.best.gainRatio)}) → node ${node.id} dipecah berdasarkan <b>${esc(node.feature)}</b> menjadi cabang ${node.children.map(c => esc(c.value)).join(', ')}.</p>`;
    h += svgBox(RF.treeSVG(t.root, { processed }));
    return `<details ${k === 0 ? 'open' : ''}><summary>Node ${node.id}: ${esc(node.feature)} <span class="pill">Gain Ratio ${fmt(node.best.gainRatio)}</span></summary><div class="in">${h}</div></details>`;
  }
  function renderTrees() {
    $('#tree-view').innerHTML = tabs(forest.trees.map(t => 'Pohon ' + t.index), forest.trees.map(t => {
      const order = RF.internalNodes(t.root), leaves = RF.leafNodes(t.root);
      let h = `<p class="hint">Pohon ${t.index}: ${order.length} node pemecah, ${leaves.length} daun, kedalaman ${RF.depth(t.root)}. Proses diulang sampai semua data pada node berada dalam kelas yang sama.</p>`;
      h += order.map((n, k) => nodeDetail(t, n, k, order)).join('');
      h += `<p><b>Node daun:</b> ` + leaves.map(l => `<span class="pill ${/^(ya|yes)$/i.test(l.label) ? 'ya' : 'no'}">${l.id}: ${esc(l.label)} (n=${l.n}${l.reason === 'murni' ? '' : ', ' + l.reason})</span>`).join(' ') + `</p>`;
      h += `<h3>Pohon keputusan ${t.index} (hasil akhir)</h3>` + svgBox(RF.treeSVG(t.root));
      return h;
    }));
  }

  /* ---------- 5. prediksi ---------- */
  function renderPredForm() {
    const d = forest.data;
    $('#pred-form').innerHTML = d.features.map((f, i) => `<label>${esc(f)}<select data-f="${esc(f)}">${d.values[f].map(v => `<option ${sample && sample[f] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`).join('') +
      `<div class="btns end"><button id="btn-pred" type="button">Prediksi</button></div>`;
    $('#btn-pred').onclick = renderPred;
    renderPred();
  }
  function renderPred() {
    const d = forest.data, x = {};
    document.querySelectorAll('#pred-form select').forEach(s => x[s.dataset.f] = s.value);
    const p = RF.predictForest(forest, x);
    let h = `<p class="hint">Data baru: ${d.features.map(f => `<b>${esc(f)}</b> = ${esc(x[f])}`).join(', ')}. Jalur penelusuran pada tiap pohon ditandai <span class="badge">oranye</span>.</p>`;
    h += tabs(forest.trees.map(t => 'Pohon ' + t.index), forest.trees.map((t, i) => {
      const r = p.results[i];
      const path = r.path.map(s => `${esc(s.feature)} = ${esc(s.value)}`).join(' → ');
      return `<p>Jalur: ${path || '(akar)'} → <b>${esc(r.label)}</b>${r.fallback ? ' <small>(nilai tidak ada di pohon, memakai kelas mayoritas node)</small>' : ''}</p>` + svgBox(RF.treeSVG(t.root, { highlight: RF.highlightOf(r) }));
    }));
    h += `<h3>Hasil mayoritas vote</h3>` + table(['Pohon keputusan', d.target], p.results.map(r => [r.tree, `<b>${esc(r.label)}</b>`]));
    h += table(['Kelas', 'Jumlah suara'], d.classes.map(k => [esc(k), p.votes[k]]));
    h += `<div class="result">Dengan ${forest.nTrees} pohon keputusan, ${d.classes.map(k => `${p.votes[k]} pohon menghasilkan <b>${esc(k)}</b>`).join(' dan ')}. Maka data tersebut diprediksi <b>${esc(d.target)} = ${esc(p.winner)}</b>.${p.tie ? ' <small>(suara imbang; dipilih kelas pertama pada urutan data)</small>' : ''}</div>`;
    $('#pred-view').innerHTML = h;
  }

  /* ---------- kendali ---------- */
  function run() {
    if (!data && !loadData($('#csv').value)) return;
    const nTrees = Math.max(1, Math.min(9, +$('#p-trees').value || 3));
    const m = Math.max(1, Math.min(data.features.length, +$('#p-m').value || 2));
    const seed = Math.floor(+$('#p-seed').value || 0);
    $('#p-trees').value = nTrees; $('#p-m').value = m;
    forest = RF.buildForest(data, { nTrees, m, seed });
    if (!sample || data.features.some(f => !data.values[f].includes(sample[f]))) sample = null;
    ['#sec-boot', '#sec-tree', '#sec-pred'].forEach(s => $(s).hidden = false);
    renderBootstrap(); renderTrees(); renderPredForm();
  }
  $('#csv').value = DEFAULT_CSV;
  $('#btn-default').onclick = () => { $('#csv').value = DEFAULT_CSV; sample = DEFAULT_SAMPLE; if (loadData(DEFAULT_CSV)) run(); };
  $('#btn-apply').onclick = () => { if (loadData($('#csv').value)) { sample = null; run(); } };
  $('#btn-run').onclick = () => { if (loadData($('#csv').value)) run(); };
  $('#btn-rand').onclick = () => { $('#p-seed').value = Math.floor(Math.random() * 9999) + 1; run(); };
  sample = DEFAULT_SAMPLE;
  if (loadData(DEFAULT_CSV)) run();
})();
