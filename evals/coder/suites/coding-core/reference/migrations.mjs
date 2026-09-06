export async function migrate(db, steps) {
  await db.begin();
  try {
    for (const step of steps) { await step.up(db); }
    await db.commit();
  } catch (error) {
    try { await db.rollback(); } catch { /* Preserve the original failure. */ }
    throw error;
  }
}
