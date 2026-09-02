/**
 * 99_rollback.js — 10_fix_data.js 的整批回滚（幂等，可重复执行）
 * 用法：
 *   node scripts/99_rollback.js          # 按 data_fix_backup 中 BATCH 镜像回滚（保留备份行作审计）
 *   node scripts/99_rollback.js purge    # 回滚并删除该批次备份行
 * 回滚顺序：先删除本批新增行(op=I)，再按备份倒序把更新行(op=U)整行还原为镜像。
 */
const { loadPool } = require('./_db');
const pool = loadPool();
const BATCH = 'B20260902';
const PURGE = process.argv[2] === 'purge';

(async () => {
  try {
    const exist = await pool.query(`SELECT to_regclass('data_fix_backup') AS t`);
    if (!exist.rows[0].t) { console.log('data_fix_backup 不存在，无需回滚'); return; }
    const rows = (await pool.query(
      `SELECT id, op, tbl, pk, old FROM data_fix_backup WHERE batch=$1 ORDER BY id DESC`, [BATCH])).rows;
    console.log(`批次 ${BATCH} 共 ${rows.length} 条镜像，开始回滚…`);

    // 1) 先删新增（倒序无所谓，删除幂等）
    let delN = 0;
    for (const r of rows.filter(x => x.op === 'I')) {
      const d = await pool.query(`DELETE FROM ${r.tbl} WHERE id::text=$1`, [r.pk]);
      delN += d.rowCount;
      console.log(`  [I] 删除 ${r.tbl}.${r.pk}：${d.rowCount} 行`);
    }

    // 2) 更新行整行还原（倒序；jsonb_populate_record 按行类型自动还原每一列）
    let upN = 0;
    const colCache = {};
    for (const r of rows.filter(x => x.op === 'U')) {
      if (!colCache[r.tbl]) {
        const c = await pool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [r.tbl]);
        colCache[r.tbl] = c.rows.map(x => x.column_name);
      }
      const cols = colCache[r.tbl].filter(k => k !== 'id'); // id 作定位键
      const setList = cols.map(k => `"${k}"`).join(',');
      const selList = cols.map(k => `x."${k}"`).join(',');
      const sql = `UPDATE ${r.tbl} SET (${setList}) =
                   (SELECT ${selList} FROM jsonb_populate_record(NULL::${r.tbl}, $1) x)
                   WHERE id::text=$2`;
      const u = await pool.query(sql, [r.old, r.pk]);
      upN += u.rowCount;
    }
    console.log(`  [U] 整行还原完成：${upN} 行；[I] 删除 ${delN} 行`);

    if (PURGE) {
      const p = await pool.query(`DELETE FROM data_fix_backup WHERE batch=$1`, [BATCH]);
      console.log(`purge：已删除批次备份 ${p.rowCount} 行`);
    } else {
      console.log('备份镜像保留在 data_fix_backup（加 purge 参数可一并清除）');
    }
    console.log('=== 回滚完成 ===');
  } catch (e) {
    console.error('回滚失败，错误信息 100% 保留：', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
