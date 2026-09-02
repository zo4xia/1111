/** 从单个页面快捷取全局 app 与作用域数据 */
function ctx() {
  const app = getApp()
  return { app, g: app.globalData, s: app.scoped() }
}

/* ==================== 材料口径单一真相 ====================
 * 定义（method / material / notice 三页共用，禁止各页再各写一套）：
 *   MATERIAL_TYPES     —— 需提交材料清单（说明卡直接渲染，不另写一套文字）
 *   MATERIAL_STAGE_KEYS—— 与材料上报相关的公告阶段（D-15 提名启动 ~ D-13 收审截止，含 D-14）
 * 关于 D-14：它是真实阶段（election_stages「候选人提名延续」，es_note 明写
 *   「持续接收提名材料；r1持续收审」），证明材料窗口是 D-15→D-13 连续的、不是各自孤立的
 *   单日。目前 announcements 表未落 D-14 公告，故不出现在列表里，但白名单必须保留。
 */
const MATERIAL_TYPES = ['个人自荐表', '身份证', '个人简历', '无犯罪记录证明', '组织推荐函']
const MATERIAL_STAGE_KEYS = ['D-15', 'D-14', 'D-13']

/** 展示名：来源枚举 → 中文 */
function sourceLabel(v) { return v === 'self' ? '个人自荐' : '组织推荐' }

/**
 * 状态语义表（全站唯一真相）
 * 返回 cls 必须是 app.wxss 中 .tag-* 的语义后缀：
 *   live 进行中 / done 已完成 / warn 警告 / bad 否决 / none 未开始
 * 任何页面不得再自造状态色。
 */

/** 四轮审核展示色 */
function roundType(v) {
  if (v === '通过' || v === '当选') return 'done'
  if (v === '不通过') return 'bad'
  if (v === '预选未入围') return 'warn'
  if (v === '待审') return 'live'
  return 'none'
}

/** 候选状态展示色 */
function statusType(v) {
  if (['当选', '正式候选人'].includes(v)) return 'done'
  if (['联审不通过', '初审退出', '考察不通过'].includes(v)) return 'bad'
  if (['预选未入围', '落选'].includes(v)) return 'warn'
  if (v && v.indexOf('待') === 0) return 'live'
  return 'none'
}

/** 材料状态：展示口径单一真相（material / profile 共用，禁止各页各写一套）
 *  pending/passed = 服务端 /api/materials 写入与审核实际使用的值（POST 落 pending，审核落 approved/rejected） */
const MATERIAL_STATUS = {
  submitted: { text: '已提交', cls: 'live' },
  pending: { text: '待审核', cls: 'live' },
  needs_correction: { text: '待补正', cls: 'warn' },
  approved: { text: '已通过', cls: 'done' },
  passed: { text: '已通过', cls: 'done' },
  rejected: { text: '未通过', cls: 'bad' }
}
function materialStatus(v) {
  return MATERIAL_STATUS[v] || { text: v || '—', cls: 'none' }
}

module.exports = {
  ctx, sourceLabel, roundType, statusType, materialStatus,
  MATERIAL_TYPES, MATERIAL_STAGE_KEYS
}
