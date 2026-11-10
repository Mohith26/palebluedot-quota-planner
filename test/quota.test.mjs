import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../core/quota.js';

test('normal CDF and inverse agree', () => {
  for (const p of [0.001, 0.05, 0.3, 0.5, 0.8, 0.975, 0.9999]) assert.ok(Math.abs(Q.Phi(Q.PhiInv(p)) - p) < 1e-6, String(p));
  assert.ok(Math.abs(Q.Phi(1.959964) - 0.975) < 1e-5);
});

test('simulate is deterministic and censors at the quota', () => {
  const a = Q.simulate(5), b = Q.simulate(5);
  assert.equal(JSON.stringify(a.observed[3]), JSON.stringify(b.observed[3]));
  a.members.forEach((m, i) => a.observed[i].forEach((o, w) => {
    if (!o) return;
    const d = a.demand[i][w];
    assert.ok(o.spend <= o.quota + 1e-9);
    assert.equal(o.blocked, d > o.quota);
  }));
});

// One synthetic member with known lognormal demand, heavily censored.
function oneMember(mu, sigma, quota, weeks, seed) {
  const r = Q.rng(seed);
  const obs = [];
  for (let w = 0; w < weeks; w++) {
    const d = Math.exp(mu + sigma * Q.normal(r));
    obs.push({ spend: Math.min(d, quota), quota, blocked: d > quota });
  }
  return obs;
}

test('censored EM recovers the mean even when most weeks hit the quota', () => {
  const mu = Math.log(120), sigma = 0.5, quota = 100; // ~64% of weeks blocked
  const obs = oneMember(mu, sigma, quota, 400, 7);
  const sim = { members: [{ dept: 0, join: 0 }], depts: ['X'], observed: [obs] };
  const m = Q.fitModel(sim, 400, { halfLife: 1e9 });
  const f = m.fits[0];
  assert.ok(f.censored > 200);
  assert.ok(Math.abs(f.mu - mu) < 0.08, `mu ${f.mu} vs ${mu}`);
  // naive: treat blocked weeks as if spend were demand -> biased low
  const naive = obs.reduce((a, o) => a + Math.log(o.spend), 0) / obs.length;
  assert.ok(naive < mu - 0.2);
});

test('a positive adoption trend is detected', () => {
  const r = Q.rng(3);
  const obs = Array.from({ length: 26 }, (_, w) => { const d = Math.exp(Math.log(30) + 0.04 * w + 0.15 * Q.normal(r)); return { spend: d, quota: 1e9, blocked: false }; });
  const sim = { members: [{ dept: 0, join: 0 }], depts: ['X'], observed: [obs] };
  const f = Q.fitModel(sim, 26).fits[0];
  assert.ok(f.slope > 0.015, `slope ${f.slope}`);
});

test('empirical helpers', () => {
  const s = Float64Array.from([0, 10, 20, 30, 40]);
  assert.equal(Q.pExceedS(s, 20), 0.4);
  assert.equal(Q.shortS(s, 25), (5 + 15) / 5);
  assert.equal(Q.quantileS(s, 0.5), 20);
});

test('strict-cap allocation sums to the budget and equalizes blocking probability', () => {
  const R = Q.run({ S: 1500, replayWeeks: [24, 25] });
  const sum = R.quotas.hard.reduce((a, b) => a + (b ?? 0), 0);
  assert.ok(sum <= R.sim.budget && sum >= R.sim.budget - 60);
  const ps = R.pred.sorted.map((a, i) => (a && R.quotas.hard[i] > 5 ? Q.pExceedS(a, R.quotas.hard[i]) : null)).filter((x) => x != null);
  const spread = Math.max(...ps) - Math.min(...ps);
  assert.ok(spread < 0.06, `blocking probabilities spread ${spread}`);
  assert.ok(R.summ.hard.unserved < R.summ.flat.unserved);
});

test('overbooked plan respects the in-sample budget risk and beats flat quotas', () => {
  const R = Q.run({ S: 2000, replayWeeks: [22, 23, 24, 25] });
  assert.ok(R.summ.overbook.pOverBudget <= 0.05 + 1e-9);
  assert.ok(R.summ.overbook.sumQuotas > R.sim.budget, 'quotas can add up to more than the budget');
  assert.ok(R.summ.overbook.blockedRate < R.summ.flat.blockedRate / 3);
  assert.ok(R.replay.overbook.blocked < R.replay.flat.blocked);
});

test('allocation is optimal against random feasible reallocations (strict cap)', () => {
  const R = Q.run({ S: 1500, replayWeeks: [25] });
  const base = R.quotas.hard, pred = R.pred;
  const cost = (q) => pred.sorted.reduce((a, s, i) => a + (s ? Q.shortS(s, q[i]) : 0), 0);
  const c0 = cost(base);
  const r = Q.rng(1);
  const idx = base.map((q, i) => (q != null ? i : -1)).filter((i) => i >= 0);
  for (let k = 0; k < 200; k++) {
    const i = idx[Math.floor(r() * idx.length)], j = idx[Math.floor(r() * idx.length)]; if (i === j) continue;
    const delta = Math.min(base[i] - 5, 1 + Math.floor(r() * 20)); if (delta <= 0) continue;
    const q = base.slice(); q[i] -= delta; q[j] += delta; // same total
    assert.ok(cost(q) >= c0 - 0.5, `move ${delta} from ${i} to ${j} improved ${c0} -> ${cost(q)}`);
  }
});
