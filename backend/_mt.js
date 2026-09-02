// 临时：用 Neon 库真实选民账号验证 materials / notifications 映射
const http = require('http')
const fs = require('fs')
const map = require('c:/Users/zo4xi/Desktop/3/miniprogram/data/map.js')
const out = []
const log = (...a) => out.push(a.join(' '))

function call(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const o = { hostname: '127.0.0.1', port: 8080, path, method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}) }
    if (data) o.headers['Content-Length'] = Buffer.byteLength(data)
    const r = http.request(o, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve({ code: -1, raw: d }) } }) })
    r.on('error', reject); if (data) r.write(data); r.end()
  })
}

async function main() {
  // 1. 平台账号登录 → /api/users 拿真实手机号
  const DB = require('c:/Users/zo4xi/Desktop/3/miniprogram/data/db.js').DB
  const admin = DB.accounts.find(a => a.acc_status === 'active')
  const lr = await call('POST', '/api/login', { phone: admin.acc_phone, password: admin.acc_password_hint || '123456', orgId: admin.acc_org_id })
  if (lr.code !== 0) { log('管理员登录失败:', JSON.stringify(lr)); return fin() }
  const adminTok = lr.data.token
  log('管理员登录 OK:', lr.data.user.phone, 'role=' + lr.data.user.role)

  const ur = await call('GET', '/api/users', null, adminTok)
  if (ur.code !== 0) { log('/api/users 失败:', JSON.stringify(ur).slice(0, 200)); return fin() }
  const users = ur.data || []
  log('真实账号数:', users.length)
  log('账号样本:', JSON.stringify(users.slice(0, 3)))

  // 2. 挑非平台账号（普通选民/经办），逐个尝试登录
  const candidates = users.filter(u => u.orgId && u.orgId !== 'boss' && u.accPhone)
  log('')
  log('可试用普通账号数:', candidates.length)

  let tested = 0
  for (const u of candidates.slice(0, 12)) {
    // 免密登录：需 acc_password_hint 为 NO.MP 或 123456
    const ml = await call('POST', '/api/mp/login', { phone: u.accPhone })
    if (ml.code !== 0) { log('  [' + u.accPhone + '@' + u.orgId + '] mp/login 不可用:', (ml.message || '').slice(0, 60)); continue }
    const tok = ml.data.token
    const orgId = ml.data.user.orgId, phone = ml.data.user.phone
    log('')
    log('=== 登录成功: ' + phone + '@' + orgId + ' ===')

    // materials
    const mr = await call('GET', '/api/mp/materials/mine', null, tok)
    if (mr.code !== 0) log('  materials FAIL:', JSON.stringify(mr).slice(0, 150))
    else {
      const rows = mr.data || []
      log('  /api/mp/materials/mine → ' + rows.length + '行')
      if (rows[0]) {
        log('    原始字段:', Object.keys(rows[0]).join(','))
        const mapped = map.mapMaterials(rows, { orgId, phone })
        log('    映射[0]:', JSON.stringify(mapped[0]))
        const ok = mapped.filter(x => x.mat_status && x.mat_submit_time).length
        log('    ✅ status+submitTime 齐全: ' + ok + '/' + mapped.length)
        // 页面依赖字段校验
        const need = ['mat_applicant_id', 'mat_status', 'mat_type', 'mat_submit_time', 'mat_review_comment', 'mat_attachments']
        const bad = need.filter(f => !mapped.some(x => x[f] !== '' && x[f] !== null && x[f] !== undefined))
        log('    ⚠ 页面依赖但全空的字段:', bad.length ? bad.join(',') : '无')
      }
    }

    // notifications
    const nr = await call('GET', '/api/notifications', null, tok)
    if (nr.code !== 0) log('  notifications FAIL:', JSON.stringify(nr).slice(0, 150))
    else {
      const rows = nr.data || []
      log('  /api/notifications → ' + rows.length + '行')
      if (rows[0]) log('    原始字段:', Object.keys(rows[0]).join(','))
      if (rows[0]) log('    样本 notifToPhones:', JSON.stringify(rows.slice(0, 3).map(x => x.notifToPhones)))
      const nf = map.mapMyNotifications(rows, orgId, phone)
      log('    过滤后命中我的通知: ' + nf.notifications.length + '/' + rows.length)
      if (nf.notifications[0]) log('    映射[0]:', JSON.stringify(nf.notifications[0]))
      if (nf.notification_reads[0]) log('    已读[0]:', JSON.stringify(nf.notification_reads[0]))
      const need = ['notif_id', 'notif_status']
      const bad = need.filter(f => !nf.notifications.some(x => x[f] !== '' && x[f] !== null && x[f] !== undefined))
      log('    ⚠ 页面依赖但全空的字段:', bad.length ? bad.join(',') : '无')
    }
    tested++
    if (tested >= 2) break // 验 2 个账号足够
  }
  if (!tested) log('未找到可登录的普通账号')
  fin()
}
function fin() { fs.writeFileSync(__dirname + '/_mt_out.txt', out.join('\n'), 'utf8'); console.log('DONE') }
main().catch(e => { fs.writeFileSync(__dirname + '/_mt_out.txt', 'ERROR ' + e.message + '\n' + e.stack, 'utf8') })
