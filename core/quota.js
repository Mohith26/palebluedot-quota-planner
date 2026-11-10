// Quota Planner core: censored demand model, quota allocation, replay evaluation.
// Pure ES module, no dependencies. Runs in the browser and under `node --test`.

// ---------- utilities ----------
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normal(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
const SQ2 = Math.SQRT2;
function erf(x) { // Abramowitz-Stegun 7.1.26 refined with one Newton-free series switch
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const Phi = (z) => 0.5 * (1 + erf(z / SQ2));
export const phi = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
export function PhiInv(p) { // Acklam's rational approximation + one Halley step
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425; let x;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - pl) { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const e = Phi(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}
export function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const r2 = (x) => Math.round(x * 100) / 100;

// ---------- synthetic organization ----------
export const DEPTS = [
  { name: 'Engineering', n: 24, base: 64, member: 0.5, sigma: 0.55, burst: 0.10 },
  { name: 'Data & ML', n: 10, base: 88, member: 0.45, sigma: 0.75, burst: 0.12 },
  { name: 'Product & Design', n: 12, base: 30, member: 0.45, sigma: 0.5, burst: 0.05 },
  { name: 'Support & Ops', n: 14, base: 15, member: 0.4, sigma: 0.4, burst: 0.03 },
];
const FIRST = ['Ava', 'Ben', 'Chloe', 'Daniel', 'Elena', 'Farah', 'Gabriel', 'Hana', 'Isaac', 'Jia', 'Kofi', 'Lena', 'Marcus', 'Nadia', 'Omar', 'Priya', 'Quinn', 'Rafael', 'Sofia', 'Tariq', 'Uma', 'Victor', 'Wen', 'Ximena', 'Yusuf', 'Zoe', 'Aiden', 'Bianca', 'Caleb', 'Divya', 'Ethan', 'Fiona', 'Grace', 'Hiro', 'Ines', 'Jonah', 'Keira', 'Liam', 'Maya', 'Noah', 'Olivia', 'Pablo', 'Rhea', 'Sam', 'Tessa', 'Umar', 'Vera', 'Will', 'Yara', 'Zane', 'Amir', 'Bea', 'Cyrus', 'Dana', 'Eli', 'Freya', 'Gus', 'Ivy', 'Jules', 'Kai'];
const LAST = ['Chen', 'Okafor', 'Silva', 'Nakamura', 'Patel', 'Kim', 'Rossi', 'Haddad', 'Novak', 'Garcia', 'Mensah', 'Larsen', 'Ivanova', 'Ortiz', 'Shah', 'Murphy', 'Tanaka', 'Moreau', 'Singh', 'Brooks', 'Weber', 'Costa', 'Ahmed', 'Park', 'Fischer', 'Reyes', 'Kowalski', 'Lindqvist', 'Adeyemi', 'Ito'];

export const WEEKS = 26;           // weeks of history (week 0 .. 25); week 26 is next week
export const START = Date.UTC(2026, 4, 11); // Mon May 11 2026 = week 0; week 26 starts Mon Nov 9 2026
export const weekStart = (w) => new Date(START + w * 7 * 86400000);

export function simulate(seed = 20261109, opts = {}) {
  const r = rng(seed);
  const budget = opts.budget ?? 5500;
  const members = [];
  let k = 0;
  DEPTS.forEach((d, di) => {
    for (let j = 0; j < d.n; j++, k++) {
      const name = FIRST[k % FIRST.length] + ' ' + LAST[(k * 7 + 3) % LAST.length];
      const join = r() < 0.12 ? 6 + Math.floor(r() * 14) : 0; // some members joined later
      const ramp = r() < 0.25 ? 0.025 + 0.035 * r() : 0;       // adoption still growing
      members.push({
        id: 'm' + k, name, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@northwind.dev', dept: di,
        role: k === 0 ? 'Super Admin' : (j === 0 ? 'Admin' : 'Member'),
        mu: Math.log(d.base) + d.member * normal(r) - (ramp ? ramp * 12 : 0),
        sigma: d.sigma * (0.8 + 0.4 * r()), burst: d.burst, ramp, join,
        pto: 0.04 + 0.03 * r(),
      });
    }
  });
  // flat quota policy in force: $50/week until week 13, then budget / members
  const flatQuota = (w) => (w < 13 ? 50 : r2(budget / members.length));
  const demand = members.map((m) => {
    const out = [];
    for (let w = 0; w <= WEEKS; w++) { // includes next week (truth only)
      if (w < m.join) { out.push(null); continue; }
      if (r() < m.pto) { out.push(0); continue; }
      let x = Math.exp(m.mu + m.ramp * w + m.sigma * normal(r));
      if (r() < m.burst) x *= 2 + 2 * r(); // agent runs, batch jobs
      out.push(r2(x));
    }
    return out;
  });
  const observed = members.map((m, i) => demand[i].slice(0, WEEKS).map((x, w) => {
    if (x === null) return null;
    const q = flatQuota(w);
    return { spend: r2(Math.min(x, q)), quota: q, blocked: x > q };
  }));
  return { seed, budget, members, depts: DEPTS.map((d) => d.name), flatQuota, demand, observed };
}

// ---------- censored lognormal model with department pooling ----------
// Weekly spend of member i: 0 with prob p0 (PTO, no use), otherwise LogNormal(mu, sigma).
// Weeks that hit the quota are right-censored: true demand was at least the quota.
// Fit by EM (Tobit on log scale), recency-weighted, with MAP shrinkage toward the department.
function fitOne(obs, upto, prior, opts) {
  const hl = opts.halfLife ?? 12;
  const ys = [];
  let zeros = 0, tot = 0;
  for (let w = 0; w < upto; w++) {
    const o = obs[w]; if (!o) continue;
    const wt = Math.pow(0.5, (upto - 1 - w) / hl);
    tot += wt;
    if (o.spend <= 0.005 && !o.blocked) { zeros += wt; continue; }
    ys.push({ y: Math.log(Math.max(o.spend, 0.01)), c: o.blocked, wt, x: w - upto }); // x = 0 is the week being forecast
  }
  const p0 = (zeros + 2 * prior.p0) / (tot + 2);
  let a = prior.mu, b = 0, s2 = prior.s2;
  if (!ys.length) return { mu: a, slope: 0, sigma: Math.sqrt(s2), p0, n: 0, censored: 0, resid: [] };
  const kMu = opts.kMu ?? 1.5, kS = opts.kS ?? 3;
  const kB = opts.kB ?? s2 / (0.02 * 0.02); // trend prior: N(0, 0.02^2) per week on the log scale (about +-2%/week)
  for (let it = 0; it < 400; it++) {
    const sd = Math.sqrt(s2);
    let Sw = 0, Sx = 0, Sxx = 0, Sy = 0, Sxy = 0;
    const E = ys.map((o) => {
      const m = a + b * o.x;
      let ey = o.y, eyy = o.y * o.y;
      if (o.c) {
        const z = (o.y - m) / sd, tail = Math.max(1 - Phi(z), 1e-12), lam = phi(z) / tail;
        ey = m + sd * lam;
        eyy = m * m + s2 + sd * (m + o.y) * lam;
      }
      Sw += o.wt; Sx += o.wt * o.x; Sxx += o.wt * o.x * o.x; Sy += o.wt * ey; Sxy += o.wt * o.x * ey;
      return [ey, eyy];
    });
    // MAP for (a, b): ridge toward (prior.mu, 0); a is the level at the forecast week
    const A11 = Sw + kMu, A12 = Sx, A22 = Sxx + kB * s2 / prior.s2;
    const r1 = Sy + kMu * prior.mu, r2_ = Sxy;
    const det = A11 * A22 - A12 * A12;
    const aN = (r1 * A22 - A12 * r2_) / det, bN = (A11 * r2_ - A12 * r1) / det;
    let ss = 0;
    ys.forEach((o, k) => { const m = aN + bN * o.x; ss += o.wt * (E[k][1] - 2 * m * E[k][0] + m * m); });
    s2 = Math.min(Math.max((ss + kS * prior.s2) / (Sw + kS), 0.02), 4);
    const done = Math.abs(aN - a) + Math.abs(bN - b) < 1e-8;
    a = aN; b = bN;
    if (done) break;
  }
  const n = ys.reduce((acc, o) => acc + o.wt, 0);
  const sd = Math.sqrt(s2);
  const resid = ys.filter((o) => !o.c).map((o) => (o.y - (a + b * o.x)) / sd); // standardized, uncensored weeks
  return { mu: a, slope: b, sigma: sd, p0, n, censored: ys.filter((o) => o.c).length, resid };
}

export function fitModel(sim, upto = WEEKS, opts = {}) {
  const { members, observed } = sim;
  const active = (i) => members[i].join < upto;
  // pass 1: weak global prior
  const glob = { mu: Math.log(40), s2: 0.6, p0: 0.05 };
  const p1 = members.map((m, i) => (active(i) ? fitOne(observed[i], upto, glob, { ...opts, kMu: 0.2, kS: 1 }) : null));
  // department priors from pass-1 estimates (method of moments, floor on between-member variance)
  const priors = sim.depts.map((_, d) => {
    const fits = p1.filter((f, i) => f && f.n > 0 && members[i].dept === d);
    const mus = fits.map((f) => f.mu), m = mus.reduce((a, b) => a + b, 0) / Math.max(1, mus.length);
    const v = mus.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, mus.length - 1);
    const s2 = fits.map((f) => f.sigma ** 2).sort((a, b) => a - b)[Math.floor(fits.length / 2)] ?? 0.4;
    const p0 = fits.reduce((a, f) => a + f.p0, 0) / Math.max(1, fits.length);
    return { mu: m, tau2: Math.max(v, 0.05), s2, p0 };
  });
  const fits = members.map((m, i) => {
    if (!active(i)) return null;
    const pr = priors[m.dept];
    // kMu = s2 / tau2 makes the shrinkage the Bayesian posterior mean under N(mu_d, tau2)
    const f = fitOne(observed[i], upto, { mu: pr.mu, s2: pr.s2, p0: pr.p0 }, { ...opts, kMu: pr.s2 / pr.tau2, kS: 3 });
    // predictive spread includes uncertainty in mu
    const seMu2 = f.sigma ** 2 / (f.n + pr.s2 / pr.tau2);
    return { ...f, dept: m.dept, s: Math.sqrt(f.sigma ** 2 + seMu2) };
  });
  // Pooled standardized residuals: they carry the heavy right tail (agent runs, batch jobs) that a
  // lognormal misses. Only members who almost never hit their quota contribute (a censored member's
  // visible weeks are its low weeks), pooled org-wide and re-standardized to mean 0, sd 1.
  const raw = fits.flatMap((f) => (f && f.resid.length >= 6 && f.censored <= 0.1 * (f.censored + f.resid.length) ? f.resid : []));
  const m0 = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  const sd0 = Math.sqrt(raw.reduce((a, b) => a + (b - m0) ** 2, 0) / Math.max(1, raw.length - 1)) || 1;
  const pool = raw.map((e) => (e - m0) / sd0);
  const pools = sim.depts.map(() => pool);
  return { upto, fits, priors, pools };
}

// ---------- predictive samples ----------
// Next-week demand draws per member: 0 with prob p0, else exp(mu + sd_mu * z + sigma * e), where e is
// resampled from the member's department pool of standardized residuals (normal if the pool is small).
// Draw s is independent across members, so column s of all members is one joint scenario.
export function predictive(model, S, seed) {
  const r = rng(seed);
  const n = model.fits.length, raw = model.fits.map((f) => (f ? new Float64Array(S) : null));
  model.fits.forEach((f, i) => {
    if (!f) return;
    const pool = model.pools[f.dept ?? 0] ?? [];
    const seMu = Math.sqrt(Math.max(f.s * f.s - f.sigma * f.sigma, 0));
    for (let s = 0; s < S; s++) {
      if (r() < f.p0) { raw[i][s] = 0; continue; }
      const e = pool.length >= 30 ? pool[Math.floor(r() * pool.length)] + 0.15 * normal(r) : normal(r);
      raw[i][s] = Math.exp(f.mu + seMu * normal(r) + f.sigma * e);
    }
  });
  const sorted = raw.map((a) => (a ? Float64Array.from(a).sort() : null));
  return { S, n, raw, sorted };
}
export function pExceedS(sorted, q) { // P(D > q)
  let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= q) lo = m + 1; else hi = m; }
  return (sorted.length - lo) / sorted.length;
}
export function quantileS(sorted, p) { return quantile(sorted, Math.min(Math.max(p, 0), 1)); }
export function shortS(sorted, q) { let t = 0; for (let k = sorted.length - 1; k >= 0 && sorted[k] > q; k--) t += sorted[k] - q; return t / sorted.length; }
export function meanS(sorted) { let t = 0; for (const x of sorted) t += x; return t / sorted.length; }
export function orgSpend(quotas, pred) {
  const out = new Float64Array(pred.S);
  pred.raw.forEach((a, i) => { if (!a || quotas[i] == null) return; for (let s = 0; s < pred.S; s++) out[s] += Math.min(a[s], quotas[i]); });
  return out;
}

// ---------- allocation ----------
// minimize sum_i E[(D_i - q_i)+]   (demand that hits a quota wall)
// hard:     subject to sum_i q_i <= B                          -> spend can never exceed B
// overbook: subject to P(sum_i min(D_i, q_i) > B) <= alpha     -> quotas may add up to more than B
// KKT: every member gets the same probability lam of hitting the quota; bisection on lam.
export function allocate(pred, budget, opts = {}) {
  const mode = opts.mode ?? 'hard', qMin = opts.qMin ?? 5, alpha = opts.alpha ?? 0.05;
  const idx = pred.sorted.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  const qs = (lam) => pred.sorted.map((a) => (a ? Math.max(qMin, quantileS(a, 1 - lam)) : null));
  const sumQ = (q) => q.reduce((a, b) => a + (b ?? 0), 0);
  const feasible = mode === 'hard'
    ? (lam) => sumQ(qs(lam)) <= budget
    : (lam) => { const sp = orgSpend(qs(lam), pred); let c = 0; for (const x of sp) if (x > budget) c++; return c / sp.length <= alpha; };
  let lo = 1e-4, hi = 0.999;
  if (feasible(lo)) hi = lo;
  for (let it = 0; it < 50 && hi / lo > 1.0005; it++) { const mid = Math.sqrt(lo * hi); if (feasible(mid)) hi = mid; else lo = mid; }
  const quotas = qs(hi).map((q) => (q == null ? null : mode === "hard" ? Math.round(q) : Math.floor(q))); // whole dollars (round down keeps the risk check valid)
  if (mode === 'hard') { // rounding may add a few dollars: trim from the largest quotas
    let over = sumQ(quotas) - budget;
    const order = idx.slice().sort((a, b) => quotas[b] - quotas[a]);
    for (let k = 0; over > 0; k = (k + 1) % order.length) { quotas[order[k]] -= 1; over -= 1; }
  }
  return { mode, lam: hi, quotas, total: sumQ(quotas), idx };
}

export function policySummary(pred, quotas, budget) {
  let blocked = 0, short = 0, demand = 0, n = 0;
  pred.sorted.forEach((a, i) => { if (!a) return; n++; blocked += pExceedS(a, quotas[i]); short += shortS(a, quotas[i]); demand += meanS(a); });
  const sp = Array.from(orgSpend(quotas, pred)).sort((a, b) => a - b);
  let over = 0; for (const x of sp) if (x > budget) over++;
  return { blockedRate: blocked / n, expectedBlocked: blocked, unserved: short, demand, expectedSpend: demand - short, pOverBudget: over / sp.length, spendP10: quantile(sp, 0.1), spendP50: quantile(sp, 0.5), spendP90: quantile(sp, 0.9), sumQuotas: quotas.reduce((a, b) => a + (b ?? 0), 0) };
}

// ---------- replay on held-out weeks (simulator truth) ----------
// Deploy each policy from week `from` onward. Every week: fit on what that policy's own history shows
// (weeks that hit a quota are censored at that quota), set next week's quotas, then apply them to the
// true demand. Weeks before `from` were observed under the flat policy for everyone.
export function replay(sim, weeks, opts = {}) {
  const from = weeks[0];
  const policies = ['flat', 'hard', 'overbook'];
  const hist = {}; // policy -> observed matrix (copy of flat history, extended as the policy runs)
  for (const p of policies) hist[p] = sim.observed.map((row) => row.slice(0, from));
  const rows = [];
  for (const t of weeks) {
    const row = { week: t };
    let cov = 0, nn = 0;
    for (const p of policies) {
      const view = { ...sim, observed: hist[p] };
      let q;
      if (p === 'flat') q = sim.members.map((m) => (m.join < t ? sim.flatQuota(t) : null));
      else {
        const model = fitModel(view, t, opts);
        const pred = predictive(model, opts.S ?? 2000, 500 + t);
        q = allocate(pred, sim.budget, p === 'hard' ? { mode: 'hard' } : { mode: 'overbook', alpha: opts.alpha ?? 0.05 }).quotas;
        if (p === 'overbook') pred.sorted.forEach((a, i) => { if (!a) return; const d = sim.demand[i][t]; if (d == null) return; nn++; if (d >= quantileS(a, 0.1) - 1e-9 && d <= quantileS(a, 0.9) + 1e-9) cov++; });
      }
      let blocked = 0, unserved = 0, spend = 0, n = 0;
      sim.members.forEach((m, i) => {
        const d = sim.demand[i][t];
        if (q[i] == null || d == null) { hist[p][i][t] = d == null ? null : { spend: 0, quota: 0, blocked: false }; return; }
        n++; if (d > q[i]) { blocked++; unserved += d - q[i]; }
        spend += Math.min(d, q[i]);
        hist[p][i][t] = { spend: r2(Math.min(d, q[i])), quota: q[i], blocked: d > q[i] };
      });
      row[p] = { blocked, unserved, spend, n, over: spend > sim.budget };
    }
    row.coverage = cov / nn; row.n = nn;
    rows.push(row);
  }
  const agg = (k) => { const s = rows.reduce((a, r) => ({ blocked: a.blocked + r[k].blocked, unserved: a.unserved + r[k].unserved, spend: a.spend + r[k].spend, n: a.n + r[k].n, overWeeks: a.overWeeks + (r[k].over ? 1 : 0) }), { blocked: 0, unserved: 0, spend: 0, n: 0, overWeeks: 0 }); return { ...s, rate: s.blocked / s.n }; };
  return { rows, flat: agg('flat'), hard: agg('hard'), overbook: agg('overbook'), coverage: rows.reduce((a, r) => a + r.coverage * r.n, 0) / rows.reduce((a, r) => a + r.n, 0) };
}

// ---------- end-to-end ----------
export function run(opts = {}) {
  const sim = simulate(opts.seed ?? 20261109, opts.sim ?? {});
  const model = fitModel(sim, WEEKS, opts.fit ?? {});
  const pred = predictive(model, opts.S ?? 4000, 4242);
  const flat = sim.members.map((m) => (m.join < WEEKS ? sim.flatQuota(WEEKS) : null));
  const hard = allocate(pred, sim.budget, { mode: 'hard' });
  const over = allocate(pred, sim.budget, { mode: 'overbook', alpha: opts.alpha ?? 0.05 });
  const summ = { flat: policySummary(pred, flat, sim.budget), hard: policySummary(pred, hard.quotas, sim.budget), overbook: policySummary(pred, over.quotas, sim.budget) };
  const rp = replay(sim, opts.replayWeeks ?? [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25], { ...(opts.fit ?? {}), alpha: opts.alpha });
  return { sim, model, pred, quotas: { flat, hard: hard.quotas, overbook: over.quotas }, lam: { hard: hard.lam, overbook: over.lam }, summ, replay: rp };
}
