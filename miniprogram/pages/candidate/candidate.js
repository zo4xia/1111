const { ctx, sourceLabel, roundType, statusType } = require('../../utils/kit')
const { DB, reviewRoundsByOrgType } = require('../../data/db')
const icons = require('../../utils/icons')

/* ───────────────────────────────────────────────────────────────────────
 * 本页依赖的 DB 字段（外部系统适配 / 内容映射锚点）
 * 权威真相见仓库根 db_structure.md；服务端 PG 字段经 data/map.js 翻译。
 * 全局上下文：g.orgId / g.electionId；审核轮次定义取自 DB.reviewRoundsByOrgType（按 org.type 切换）
 * ── 取数表 → 字段 ──────────────────────────────────────────────────────
 * elections  : el_org_id, el_status, el_id, el_name
 * candidates : cand_election_id, cand_status, cand_name, cand_position_id, cand_source,
 *              cand_gender, cand_age, cand_votes, cand_note,
 *              cand_r1(+_time/_reviewer/_comment), cand_r2(...), cand_r3(...), cand_r4(...)
 *              （动态轮次键 cand_{r.key} 由 ROUND_DEFS / reviewRoundsByOrgType 驱动，非写死）
 * positions  : pos_election_id, pos_type, pos_quota（岗位口径/配额）
 * ─────────────────────────────────────────────────────────────────────── */

// 公示口径：出局（预选未入围/初审退出/联审不通过/考察不通过）不展示；
// 当选/落选为 D 日投票结果，走完全流程，保留。
const OUT_STATUSES = ['预选未入围', '初审退出', '联审不通过', '考察不通过']
const CN_NO = ['一', '二', '三', '四', '五']

// 状态短文案（名单 chip 用）
function statusShort(s) {
  if (s === '待第3轮') return '联审中'
  if (s === '待第4轮考察') return '考察中'
  if (s === '待第2轮') return '初审中'
  if (s === '待第1轮') return '收审中'
  return s
}

Page({
  data: {
    icons: icons.dai,
    elections: [],
    activeElection: '',
    activeElectionName: '',
    summary: '',
    groups: [],
    detail: null,
    detailRounds: []
  },

  onShow() { this.refresh() },

  refresh() {
    const { app, g } = ctx()
    if (!g.account || !g.orgId || !g.electionId) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const orgs = [app.org()].filter(Boolean)
    const elections = orgs.map(o => {
      const el = DB.elections.find(e => e.el_org_id === o.slug && e.el_status === 'in_progress')
      return { id: el.el_id, name: o.name, short: o.name.replace(/居委会|村委会/, ''), typeLabel: o.type === 'community_committee' ? '居委会' : '村委会' }
    })
    const activeElection = this.data.activeElection || g.electionId
    const active = elections.find(e => e.id === activeElection) || elections[0]
    this.setData({ elections, activeElection: active.id, activeElectionName: active.name })
    this.loadCandidates(active.id)
  },

  loadCandidates(elId) {
    const { app, s } = ctx()
    // 轮次标签随当前归属地 org.type 切换口径（db.js REVIEW_ROUND_CATALOG）
    const ROUND_DEFS = reviewRoundsByOrgType((app.org() && app.org().type) || 'village_committee')
    const isDone = elId === 'el-11'
    const shown = s.candidates
      .filter(c => c.cand_election_id === elId && !OUT_STATUSES.includes(c.cand_status))
      .map(c => ({
        name: c.cand_name, position: c.cand_position_id, source: sourceLabel(c.cand_source),
        gender: c.cand_gender, age: c.cand_age, status: c.cand_status, statusShort: statusShort(c.cand_status),
        statusCls: statusType(c.cand_status), votes: c.cand_votes, note: c.cand_note,
        rounds: ROUND_DEFS.map(r => ({
          key: r.key, label: r.label, val: c['cand_' + r.key], cls: roundType(c['cand_' + r.key]),
          time: c['cand_' + r.key + '_time'], reviewer: c['cand_' + r.key + '_reviewer'], comment: c['cand_' + r.key + '_comment']
        })),
        // 当前所在轮（第一个待审轮）
        curRound: ROUND_DEFS.find(r => c['cand_' + r.key] === '待审') || null,
        raw: c
      }))

    // 按岗位分容器：岗位名 + 应选职数 + 当前审核阶段 + 名单
    const posRows = DB.positions.filter(p => p.pos_election_id === elId)
    const posOrder = posRows.length ? posRows.map(p => p.pos_type) : ['主任', '副主任', '委员']
    const groups = posOrder.map((title, gi) => {
      const members = shown.filter(c => c.position === title)
      const quota = posRows.find(p => p.pos_type === title)
      // 组内当前阶段 = 待审轮最深者；全部无待审 = 四轮全过（投票/当选）
      let stageText = '四轮审核全部通过'
      let doing = false
      const pending = members.filter(m => m.curRound)
      if (pending.length) {
        let deepest = pending[0]
        pending.forEach(m => {
          const a = ROUND_DEFS.findIndex(r => r.key === m.curRound.key)
          const b = ROUND_DEFS.findIndex(r => r.key === deepest.curRound.key)
          if (a > b) deepest = m
        })
        stageText = deepest.curRound.label + ' 审核中'
        doing = true
      } else if (members.some(m => m.status === '当选' || m.status === '落选')) {
        stageText = '投票结果已公示'
      }
      // 缺额计算（positions.pos_quota 真相源）：投票前 = 职数 − 在审人数；开票后 = 职数 − 当选人数
      const quotaNum = quota ? Number(quota.pos_quota) || 0 : 0
      const wonCount = members.filter(m => m.status === '当选').length
      const voted = members.some(m => m.status === '当选' || m.status === '落选')
      return {
        title, cnNo: CN_NO[gi] || String(gi + 1),
        quota: quotaNum,
        gap: Math.max(0, quotaNum - (voted ? wonCount : members.length)),
        stageText, doing,
        members
      }
    }).filter(gp => gp.members.length || gp.quota)

    const inPool = shown.filter(c => c.status.indexOf('待') === 0)
    const won = shown.filter(c => c.status === '当选')
    this.setData({
      groups,
      summary: isDone
        ? '当选 ' + won.length + ' 人 · 落选 ' + (shown.length - won.length) + ' 人（全流程完结样本）'
        : '审核进行中 ' + inPool.length + ' 人 · 共 ' + shown.length + ' 人（出局人员不公示）'
    })
  },

  openDetail(e) {
    const g = Number(e.currentTarget.dataset.g), i = Number(e.currentTarget.dataset.i)
    const c = (this.data.groups[g] || {}).members ? this.data.groups[g].members[i] : null
    if (!c) return
    this.setData({ detail: c, detailRounds: c.rounds })
  },
  closeDetail() { this.setData({ detail: null }) }
})
