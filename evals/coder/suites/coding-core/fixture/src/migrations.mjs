export async function migrate(db, steps) {
  await db.begin();
  for (const step of steps) { await step.up(db); }
  await db.commit();
}
