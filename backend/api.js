/**
 * api.js — 城厢区村居换届选举系统 · 配套后端 v6.1（Neon 云库版）
 * 端口 8080 · Node + Express + PostgreSQL(Neon) + JWT + multer
 *
 * 数据库：优先 DATABASE_URL 环境变量 → server/neon.env → 本地 5432/wechat 兜底
 * 数据隔离铁律：普通账号仅本村数据；platform_admin 豁免跨归属地但 token 携真实归属地
 * 写操作注意：publish/review/result 全部是 PUT（Task10 实证 Express app.put 不响应 POST）
 */
'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pg = require('pg');
const { Client } = pg;

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'cxq-secret-dev-CHANGE-IN-PROD';
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── 数据库连接 ─────────────────────────────────────────
function resolveDB() {
  // 优先级：项目内 neon.env（显式配置）> 环境变量（仅当是合法 postgres:// 链接）> 本地 5432 兜底
  // 注意：容器自带 DATABASE_URL=file:...custom.db（SQLite 风格，平台模板残留），必须跳过
  const envFile = path.join(__dirname, 'neon.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf-8').match(/^DATABASE_URL\s*=\s*(.+)$/m);
    if (m) return { connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } };
  }
  if (process.env.DATABASE_URL && /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
    return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  return { host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'wechat' };
}
const DB = resolveDB();
// DATE 保持 'yyyy-mm-dd' 字符串（前端直接展示，避免时区漂移）
pg.types.setTypeParser(1082, v => v);
// 短连接池：Neon pooler 场景下免长连接复用问题，又有连接复用速度
const pool = new pg.Pool({ ...DB, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
pool.on('error', e => console.error('[pg pool]', e.message));

// ── 小工具 ─────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const ok = (res, data) => res.json({ code: 0, data });
const fail = (res, code, message) => res.status(code).json({ code, message });
const h = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(`[${req.method} ${req.url}]`, e.message);
  if (!res.headersSent) fail(res, 500, '服务器开小差了，请稍后再试');
});
const now = () => new Date();

function sign(payload) {
  return jwt.sign({ ...payload, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '7d' });
}
function auth() {
  return (req, res, next) => {
    const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return fail(res, 401, '未登录');
    try { req.user = jwt.verify(m[1], JWT_SECRET); next(); }
    catch { return fail(res, 401, 'token 无效'); }
  };
}
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return fail(res, 403, '需要管理员权限');
  next();
};
// 业务角色判定（account_roles.role_key）：经办 operator / 子管理 sub_admin / 编辑 editor / 审核 reviewer
const STAFF_ROLES = ['operator', 'sub_admin', 'editor', 'reviewer', 'platform_admin'];
const requireStaff = (req, res, next) => {
  const keys = req.user && (req.user.roleKeys || []);
  const isStaff = req.user && (req.user.role === 'admin' || (Array.isArray(keys) && keys.some(k => STAFF_ROLES.includes(k))));
  if (!isStaff) return fail(res, 403, '需要经办 / 子管理 / 编辑 / 审核权限');
  next();
};
// 查账号业务角色（account_roles），登录时存进 token 供鉴权与前端显隐
async function roleKeysOf(accId) {
  try {
    const r = await pool.query(
      `SELECT role_key FROM account_roles WHERE acc_id = $1 AND ar_status = 'active'`, [accId]);
    return r.rows.map(x => x.role_key);
  } catch { return []; }
}
// 归属地范围：admin 跨组织，普通人锁本村
function orgWhere(user, col = 'org_id') {
  return user.crossOrg ? { sql: '', params: [] } : { sql: ` AND ${col} = $1`, params: [user.orgId] };
}
// 带起始序号的 orgWhere（拼进多参数语句时防 $1 错位——varchar=uuid 崩的根因）
function orgWhereAt(user, start, col = 'org_id') {
  if (user.crossOrg) return { sql: '', params: [] };
  return { sql: ` AND ${col} = $${start}`, params: [user.orgId] };
}

// ── 健康检查 + Neon 保活（60s 一次，防免费版休眠冷启动）────
app.get('/api/health', h(async (req, res) => {
  try {
    const r = await pool.query('SELECT now()::date AS d');
    ok(res, { db: 'up', today: String(r.rows[0].d) });
  } catch (e) { ok(res, { db: 'down', message: e.message.slice(0, 80) }); }
}));
setInterval(async () => {
  try { await pool.query('SELECT 1'); } catch (e) { console.error('[keepalive]', e.message.slice(0, 60)); }
}, 60000);

// ── 登录 ───────────────────────────────────────────────
app.post('/api/login', h(async (req, res) => {
  const { phone, password, orgId } = req.body || {};
  if (!phone || !password) return fail(res, 400, '手机号和密码必填');
  const r = await pool.query(
    `SELECT a.*, o.name AS org_name FROM accounts a LEFT JOIN organizations o ON o.slug = a.org_id
     WHERE a.acc_phone = $1 AND a.acc_status = 'active' LIMIT 1`, [String(phone)]);
  const acc = r.rows[0];
  if (!acc) return fail(res, 401, '账号不存在或已停用');
  const expectPw = acc.acc_password_hint || '123456';
  if (expectPw !== password) return fail(res, 401, '密码不正确');
  const isAdmin = acc.roles === 'platform_admin';
  // 归属地锁定：普通账号登录归属地必须与账号归属地一致；平台管理员豁免
  if (orgId && acc.org_id !== orgId && !isAdmin) {
    return fail(res, 403, `该账号归属地为「${acc.org_name || acc.org_id}」，不能从所选归属地登录`);
  }
  const user = {
    id: acc.id, phone: acc.acc_phone, orgId: acc.org_id, orgName: acc.org_name,
    name: acc.acc_name, role: isAdmin ? 'admin' : 'user', roles: acc.roles, crossOrg: isAdmin,
  };
  user.roleKeys = isAdmin ? ['platform_admin'] : await roleKeysOf(acc.id);
  ok(res, { token: sign(user), user });
}));

// ── 小程序端：免密注册 / 登录 / 微信登录 ───────────────
app.post('/api/mp/register', h(async (req, res) => {
  const { phone, orgId, name } = req.body || {};
  if (!phone || !orgId) return fail(res, 400, '手机号和归属地必填');
  const ex = await pool.query('SELECT org_id FROM accounts WHERE acc_phone = $1 LIMIT 1', [String(phone)]);
  if (ex.rows[0]) {
    if (ex.rows[0].org_id !== orgId) return fail(res, 409, '该手机号已绑定其他村（社区），一号一归属地');
    return fail(res, 409, '该手机号已注册，请直接登录');
  }
  const org = await pool.query('SELECT name FROM organizations WHERE slug = $1', [orgId]);
  const r = await pool.query(
    `INSERT INTO accounts (org_id, acc_name, acc_phone, acc_password_hint, roles, acc_status, acc_note)
     VALUES ($1,$2,$3,'NO.MP','voter','active','小程序选民注册') RETURNING *`, [orgId, name || '选民', String(phone)]);
  const acc = r.rows[0];
  const user = { id: acc.id, phone: acc.acc_phone, orgId: acc.org_id, name: acc.acc_name, role: 'user', roles: 'voter', crossOrg: false };
  user.roleKeys = await roleKeysOf(acc.id);
  ok(res, { token: sign(user), user, orgName: org.rows[0] ? org.rows[0].name : orgId });
}));

app.post('/api/mp/login', h(async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return fail(res, 400, '手机号必填');
  const r = await pool.query(
    `SELECT a.*, o.name AS org_name FROM accounts a LEFT JOIN organizations o ON o.slug = a.org_id
     WHERE a.acc_phone = $1 AND a.acc_status = 'active' LIMIT 1`, [String(phone)]);
  const acc = r.rows[0];
  if (!acc) return fail(res, 404, '该手机号未注册');
  if ((acc.acc_password_hint || '123456') !== 'NO.MP' && (acc.acc_password_hint || '123456') !== '123456') {
    return fail(res, 403, '该账号为密码账号，请走密码登录');
  }
  const user = {
    id: acc.id, phone: acc.acc_phone, orgId: acc.org_id, orgName: acc.org_name,
    name: acc.acc_name, role: acc.roles === 'platform_admin' ? 'admin' : 'user', roles: acc.roles, crossOrg: false,
  };
  user.roleKeys = acc.roles === 'platform_admin' ? ['platform_admin'] : await roleKeysOf(acc.id);
  ok(res, { token: sign(user), user });
}));

app.post('/api/mp/wxlogin', h(async (req, res) => {
  fail(res, 501, '未配置微信 AppID/Secret，暂不支持微信登录（演示环境走手机号）');
}));

// ── 组织（公开：登录页下拉需要）────────────────────────
app.get('/api/orgs', h(async (req, res) => {
  const r = await pool.query(
    `SELECT slug AS "orgId", name, town, type, status, org_phone AS "orgPhone", org_person AS "orgPerson"
     FROM organizations ORDER BY type, town, name`);
  ok(res, r.rows);
}));

// ── 后台账号管理（D-013：隐藏解锁页 + 归属地账号预设，仅 platform_admin）────────────
// 现状说明：登录按 acc_password_hint 明文比对（见 /api/login），本接口沿用同一字段存初始密码，
//   保证「预设即可登录」；bcrypt 哈希列为后续安全加固项（需同步改登录校验，不能只改一边造成第二真相）。
const crypto = require('crypto');
const UNLOCK_CODE = process.env.UNLOCK_CODE || '123456';
const PRESET_ROLES = ['sub_admin', 'operator', 'editor', 'reviewer']; // 允许预设的业务角色（不含超管/冻结的选民）
const PRESET_ROLE_NAME = { sub_admin: '子管理', operator: '经办', editor: '编辑', reviewer: '审核员' };
const accountSelect = `
  SELECT a.id, a.org_id AS "orgId", o.name AS "orgName", a.acc_name AS "name", a.acc_phone AS "phone",
         a.acc_status AS "status", a.acc_note AS "note", a.created_at AS "createdAt",
         (SELECT ar.role_key FROM account_roles ar WHERE ar.acc_id=a.id AND ar.ar_status='active' LIMIT 1) AS "roleKey"
  FROM accounts a LEFT JOIN organizations o ON o.slug=a.org_id`;

// 账号列表：GET /api/admin/accounts?orgId=（超管；不传返回全部，上限 200；不回传密码）
app.get('/api/admin/accounts', auth(), requireAdmin, h(async (req, res) => {
  const orgId = req.query.orgId ? String(req.query.orgId) : '';
  const r = orgId
    ? await pool.query(accountSelect + ' WHERE a.org_id=$1 ORDER BY a.created_at', [orgId])
    : await pool.query(accountSelect + ' ORDER BY a.org_id, a.created_at LIMIT 200');
  ok(res, r.rows);
}));

// 批量预设账号：POST /api/admin/accounts { unlockCode, orgId, accounts:[{name,phone,roleKey,password?}] }
app.post('/api/admin/accounts', auth(), requireAdmin, h(async (req, res) => {
  const { unlockCode, orgId, accounts: list } = req.body || {};
  if (unlockCode !== UNLOCK_CODE) return fail(res, 403, '解锁码不正确');
  if (!orgId) return fail(res, 400, '请选择归属地（村/社区）');
  if (!Array.isArray(list) || !list.length) return fail(res, 400, '至少添加一个账号');
  const org = await pool.query('SELECT slug, name FROM organizations WHERE slug=$1', [orgId]);
  if (!org.rows[0]) return fail(res, 404, '归属地不存在');
  const created = [], updated = [], skipped = [];
  for (const item of list) {
    const name = (item.name || '').trim();
    const phone = String(item.phone || '').trim();
    const roleKey = String(item.roleKey || '').trim();
    const password = String(item.password || '123456').trim() || '123456';
    if (!/^1\d{10}$/.test(phone)) { skipped.push({ phone, reason: '手机号格式不对（11 位）' }); continue; }
    if (!PRESET_ROLES.includes(roleKey)) { skipped.push({ phone, reason: '角色不合法' }); continue; }
    // 一号一归属地：手机号全局唯一，已绑别的村则拦截（防串台 D-000）
    const ex = await pool.query('SELECT id, org_id FROM accounts WHERE acc_phone=$1', [phone]);
    let accId;
    if (ex.rows[0]) {
      if (ex.rows[0].org_id !== orgId) { skipped.push({ phone, reason: '该手机号已绑定其他归属地' }); continue; }
      accId = ex.rows[0].id;
      await pool.query(
        `UPDATE accounts SET acc_name=COALESCE(NULLIF($2,''),acc_name), acc_password_hint=$3, acc_status='active', updated_at=now()
         WHERE id=$1`, [accId, name, password]);
      updated.push(phone);
    } else {
      accId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO accounts (id, org_id, acc_name, acc_phone, acc_password_hint, org, roles, acc_status, acc_created_by, acc_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9)`,
        [accId, orgId, name || PRESET_ROLE_NAME[roleKey], phone, password, org.rows[0].name, roleKey, req.user.phone || 'admin', '隐藏解锁页预设']);
      created.push(phone);
    }
    // account_roles：一人一岗，先停旧 active 角色再挂新角色，避免角色挤兑（唯一性）
    await pool.query(`UPDATE account_roles SET ar_status='disabled', updated_at=now() WHERE acc_id=$1 AND ar_status='active'`, [accId]);
    const arEx = await pool.query('SELECT id FROM account_roles WHERE acc_id=$1 AND role_key=$2', [accId, roleKey]);
    if (arEx.rows[0]) {
      await pool.query(`UPDATE account_roles SET ar_status='active', org_id=$2, ar_assigned_by=$3, updated_at=now() WHERE id=$1`,
        [arEx.rows[0].id, orgId, req.user.phone || 'admin']);
    } else {
      await pool.query(
        `INSERT INTO account_roles (id, org_id, role_key, ar_status, ar_assigned_by, ar_note, acc_id)
         VALUES ($1,$2,$3,'active',$4,$5,$6)`,
        [crypto.randomUUID(), orgId, roleKey, req.user.phone || 'admin', '隐藏解锁页预设', accId]);
    }
  }
  ok(res, { created, updated, skipped, orgId, orgName: org.rows[0].name });
}));

// 启用/停用：PUT /api/admin/accounts/:id/status { status:'active'|'disabled' }
app.put('/api/admin/accounts/:id/status', auth(), requireAdmin, h(async (req, res) => {
  const status = req.body && req.body.status === 'active' ? 'active' : 'disabled';
  const r = await pool.query('UPDATE accounts SET acc_status=$2, updated_at=now() WHERE id=$1 RETURNING id, acc_status AS "status"',
    [req.params.id, status]);
  if (!r.rows[0]) return fail(res, 404, '账号不存在');
  ok(res, r.rows[0]);
}));

// 重置密码：PUT /api/admin/accounts/:id/reset-password { password? }，默认重置为 123456
app.put('/api/admin/accounts/:id/reset-password', auth(), requireAdmin, h(async (req, res) => {
  const pw = String((req.body && req.body.password) || '123456').trim() || '123456';
  const r = await pool.query('UPDATE accounts SET acc_password_hint=$2, updated_at=now() WHERE id=$1 RETURNING id',
    [req.params.id, pw]);
  if (!r.rows[0]) return fail(res, 404, '账号不存在');
  ok(res, { id: r.rows[0].id, reset: true });
}));

// ── 列表工厂（登录 + 归属地隔离）───────────────────────
function listFactory(table, sql, paramsFn) {
  return [auth(), h(async (req, res) => {
    const { sql: extra, params } = paramsFn(req);
    const r = await pool.query(sql.replace('__SCOPE__', extra), params);
    ok(res, r.rows);
  })];
}

app.get('/api/elections', ...listFactory('elections',
  `SELECT e.id AS "electionId", e.org_id AS "orgId", o.name AS "orgName", e.el_id AS "elId", e.el_term AS "elTerm",
          e.el_name AS "elName", e.el_status AS "elStatus", e.el_election_date AS "elElectionDate",
          e.el_method AS "elMethod", e.el_proposal_id AS "elProposalId", e.el_note AS "elNote"
   FROM elections e LEFT JOIN organizations o ON o.slug = e.org_id WHERE 1=1__SCOPE__ ORDER BY e.el_election_date DESC NULLS LAST`,
  req => orgWhere(req.user)));

app.get('/api/elections/:id/stages', auth(), h(async (req, res) => {
  const r = await pool.query(
    `SELECT s.stage_key AS "stageKey", s.stage_name AS "stageName", s.stage_status AS "stageStatus",
            s.stage_start_date AS "stageStartDate", s.stage_end_date AS "stageEndDate", s.stage_order AS "stageOrder"
     FROM election_stages s WHERE s.election_id = (SELECT el_id FROM elections WHERE id = $1)
     ORDER BY s.stage_order`, [req.params.id]);
  if (!r.rows.length) return fail(res, 404, '该届暂无日程（可先调 generate-stages 生成）');
  ok(res, r.rows);
}));

// ── 日程引擎：D 日锚点 → 16 阶段全表平移 ───────────────
app.post('/api/elections/:id/generate-stages', auth(), h(async (req, res) => {
  const el = await pool.query('SELECT id, el_id, org_id, el_election_date FROM elections WHERE id = $1', [req.params.id]);
  if (!el.rows[0]) return fail(res, 404, '届次不存在');
  const e = el.rows[0];
  if (!req.user.crossOrg && req.user.orgId !== e.org_id) return fail(res, 403, '只能操作本村届次');
  if (!e.el_election_date) return fail(res, 400, '该届未设置选举日(D)，无法生成日程');
  const tpl = await pool.query(
    `SELECT st_key, st_name, st_day_offset, st_duration_days, st_order FROM stage_templates ORDER BY st_order`);
  if (!tpl.rows.length) return fail(res, 500, 'stage_templates 空，日程引擎无模板');
  const today = localToday();
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query('DELETE FROM election_stages WHERE election_id = $1', [e.el_id]);
    for (const t of tpl.rows) {
      const sStr = shiftDate(e.el_election_date, t.st_day_offset);
      // st_duration_days 列实义=阶段结束日相对D的offset(同前端offsetEnd，单天阶段=起始offset)，并非持续天数
      const eStr = shiftDate(e.el_election_date, Number(t.st_duration_days));
      const status = today < sStr ? '未开始' : (today <= eStr ? '进行中' : '已完成');
      await tx.query(
        `INSERT INTO election_stages (org_id, election_id, stage_key, stage_name, stage_status, stage_start_date, stage_end_date, stage_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [e.org_id, e.el_id, t.st_key, t.st_name, status, sStr, eStr, t.st_order]);
    }
    await tx.query('COMMIT');
  } catch (err) { await tx.query('ROLLBACK'); throw err; }
  finally { tx.release(); }
  const n = await pool.query('SELECT count(*)::int n FROM election_stages WHERE election_id = $1', [e.el_id]);
  ok(res, { generated: n.rows[0].n, electionId: req.params.id, d: String(e.el_election_date) });
}));

// ── 提案联动：D 日锚定 → 日程 / 岗位 / 公告草稿 一次性生成 ──
function elTermFromTitle(title) {
  const m = String(title || '').match(/(第[一二三四五六七八九十百\d]+届)/);
  return m ? m[1] : '';
}
/** 公告标题（与前端 announcementTemplates 同源） */
const ANN_TITLES = {
  1: '关于确定选举日的公告', 2: '关于村民选举委员会名单的公告', 3: '关于选民登记的公告',
  4: '关于选民名单的公告', 5: '关于村民代表和小组长选举的公告', 6: '关于村民代表名单的公告',
  '6-1': '关于村民小组长、副组长名单的公告', 7: '关于村民委员会成员初步候选人提名的公告',
  8: '关于村民委员会成员初步候选人名单的公告', 9: '关于村民委员会成员正式候选人名单的公告',
  10: '关于村民委员会选举投票时间和地点的公告', 11: '关于选举工作人员名单的公告',
  12: '关于流动票箱投票人员名单的公告', 13: '关于委托投票名单的公告', 14: '关于代写人员名单的公告',
  15: '关于无效票认定规则的公告', 16: '关于村民委员会选举结果的公告', 17: '关于村务监督委员会成员选举结果的公告',
};
/** 阶段 → 公告编号（与前端 stageTemplates 同源） */
const STAGE_ANNOUNCEMENTS = {
  'D-34': ['1', '2', '3'], 'D-28~-24': ['4'], 'D-20~-16': ['5', '6', '6-1'],
  'D-15': ['7'], 'D-13': ['8'], 'D-4': ['9'], 'D-3~-2': ['10', '11', '12', '13', '14'],
  'D-1': ['15'], 'D0': ['16', '17'],
};

/** 列出 uploads 下某子目录的文件清单 */
function listDirFiles(sub) {
  const dir = path.join(UPLOAD_DIR, sub);
  try { return fs.readdirSync(dir).filter((f) => !f.startsWith('.')); } catch { return []; }
}
/** 附件 URL 清单（目录扫描，positions/announcements 共用同一套，避免新增数据库列造成第二真相） */
function filesOf(relSub) {
  return listDirFiles(relSub).map((f) => ({ name: f, url: `/api/files/${relSub}/${encodeURIComponent(f)}` }));
}
// 示意附件唯一真源在 lib/stubFiles（api 与 scripts/ensure_stubs 共用，禁止复制内容模板）
const {
  ensureStubFile: ensureStubRaw, positionStubText, announcementStubText,
} = require('./lib/stubFiles');
const ensureStubFile = (relSub, content) => ensureStubRaw(UPLOAD_DIR, relSub, content);

/** 纯日历日加减：YYYY-MM-DD + offset 天 → YYYY-MM-DD。用本地分量构造与读取，不走 UTC/toISOString，避免 UTC+8 午夜被回退一天 */
// D-day 纯日期计算唯一真源抽到 lib/dateUtil（api 与 scripts 共用，禁止第二份日期算法）
const { shiftDate, localToday } = require('./lib/dateUtil');

/** 按 D 日生成 16 阶段日程（供 generate-stages 与提案审批联动复用） */
async function genStagesFor(elUuid) {
  const el = await pool.query('SELECT id, el_id, org_id, el_election_date FROM elections WHERE id = $1', [elUuid]);
  const e = el.rows[0];
  if (!e) throw new Error('届次不存在');
  if (!e.el_election_date) throw new Error('该届未设置选举日(D)，无法生成日程');
  const tpl = await pool.query(
    `SELECT st_key, st_name, st_day_offset, st_duration_days, st_order FROM stage_templates ORDER BY st_order`);
  if (!tpl.rows.length) throw new Error('stage_templates 空，日程引擎无模板');
  const today = localToday();
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query('DELETE FROM election_stages WHERE election_id = $1', [e.el_id]);
    for (const t of tpl.rows) {
      const sStr = shiftDate(e.el_election_date, t.st_day_offset);
      // st_duration_days 列实义=阶段结束日相对D的offset(同前端offsetEnd，单天阶段=起始offset)，并非持续天数
      const eStr = shiftDate(e.el_election_date, Number(t.st_duration_days));
      const status = today < sStr ? '未开始' : (today <= eStr ? '进行中' : '已完成');
      await tx.query(
        `INSERT INTO election_stages (org_id, election_id, stage_key, stage_name, stage_status, stage_start_date, stage_end_date, stage_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [e.org_id, e.el_id, t.st_key, t.st_name, status, sStr, eStr, t.st_order]);
    }
    await tx.query('COMMIT');
  } catch (err) { await tx.query('ROLLBACK'); throw err; }
  finally { tx.release(); }
  const n = await pool.query('SELECT count(*)::int n FROM election_stages WHERE election_id = $1', [e.el_id]);
  return { generated: n.rows[0].n, d: String(e.el_election_date) };
}

// 提案附件上传（提案/岗位报名表，存 uploads/proposals/<id>/）
const proposalUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, 'proposals', String(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '')}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ── 提案（真实持久化：创建 / 审批联动 / 附件）────────────
app.get('/api/proposals', auth(), h(async (req, res) => {
  const { sql, params } = orgWhere(req.user);
  const r = await pool.query(
    `SELECT pr.id, pr.org_id AS "orgId", pr.election_id AS "elId", pr.prop_title AS "propTitle", pr.prop_method AS "propMethod",
            pr.prop_status AS "propStatus", pr.prop_version AS "propVersion", pr.prop_submit_time AS "propSubmitTime",
            pr.prop_reviewer_id AS "propReviewerId", pr.prop_review_time AS "propReviewTime", pr.prop_review_comment AS "propReviewComment",
            pr.prop_report AS "propReport",
            pr.prop_election_date AS "propElectionDate", e.el_election_date AS "electionDate"
     FROM proposals pr LEFT JOIN elections e ON e.el_id = pr.election_id
     WHERE 1=1${sql} ORDER BY pr.prop_submit_time DESC NULLS LAST`, params);
  const rows = await Promise.all(r.rows.map(async (x) => {
    const posts = await pool.query(
      `SELECT id, pos_type AS "position", pos_quota AS "count", pos_desc AS "requirement" FROM proposal_posts WHERE proposal_id=$1 ORDER BY created_at`, [x.id]);
    return { ...x, posts: posts.rows, files: listDirFiles('proposals/' + x.id).map((f) => ({ name: f, url: `/api/files/proposals/${x.id}/${f}` })) };
  }));
  ok(res, rows);
}));

app.post('/api/proposals', auth(), requireStaff, h(async (req, res) => {
  const { title, method, electionDate, posts, orgId, report } = req.body || {};
  if (!title) return fail(res, 400, '提案名称必填');
  const u = req.user;
  const org = u.crossOrg ? (orgId || null) : u.orgId;
  if (!org) return fail(res, 400, '缺少归属地');
  const elId = 'el-' + Date.now().toString(36);
  const pr = await pool.query(
    `INSERT INTO proposals (org_id, election_id, prop_title, prop_method, prop_creator_id, prop_status, prop_version, prop_submit_time, prop_report, prop_election_date)
     VALUES ($1,$2,$3,$4,$5,'pending',1,now(),$6,$7) RETURNING id`,
    [org, elId, title, method || '全民直选', u.phone || '', (report || '').trim() || null, electionDate || null]);
  const pid = pr.rows[0].id;
  for (const po of (Array.isArray(posts) ? posts : [])) {
    await pool.query(
      `INSERT INTO proposal_posts (proposal_id, pos_type, pos_quota, pos_desc) VALUES ($1,$2,$3,$4)`,
      [pid, po.position || '委员', Number(po.count) || 1, (po.requirement || '').trim() || null]);
  }
  ok(res, { id: pid, elId, title, status: 'pending' });
}));

// 驳回后编辑重提：更新内容并重置为待审批
app.put('/api/proposals/:id', auth(), requireStaff, h(async (req, res) => {
  const { title, method, electionDate, posts, report } = req.body || {};
  const cur = await pool.query(`SELECT * FROM proposals WHERE id = $1`, [req.params.id]);
  const p = cur.rows[0];
  if (!p) return fail(res, 404, '提案不存在');
  if (p.prop_status === 'approved') return fail(res, 400, '已通过提案不可编辑');
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query(
      `UPDATE proposals SET prop_title=COALESCE($2,prop_title), prop_method=COALESCE($3,prop_method),
        prop_election_date=COALESCE($4,prop_election_date), prop_report=COALESCE($5,prop_report),
        prop_status='pending', prop_review_comment=NULL, prop_reviewer_id=NULL, prop_review_time=NULL,
        prop_version=prop_version+1, updated_at=now() WHERE id=$1`,
      [req.params.id, title || null, method || null, electionDate || null, report ?? null]);
    if (Array.isArray(posts)) {
      await tx.query(`DELETE FROM proposal_posts WHERE proposal_id=$1`, [req.params.id]);
      for (const po of posts) {
        await tx.query(
          `INSERT INTO proposal_posts (proposal_id, pos_type, pos_quota, pos_desc) VALUES ($1,$2,$3,$4)`,
          [req.params.id, po.position || '委员', Number(po.count) || 1, (po.requirement || '').trim() || null]);
      }
    }
    await tx.query('COMMIT');
    ok(res, { id: req.params.id, status: 'pending' });
  } catch (err) { await tx.query('ROLLBACK'); throw err; }
  finally { tx.release(); }
}));

app.put('/api/proposals/:id/review', auth(), requireStaff, h(async (req, res) => {
  const { action, comment, electionDate, method } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return fail(res, 400, 'action 只能是 approve / reject');
  const cur = await pool.query(`SELECT * FROM proposals WHERE id = $1`, [req.params.id]);
  const p = cur.rows[0];
  if (!p) return fail(res, 404, '提案不存在');
  if (p.prop_status !== 'pending') return fail(res, 400, '该提案已处理，不能重复审批');
  if (!req.user.crossOrg && req.user.orgId !== p.org_id) return fail(res, 403, '只能审批本村（社区）提案');
  const phone = req.user.phone || '';
  if (action === 'reject') {
    await pool.query(
      `UPDATE proposals SET prop_status='rejected', prop_reviewer_id=$2, prop_review_time=now(), prop_review_comment=$3, updated_at=now() WHERE id=$1`,
      [req.params.id, phone, (comment || '').trim()]);
    return ok(res, { id: p.id, status: 'rejected' });
  }
  // approve：D 日锚定 → 活动 + 16 阶段日程 + 岗位 + 公告草稿 一次生成
  const elId = p.election_id;
  const finalDday = electionDate || p.prop_election_date || null;
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    // 原子抢占：仅当仍为 pending 才置为 approved，并发/连点时第二个请求抢不到行 → 回滚，杜绝重复生成
    const claim = await tx.query(
      `UPDATE proposals SET prop_status='approved', prop_reviewer_id=$2, prop_review_time=now(), prop_review_comment=$3, updated_at=now()
       WHERE id=$1 AND prop_status='pending' RETURNING id`,
      [p.id, phone, (comment || '').trim()]);
    if (!claim.rows[0]) { await tx.query('ROLLBACK'); return fail(res, 400, '该提案已处理，不能重复审批'); }
    let e = (await tx.query(`SELECT * FROM elections WHERE el_id=$1`, [elId])).rows[0];
    if (!e) {
      const ins = await tx.query(
        `INSERT INTO elections (org_id, el_id, el_term, el_name, el_status, el_election_date, el_method, el_proposal_id)
         VALUES ($1,$2,$3,$4,'in_progress',$5,$6,$7) RETURNING *`,
        [p.org_id, elId, elTermFromTitle(p.prop_title), p.prop_title || `${elTermFromTitle(p.prop_title)}换届选举`,
          finalDday, method || p.prop_method || '全民直选', p.id]);
      e = ins.rows[0];
    } else {
      await tx.query(
        `UPDATE elections SET el_status='in_progress', el_election_date=COALESCE($2, el_election_date), el_method=COALESCE($3, el_method), el_proposal_id=$4, updated_at=now() WHERE el_id=$1`,
        [elId, finalDday, method || null, p.id]);
      e = (await tx.query(`SELECT * FROM elections WHERE el_id=$1`, [elId])).rows[0];
    }
    if (!e.el_election_date) { await tx.query('ROLLBACK'); return fail(res, 400, '该届未设置正式选举日(D)，无法通过'); }
    // 日程
    const stpl = await tx.query(`SELECT st_key, st_name, st_day_offset, st_duration_days, st_order FROM stage_templates ORDER BY st_order`);
    if (!stpl.rows.length) { await tx.query('ROLLBACK'); return fail(res, 500, '日程模板为空'); }
    const today = localToday();
    await tx.query('DELETE FROM election_stages WHERE election_id = $1', [elId]);
    for (const t of stpl.rows) {
      const sStr = shiftDate(e.el_election_date, t.st_day_offset);
      // st_duration_days 列实义=阶段结束日相对D的offset(同前端offsetEnd，单天阶段=起始offset)，并非持续天数
      const eStr = shiftDate(e.el_election_date, Number(t.st_duration_days));
      const status = today < sStr ? '未开始' : (today <= eStr ? '进行中' : '已完成');
      await tx.query(
        `INSERT INTO election_stages (org_id, election_id, stage_key, stage_name, stage_status, stage_start_date, stage_end_date, stage_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [p.org_id, elId, t.st_key, t.st_name, status, sStr, eStr, t.st_order]);
    }
    // 岗位：proposal_posts → positions（覆盖式重建，保持与提案一致）
    const pp = await tx.query(`SELECT * FROM proposal_posts WHERE proposal_id=$1 ORDER BY created_at`, [p.id]);
    await tx.query('DELETE FROM positions WHERE election_id = $1', [elId]);
    const newPositions = [];
    for (const po of pp.rows) {
      const insP = await tx.query(
        `INSERT INTO positions (org_id, election_id, pos_type, pos_quota, pos_status, pos_desc) VALUES ($1,$2,$3,$4,'active',$5)
         RETURNING id, pos_type AS "posType", pos_quota AS "posQuota", pos_desc AS "posDesc"`,
        [p.org_id, elId, po.pos_type, Number(po.pos_quota) || 1, po.pos_desc]);
      newPositions.push(insP.rows[0]);
    }
    // 公告草稿：按阶段模板批量生成未发布模板（小编只编辑不新建）
    let annN = 0;
    const newAnns = [];
    const stages = await tx.query(`SELECT stage_key FROM election_stages WHERE election_id=$1 ORDER BY stage_order`, [elId]);
    for (const s of stages.rows) {
      for (const no of (STAGE_ANNOUNCEMENTS[s.stage_key] || [])) {
        const dup = await tx.query(`SELECT id FROM announcements WHERE election_id=$1 AND ann_code=$2`, [elId, no]);
        if (dup.rows[0]) continue;
        const insA = await tx.query(
          `INSERT INTO announcements (org_id, election_id, ann_code, ann_title, ann_stage_key, ann_status, ann_version, ann_editor, ann_edit_time, ann_content)
           VALUES ($1,$2,$3,$4,$5,'draft',1,'系统生成',now(),'')
           RETURNING id, ann_code AS "annCode", ann_title AS "annTitle", ann_stage_key AS "stageKey"`,
          [p.org_id, elId, no, ANN_TITLES[no] || `${no}号公告`, s.stage_key]);
        newAnns.push(insA.rows[0]);
        annN++;
      }
    }
    await tx.query('COMMIT');
    // 事务提交成功后再落纯文本示意附件（回滚不留孤儿；已有真实文件的目录 ensureStubFile 会自动跳过）
    let stubN = 0;
    for (const pos of newPositions) {
      if (ensureStubFile(`positions/${pos.id}`, positionStubText(pos))) stubN += 1;
    }
    for (const a of newAnns) {
      if (ensureStubFile(`announcements/${a.id}`, announcementStubText(a))) stubN += 1;
    }
    ok(res, {
      id: p.id, status: 'approved', elId,
      stagesGenerated: stpl.rows.length, positionsGenerated: pp.rows.length, announcementsGenerated: annN,
      stubFilesGenerated: stubN,
    });
  } catch (err) { await tx.query('ROLLBACK'); throw err; }
  finally { tx.release(); }
}));

app.post('/api/proposals/:id/file', auth(), proposalUpload.single('file'), h(async (req, res) => {
  if (!req.file) return fail(res, 400, '未收到文件');
  ok(res, { id: req.params.id, file: `/api/files/proposals/${req.params.id}/${req.file.filename}`, size: req.file.size });
}));

// ── 公告 ───────────────────────────────────────────────
// 显式 handler（不走 listFactory）：逐份拼 annFiles，保证每份公告带各自独立的下载件，切换公告不写死
app.get('/api/announcements', auth(), h(async (req, res) => {
  const { sql, params } = orgWhere(req.user);
  const qp = [...params];
  let extra = sql;
  if (req.query.electionId) { extra += ' AND a.election_id = $' + (qp.length + 1); qp.push(String(req.query.electionId)); }
  const r = await pool.query(
    `SELECT a.id, a.org_id AS "orgId", a.election_id AS "elId", a.ann_code AS "annCode", a.ann_title AS "annTitle",
            a.ann_stage_key AS "annStageKey", a.ann_status AS "annStatus", a.ann_version AS "annVersion",
            a.ann_editor AS "annEditor", a.ann_publish_time AS "annPublishTime", a.ann_content AS "annContent",
            a.ann_publicity_deadline AS "annPublicityDeadline",
            a.ann_sign AS "annSign", a.ann_sign_date AS "annSignDate",
            a.ann_open_material_submit AS "annOpenMaterialSubmit", a.ann_publish_mode AS "annPublishMode",
            a.ann_publish_at AS "annPublishAt", a.ann_remind_hours AS "annRemindHours", a.ann_remind_to AS "annRemindTo"
     FROM announcements a WHERE 1=1${extra} ORDER BY a.ann_publish_time DESC NULLS LAST, a.ann_code`, qp);
  const rows = r.rows.map((a) => ({ ...a, annFiles: filesOf(`announcements/${a.id}`) }));
  ok(res, rows);
}));

app.post('/api/announcements', auth(), h(async (req, res) => {
  const { elId, annCode, annTitle, annStageKey, annContent } = req.body || {};
  if (!elId || !annTitle) return fail(res, 400, '届次和标题必填');
  const el = await pool.query('SELECT org_id, el_id FROM elections WHERE el_id = $1', [elId]);
  if (!el.rows[0]) return fail(res, 404, '届次不存在');
  if (!req.user.crossOrg && req.user.orgId !== el.rows[0].org_id) return fail(res, 403, '只能操作本村公告');
  const r = await pool.query(
    `INSERT INTO announcements (org_id, election_id, ann_code, ann_title, ann_stage_key, ann_status, ann_version, ann_editor, ann_edit_time, ann_content)
     VALUES ($1,$2,$3,$4,$5,'draft',1,$6,$7,$8) RETURNING id, ann_code AS "annCode", ann_title AS "annTitle", ann_status AS "annStatus"`,
    [el.rows[0].org_id, elId, annCode || '', annTitle, annStageKey || '', req.user.name || '', now(), annContent || '']);
  ok(res, r.rows[0]);
}));

app.put('/api/announcements/:id/publish', auth(), h(async (req, res) => {
  const r = await pool.query(
    `UPDATE announcements SET ann_status='published', ann_publish_time=$2, ann_editor=$3, updated_at=now()
     WHERE id = $1 RETURNING id, ann_code AS "annCode", ann_title AS "annTitle", ann_status AS "annStatus", ann_publish_time AS "annPublishTime"`,
    [req.params.id, now(), req.user.name || '']);
  if (!r.rows[0]) return fail(res, 404, '公告不存在');
  ok(res, r.rows[0]);
}));

// 公告草稿全量编辑持久化（小编工作台唯一编辑器：标题/正文/编号/落款/成文日期/材料开关/发布方式/定时/提醒，刷新不丢）
app.put('/api/announcements/:id', auth(), h(async (req, res) => {
  const {
    annTitle, annContent, annCode, annSign, annSignDate,
    annOpenMaterialSubmit, annPublishMode, annPublishAt, annRemindHours, annRemindTo,
  } = req.body || {};
  const remindTo = Array.isArray(annRemindTo) ? annRemindTo.join(',') : (annRemindTo ?? null);
  const r = await pool.query(
    `UPDATE announcements SET
       ann_title=COALESCE($2, ann_title), ann_content=COALESCE($3, ann_content), ann_code=COALESCE($4, ann_code),
       ann_sign=COALESCE($5, ann_sign), ann_sign_date=COALESCE($6, ann_sign_date),
       ann_open_material_submit=COALESCE($7, ann_open_material_submit),
       ann_publish_mode=COALESCE($8, ann_publish_mode), ann_publish_at=COALESCE($9, ann_publish_at),
       ann_remind_hours=COALESCE($10, ann_remind_hours), ann_remind_to=COALESCE($11, ann_remind_to),
       ann_editor=$12, ann_edit_time=now(), updated_at=now()
     WHERE id = $1 RETURNING id, ann_code AS "annCode", ann_title AS "annTitle", ann_status AS "annStatus",
       ann_publish_mode AS "annPublishMode", ann_open_material_submit AS "annOpenMaterialSubmit"`,
    [req.params.id, annTitle ?? null, annContent ?? null, annCode ?? null, annSign ?? null, annSignDate ?? null,
      annOpenMaterialSubmit ?? null, annPublishMode ?? null, annPublishAt ?? null, annRemindHours ?? null, remindTo,
      req.user.name || '']);
  if (!r.rows[0]) return fail(res, 404, '公告不存在');
  ok(res, r.rows[0]);
}));

// 公告附件上传（每份公告各自目录 uploads/announcements/<id>/，小编在工作台传正式公文）
const announcementUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, 'announcements', String(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '')}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
app.post('/api/announcements/:id/file', auth(), announcementUpload.single('file'), h(async (req, res) => {
  if (!req.file) return fail(res, 400, '未收到文件');
  const r = await pool.query(`SELECT id FROM announcements WHERE id = $1`, [req.params.id]);
  if (!r.rows[0]) return fail(res, 404, '公告不存在');
  ok(res, { id: req.params.id, file: `/api/files/announcements/${req.params.id}/${encodeURIComponent(req.file.filename)}`, size: req.file.size });
}));

// ── 候选人（四轮人工审核：甲方邮箱送审 → 系统手动录入结果+可选理由）──────
app.get('/api/candidates', ...listFactory('candidates',
  `SELECT c.id, c.org_id AS "orgId", c.election_id AS "elId", c.cand_name AS "candName", c.cand_position_id AS "candPositionId",
          c.cand_source AS "candSource", c.cand_gender AS "candGender", c.cand_age AS "candAge", c.cand_phone AS "candPhone",
          c.cand_r1 AS "candR1", c.cand_r1_reviewer AS "candR1Reviewer", c.cand_r1_time AS "candR1Time", c.cand_r1_comment AS "candR1Comment",
          c.cand_r2 AS "candR2", c.cand_r2_reviewer AS "candR2Reviewer", c.cand_r2_time AS "candR2Time", c.cand_r2_comment AS "candR2Comment",
          c.cand_r3 AS "candR3", c.cand_r3_reviewer AS "candR3Reviewer", c.cand_r3_time AS "candR3Time", c.cand_r3_comment AS "candR3Comment",
          c.cand_r4 AS "candR4", c.cand_r4_reviewer AS "candR4Reviewer", c.cand_r4_time AS "candR4Time", c.cand_r4_comment AS "candR4Comment",
          c.cand_status AS "candStatus", c.cand_votes AS "candVotes"
   FROM candidates c WHERE 1=1__SCOPE__ ORDER BY c.created_at`,
  req => orgWhere(req.user)));

// R 轮结果状态派生（cand_status 由轮次结果自动推进，无需计算逻辑）
function deriveStatus(r1, r2, r3, r4, votes) {
  if (r1 === '不通过') return '初审退出';
  if (r2 === '不通过') return '预选未入围';
  if (r3 === '不通过') return '联审不通过';
  if (r4 === '不通过') return '考察不通过';
  if (r4 === '通过') return votes != null ? (votes > 0 ? '当选' : '落选') : '正式候选人';
  if (r3 === '通过') return '待第4轮考察';
  if (r2 === '通过') return '待第3轮';
  if (r1 === '通过') return '待第2轮';
  return '待初审';
}
const ROUND_COLS = {
  1: ['cand_r1', 'cand_r1_reviewer', 'cand_r1_time', 'cand_r1_comment'],
  2: ['cand_r2', 'cand_r2_reviewer', 'cand_r2_time', 'cand_r2_comment'],
  3: ['cand_r3', 'cand_r3_reviewer', 'cand_r3_time', 'cand_r3_comment'],
  4: ['cand_r4', 'cand_r4_reviewer', 'cand_r4_time', 'cand_r4_comment'],
};
// 甲方手动录入某轮结果：PUT /api/candidates/:id/round {round:1-4, result:'通过'|'不通过', reason?:'可选理由'}
app.put('/api/candidates/:id/round', auth(), requireStaff, h(async (req, res) => {
  const { round, result, reason } = req.body || {};
  const n = Number(round);
  if (!ROUND_COLS[n]) return fail(res, 400, 'round 只能是 1-4');
  if (!['通过', '不通过'].includes(result)) return fail(res, 400, 'result 只能是 通过 / 不通过');
  const { sql, params } = orgWhereAt(req.user, 2);
  const cur = await pool.query(`SELECT * FROM candidates WHERE id = $1${sql}`, [req.params.id, ...params]);
  const c = cur.rows[0];
  if (!c) return fail(res, 404, '候选人不存在');
  const [rCol, rvCol, tCol, cmCol] = ROUND_COLS[n];
  // 前置轮未过不允许跳轮录入（防手滑，也符合 pipeline 顺序）
  for (let i = 1; i < n; i += 1) {
    if (c[ROUND_COLS[i][0]] !== '通过') {
      return fail(res, 400, `第 ${n} 轮之前还有轮次未通过/未录入，请按 R1→R4 顺序操作`);
    }
  }
  const status = deriveStatus(
    n === 1 ? result : c.cand_r1, n === 2 ? result : c.cand_r2,
    n === 3 ? result : c.cand_r3, n === 4 ? result : c.cand_r4, c.cand_votes);
  // 通过后自动把下一轮置「待审」（自然推进）
  const nextCol = ROUND_COLS[n + 1] ? ROUND_COLS[n + 1][0] : null;
  const nextSet = nextCol && result === '通过' && !c[nextCol] ? `, ${nextCol} = '待审'` : '';
  const r = await pool.query(
    `UPDATE candidates SET ${rCol} = $2, ${rvCol} = $3, ${tCol} = $4, ${cmCol} = $5, cand_status = $6${nextSet}, updated_at = now()
     WHERE id = $1 RETURNING *`, [req.params.id, result, req.user.name || '', now(), (reason || '').trim() || null, status]);
  const row = r.rows[0];
  ok(res, {
    id: row.id, candName: row.cand_name, round: n, result,
    reviewer: row[rvCol], time: row[tCol], reason: row[cmCol],
    candStatus: row.cand_status,
  });
}));

app.put('/api/candidates/:id/result', auth(), h(async (req, res) => {
  const { votes, status } = req.body || {};
  const r = await pool.query(
    `UPDATE candidates SET cand_votes = $2, cand_status = COALESCE($3, cand_status), updated_at = now()
     WHERE id = $1 RETURNING id, cand_name AS "candName", cand_votes AS "candVotes", cand_status AS "candStatus"`,
    [req.params.id, Number(votes) || 0, status || null]);
  if (!r.rows[0]) return fail(res, 404, '候选人不存在');
  ok(res, r.rows[0]);
}));

// 一键送审：把待审轮次的候选人名单+材料链接打包成邮件，发给评审领导邮箱
// SMTP_URL 配置了就真发（nodemailer）；没配返回文案由后台复制转发（同样一键）
app.post('/api/candidates/send-review', auth(), requireStaff, h(async (req, res) => {
  const { elId, round, emails, note } = req.body || {};
  const n = Number(round) || 1;
  if (!elId) return fail(res, 400, '缺少选举届次 elId');
  const list = String(emails || '').split(/[,;，；\s]+/).map(x => x.trim()).filter(x => /.+@.+\..+/.test(x));
  if (!list.length) return fail(res, 400, '请至少填写一个有效邮箱');
  const { sql, params } = orgWhereAt(req.user, 2, 'c.org_id');
  // 该轮待审候选人（或全部轮次状态，给评审看全景）
  const rCol = ROUND_COLS[n][0];
  const cands = await pool.query(
    `SELECT c.cand_name, c.cand_position_id, c.cand_source, c.${rCol} AS r,
            c.cand_phone, m.id AS mat_id, m.mat_type
     FROM candidates c LEFT JOIN materials m ON m.mat_candidate_id::text = c.id::text
     WHERE c.election_id = $1${sql} ORDER BY c.created_at`, [elId, ...params]);
  if (!cands.rows.length) return fail(res, 404, '该届次暂无候选人');
  // 材料附件链接（uploads/<材料id>/ 下文件清单）
  const origin = (req.headers.origin || `http://${req.headers.host || 'localhost:3000'}`).replace(/\/$/, '');
  const lines = [];
  for (const c of cands.rows) {
    const files = c.mat_id ? listFiles(c.mat_id) : [];
    const links = files.map(f => `${origin}/api/files/${c.mat_id}/${f}`);
    lines.push(
      `· ${c.cand_name}（${c.cand_position_id || '委员'} · ${c.cand_source === 'org_recommend' ? '组织推荐' : '个人自荐'} · R${n}${c.r === '通过' ? '已通过' : '待审'}）` +
      (links.length ? `\n  材料附件：\n  ${links.join('\n  ')}` : '\n  （无线上材料）')
    );
  }
  const subject = `【送审】城厢区村居换届 · 候选人第 ${n} 轮评审（共 ${cands.rows.length} 人）`;
  const text = [
    `各位领导：`,
    ``,
    `现将村（社区）换届选举候选人第 ${n} 轮评审材料发送如下，请查收审核：`,
    ``,
    ...lines,
    ``,
    note ? `备注：${note}` : '',
    `请审核后将结果反馈至经办（联系电话见公告），由经办在系统中录入。`,
    `此邮件由换届选举系统自动生成。`,
  ].filter(x => x !== '').join('\n');
  let sent = 0, mailed = false;
  try {
    const smtp = process.env.SMTP_URL || (fs.existsSync(path.join(__dirname, 'smtp.env')) &&
      fs.readFileSync(path.join(__dirname, 'smtp.env'), 'utf8').match(/^SMTP_URL\s*=\s*(.+)$/m) || [])[1];
    if (smtp) {
      const transporter = require('nodemailer').createTransport(smtp);
      await transporter.sendMail({ from: process.env.SMTP_FROM || '换届系统 <no-reply@cxq.gov>', to: list.join(','), subject, text });
      sent = list.length; mailed = true;
    }
  } catch (e) { console.error('[send-review] SMTP 失败，降级为文案：', e.message.slice(0, 80)); }
  ok(res, { round: n, receivers: list, count: cands.rows.length, mailed, sent, subject, text });
}));

// ── 材料（v6.2 简化模型：一份材料=一条记录+多张拍照附件）──────
// 附件约定：uploads/<材料id>/ 目录，静态路由 /api/files/<材料id>/<文件名>
function listFiles(matId) {
  const dir = path.join(UPLOAD_DIR, String(matId));
  try { return fs.readdirSync(dir).filter(f => !f.startsWith('.')); } catch { return []; }
}
function attachFiles(rows) {
  return rows.map(m => ({ ...m, matFiles: listFiles(m.id).map(f => ({ name: f, url: `/api/files/${m.id}/${f}` })) }));
}

app.get('/api/materials', auth(), h(async (req, res) => {
  const { sql, params } = orgWhere(req.user);
  const r = await pool.query(
    `SELECT m.id, m.org_id AS "orgId", m.election_id AS "elId", m.mat_type AS "matType", m.mat_status AS "matStatus",
            m.mat_position_id AS "matPositionId", m.mat_candidate_id AS "matCandidateId",
            m.mat_submitter AS "matSubmitter", m.mat_submitter_phone AS "matSubmitterPhone", m.mat_submit_time AS "matSubmitTime",
            m.mat_review_time AS "matReviewTime", m.mat_reviewer AS "matReviewer", m.mat_review_comment AS "matReviewComment",
            m.mat_stage AS "matStage", m.mat_note AS "matNote"
     FROM materials m WHERE 1=1${sql} ORDER BY m.mat_submit_time DESC NULLS LAST`, params);
  ok(res, attachFiles(r.rows));
}));

// 归属地当前进行中的届次（材料必须挂届）
async function activeElectionOf(orgId) {
  const r = await pool.query(
    `SELECT el_id, el_term FROM elections WHERE org_id = $1 AND el_status = 'in_progress' ORDER BY el_election_date DESC LIMIT 1`, [orgId]);
  return r.rows[0] || null;
}

// 选民端：我的材料记录（含附件清单与审核结果）
// 选民小程序提交（极简：说明+拍照上传）——创建材料记录
app.get('/api/mp/materials/mine', auth(), h(async (req, res) => {
  const r = await pool.query(
    `SELECT m.id, m.election_id AS "elId", m.mat_type AS "matType", m.mat_status AS "matStatus",
            m.mat_position_id AS "matPositionId", m.mat_submit_time AS "matSubmitTime",
            m.mat_review_time AS "matReviewTime", m.mat_review_comment AS "matReviewComment", m.mat_note AS "matNote"
     FROM materials m WHERE m.mat_submitter_phone = $1 ORDER BY m.mat_submit_time DESC NULLS LAST`, [String(req.user.phone)]);
  ok(res, attachFiles(r.rows));
}));

app.post('/api/mp/materials', auth(), h(async (req, res) => {
  const { positionId, note } = req.body || {};
  const u = req.user;
  const el = await activeElectionOf(u.orgId);
  if (!el) return fail(res, 400, '本村（社区）当前没有进行中的选举，无需提交材料');
  const dup = await pool.query(
    `SELECT id, mat_status FROM materials WHERE mat_submitter_phone = $1 AND election_id = $2 AND mat_status IN ('pending','submitted') LIMIT 1`,
    [String(u.phone), el.el_id]);
  if (dup.rows[0]) return fail(res, 409, '您已有一份待审材料，请等待审核结果（驳回后可重新提交）');
  const r = await pool.query(
    `INSERT INTO materials (org_id, election_id, mat_position_id, mat_type, mat_status, mat_submitter, mat_submitter_phone, mat_submit_time, mat_stage, mat_note)
     VALUES ($1,$2,$3,'个人自荐','pending',$4,$5,$6,'提名阶段',$7)
     RETURNING id, mat_status AS "matStatus", mat_position_id AS "matPositionId", mat_note AS "matNote"`,
    [u.orgId, el.el_id, positionId || '委员', u.name || '选民', String(u.phone), now(), (note || '').trim() || null]);
  ok(res, { ...r.rows[0], elId: el.el_id, elTerm: el.el_term });
}));

// 后台手工新增（内推：甲方按岗位要求代交材料，mat_type=组织推荐）
app.post('/api/materials', auth(), requireStaff, h(async (req, res) => {
  const { name, phone, positionId, note, elId } = req.body || {};
  if (!name || !phone) return fail(res, 400, '姓名和手机号必填');
  if (!/^1\d{10}$/.test(String(phone))) return fail(res, 400, '手机号格式不对（11 位）');
  const u = req.user;
  // 届次定位三优先级：显式 elId（后台传当前届） > 归属地村（普通账号锁本村） > 超管首村有进行中届次的
  let orgId = null, targetEl = null;
  if (elId) {
    const e = await pool.query(`SELECT org_id, el_id FROM elections WHERE el_id = $1 LIMIT 1`, [elId]);
    if (!e.rows[0]) return fail(res, 400, '指定届次不存在');
    orgId = e.rows[0].org_id; targetEl = e.rows[0].el_id;
    // 非超管只允许给自己村的届内推
    if (!u.crossOrg && orgId !== u.orgId) return fail(res, 403, '只能为本村（社区）新增材料');
  } else {
    orgId = u.crossOrg ? (req.body.orgId || null) : u.orgId;
    if (!orgId) {
      // 超管未指定村：取第一个有进行中届次的村
      const any = await pool.query(`SELECT org_id, el_id FROM elections WHERE el_status = 'in_progress' ORDER BY el_election_date DESC LIMIT 1`);
      if (any.rows[0]) { orgId = any.rows[0].org_id; targetEl = any.rows[0].el_id; }
    }
    const el = targetEl ? { el_id: targetEl } : await activeElectionOf(orgId);
    if (!el) return fail(res, 400, '该村（社区）当前没有进行中的选举，请指定届次');
    targetEl = el.el_id;
  }
  const dup = await pool.query(
    `SELECT id FROM materials WHERE mat_submitter_phone = $1 AND election_id = $2 AND mat_status IN ('pending','submitted') LIMIT 1`,
    [String(phone), targetEl]);
  if (dup.rows[0]) return fail(res, 409, `${name} 已有该届待审材料，请勿重复新增`);
  const r = await pool.query(
    `INSERT INTO materials (org_id, election_id, mat_position_id, mat_type, mat_status, mat_submitter, mat_submitter_phone, mat_submit_time, mat_stage, mat_note)
     VALUES ($1,$2,$3,'组织推荐','pending',$4,$5,$6,'提名阶段',$7)
     RETURNING id, mat_status AS "matStatus", mat_type AS "matType", mat_position_id AS "matPositionId"`,
    [orgId, targetEl, positionId || '委员', name, String(phone), now(), `内推·${u.name || '经办'}${(note || '').trim() ? '：' + note.trim() : ''}`]);
  ok(res, r.rows[0]);
}));

// 通用附件追加（左示例右上传的"上传"侧；选民传自己的，工作人员可代传任何材料）
const materialUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, String(req.params.id || 'misc'));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '')}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
app.post('/api/materials/:id/file', auth(), materialUpload.single('file'), h(async (req, res) => {
  if (!req.file) return fail(res, 400, '未收到文件');
  const r = await pool.query(`SELECT org_id, mat_submitter_phone FROM materials WHERE id = $1`, [req.params.id]);
  const m = r.rows[0];
  if (!m) return fail(res, 404, '材料记录不存在');
  // 本人材料本人传；工作人员（operator/sub_admin/editor/reviewer/admin）可代传
  const isOwner = String(m.mat_submitter_phone) === String(req.user.phone) && m.org_id === req.user.orgId;
  const isStaff = req.user.role === 'admin' || (req.user.roleKeys || []).some(k => STAFF_ROLES.includes(k));
  if (!isOwner && !isStaff) return fail(res, 403, '只能给自己的材料上传附件');
  // 首个附件视为"正式提交"（pending→submitted，进入待审列表）
  const files = listFiles(req.params.id);
  if (files.length === 1) {
    await pool.query(
      `UPDATE materials SET mat_status = 'submitted', mat_submit_time = COALESCE(mat_submit_time, $2), updated_at = now() WHERE id = $1`,
      [req.params.id, now()]);
  }
  ok(res, { id: req.params.id, file: `/api/files/${req.params.id}/${req.file.filename}`, size: req.file.size, total: files.length });
}));
app.use('/api/files', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// 材料审核：通过 → 自动进候选人池（R1 待审）；驳回 → 私信回流参选人
app.put('/api/materials/:id/review', auth(), requireStaff, h(async (req, res) => {
  const { status, comment } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) return fail(res, 400, 'status 只能是 approved / rejected');
  const { sql, params } = orgWhereAt(req.user, 6);
  const r = await pool.query(
    `UPDATE materials SET mat_status = $2, mat_review_time = $3, mat_reviewer = $4, mat_review_comment = $5, updated_at = now()
     WHERE id = $1${sql} RETURNING *`, [req.params.id, status, now(), req.user.name || '', comment || '', ...params]);
  if (!r.rows[0]) return fail(res, 404, '材料不存在');
  const m = r.rows[0];
  let candId = m.mat_candidate_id || null;
  let pooled = false;
  if (status === 'approved') {
    // 入池去重：同届同手机号已有候选人则只回写关联
    const ex = await pool.query(
      `SELECT id FROM candidates WHERE election_id = $1 AND cand_phone = $2 LIMIT 1`, [m.election_id, m.mat_submitter_phone]);
    if (ex.rows[0]) {
      candId = ex.rows[0].id;
    } else {
      const ins = await pool.query(
        `INSERT INTO candidates (org_id, election_id, cand_name, cand_position_id, cand_source, cand_phone, cand_r1, cand_status, cand_note)
         VALUES ($1,$2,$3,$4,$5,$6,'待审','待初审',$7) RETURNING id`,
        [m.org_id, m.election_id, m.mat_submitter || '参选人', m.mat_position_id || '委员',
          m.mat_type === '组织推荐' ? 'org_recommend' : 'self', m.mat_submitter_phone,
          `材料通过入池（材料号 ${String(m.id).slice(0, 8)}）`]);
      candId = ins.rows[0].id;
      pooled = true;
    }
    await pool.query(`UPDATE materials SET mat_candidate_id = $2 WHERE id = $1`, [m.id, candId]);
    // 私信：材料通过
    if (m.mat_submitter_phone) {
      await pool.query(
        `INSERT INTO notifications (notif_id, org_id, election_id, notif_type, notif_content, notif_to_phones, notif_status, notif_scheduled_at, notif_source_type, notif_source_key)
         VALUES ($1,$2,$3,'material_approved',$4,$5,'sent',now(),'materials',$6)`,
        ['N' + Date.now(), m.org_id, m.election_id,
          `您提交的参选材料已通过审核，进入候选人池，将参加 R1 初审。请保持手机畅通。`,
          m.mat_submitter_phone, String(m.id)]);
    }
  } else if (m.mat_submitter_phone) {
    await pool.query(
      `INSERT INTO notifications (notif_id, org_id, election_id, notif_type, notif_content, notif_to_phones, notif_status, notif_scheduled_at, notif_source_type, notif_source_key)
       VALUES ($1,$2,$3,'material_rejected',$4,$5,'sent',now(),'materials',$6)`,
      ['N' + Date.now(), m.org_id, m.election_id,
        `您提交的材料「${m.mat_type || ''}」未通过审核，原因：${comment || '未注明'}，请修改后重新提交。`,
        m.mat_submitter_phone, String(m.id)]);
  }
  ok(res, { id: m.id, matStatus: m.mat_status, matReviewer: m.mat_reviewer, matReviewComment: m.mat_review_comment, candidateId: candId, pooled });
}));

// 兼容旧端点（历史调用方）：上传即建附件目录（等价 :id/file）
app.post('/api/materials/:id/upload', auth(), materialUpload.single('file'), h(async (req, res) => {
  if (!req.file) return fail(res, 400, '未收到文件');
  ok(res, { id: req.params.id, file: `/api/files/${req.params.id}/${req.file.filename}`, size: req.file.size, total: listFiles(req.params.id).length });
}));

// ── 其余列表（同一工厂）────────────────────────────────
const SIMPLE = {
  notifications: `SELECT n.id, n.org_id AS "orgId", n.election_id AS "elId", n.notif_type AS "notifType", n.notif_content AS "notifContent", n.notif_status AS "notifStatus", n.notif_scheduled_at AS "notifScheduledAt", n.notif_to_phones AS "notifToPhones" FROM notifications n WHERE 1=1__SCOPE__ ORDER BY n.notif_scheduled_at DESC NULLS LAST`,
  roster: `SELECT r.id, r.org_id AS "orgId", r.ros_position AS "rosPosition", r.ros_name AS "rosName", r.ros_phone AS "rosPhone", r.ros_term AS "rosTerm", r.ros_status AS "rosStatus" FROM roster r WHERE 1=1__SCOPE__ ORDER BY r.ros_position`,
  results: `SELECT er.id, er.org_id AS "orgId", er.org_name AS "orgName", er.election_id AS "elId", er.er_election_date AS "erElectionDate", er.er_position AS "erPosition", er.er_winner_name AS "erWinnerName", er.er_votes AS "erVotes", er.er_turnout AS "erTurnout", er.er_filing_status AS "erFilingStatus" FROM election_results er WHERE 1=1__SCOPE__ ORDER BY er.er_election_date DESC`,
  archives: `SELECT ar.id, ar.org_id AS "orgId", ar.election_id AS "elId", ar.arch_source_type AS "archSourceType", ar.arch_display_name AS "archDisplayName", ar.arch_visibility AS "archVisibility", ar.arch_file_version AS "archFileVersion" FROM archives ar WHERE 1=1__SCOPE__ ORDER BY ar.created_at`,
};
for (const [name, sql] of Object.entries(SIMPLE)) {
  app.get(`/api/${name}`, ...listFactory(name, sql, req => orgWhere(req.user)));
}

// ── 岗位（真实持久化：列表含附件 + 附件上传）────────────
const positionUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, 'positions', String(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '')}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
app.get('/api/positions', auth(), h(async (req, res) => {
  const ow = orgWhereAt(req.user, 1);
  const params = [...ow.params];
  let elCond = '';
  if (req.query.electionId) { elCond = ` AND p.election_id = $${params.length + 1}`; params.push(String(req.query.electionId)); }
  const r = await pool.query(
    `SELECT p.id, p.org_id AS "orgId", p.election_id AS "elId", p.pos_type AS "posType", p.pos_quota AS "posQuota", p.pos_status AS "posStatus", p.pos_desc AS "posDesc"
     FROM positions p WHERE 1=1${ow.sql}${elCond} ORDER BY p.pos_type`, params);
  const rows = r.rows.map((x) => ({
    ...x,
    posFiles: filesOf('positions/' + x.id),
  }));
  ok(res, rows);
}));
app.post('/api/positions/:id/file', auth(), positionUpload.single('file'), h(async (req, res) => {
  if (!req.file) return fail(res, 400, '未收到文件');
  const r = await pool.query(`SELECT id FROM positions WHERE id = $1`, [req.params.id]);
  if (!r.rows[0]) return fail(res, 404, '岗位不存在');
  ok(res, { id: req.params.id, file: `/api/files/positions/${req.params.id}/${req.file.filename}`, size: req.file.size });
}));

// ── 后台：人员（admin）+ 仪表盘预警 ────────────────────
app.get('/api/users', auth(), requireAdmin, h(async (req, res) => {
  const r = await pool.query(
    `SELECT a.id, a.acc_phone AS "accPhone", a.acc_name AS "accName", a.org_id AS "orgId", o.name AS "orgName",
            a.roles, a.acc_status AS "accStatus", a.created_at AS "createdAt"
     FROM accounts a LEFT JOIN organizations o ON o.slug = a.org_id ORDER BY a.org_id, a.acc_phone`);
  ok(res, r.rows);
}));

app.get('/api/dashboard/alerts', auth(), h(async (req, res) => {
  const { sql, params } = orgWhere(req.user);
  const alerts = [];
  const cand = await pool.query(`SELECT count(*)::int n FROM candidates WHERE cand_r3 = '待审'${sql}`, params);
  if (cand.rows[0].n > 0) alerts.push({ level: 'warning', text: `${cand.rows[0].n} 名候选人待第 3 轮联审` });
  const mat = await pool.query(`SELECT count(*)::int n FROM materials WHERE mat_status IN ('submitted','pending')${sql}`, params);
  if (mat.rows[0].n > 0) alerts.push({ level: 'info', text: `${mat.rows[0].n} 份材料待审核` });
  const ann = await pool.query(`SELECT count(*)::int n FROM announcements WHERE ann_status = 'draft'${sql}`, params);
  if (ann.rows[0].n > 0) alerts.push({ level: 'info', text: `${ann.rows[0].n} 份公告草稿待发布` });
  const stage = await pool.query(
    `SELECT s.stage_name, s.stage_end_date FROM election_stages s WHERE s.stage_status = '进行中'${sql}
     ORDER BY s.stage_end_date LIMIT 3`, params);
  for (const s of stage.rows) alerts.push({ level: 'warning', text: `「${s.stage_name}」进行中，${s.stage_end_date} 截止` });
  ok(res, alerts);
}));

// ── 404 兜底 + 启动 ────────────────────────────────────
app.use((req, res) => fail(res, 404, `接口不存在：${req.method} ${req.url}`));

// 幂等建表：提案岗位行（proposal_posts）
pool.query(`CREATE TABLE IF NOT EXISTS proposal_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  pos_type varchar(50) DEFAULT '委员',
  pos_quota int DEFAULT 1,
  pos_desc text,
  created_at timestamptz DEFAULT now()
)`).then(() => console.log('[api] proposal_posts 表就绪')).catch((e) => console.error('[api] proposal_posts 建表失败：', e.message.slice(0, 80)));
// 提案创建时持久化正式选举日(D)，审批通过时从事务内读取（避免二次传参丢失）
pool.query(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS prop_election_date date`)
  .then(() => console.log('[api] proposals.prop_election_date 列就绪'))
  .catch((e) => console.error('[api] prop_election_date 加列失败：', e.message.slice(0, 80)));
pool.query(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS prop_report text`)
  .then(() => console.log('[api] proposals.prop_report 列就绪'))
  .catch((e) => console.error('[api] prop_report 加列失败：', e.message.slice(0, 80)));

// 公告编辑态持久化（小编工作台是唯一编辑器，编辑字段必须落库、刷新不丢；附件不走列，走 uploads 目录扫描 annFiles）
pool.query(`ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS ann_sign text,
  ADD COLUMN IF NOT EXISTS ann_sign_date varchar(40),
  ADD COLUMN IF NOT EXISTS ann_open_material_submit boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ann_publish_mode varchar(16) DEFAULT 'immediate',
  ADD COLUMN IF NOT EXISTS ann_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS ann_remind_hours int DEFAULT 24,
  ADD COLUMN IF NOT EXISTS ann_remind_to varchar(60) DEFAULT 'editor,admin'`)
  .then(() => console.log('[api] announcements 编辑态列就绪'))
  .catch((e) => console.error('[api] announcements 加列失败：', e.message.slice(0, 80)));

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[api] listening on 0.0.0.0:${PORT}`);
  try {
    const r = await pool.query('SELECT now()::date d, (SELECT count(*) FROM organizations) orgs');
    console.log(`[api] 数据库连接成功（Neon）· today=${r.rows[0].d} · organizations=${r.rows[0].orgs}`);
  } catch (e) { console.error('[api] 数据库连接失败：', JSON.stringify({ name: e.name, msg: e.message, code: e.code })); }
});

// 进程级守护：单请求异常绝不杀整个服务
process.on('uncaughtException', e => console.error('[api] uncaught:', e.message));
process.on('unhandledRejection', e => console.error('[api] unhandled:', e));
