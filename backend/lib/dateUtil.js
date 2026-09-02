'use strict';
/**
 * dateUtil.js — D-day 纯日期计算唯一真源（api.js 与 scripts/ 共用，禁止各处复制第二份）
 * 口径：D=选举日；offset 负数=D 之前(提早,D-)，0=D 当天，正数=D 之后(D+)。
 * 只用本地年月日分量加减，禁 toISOString/UTC，避免 UTC+8 午夜被回退一天。
 */
function shiftDate(dateStr, offset) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + Number(offset || 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
/** 本地今日 YYYY-MM-DD（ISO 字典序即时间序，可直接比较） */
function localToday() {
  const n = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}
module.exports = { shiftDate, localToday };
