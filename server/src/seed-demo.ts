// Dev-only: seed the six demo projects (and their members) from the approved mock.
// Usage: npm run seed:demo   (no-op if any project already exists; refuses in production)
import { ConfigError, loadConfig } from './config.js';
import { createPool, withTx } from './db.js';
import { runMigrations } from './migrate.js';

const PROJECTS = [
  {
    title: 'Kokosing sediment buoy',
    blurb: 'A floating ESP32 rig that logs turbidity and temperature down the river, plotted against the BFEC rain gauge.',
    fields: ['cs', 'env'], cap: 4, need: 'Someone comfortable waterproofing electronics',
    members: [['Maya Ortiz', 'Kenyon College'], ['Theo Brandt', 'Denison University'], ['Ana Petrov', 'Kenyon College']],
  },
  {
    title: 'Greenslade manuscript OCR',
    blurb: 'Fine-tuning handwriting recognition on nineteenth-century Ohio letters so the archive is finally searchable.',
    fields: ['cs', 'hum'], cap: 4, need: 'A history major who can read bad cursive',
    members: [['Julian Reyes', 'Oberlin College'], ['Priya Nair', 'Kenyon College']],
  },
  {
    title: 'Birdsong classifier for the BFEC',
    blurb: 'A microphone box at the field station that tags species in real time and posts a daily list.',
    fields: ['cs', 'bio'], cap: 5, need: 'Anyone who has trained a small model before',
    members: [
      ['Sam Whitfield', 'The College of Wooster'], ['Grace Lim', 'Kenyon College'],
      ['Owen Marks', 'Ohio Wesleyan University'], ['Dee Cardoso', 'Denison University'],
    ],
  },
  {
    title: 'Sonifying seismic data',
    blurb: 'Turning a year of Ohio microquake records into a listenable score, performed live at the closing.',
    fields: ['cs', 'art', 'phy'], cap: 3, need: 'A composer, or anyone with Ableton',
    members: [['Lena Fischer', 'Oberlin College']],
  },
  {
    title: 'Chalmers room occupancy',
    blurb: 'Cheap PIR sensors plus a small model that predicts which study rooms are free before you walk over.',
    fields: ['cs', 'soc'], cap: 4, need: 'Someone who likes survey design',
    members: [['Noah Ellis', 'Kenyon College'], ['Iris Kwon', 'Kenyon College']],
  },
  {
    title: 'Peirce waste weigh-in',
    blurb: 'A scale under the dish return that tracks food waste by meal and puts the number on a hallway display.',
    fields: ['cs', 'env', 'soc'], cap: 5, need: 'Hardware people and one strong writer',
    members: [['Marcus Bell', 'Denison University'], ['Ruth Adeyemi', 'Ohio Wesleyan University'], ['Kai Tanaka', 'The College of Wooster']],
  },
];

const emailFor = (name: string) => name.toLowerCase().split(/\s+/).join('.') + '@example.edu';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed] refusing to seed demo data with NODE_ENV=production');
    process.exit(1);
  }
  const config = loadConfig(process.env);
  const pool = createPool(config);
  try {
    await runMigrations(pool);
    const done = await withTx(pool, async (c) => {
      await c.query('LOCK TABLE projects IN EXCLUSIVE MODE');
      const n = await c.query<{ n: number }>('SELECT count(*) AS n FROM projects');
      if (n.rows[0]!.n > 0) return false;
      let order = 0;
      for (const [i, p] of PROJECTS.entries()) {
        const userIds: number[] = [];
        for (const [name, college] of p.members) {
          const u = await c.query<{ id: number }>(
            `INSERT INTO users (name, email, college, accepted_ai_policy, accepted_waiver, email_verified_at)
             VALUES ($1, $2, $3, true, true, now())
             ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [name, emailFor(name!), college],
          );
          userIds.push(u.rows[0]!.id);
        }
        // Earlier mock projects get later created_at so they list first (state is newest-first).
        const proj = await c.query<{ id: number }>(
          `INSERT INTO projects (title, blurb, fields, cap, need, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() - make_interval(mins => $7))
           RETURNING id`,
          [p.title, p.blurb, p.fields, p.cap, p.need, userIds[0], i],
        );
        for (const uid of userIds) {
          order++;
          await c.query(
            `UPDATE users SET project_id = $1, team_joined_at = now() - interval '1 hour' + make_interval(secs => $2)
              WHERE id = $3`,
            [proj.rows[0]!.id, order, uid],
          );
        }
      }
      return true;
    });
    console.log(done ? `[seed] inserted ${PROJECTS.length} demo projects` : '[seed] projects already exist — nothing to do');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof ConfigError ? `[config] ${err.message}` : `[seed] ${(err as Error).message}`);
  process.exit(1);
});
