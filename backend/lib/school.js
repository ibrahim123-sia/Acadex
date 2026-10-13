const pool = require('../db/pool');

// Display and locale settings of a school (cached per request by callers if needed).
async function schoolSettings(schoolId, db = pool) {
  const { rows } = await db.query(
    'SELECT id, name, primary_color, currency, timezone, locale FROM schools WHERE id=$1', [schoolId]);
  return rows[0] || null;
}

module.exports = { schoolSettings };
