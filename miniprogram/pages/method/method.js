const { ctx } = require('../../utils/kit')
const { computeStageDates } = require('../../utils/dates')
const { DB } = require('../../data/db')
const icons = require('../../utils/icons')

/* ───────────────────────────────────────────────────────────────────────
 * 本页依赖的 DB 字段（外部系统适配 / 内容映射锚点）
 * 权威真相见仓库根 db_structure.md；服务端 PG 字段经 data/map.js 翻译。
 * 全局上下文：g.orgId / g.electionId
 * ── 取数表 → 字段 ──────────────────────────────────────────────────────
 * elections       : el_id, el_term, el_name, el_status, el_election_date,
 *                   el_method, el_note, el_org_id
 * election_stages : es_election_id, es_stage_key, es_stage_name, es_status,
 *                   es_offset_start, es_offset_end
 * positions      : pos_org_id, pos_election_id, pos_type, pos_quota, pos_status, pos_desc
 * ─────────────────────────────────────────────────────────────────────── */

const STAGE_STATUS_TEXT = { '已完成': '已完成', '办理中': '进行中', '未开始': '未开始' }

function statusLabel(status) {
  if (status === 'in_progress') return '正在进行'
  if (status === 'archived') return '历史归档'
  return status || '未开始'
}

function dateText(s) { return s ? String(s).slice(0, 10) : '' }

Page({
  data: {
    icons: icons.dai,
    electionOptions: [],
    electionIndex: 0,
    selectedElectionId: '',
    selectedElection: null,
    electionMethodText: '',
    positions: [],
    positionTotal: 0,
    stages: [],
    // 报名表弹窗
    formVisible: false,
    formText: '',
    formPosition: '',
    // 岗位说明弹窗
    descVisible: false,
    descTitle: '',
    descText: '',
    // 材料下载弹窗（资料不止一份）
    matVisible: false,
    matPos: '',
    matList: []
  },

  onShow() { this.refresh() },

  refresh() {
    const { app, g } = ctx()
    if (!g.account || !g.orgId || !g.electionId) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    const electionOptions = DB.elections
      .filter(x => x.el_org_id === g.orgId)
      .sort((a, b) => {
        if (a.el_id === g.electionId) return -1
        if (b.el_id === g.electionId) return 1
        return (b.el_election_date || '').localeCompare(a.el_election_date || '')
      })
      .map(x => ({
        id: x.el_id,
        term: x.el_term,
        label: (x.el_id === g.electionId ? '当前活动 · ' : '') + x.el_term + ' · ' + x.el_name,
        name: x.el_name,
        orgName: (app.org() && app.org().name) || x.el_name,
        status: x.el_status,
        statusLabel: statusLabel(x.el_status),
        date: dateText(x.el_election_date),
        method: x.el_method || '按方案执行',
        note: x.el_note || ''
      }))

    const selectedElectionId = electionOptions.some(x => x.id === this.data.selectedElectionId)
      ? this.data.selectedElectionId
      : (electionOptions.some(x => x.id === g.electionId) ? g.electionId : (electionOptions[0] ? electionOptions[0].id : ''))
    const electionIndex = Math.max(0, electionOptions.findIndex(x => x.id === selectedElectionId))
    const selectedElection = electionOptions[electionIndex] || null
    const method = selectedElection ? selectedElection.method : ''

    // —— 本届换届选举岗位清单（positions 表：职位/职数/岗位需求说明） ——
    const positions = DB.positions
      .filter(x => x.pos_org_id === g.orgId && x.pos_election_id === selectedElectionId)
      .map(x => {
        const desc = x.pos_desc || '按本届选举方案执行'
        // 长说明（约 1 行 fs-cap 容纳不下的）走 1 行截断 + 详情弹窗；短说明直接全显
        return {
          type: x.pos_type,
          quota: Number(x.pos_quota) || 0,
          status: x.pos_status,
          desc,
          descLong: desc.length > 14
        }
      })

    // —— 当前进度 · 选举日程：全量阶段（紧凑卡片化用，dot 走全局语义） ——
    const stageRows = DB.election_stages.filter(x => x.es_election_id === selectedElectionId)
    const stagePlans = computeStageDates(selectedElection ? selectedElection.date : '', stageRows)
    const stages = stagePlans.map(x => {
      const dday = x.es_offset_start === 0 && x.es_offset_end === 0
      return {
        key: x.es_stage_key,
        name: x.es_stage_name,
        start: x.plan_start || '',
        end: x.plan_end || '',
        status: x.es_status || '未开始',
        statusText: STAGE_STATUS_TEXT[x.es_status] || x.es_status || '未开始',
        cls: x.es_status === '已完成' ? 'done' : (x.es_status === '办理中' ? 'doing' : 'todo'),
        dotCls: dday ? 'state-dday'
          : x.es_status === '办理中' ? 'state-live'
          : x.es_status === '已完成' ? 'state-done'
          : 'state-off',
        dday
      }
    })
    // 摘要：完成数 / 百分比 / 当前阶段名（用于紧凑卡片头部）
    const stageDone = stages.filter(s => s.cls === 'done').length
    const progressPct = stages.length ? Math.round((stageDone / stages.length) * 100) : 0
    const currentStage = stages.find(s => s.cls === 'doing') || stages.find(s => s.dday)

    this.setData({
      electionOptions,
      electionIndex,
      selectedElectionId,
      selectedElection,
      electionMethodText: method,
      positions,
      positionTotal: positions.reduce((sum, x) => sum + x.quota, 0),
      stages,
      stageDone,
      progressPct,
      currentStageName: currentStage ? currentStage.name : ''
    })
  },

  /* ============ 岗位卡「快捷提交」：带着岗位直达材料提交页 ============
     为什么不在这页再拉一个提交弹层：
       材料提交已有唯一实现页（/pages/material，含公告关联、材料类型、提名渠道、
       图片/文件附件、真实上传与提交记录）。本页若再实现一套，就会出现
       「同一个业务动作两处实现、口径与落库结果都不一致」的第二套真相。
     material 页 onLoad 已支持 ?position= 预填岗位，此处补齐调用方即可。 */
  goQuickSubmit(e) {
    // 极简提交页只收「参选人材料」一种，不再带岗位预选参数（material 页已砍掉材料类型/渠道 picker）
    wx.navigateTo({ url: '/pages/material/material' })
  },

  /* ============ 选举活动切换（复用公告页 picker 届次切换范式） ============ */
  pickElection(e) {
    const index = Number(e.detail.value)
    const option = (this.data.electionOptions || [])[index]
    if (!option) return
    this.setData({ electionIndex: index, selectedElectionId: option.id })
    this.refresh()
  },

  /* ============ 报名表（无短信/文件接口，采用「模板文本 + 一键复制」方案） ============ */
  // 官方报名表以文本模板呈现：用户复制后可在微信中粘贴打印，或填写后拍照走「快捷提交」上传
  buildFormText(posName) {
    const app = getApp()
    const org = (app.org() && app.org().name) || '本村（社区）'
    const term = this.data.selectedElection ? this.data.selectedElection.term : ''
    return [
      org + term + '换届选举报名表',
      '━━━━━━━━━━━━━━━━━━',
      '报名岗位：' + (posName || '____________'),
      '━━━━━━━━━━━━━━━━━━',
      '姓名：____________　　性别：______',
      '出生年月：____________　政治面貌：____________',
      '身份证号：____________________',
      '联系电话：____________',
      '户籍/居住地址：____________________',
      '━━━━━━━━━━━━━━━━━━',
      '个人简历（学习、工作经历）：',
      '________________________________',
      '',
      '自荐理由：',
      '________________________________',
      '',
      '本人承诺以上信息真实、准确、有效。',
      '报名人签名：____________　　日期：____________'
    ].join('\n')
  },
  /* ============ 弹层关闭（全局 mask/sheet 范式：遮罩或右上角 × 关闭） ============ */
  closeSheet(e) {
    const k = e.currentTarget.dataset.k
    if (k) this.setData({ [k]: false })
  },
  copyForm() {
    wx.setClipboardData({
      data: this.data.formText,
      success: () => wx.showToast({ title: '报名表已复制，可粘贴打印或填写', icon: 'none' })
    })
  },

  /* ============ 岗位说明弹窗（表格「说明」列点击展开，长文不截断在表格内） ============ */
  showPosDesc(e) {
    const { pos, desc } = e.currentTarget.dataset
    this.setData({ descVisible: true, descTitle: pos || '', descText: desc || '按本届选举方案执行' })
  },
  // 说明弹窗内「下载报名表」：复用打开报名表逻辑并预置岗位
  openFormFromDesc(e) {
    const pos = (e && e.currentTarget && e.currentTarget.dataset.pos) || this.data.descTitle || ''
    this.setData({ descVisible: false, formVisible: true, formPosition: pos, formText: this.buildFormText(pos) })
  },

  /* ============ 材料下载弹窗：资料不止一份，逐项复制模板（模板页数据驱动，岗位不硬编码） ============ */
  openMaterials(e) {
    const pos = (e && e.currentTarget && e.currentTarget.dataset.pos) || ''
    const org = (getApp().org() && getApp().org().name) || '本村（社区）'
    const term = this.data.selectedElection ? this.data.selectedElection.term : ''
    const matList = [
      {
        name: '换届选举报名表',
        desc: '官方模板 · 复制后粘贴打印或填写拍照',
        text: this.buildFormText(pos)
      },
      {
        name: '个人自荐表',
        desc: '个人自荐渠道用 · 复制模板填写',
        text: [
          org + term + '换届选举个人自荐表',
          '━━━━━━━━━━━━━━━━━━',
          '自荐岗位：' + (pos || '____________'),
          '━━━━━━━━━━━━━━━━━━',
          '姓名：____________　　性别：______',
          '出生年月：____________　政治面貌：____________',
          '身份证号：____________________',
          '联系电话：____________',
          '户籍/居住地址：____________________',
          '━━━━━━━━━━━━━━━━━━',
          '自荐理由（个人优势、履职设想）：',
          '________________________________',
          '',
          '本人承诺信息真实，服从选举安排。',
          '自荐人签名：____________　　日期：____________'
        ].join('\n')
      },
      {
        name: '组织推荐函',
        desc: '组织推荐渠道用 · 复制模板填写',
        text: [
          org + term + '换届选举组织推荐函',
          '━━━━━━━━━━━━━━━━━━',
          '推荐岗位：' + (pos || '____________'),
          '━━━━━━━━━━━━━━━━━━',
          '被推荐人：____________　性别：______',
          '身份证号：____________________',
          '联系电话：____________',
          '━━━━━━━━━━━━━━━━━━',
          '推荐理由（政治素质、工作能力、群众基础）：',
          '________________________________',
          '',
          '推荐组织（盖章）：____________',
          '负责人签名：____________　　日期：____________'
        ].join('\n')
      },
      {
        name: '材料清单说明',
        desc: '身份证 / 简历 / 无犯罪记录证明等要求',
        text: [
          org + term + '换届选举报名材料清单',
          '━━━━━━━━━━━━━━━━━━',
          '1. 换届选举报名表（1 份，签名）；',
          '2. 本人身份证原件及复印件（正反面）；',
          '3. 个人简历（学习、工作经历）；',
          '4. 无犯罪记录证明（派出所开具）；',
          '5. 组织推荐的另附组织推荐函（盖章）。',
          '━━━━━━━━━━━━━━━━━━',
          '材料交至村委会/居委会办公室，窗口按日程自动开关，逾期无法受理。'
        ].join('\n')
      }
    ]
    this.setData({ matVisible: true, matPos: pos, matList })
  },
  copyMaterial(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const item = (this.data.matList || [])[idx]
    if (!item) return
    wx.setClipboardData({
      data: item.text,
      success: () => wx.showToast({ title: item.name + '模板已复制', icon: 'none' })
    })
  }
})
