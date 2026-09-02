const { ctx } = require('../../utils/kit')
const { computeStageDates, daysBetween, parseDate, fmtDate, fullRange } = require('../../utils/dates')
const icons = require('../../utils/icons')

/* ───────────────────────────────────────────────────────────────────────
 * 本页依赖的 DB 字段（外部系统适配 / 内容映射锚点）
 * 权威真相见仓库根 db_structure.md；字段名=小程序口径（蛇形前缀），
 * 服务端 PG 字段需经 data/map.js 翻译（org_id→el_org_id 等）。
 * 全局上下文（ctx）：g.orgId/g.electionId/g.account.acc_phone/g.snapshotDate
 * ── 取数表 → 字段 ──────────────────────────────────────────────────────
 * elections      : el_name, el_election_date, el_org_id
 * election_stages: es_stage_key, es_stage_name, es_status, es_offset_start, es_offset_end
 *                  （plan_start/plan_end 由 computeStageDates 经 el_election_date + offset 算出）
 * announcements   : ann_code, ann_title, ann_publish_time, ann_edit_time, ann_pin, ann_type, ann_status
 * roster          : ros_term, ros_name, ros_position, ros_note, ros_phone
 * organizations   : name, type
 * ─────────────────────────────────────────────────────────────────────── */

Page({
  data: {
    icons: icons.dai,
    orgName: '',
    electionName: '',
    dDate: '',
    daysToD: 0,
    currentStage: null,
    marqueeText: '',
    grid: [],
    latestAnns: [],
    nextStage: null,
    progressDone: 0,
    roster: []
  },

  onShow() { this.refresh() },

  refresh() {
    const { app, g, s } = ctx()
    if (!g.account || !g.orgId || !g.electionId) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const el = app.election()
    const org = app.org()
    const stages = computeStageDates(el.el_election_date, s.stages)

    // 顶部公告走马灯：只展示当前组织、当前届次中最新发布的公告。
    // 未读通知属于个人消息，不能替代面向全体用户的正式公告。
    const anns = s.announcements
      .filter(a => a.ann_status === 'published' || a.ann_status === '已发布')
      .slice()
      .sort((a, b) => (b.ann_publish_time || '').localeCompare(a.ann_publish_time || ''))
    // ⇠ 后端[announcements.ann_publish_time / ann_edit_time] 单条公告距“今日”≤24h 判定为“新”
    //   首页「公告通知」icon 小红点与下方列表“新”角标共用此判定，保证口径一致。
    //   演示基准 = 快照日（g.snapshotDate），与下方 7 天窗口共用同一“今日”，
    //   避免真实时钟（2026-08）与 7 月快照数据错位 → 预告区恒空、“新”角标恒无。
    const DAY = 24 * 3600 * 1000
    const today0 = parseDate(g.snapshotDate) || (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })()
    const nowTs = today0.getTime()
    const isNewAnn = (a) => {
      const t = a.ann_publish_time || a.ann_edit_time
      if (!t) return false
      const ts = new Date(String(t).replace(/-/g, '/')).getTime()
      return Math.abs(nowTs - ts) <= DAY
    }
    // 只要有任意一条近 24h 内更新 → icon 显示未读小红点
    const hasNewAnn = anns.some(isNewAnn)
    const latestAnn = anns[0]
    const marqueeText = latestAnn
      ? '最新公告：' + latestAnn.ann_code + ' · ' + latestAnn.ann_title
      : '当前暂无已发布公告'

    // 首页公告列表：与走马灯使用同一份“最新已发布公告”数据源；
    // 角标“新”复用 isNewAnn 判定（≤24h）；“置顶/通知/公告”来自后端演示字段 ann_pin / ann_type（后端 xlsx 暂缺，需补列）。
    const latestAnns = anns.slice(0, 2).map(a => ({
      code: a.ann_code,
      title: a.ann_title,
      date: (a.ann_publish_time || a.ann_edit_time || '').slice(0, 10),
      isNew: isNewAnn(a),
      isPin: !!a.ann_pin,                       // ⇠ 后端[announcements.ann_pin] 置顶角标（演示字段，待后端补列）
      type: a.ann_type || '公告'                // ⇠ 后端[announcements.ann_type] 类型角标：通知 / 公告（演示字段，待后端补列）
    }))

    // Hero 参数来源：选举主表提供 D 日，阶段表提供当前进度和下一阶段。
    const active = stages.find(x => x.es_status === '办理中')
    const upcoming = stages.filter(x => x.plan_start && x.plan_start > g.snapshotDate && x.es_status === '未开始')
    const doneCount = s.stages.filter(x => x.es_status === '已完成').length

    // ===== 近期选举预告 · 展示逻辑（样式不变，仅补充判定与注释）=====
    // 规则（务必看清）：
    //   1) 以“当日”作为第 1 天（day=1 起算），向后取 7 天窗口 = [当日, 当日+6天]（含首尾共 7 天）。
    //   2) 窗口内“是否存在选举阶段”的判定标准 = 是否“发过公告”——
    //      只要在该 7 天窗口内存在任意一条【已发布 / published】的公告
    //      （以 ann_publish_time 或 ann_edit_time 落窗判断），即认定“7 天内有选举阶段”。
    //   3) 满足则该区展示，内容取本届次【预置 / 填充】的下一阶段 nextStageRaw（演示数据，仅撑版面，非实时接口）；
    //      不满足则不展示，避免空占位。
    today0.setHours(0, 0, 0, 0)   // 当日（第 1 天），归零到 00:00（快照日已归零，兜底重复归零无副作用）
    const winEnd = new Date(today0.getTime() + 6 * DAY)       // 7 天窗口末日 = 当日+6天（含首尾共 7 天）
    const in7d = (t) => {                                      // 判断某日期是否落在 7 天窗口内
      if (!t) return false
      const d = parseDate(String(t).slice(0, 10)); if (!d) return false
      const ts = d.getTime()
      return ts >= today0.getTime() && ts <= winEnd.getTime()
    }
    // 任一已发布公告的发布/编辑时间落窗 → 视为 7 天内有选举阶段
    const hasStageIn7d = anns.some(a => in7d(a.ann_publish_time) || in7d(a.ann_edit_time))
    // 预告卡内容 = 预置的下一阶段（填充数据）；仅当 7 天窗口内有公告时才展示
    const nextStageRaw = upcoming.length ? upcoming[0] : null
    const showForecast = hasStageIn7d && !!nextStageRaw

    // 村/居委会干部花名册（纯展示，人工维护；后端 roster 表，按当前组织作用域隔离 s.roster）
    // 字段映射：ros_term=届期 / ros_name=姓名 / ros_position=职位 / ros_note=简介 / ros_phone=联系方式
    const roster = s.roster.map(r => ({
      term: r.ros_term,
      name: r.ros_name,
      position: r.ros_position,
      note: r.ros_note || '',
      phone: r.ros_phone || ''
    }))

    this.setData({
      orgName: org ? org.name : '',
      electionName: el.el_name,
      dDate: fmtDate(parseDate(el.el_election_date)),
      daysToD: daysBetween(g.snapshotDate, el.el_election_date),
      currentStage: active ? { key: active.es_stage_key, name: active.es_stage_name, start: active.plan_start, end: active.plan_end, range: fullRange(active.plan_start, active.plan_end) } : null,
      marqueeText,
      grid: [
        { ic: 'bell',   label: '公告通知', url: '/pages/notice/notice', dot: hasNewAnn },
        { ic: 'ballot', label: '报名参选', url: '/pages/method/method' },
        { ic: 'user',   label: '选举公示', url: '/pages/candidate/candidate' },
        { ic: 'file',   label: '材料提交', url: '/pages/material/material' }
      ],
      latestAnns,
      // 村/居委会干部花名册：直接展示作用域内 roster 数据（纯展示，人工维护）
      roster,
      // 近期选举预告：仅当 7 天窗口内有已发布公告且存在预置下一阶段时才展示
      nextStage: showForecast ? {
        key: nextStageRaw.es_stage_key,
        name: nextStageRaw.es_stage_name,
        start: nextStageRaw.plan_start,
        end: nextStageRaw.plan_end
      } : null,
      progressDone: stages.length ? Math.round(doneCount / stages.length * 100) : 0
    })
  },

  goGrid(e) {
    const url = e.currentTarget.dataset.url
    const tabPages = ['/pages/home/home', '/pages/notice/notice', '/pages/candidate/candidate', '/pages/profile/profile']
    if (tabPages.includes(url)) { wx.switchTab({ url }); return }
    wx.navigateTo({ url })
  },

  goNotice() { wx.switchTab({ url: '/pages/notice/notice' }) },

  // 点击首页某条最新公告 → 跳转到该公告的详情（而非笼统推到列表页）。
  // notice 是 tab 页无法带参，故把目标 ann_code 挂到全局挂起参数，由 notice.onShow 接收并打开详情。
  goAnnDetail(e) {
    const code = e.currentTarget.dataset.code
    getApp().pendingAnnCode = code
    wx.switchTab({ url: '/pages/notice/notice' })
  }
})
