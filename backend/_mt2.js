// 临时：用候选人手机号验证 materials 映射 + 通知状态枚举分布
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
  const DB = require('c:/Users/zo4xi/Desktop/3/miniprogram/data/db.js').DB
  const admin = DB.accounts.find(a => a.acc_status === 'active')
  const lr = await call('POST', '/api/login', { phone: admin.acc_phone, password: admin.acc_password_hint || '123456', orgId: admin.acc_org_id })
  const adminTok = lr.data.token

  // 通知状态枚举分布（关键：profile 页只认 sent）
  const nr = await call('GET', '/api/notifications', null, adminTok)
  if (nr.code === 0) {
    const rows = nr.data || []
    const dist = {}
    rows.forEach(r => { dist[r.notifStatus] = (dist[r.notifStatus] || 0) + 1 })
    log('=== notifications 状态枚举分布（全部）===')
    log('  ' + JSON.stringify(dist))
    log('  ⚠ profile 页未读红点逻辑: filter(notif_status === "sent")')
    const sentN = rows.filter(r => r.notifStatus === 'sent').length
    log('  → status="sent" 的条数: ' + sentN + '/' + rows.length + (sentN === 0 ? '  ❌ 红点恒为 0' : '  ✅'))
  }

  // 候选人手机号 → 尝试登录 → 测 materials
  const cr = await call('GET', '/api/candidates', null, adminTok)
  const phones = [...new Set((cr.code === 0 ? cr.data || [] : []).map(c => c.candPhone).filter(Boolean))]
  log('')
  log('=== 候选人手机号 ' + phones.length + ' 个，逐个尝试登录测 materials ===')

  let hit = 0
  for (const p of phones.slice(0, 10)) {
    const ml = await call('POST', '/api/mp/login', { phone: p })
    if (ml.code !== 0) { log('  [' + p + '] 登录失败: ' + (ml.message || '').slice(0, 50)); continue }
    const tok = ml.data.token, orgId = ml.data.user.orgId, phone = ml.data.user.phone
    const mr = await call('GET', '/api/mp/materials/mine', null, tok)
    const rows = (mr.code === 0 ? mr.data || [] : [])
    log('  [' + p + '@' + orgId + '] materials → ' + rows.length + '行')
    if (rows.length) {
      hit++
      log('    原始字段: ' + Object.keys(rows[0]).join(','))
      const mapped = map.mapMaterials(rows, { orgId, phone })
      log('    映射[0]: ' + JSON.stringify(mapped[0]))
      const need = ['mat_applicant_id', 'mat_status', 'mat_type', 'mat_submit_time', 'mat_review_comment', 'mat_attachments']
      const bad = need.filter(f => !mapped.some(x => x[f] !== '' && x[f] !== null && x[f] !== undefined && (!Array.isArray(x[f]) || x[f].length)))
      log('    ✅ 页面依赖字段齐全: ' + (need.length - bad.length) + '/' + need.length)
      log('    ⚠ 全空字段: ' + (bad.length ? bad.join(',') : '无'))
      if (hit >= 2) break
    }
  }
  if (!hit) {
    log('')
    log('⚠ 所有候选人手机号均无材料记录（库里可能确实没有选民提交的材料）')
    log('  → 用构造样本验证 materials 映射（字段名契约层面）:')
    const fake = [{ id: 'm1', elId: 'el-15', matType: '个人自荐', matStatus: 'submitted', matPositionId: '主任', matSubmitTime: '2026-07-16 14:00:00', matReviewTime: '2026-07-17 09:00:00', matReviewComment: '材料齐全', matNote: '备注', files: [{ name: 'a.jpg', url: '/api/files/m1/a.jpg' }] }]
    const m = map.mapMaterials(fake, { orgId: 's-jiankou', phone: '13800000002' })
    log('    ' + JSON.stringify(m[0]))
  }
  fin()
}
function fin() { fs.writeFileSync(__dirname + '/_mt2_out.txt', out.join('\n'), 'utf8'); console.log('DONE') }
main().catch(e => { fs.writeFileSync(__dirname + '/_mt2_out.txt', 'ERROR ' + e.message + '\n' + e.stack, 'utf8') })
