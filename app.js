import * as Q from './core/quota.js';

const $ = (id) => document.getElementById(id);
const money = (x, d = 1) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 1) => (100 * x).toFixed(d) + '%';
const dfmt = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const iso = (dt) => dt.toISOString().slice(0, 10);
const icons = () => window.lucide && window.lucide.createIcons();

let R, mode = 'overbook', chartTab = 'spend', alpha = 0.05, deptF = -1, query = '', page = 0, applied = false;
const PER = 12;
const LABEL = { flat: 'Current (flat)', hard: 'Strict cap', overbook: 'Recommended' };

function compute() {
  R = Q.run();
  R.summ.overbook95 = R.summ.overbook;
  R.spendSamples = {};
  for (const k of ['flat', 'hard', 'overbook']) R.spendSamples[k] = Array.from(Q.orgSpend(R.quotas[k], R.pred)).sort((a, b) => a - b);
}
function reallocate() {
  const o = Q.allocate(R.pred, R.sim.budget, { mode: 'overbook', alpha });
  R.quotas.overbook = o.quotas; R.lam.overbook = o.lam;
  R.summ.overbook = Q.policySummary(R.pred, o.quotas, R.sim.budget);
  R.spendSamples.overbook = Array.from(Q.orgSpend(o.quotas, R.pred)).sort((a, b) => a - b);
  applied = false;
}

function render() {
  const s = R.summ[mode], rp = R.replay[mode], active = R.model.fits.filter(Boolean).length;
  document.querySelectorAll('#modeTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('weekLbl').textContent = iso(Q.weekStart(Q.WEEKS)) + '  →  ' + iso(new Date(Q.weekStart(Q.WEEKS).getTime() + 6 * 864e5));
  $('sBudget').textContent = money(R.sim.budget);
  $('sMembers').textContent = active;
  $('sBlocked').innerHTML = `<span class="${rp.rate > 0.1 ? 'up' : 'ok'}">${pct(rp.rate)}</span><small>${rp.blocked} of ${rp.n}</small>`;
  $('sBlockedSub').textContent = `12-week replay · next week ${pct(s.blockedRate)}`;
  $('sSpend').innerHTML = `${money(s.spendP50, 0)}<small>of ${money(s.demand, 0)} demand</small>`;
  $('sSpendSub').textContent = `80% range ${money(s.spendP10, 0)} – ${money(s.spendP90, 0)}`;
  $('sOver').innerHTML = `${pct(s.pOverBudget)}<small>${mode === 'overbook' ? 'target ' + pct(alpha, 0) : 'quotas sum to ' + money(s.sumQuotas, 0)}</small>`;
  $('sOverSub').textContent = `replay: over in ${rp.overWeeks} of ${R.replay.rows.length} weeks`;
  drawChart();
  table();
  icons();
}

// ---------- charts ----------
const smooth = (pts) => {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
};
function kde(sorted, xs) {
  const n = sorted.length, sd = Math.sqrt(sorted.reduce((a, x) => a + x * x, 0) / n - (sorted.reduce((a, x) => a + x, 0) / n) ** 2);
  const h = 1.06 * sd * Math.pow(n, -0.2);
  return xs.map((x) => { let t = 0; for (let i = 0; i < n; i += 4) { const z = (x - sorted[i]) / h; t += Math.exp(-0.5 * z * z); } return t / ((n / 4) * h * Math.sqrt(2 * Math.PI)); });
}
function axisY(W, m, H, lo, hi, step, y, fmt) {
  let g = '';
  for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e2e2" stroke-dasharray="4 4"/><text x="${m.l - 10}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#999">${fmt(v)}</text>`;
  return g;
}
function drawChart() {
  document.querySelectorAll('#chartTabs button').forEach((b) => b.classList.toggle('on', b.dataset.c === chartTab));
  const el = $('chart'), W = el.clientWidth || 1100, H = 300, m = { l: 70, r: 20, t: 14, b: 30 };
  const tip = $('tip');
  if (chartTab === 'spend') {
    $('ctitle').textContent = 'Org Spend Distribution, next week';
    const lo = 2000, hi = Math.max(R.sim.budget * 1.25, R.spendSamples.overbook.at(-1));
    const xs = Array.from({ length: 90 }, (_, i) => lo + (hi - lo) * i / 89);
    const dens = {}; for (const k of ['flat', 'hard', 'overbook']) dens[k] = kde(R.spendSamples[k], xs);
    const ymax = Math.max(...Object.values(dens).flat()) * 1.1;
    const x = (v) => m.l + (v - lo) / (hi - lo) * (W - m.l - m.r), y = (v) => m.t + (1 - v / ymax) * (H - m.t - m.b);
    let g = '';
    for (let v = 0; v <= 4; v++) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(ymax * v / 4)}" y2="${y(ymax * v / 4)}" stroke="#e2e2e2" stroke-dasharray="4 4"/>`;
    for (let v = 2000; v <= hi; v += 1000) g += `<text x="${x(v)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#999">${money(v, 0)}</text>`;
    g += `<text x="${m.l - 10}" y="${y(ymax * .5) + 4}" text-anchor="end" font-size="11" fill="#999">density</text>`;
    const col = { flat: '#b8bec8', hard: '#7aa7d9', overbook: '#0086ff' };
    for (const k of ['flat', 'hard', 'overbook']) {
      const pts = xs.map((v, i) => [x(v), y(dens[k][i])]);
      if (k === mode) g += `<defs><linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0086ff" stop-opacity=".28"/><stop offset="1" stop-color="#0086ff" stop-opacity="0"/></linearGradient></defs><path d="${smooth(pts)}L${x(hi)},${y(0)}L${x(lo)},${y(0)}Z" fill="url(#gf)"/>`;
      g += `<path d="${smooth(pts)}" fill="none" stroke="${k === mode ? '#0086ff' : col[k]}" stroke-width="${k === mode ? 2 : 1.4}" ${k === mode ? '' : 'stroke-dasharray="5 4"'}/>`;
    }
    g += `<line x1="${x(R.sim.budget)}" x2="${x(R.sim.budget)}" y1="${m.t}" y2="${H - m.b}" stroke="#f04438" stroke-dasharray="5 4"/><text x="${x(R.sim.budget) + 6}" y="${m.t + 12}" font-size="11" fill="#f04438">Budget ${money(R.sim.budget, 0)}</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}<line id="hv" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="#bbb" stroke-dasharray="3 3" opacity="0"/></svg>`;
    $('clegend').innerHTML = ['flat', 'hard', 'overbook'].map((k) => `<span><i style="background:${k === mode ? '#0086ff' : col[k]}"></i>${LABEL[k]} · P(over budget) ${pct(R.summ[k].pOverBudget)}</span>`).join('');
    const svg = el.querySelector('svg');
    svg.onmousemove = (e) => {
      const r = svg.getBoundingClientRect(); const v = lo + ((e.clientX - r.left) * W / r.width - m.l) / (W - m.l - m.r) * (hi - lo);
      if (v < lo || v > hi) return;
      const hv = svg.querySelector('#hv'); hv.setAttribute('x1', x(v)); hv.setAttribute('x2', x(v)); hv.setAttribute('opacity', 1);
      const cdf = (k) => { const a = R.spendSamples[k]; let c = 0; for (const z of a) if (z <= v) c++; return c / a.length; };
      tip.innerHTML = `<b>Org spend ≤ ${money(v, 0)}</b>` + ['flat', 'hard', 'overbook'].map((k) => `<div><span>${LABEL[k]}</span><span>${pct(cdf(k))}</span></div>`).join('');
      tip.style.opacity = 1; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY - 12 + 'px';
    };
    svg.onmouseleave = () => { tip.style.opacity = 0; };
  } else if (chartTab === 'risk') {
    $('ctitle').textContent = `Chance of hitting quota next week: current vs ${LABEL[mode].toLowerCase()} (14 most-blocked members)`;
    const rows = R.sim.members.map((mm, i) => ({ mm, i, a: R.pred.sorted[i] })).filter((r) => r.a).map((r) => ({ ...r, cur: Q.pExceedS(r.a, R.quotas.flat[r.i]), nw: Q.pExceedS(r.a, R.quotas[mode][r.i]) })).sort((a, b) => b.cur - a.cur).slice(0, 14);
    const mm = { l: 150, r: 30, t: 6, b: 24 }, bh = (H - mm.t - mm.b) / rows.length;
    const x = (v) => mm.l + v * (W - mm.l - mm.r);
    let g = '';
    for (let v = 0; v <= 1.0001; v += 0.25) g += `<line x1="${x(v)}" x2="${x(v)}" y1="${mm.t}" y2="${H - mm.b}" stroke="#e2e2e2" stroke-dasharray="4 4"/><text x="${x(v)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#999">${pct(v, 0)}</text>`;
    rows.forEach((r, k) => {
      const yy = mm.t + k * bh;
      g += `<text x="${mm.l - 10}" y="${yy + bh / 2 + 4}" text-anchor="end" font-size="11" fill="#555">${r.mm.name}</text>`;
      g += `<rect x="${mm.l}" y="${yy + bh * 0.18}" width="${Math.max(1, x(r.cur) - mm.l)}" height="${bh * 0.3}" rx="2" fill="#d5d9e0"/>`;
      g += `<rect x="${mm.l}" y="${yy + bh * 0.52}" width="${Math.max(1, x(r.nw) - mm.l)}" height="${bh * 0.3}" rx="2" fill="#0086ff"/>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
    $('clegend').innerHTML = `<span><i style="background:#d5d9e0"></i>Current flat quota ${money(R.sim.flatQuota(Q.WEEKS), 2)}</span><span><i style="background:#0086ff"></i>${LABEL[mode]}</span>`;
  } else {
    $('ctitle').textContent = 'Replay: members blocked per week when each policy is deployed from Aug 17 (simulator truth)';
    const rows = R.replay.rows, n = rows.length, ymax = Math.ceil(Math.max(...rows.map((r) => r.flat.blocked)) / 5) * 5 + 5;
    const bw = (W - m.l - m.r) / n, y = (v) => m.t + (1 - v / ymax) * (H - m.t - m.b);
    let g = axisY(W, m, H, 0, ymax, 5, y, (v) => v);
    rows.forEach((r, k) => {
      const x0 = m.l + k * bw;
      g += `<rect x="${x0 + bw * 0.2}" y="${y(r.flat.blocked)}" width="${bw * 0.27}" height="${y(0) - y(r.flat.blocked)}" rx="2" fill="#d5d9e0"/>`;
      g += `<rect x="${x0 + bw * 0.53}" y="${y(r[mode].blocked)}" width="${bw * 0.27}" height="${Math.max(1, y(0) - y(r[mode].blocked))}" rx="2" fill="#0086ff"/>`;
      if (r[mode].over) g += `<circle cx="${x0 + bw * 0.665}" cy="${y(r[mode].blocked) - 9}" r="3.5" fill="#f04438"/>`;
      g += `<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#999">${iso(Q.weekStart(r.week)).slice(5)}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
    $('clegend').innerHTML = `<span><i style="background:#d5d9e0"></i>Current flat quotas · ${R.replay.flat.blocked} blocked</span><span><i style="background:#0086ff"></i>${LABEL[mode]} · ${R.replay[mode].blocked} blocked</span><span><i style="background:#f04438;border-radius:50%"></i>Week over budget</span>`;
  }
}

// ---------- table ----------
function spark(i) {
  const obs = R.sim.observed[i].slice(Q.WEEKS - 12), vals = obs.map((o) => (o ? o.spend : 0));
  const mx = Math.max(...vals, 1), w = 62, h = 22;
  const pts = vals.map((v, k) => [k * w / (vals.length - 1), h - 2 - v / mx * (h - 4)]);
  const dots = obs.map((o, k) => (o && o.blocked ? `<circle cx="${pts[k][0]}" cy="${pts[k][1]}" r="2" fill="#f04438"/>` : '')).join('');
  return `<svg width="${w}" height="${h}"><path d="${pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('')}" fill="none" stroke="#0086ff" stroke-width="1.4"/>${dots}</svg>`;
}
function rows() {
  return R.sim.members.map((mm, i) => ({ mm, i, a: R.pred.sorted[i] })).filter((r) => r.a)
    .filter((r) => deptF < 0 || r.mm.dept === deptF)
    .filter((r) => !query || (r.mm.name + ' ' + r.mm.email).toLowerCase().includes(query))
    .map((r) => ({ ...r, cur: Q.pExceedS(r.a, R.quotas.flat[r.i]), nw: Q.pExceedS(r.a, R.quotas[mode][r.i]), blockedWeeks: R.sim.observed[r.i].slice(Q.WEEKS - 12).filter((o) => o && o.blocked).length, seen: R.sim.observed[r.i].slice(Q.WEEKS - 12).filter(Boolean).length }))
    .sort((a, b) => b.cur - a.cur || b.a[Math.floor(b.a.length / 2)] - a.a[Math.floor(a.a.length / 2)]);
}
function riskBadge(p) { const cls = p > 0.25 ? 'bad' : p > 0.08 ? 'warn' : 'ok'; return `<span class="badge ${cls}">${pct(p, 0)}</span>`; }
function table() {
  const all = rows(), pages = Math.max(1, Math.ceil(all.length / PER)); page = Math.min(page, pages - 1);
  const slice = all.slice(page * PER, page * PER + PER);
  $('records').textContent = `${all.length} records`;
  $('showing').textContent = `Showing ${all.length ? page * PER + 1 : 0} to ${Math.min(all.length, page * PER + PER)} of ${all.length} entries`;
  document.querySelector('.pg b').textContent = page + 1;
  $('applyAll').innerHTML = applied ? '<i data-lucide="check"></i>Quotas Applied' : '<i data-lucide="check"></i>Apply Recommended Quotas';
  $('applyAll').classList.toggle('done', applied);
  $('tbl').innerHTML = `<thead><tr><th style="width:34px"><span class="cbx"></span></th><th>Name</th><th>Role</th><th>Last 12 Weeks</th><th class="r">Weeks Blocked</th><th class="r">Forecast P50 / P90</th><th class="r">Current Quota</th><th class="r">${mode === 'flat' ? 'Quota' : LABEL[mode]}</th><th>Blocking Risk</th><th>Actions</th></tr></thead><tbody>` +
    slice.map((r) => {
      const qc = R.quotas.flat[r.i], qn = R.quotas[mode][r.i];
      const role = r.mm.role === 'Super Admin' ? 'super' : r.mm.role === 'Admin' ? 'admin' : '';
      return `<tr><td><span class="cbx"></span></td><td><div class="nm">${r.mm.name}<small>${R.sim.depts[r.mm.dept]} · ${r.mm.email}</small></div></td><td><span class="badge ${role}">${r.mm.role}</span></td><td class="spark">${spark(r.i)}</td>
        <td class="r">${r.blockedWeeks} / ${r.seen}</td><td class="r">${money(Q.quantileS(r.a, 0.5), 0)} / ${money(Q.quantileS(r.a, 0.9), 0)}</td><td class="r">${money(qc, 2)}</td>
        <td class="r"><span class="recq ${qn > qc + 0.5 ? 'up' : 'down'}">${money(qn, 0)}</span></td>
        <td><span class="risk">${riskBadge(r.cur)}<span class="arrow">→</span>${riskBadge(r.nw)}</span></td>
        <td><span class="lnk">Apply</span><span class="lnk">Quota Logs</span></td></tr>`;
    }).join('') + '</tbody>';
}

// ---------- events ----------
function wire() {
  document.querySelectorAll('#modeTabs button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
  document.querySelectorAll('#chartTabs button').forEach((b) => b.addEventListener('click', () => { chartTab = b.dataset.c; drawChart(); }));
  R.sim.depts.forEach((d, k) => { const o = document.createElement('option'); o.value = k; o.textContent = d; $('dept').appendChild(o); });
  $('dept').addEventListener('change', (e) => { deptF = +e.target.value; page = 0; table(); icons(); });
  $('q').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); page = 0; table(); icons(); });
  $('alpha').addEventListener('change', (e) => { alpha = +e.target.value; reallocate(); mode = 'overbook'; render(); toast(`Re-planned for ${pct(1 - alpha, 0)} budget confidence: quotas sum to ${money(R.summ.overbook.sumQuotas, 0)}`); });
  $('reset').addEventListener('click', () => { $('q').value = ''; query = ''; $('dept').value = '-1'; deptF = -1; page = 0; table(); icons(); });
  $('applyAll').addEventListener('click', () => { applied = !applied; table(); icons(); if (applied) toast(`${R.model.fits.filter(Boolean).length} member quotas updated for the week of ${dfmt(Q.weekStart(Q.WEEKS))}`); });
  $('export').addEventListener('click', () => {
    const lines = ['name,email,department,current_quota,recommended_quota,p_block_current,p_block_recommended'];
    rows().forEach((r) => lines.push([r.mm.name, r.mm.email, R.sim.depts[r.mm.dept], R.quotas.flat[r.i], R.quotas.overbook[r.i], r.cur.toFixed(3), Q.pExceedS(r.a, R.quotas.overbook[r.i]).toFixed(3)].join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = 'quota-plan.csv'; a.click();
  });
  document.querySelector('.pg').addEventListener('click', (e) => {
    const icon = e.target.closest('svg'); if (!icon) return;
    const all = rows().length, pages = Math.ceil(all / PER);
    page = icon === document.querySelectorAll('.pg svg')[0] ? Math.max(0, page - 1) : Math.min(pages - 1, page + 1); table(); icons();
  });
  window.addEventListener('resize', () => R && drawChart());
}
let tt; function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2400); }

icons();
requestAnimationFrame(() => setTimeout(() => { compute(); wire(); render(); window.__ready = true; }, 10));
