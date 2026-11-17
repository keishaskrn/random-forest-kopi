/* =====================================================================
   rf.js — Inti algoritma Random Forest (C4.5: Entropy, Gain, Split Info,
   Gain Ratio) + pembuat gambar pohon (SVG) + penjelasan rumus.
   Dipakai bersama oleh web simulasi (browser) dan pembuat laporan (Node).
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Utilitas ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const fmt = (x, d = 6) => (Math.abs(x) < 5e-13 ? 0 : x).toFixed(d).replace('.', ',');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---------- Membaca dataset (CSV) ---------- */
  function parseCSV(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 5) throw new Error('Dataset minimal terdiri atas 1 baris header dan 4 baris data.');
    const first = lines[0];
    const delim = first.includes('\t') ? '\t' : (first.includes(';') && !first.includes(',')) ? ';' : ',';
    let table = lines.map(l => l.split(delim).map(c => c.trim()));
    const width = table[0].length;
    table.forEach((r, i) => { if (r.length !== width) throw new Error('Baris ' + (i + 1) + ' memiliki ' + r.length + ' kolom, seharusnya ' + width + '.'); });
    let header = table[0], body = table.slice(1), hasNo = /^(no|nomor|id)$/i.test(header[0]);
    if (hasNo) { header = header.slice(1); }
    if (header.length < 3) throw new Error('Minimal 2 atribut dan 1 kolom target (kolom terakhir).');
    const features = header.slice(0, -1), target = header[header.length - 1];
    const rows = body.map((r, i) => {
      const no = hasNo ? r[0] : String(i + 1), vals = hasNo ? r.slice(1) : r;
      const x = {}; features.forEach((f, j) => { x[f] = vals[j]; });
      if (vals.some(v => v === '')) throw new Error('Ada sel kosong pada baris data ke-' + (i + 1) + '.');
      return { no: Number(no) || no, x, y: vals[vals.length - 1] };
    });
    const classes = [...new Set(rows.map(r => r.y))];
    if (classes.length < 2) throw new Error('Kolom target harus memiliki minimal 2 kelas.');
    const values = {}; features.forEach(f => { values[f] = [...new Set(rows.map(r => r.x[f]))]; });
    return { features, target, rows, classes, values };
  }

  /* ---------- Rumus dasar ---------- */
  function countClasses(rows, classes) { const c = {}; classes.forEach(k => c[k] = 0); rows.forEach(r => c[r.y]++); return c; }
  function entropy(counts, n) { let e = 0; for (const k in counts) { const c = counts[k]; if (c > 0) { const p = c / n; e -= p * Math.log2(p); } } return e; }
  function majority(counts, classes) { let b = classes[0]; classes.forEach(k => { if (counts[k] > counts[b]) b = k; }); return b; }

  function evalFeature(rows, f, values, classes, parentE) {
    const N = rows.length, branches = [];
    values.forEach(v => {
      const sub = rows.filter(r => r.x[f] === v); if (!sub.length) return;
      const counts = countClasses(sub, classes), n = sub.length;
      branches.push({ value: v, n, counts, entropy: entropy(counts, n), splitTerm: -(n / N) * Math.log2(n / N) });
    });
    let rem = 0, si = 0; branches.forEach(b => { rem += (b.n / N) * b.entropy; si += b.splitTerm; });
    const gain = Math.max(0, parentE - rem);
    return { feature: f, branches, gain, splitInfo: si, gainRatio: si > 1e-12 ? gain / si : 0 };
  }

  /* ---------- Penjelasan rumus (teks) ---------- */
  const F = {
    entropy(counts, classes, n) { return classes.map(k => `(- ${counts[k]}/${n} * log₂(${counts[k]}/${n}))`).join(' + '); },
    gain(parentE, branches, N) { return `${fmt(parentE)} – (${branches.map(b => `(${b.n}/${N} * ${fmt(b.entropy)})`).join(' + ')})`; },
    splitInfo(branches, N) { return branches.map(b => `((-${b.n}/${N}) * log₂(${b.n}/${N}))`).join(' + '); },
    gainRatio(c) { return `${fmt(c.gain)} / ${fmt(c.splitInfo)}`; }
  };

  /* ---------- Membangun pohon ---------- */
  function sampleWithoutReplacement(arr, k, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const chosen = a.slice(0, k);
    return arr.filter(x => chosen.includes(x));            // urutan sesuai kolom asli
  }

  function buildNode(id, rows, avail, ctx, cond) {
    const n = rows.length, counts = countClasses(rows, ctx.classes), e = entropy(counts, n);
    const node = { id, n, counts, entropy: e, rows, majority: majority(counts, ctx.classes), cond };
    const present = ctx.classes.filter(k => counts[k] > 0);
    if (present.length === 1) { node.leaf = true; node.label = present[0]; node.reason = 'murni'; return node; }
    if (avail.length === 0) { node.leaf = true; node.label = node.majority; node.reason = 'atribut habis'; return node; }
    node.subset = sampleWithoutReplacement(avail, Math.min(ctx.m, avail.length), ctx.rng);
    node.candidates = node.subset.map(f => evalFeature(rows, f, ctx.values[f], ctx.classes, e));
    let best = node.candidates[0];
    node.candidates.forEach(c => { if (c.gainRatio > best.gainRatio + 1e-12) best = c; });
    node.feature = best.feature; node.best = best; node.leaf = false;
    node.children = best.branches.map((b, i) => ({
      value: b.value,
      node: buildNode(id + '.' + (i + 1), rows.filter(r => r.x[best.feature] === b.value),
        avail.filter(a => a !== best.feature), ctx, cond.concat([{ feature: best.feature, value: b.value }]))
    }));
    return node;
  }

  function buildForest(data, opt) {
    const nTrees = opt.nTrees || 3, m = opt.m || 2, seed = opt.seed == null ? 1 : opt.seed;
    const rng = mulberry32(seed), ctx = { classes: data.classes, values: data.values, m, rng };
    const trees = [], N = data.rows.length;
    for (let t = 0; t < nTrees; t++) {
      const idx = []; for (let i = 0; i < N; i++) idx.push(Math.floor(rng() * N));
      const sample = idx.map(i => data.rows[i]);
      const used = new Set(idx);
      const oob = data.rows.filter((r, i) => !used.has(i));
      const root = buildNode('1', sample, data.features.slice(), ctx, []);
      trees.push({ index: t + 1, idx, sample, oob, root });
    }
    return { seed, m, nTrees, trees, data };
  }

  /* ---------- Penelusuran pohon ---------- */
  function internalNodes(node, out = []) { if (!node.leaf) { out.push(node); node.children.forEach(c => internalNodes(c.node, out)); } return out; }
  function leafNodes(node, out = []) { if (node.leaf) out.push(node); else node.children.forEach(c => leafNodes(c.node, out)); return out; }
  function depth(node) { return node.leaf ? 1 : 1 + Math.max(...node.children.map(c => depth(c.node))); }

  function predictTree(root, x) {
    let n = root; const path = [];
    while (!n.leaf) {
      const v = x[n.feature], ch = n.children.find(c => c.value === v);
      if (!ch) { path.push({ node: n.id, feature: n.feature, value: v, fallback: true }); return { label: n.majority, path, endNode: n, fallback: true }; }
      path.push({ node: n.id, feature: n.feature, value: v, to: ch.node.id }); n = ch.node;
    }
    return { label: n.label, path, endNode: n };
  }
  function predictForest(forest, x) {
    const results = forest.trees.map(t => Object.assign({ tree: t.index }, predictTree(t.root, x)));
    const votes = {}; forest.data.classes.forEach(k => votes[k] = 0); results.forEach(r => votes[r.label]++);
    let winner = forest.data.classes[0]; forest.data.classes.forEach(k => { if (votes[k] > votes[winner]) winner = k; });
    const top = forest.data.classes.filter(k => votes[k] === votes[winner]);
    return { results, votes, winner, tie: top.length > 1 };
  }
  function highlightOf(res) {
    const nodes = new Set([res.endNode.id]), edges = new Set();
    res.path.forEach(p => { nodes.add(p.node); if (p.to) { nodes.add(p.to); edges.add(p.node + '>' + p.to); } });
    return { nodes, edges };
  }

  /* ---------- Gambar pohon (SVG) ---------- */
  function treeSVG(root, opts) {
    opts = opts || {};
    const processed = opts.processed || null, hl = opts.highlight || null;
    const NW = 124, LH = 118, GREEN = '#7cb342', LIGHT = '#aed581', ORANGE = '#ef6c00';
    const isOpen = n => !n.leaf && (!processed || processed.has(n.id));
    function mk(n, d) { const kids = isOpen(n) ? n.children.map(c => ({ value: c.value, L: mk(c.node, d + 1) })) : []; return { n, d, kids, w: kids.length ? kids.reduce((s, k) => s + k.L.w, 0) : NW }; }
    const L0 = mk(root, 0); let maxD = 0;
    (function pos(L, left) { L.y = L.d * LH + 46; maxD = Math.max(maxD, L.d); if (!L.kids.length) { L.x = left + L.w / 2; return; } let cur = left; L.kids.forEach(k => { pos(k.L, cur); cur += k.L.w; }); L.x = (L.kids[0].L.x + L.kids[L.kids.length - 1].L.x) / 2; })(L0, 0);
    const W = L0.w + 20, H = maxD * LH + 100;
    let edges = '', nodes = '', labels = '';
    (function draw(L) {
      L.kids.forEach(k => {
        const on = hl && hl.edges.has(L.n.id + '>' + k.L.n.id), col = on ? ORANGE : LIGHT;
        const x1 = L.x, y1 = L.y + 30, x2 = k.L.x, y2 = k.L.y - (k.L.n.leaf ? 24 : 30) - 3;
        edges += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${on ? 3.5 : 2}" marker-end="url(#${on ? 'ah-o' : 'ah-g'})"/>`;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, tw = Math.max(26, esc(k.value).length * 7.2 + 10);
        labels += `<rect x="${mx - tw / 2}" y="${my - 10}" width="${tw}" height="20" rx="4" fill="#fff" opacity=".92"/><text x="${mx}" y="${my + 4.5}" text-anchor="middle" font-size="12.5" fill="${on ? ORANGE : '#33691e'}" font-weight="${on ? 700 : 500}">${esc(k.value)}</text>`;
        draw(k.L);
      });
      const n = L.n, on = hl && hl.nodes.has(n.id), stroke = on ? `stroke="${ORANGE}" stroke-width="3.5"` : '';
      if (n.leaf) {
        nodes += `<rect x="${L.x - 42}" y="${L.y - 24}" width="84" height="48" rx="10" fill="${GREEN}" ${stroke}/><text x="${L.x}" y="${L.y + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">${esc(n.label)}</text>`;
      } else {
        const open = isOpen(n), txt = open ? n.feature : n.id + ' ?';
        nodes += `<ellipse cx="${L.x}" cy="${L.y}" rx="${open ? 54 : 40}" ry="30" fill="${open ? GREEN : LIGHT}" ${stroke}/><text x="${L.x}" y="${L.y + 5}" text-anchor="middle" font-size="${open ? 14 : 15}" font-weight="700" fill="#fff">${esc(txt)}</text>`;
      }
    })(L0);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif"><defs>` +
      `<marker id="ah-g" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${LIGHT}"/></marker>` +
      `<marker id="ah-o" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" refX="10" refY="5.5" orient="auto"><path d="M0,0 L11,5.5 L0,11 z" fill="${ORANGE}"/></marker></defs>` +
      `<rect width="${W}" height="${H}" fill="#fff"/>${edges}${labels}${nodes}</svg>`;
  }

  return { mulberry32, parseCSV, countClasses, entropy, majority, evalFeature, buildForest, buildNode, internalNodes, leafNodes, depth,
    predictTree, predictForest, highlightOf, treeSVG, fmt, esc, F };
});
