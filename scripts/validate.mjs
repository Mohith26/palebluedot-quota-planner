// Robustness: the full pipeline (fit, plan, sequential 12-week replay) on freshly simulated orgs.
import * as Q from '../core/quota.js';
const seeds = process.argv.slice(2).map(Number); if (!seeds.length) seeds.push(1, 2, 3, 4, 5, 6);
let over = 0, weeks = 0;
for (const seed of seeds) {
  const R = Q.run({ seed, S: 3000, alpha: +(process.env.ALPHA || 0.05) });
  const r = R.replay; over += r.overbook.overWeeks; weeks += r.rows.length;
  console.log(`seed ${seed}: blocked member-weeks flat ${(100 * r.flat.rate).toFixed(1)}% | strict cap ${(100 * r.hard.rate).toFixed(1)}% | planner ${(100 * r.overbook.rate).toFixed(1)}% | unserved $${r.flat.unserved.toFixed(0)} -> $${r.overbook.unserved.toFixed(0)} | over budget ${r.overbook.overWeeks}/${r.rows.length} weeks | 80% interval coverage ${(100 * r.coverage).toFixed(1)}%`);
}
console.log(`planner over-budget weeks: ${over}/${weeks} (${(100 * over / weeks).toFixed(1)}%, target 5%)`);
