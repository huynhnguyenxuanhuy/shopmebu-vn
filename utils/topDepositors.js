async function ensureTopDepositorsSchema(db) {
  await db.query('CREATE INDEX idx_top_depositors_user_id ON top_depositors (user_id)').catch(() => {});

  const [indexes] = await db.query('SHOW INDEX FROM top_depositors');
  const grouped = new Map();
  for (const row of indexes) {
    if (row.Key_name === 'PRIMARY' || Number(row.Non_unique) !== 0) continue;
    if (!grouped.has(row.Key_name)) grouped.set(row.Key_name, []);
    grouped.get(row.Key_name).push(row);
  }

  for (const [keyName, rows] of grouped.entries()) {
    const columns = rows
      .sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))
      .map(row => row.Column_name);
    if (columns.length === 1 && columns[0] === 'user_id') {
      await db.query(`ALTER TABLE top_depositors DROP INDEX \`${keyName}\``).catch(() => {});
    }
  }

  await db.query(
    'ALTER TABLE top_depositors ADD UNIQUE KEY uniq_top_depositors_user_period (user_id, period)'
  ).catch(() => {});
}

async function upsertTopDepositor(db, userId, period, amount) {
  await db.query(`
    INSERT INTO top_depositors (user_id, period, total, count)
    VALUES (?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE total=total+?, count=count+1
  `, [userId, period, amount, amount]);
}

async function refreshTopDepositorRanks(db, period) {
  await db.query('SET @rank = 0');
  await db.query(
    'UPDATE top_depositors SET rank = (@rank := @rank + 1) WHERE period=? ORDER BY total DESC',
    [period]
  );
}

module.exports = {
  ensureTopDepositorsSchema,
  upsertTopDepositor,
  refreshTopDepositorRanks
};
