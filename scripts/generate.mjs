// Writes the seeded synthetic org (observed usage, as the console would see it) and headline results to data/.
import { writeFileSync, mkdirSync } from 'node:fs';
import * as Q from '../core/quota.js';
const seed = +(process.argv[2] ?? 20261109);
const R = Q.run({ seed });
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/org.json', import.meta.url), JSON.stringify({ seed, budget: R.sim.budget, weekStart: Q.weekStart(0).toISOString().slice(0, 10), depts: R.sim.depts,
  members: R.sim.members.map((m, i) => ({ name: m.name, email: m.email, dept: R.sim.depts[m.dept], role: m.role, observed: R.sim.observed[i] })) }));
const pick = (s) => ({ blockedRateNextWeek: +s.blockedRate.toFixed(4), expectedSpendP50: Math.round(s.spendP50), pOverBudget: +s.pOverBudget.toFixed(4), sumQuotas: Math.round(s.sumQuotas), unservedNextWeek: Math.round(s.unserved) });
const rp = (r) => ({ blocked: r.blocked, memberWeeks: r.n, rate: +r.rate.toFixed(4), unserved: Math.round(r.unserved), spend: Math.round(r.spend), overBudgetWeeks: r.overWeeks });
const summary = { seed, budget: R.sim.budget, members: R.model.fits.filter(Boolean).length, flatQuota: R.sim.flatQuota(Q.WEEKS),
  nextWeek: { flat: pick(R.summ.flat), strictCap: pick(R.summ.hard), recommended95: pick(R.summ.overbook) },
  replay12Weeks: { flat: rp(R.replay.flat), strictCap: rp(R.replay.hard), recommended95: rp(R.replay.overbook), coverage80: +R.replay.coverage.toFixed(4) },
  historyBlockedSinceWeek13: R.sim.observed.flatMap((r) => r.slice(13)).filter((o) => o && o.blocked).length + ' of ' + R.sim.observed.flatMap((r) => r.slice(13)).filter(Boolean).length };
writeFileSync(new URL('../data/summary.json', import.meta.url), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
