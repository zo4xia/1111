# 数据库结构（单一真相源）

> 本文件由 `data/db.js` 运行时字段**实测**生成，代表小程序正在使用的字段口径（代码真相 > 注释/文件）。
> 所有页面通过 `require('../../data/db').DB` 取数；远程数据（云开发 / HTTP）最终都归一覆盖到同一 `DB`。
> 字段命名约定：**蛇形前缀**标识表归属（`el_=elections` / `es_=election_stages` / `cand_=` / `mat_=` / `ann_=` / `er_=` / `ros_=` / `notif_` / `nr_` / `arch_` / `dn_` / `prop_` / `rq_` / `ar_` / `acc_` / `vot_` / `at_` / `st_`）。
> 状态类字段中文口径：`未开始 / 办理中 / 已完成`（阶段）、`pending/ongoing/completed` 为服务端 PG 口径，由 `data/map.js` 翻译。

## D 日锚点口径（名词即时定义，2026-09-02 代码实测核验）

**D 日 = `elections.el_election_date`（正式投票选举日），是全系统日程的唯一计算锚点。**

| 记号 | 偏移符号 | 含义 | 计算 |
|---|---|---|---|
| **D-N** | 负（negative） | D 日**往前** N 天 = **提早** N 天 | `日期 = D + (-N) 天` |
| **D0** | 0 | D 日当天 | `日期 = D` |
| **D+N** | 正（positive） | D 日**往后** N 天 | `日期 = D + (+N) 天` |

**实现真相**（`utils/dates.js`）：
- `computeStageDates(D, stages)` → `plan_start = addDays(D, es_offset_start)`，`addDays` 内部 `dt.setDate(dt.getDate() + offset)`。
- 所以 `es_offset_start/-end` **负数为 D-（提早），正数为 D+（延后）**，与记号直接对应。
- 反推：`map.offsetFrom(D, date) = (date − D) / 86400000` → 早于 D 得负数（D-N），晚于 D 得正数（D+N）。

**实测交叉验证**（el-15，D = `2026-07-30`）：

| 阶段 | offset | 推算日期 |
|---|---|---|
| D-35 前期筹备 | −35 | 2026-06-25（往前 35 天） |
| D-33~-29 选民登记 | −33 ~ −29 | 2026-06-27 ~ 2026-07-01 |
| D-15 材料上报起 | −15 | 2026-07-15 |
| D-13 材料上报止 | −13 | 2026-07-17 |
| D0 投票日 | 0 | 2026-07-30 |
| D+5 | +5 | 2026-08-04（往后 5 天） |

- 材料窗口 = D-15 ~ D-13 = `07-15 ~ 07-17`（闭区间首尾三天，见 `materialWindow`）。
- 快照日 `SNAPSHOT_DATE=2026-07-21` = **D-9**（相对 el-15 的 D 日 07-30 往前 9 天）；同时也是 el-11（D=2026-07-16）的 **D+5**（已完结第 5 天）。
- `daysBetween(from, to) = to − from`：home 的 `daysToD = daysBetween(快照日, D)` = 正数表示「距 D 日还有几天」。

**结论：D+ = 往后、D- = 往前（提早）—— 与业务口径一致，代码无需修正。**

## 数据源与一致性策略

| 通道 | 字段口径 | 归一处理 |
|---|---|---|
| `data/db.js`（本地静态快照，自动生成） | 蛇形前缀（权威） | 兜底，无需翻译 |
| `data/cloud.js`（微信云开发，只读） | 约定同构；若检测到 PG 风格字段则走 `map.*` 同构（`normalizeRemote`） | 见 `cloud.normalizeRemote` |
| `data/http.js`（PC 服务端 PG，主写库） | `org_id / election_id / stage_key / cand_phone` 等 | 经 `data/map.js` 翻译覆盖 `DB` |

**铁律**：三通道最终都收敛到 `DB` 的蛇形前缀字段；新增字段必须在 `map.js` 与对应表对齐，禁止页面直接读 PG 风格字段。

## PostgreSQL（Neon 云库）结构对比（2026-09-02 实测）

> 目的：确认小程序字段能否从 PG 服务端映射。连 `information_schema.columns` 实测 PG 共 **25 张表**，
> 与小程序的 21 张业务表逐一按「去表前缀后字段名」匹配。结论：**可映射，主体字段命中率 58%~91%**。
> 映射翻译层 = `data/map.js`（声明式 SCHEMA 驱动，详见该文件）。

> **⚠️ 重要澄清（防歧义，2026-09-02 修正）**
> **小程序从不直连 PG**。真实链路是：
> `小程序 → utils/api.js(HTTP) → server/api.js(Express) → PG`
> 因此 **`map.js` 的入参是 API 响应 JSON 的字段名，不是 PG 表列名**。
> 实测已证：PG 的 `election_stages` 表**不存在 `start_date` 列**（而 `mapStages` 用的正是 `start_date`），
> 说明 API 层（`server/api.js`）在返回时做了字段重命名/组装（如 `AS start_date` 别名）。
> **结论：核对口径必须以 `server/api.js` 的 SELECT 语句为准，不能用 PG 列名直接推断 `map.js` 入参。**
> 下方「命中率」是按表名字面匹配的**结构相似度参考**，不等于 API 契约，勿据此改 `map.js`。

### 表级映射命中率（PG 表 → 小程序表）
| PG 表 (列数) | 映射小程序表 | 字段命中率 | 备注 |
|---|---|---|---|
| organizations (11) | organizations | 73% | 小程序无缺 |
| elections (12) | elections | 83% | 小程序无缺 |
| election_stages (11) | election_stages | 36% | **低命中+列名不符**：PG 表**无** `start_date` 列（实测报错），`mapStages` 的 `start_date/end_date/stage_status/st_description` 来自 API 别名，非 PG 原列名。小程序用 `es_offset_start/es_offset_end/es_status`（由 `mapStages` 用 `offsetFrom(D,date)` 反推） |
| stage_templates (9) | stage_templates | 11%* | *误匹配到 elections；实际为独立模板表，小程序 `st_*` 字段全本地 |
| announcement_templates (9) | announcement_templates | 67% | 小程序无缺 |
| roles (8) | roles | 50% | 小程序独有 `ID / 角色权限`（本地演示列） |
| role_quotas (12) | account_roles(误) | 25%* | *误匹配；小程序 `rq_*` 字段全本地，PG 无对应 |
| accounts (12) | accounts | 75% | 小程序无缺 |
| account_roles (9) | account_roles | 67% | 小程序无缺 |
| positions (9) | positions | 67% | 小程序无缺 |
| proposals (16) | proposals | 69% | 小程序无缺 |
| voters (23) | voters | 74% | 已废弃表，口径一致 |
| materials (18) | materials | 83% | 小程序无缺（含 `mat_submitter_phone/mat_candidate_id` 已对齐 map） |
| candidates (32) | candidates | 91% | 最高命中，四轮审核 `cand_r1~r4` 全对齐 |
| announcements (24) | announcements | 58% | 小程序独有 `ann_pin/ann_type`（本地演示列，PG 无） |
| notifications (14) | notifications | 86% | 小程序无缺 |
| notification_reads (7) | notification_reads | 57% | 小程序独有 `nr_status`（本地默认 'read'） |
| election_results (20) | election_results | 85% | 小程序 `er_*` 全对齐（含 `er_filing_time/er_result_ann_code` 已补 map） |
| roster (14) | roster | 79% | 小程序无缺 |
| archives (10) | archives | 70% | 小程序无缺 |
| project_memory (5) | — | 20%* | *误匹配 elections；独立表，小程序 `title/category/priority/content` 全本地 |
| proposal_posts (6) | positions(误) | 50%* | *误匹配；PG 端岗位附表，小程序无独立映射 |
| data_fix_backup (7) | — | 14%* | 运维备份表，无需映射 |
| design_notes (8) | — | 25%* | PG 端设计备注，小程序 `design_notes(dn_*)` 为独立表 |
| system_configs (8) | — | 13%* | 系统配置表，小程序无对应 |

> 标注 * 的「误匹配」是脚本按字段重叠的启发式猜测，非真实映射；真实映射以表名一致为准（上方非 * 行）。

### 关键差异（小程序独有 / 需翻译）
1. **阶段时间**：API 返回 `start_date/end_date`（真实日期）↔ 小程序 `es_offset_start/es_offset_end`（D 日偏移）。由 `mapStages` 用 `offsetFrom(D, date)` 反推，**不是简单字段改名**。（注意：`start_date` 是 API 字段名，PG 原表无此列）
2. **阶段状态**：PG `pending/ongoing/completed` ↔ 小程序 `未开始/办理中/已完成`。`map.js` `STAGE_STATUS_CN` 翻译。
3. **本地演示列**（PG 无，小程序写死缺省）：`ann_pin, ann_type, el_proposal_id, org_phone, org_person, org_note, es_biz_module, roles.ID, roles.角色权限, nr_status`。
4. **完全本地表**（PG 无对应或独立）：`stage_templates(st_*)`, `project_memory`, `design_notes(dn_*)`, `role_quotas(rq_*)`, `system_configs`, `data_fix_backup`。

### 结论
- **可映射**：小程序 21 张业务表中，19 张与 PG 表名/字段可直接对应（命中率 ≥57%），经 `data/map.js` 翻译即可对齐。
- **需特殊处理**：`election_stages`（偏移反推）、`announcements`（本地演示列）、`roles`（本地列）三处非纯改名，已在 map 中处理。
- **本地独占**：`stage_templates / project_memory / design_notes / role_quotas` 为小程序端扩展或独立表，PG 端无强制对应，属「小程序侧真相」。

## 表结构（实测字段）

### organizations（123 行）
`slug, name, town, type, status, org_phone, org_person, org_note`

### elections（4 行）
`el_org_id, el_id, el_term, el_name, el_status, el_election_date, el_method, el_proposal_id, el_note`

### election_stages（32 行）
`es_org_id, es_election_id, es_stage_key, es_stage_name, es_offset_start, es_offset_end, es_status, es_biz_module, es_note`

### stage_templates（16 行）
`st_d_day, st_name, st_offset_start, st_offset_end, st_version, st_core_work, st_sys_action, st_announcement, st_need_review, st_review_round, st_need_material, st_material_type`

### announcement_templates（22 行）
`at_code, at_name, at_version, at_content, at_need_remind, at_note`

### roles（6 行）
`ID, role_key, role_name, role_scope, role_desc, 角色权限`

### role_quotas（8 行）
`rq_org_id, rq_role_key, rq_max_count, rq_set_by, rq_note`

### accounts（12 行）
`acc_org_id, acc_name, acc_phone, acc_password_hint, org, roles, acc_status, acc_created_by, acc_note`

### account_roles（11 行）
`ar_org_id, ar_acc_id, ar_role_key, ar_status, ar_assigned_by, ar_note`

### positions（6 行）
`pos_org_id, pos_election_id, pos_type, pos_quota, pos_status, pos_desc`

### proposals（5 行）
`prop_org_id, prop_election_id, prop_title, prop_method, prop_creator_id, prop_status, prop_version, prop_submit_time, prop_reviewer_id, prop_review_time, prop_review_comment`

### voters（38 行，已废弃：参选人一律走 candidates）
`vot_org_id, vot_election_id, vot_name, vot_gender, vot_age, vot_id_card, vot_phone, vot_household_addr, vot_residence_addr, vot_group, vot_register_time, vot_status, vot_is_away, vot_need_ballot_box, vot_is_proxy, vot_proxy_person, vot_note`

### materials（24 行）
`mat_org_id, mat_election_id, mat_position_id, mat_applicant_id, mat_type, mat_status, mat_submitter, mat_submitter_phone, mat_submit_time, mat_review_time, mat_reviewer, mat_review_comment, mat_candidate_id, mat_note, mat_stage`

### candidates（23 行）
`cand_org_id, cand_election_id, cand_name, cand_position_id, cand_acc_id, cand_source, cand_gender, cand_age, cand_id_card, cand_phone, cand_r1, cand_r1_reviewer, cand_r1_time, cand_r1_comment, cand_r2, cand_r2_reviewer, cand_r2_time, cand_r2_comment, cand_r3, cand_r3_reviewer, cand_r3_time, cand_r3_comment, cand_r4, cand_r4_reviewer, cand_r4_time, cand_r4_comment, cand_status, cand_votes, cand_note`

### announcements（38 行）
`ann_org_id, ann_election_id, ann_code, ann_title, ann_stage_key, ann_status, ann_version, ann_editor, ann_edit_time, ann_reviewer, ann_review_time, ann_publish_time, ann_publicity_deadline, ann_pin, ann_type, ann_content`

### notifications（5 行）
`notif_id, notif_org_id, notif_election_id, notif_type, notif_content, notif_to_role_filter, notif_to_phones, notif_status, notif_scheduled_at, notif_source_type, notif_source_key`

### notification_reads（4 行）
`nr_notif_id, nr_acc_id, nr_org_id, nr_read_at, nr_status`

### election_results（10 行）
`er_org_id, er_org_name, er_election_id, er_election_date, er_position, er_winner_name, er_votes, er_eligible_voters, er_actual_voters, er_valid_votes, er_invalid_votes, er_turnout, er_result_ann_code, er_filing_status, er_filing_time, er_handover_status, er_note`

### roster（14 行）
`ros_org_id, ros_position, ros_name, ros_phone, ros_term, ros_year_start, ros_year_end, ros_status, ros_is_active, ros_session_no, ros_note`

### archives（6 行）
`arch_org_id, arch_election_id, arch_source_type, arch_source_id, arch_file_version, arch_display_name, arch_visibility`

### design_notes（7 行）
`dn_module, dn_rule, dn_source, dn_date, dn_critical`

### project_memory（2 行）
`title, category, priority, status, content`

## 已知口径缺口（已修复记录）
- `mapMaterials` 原缺 `mat_submitter_phone / mat_candidate_id` → 已补齐（2026-09-02）。
- `mapResults` 原缺 `er_org_name / er_eligible_voters / er_valid_votes / er_invalid_votes / er_filing_time / er_result_ann_code / er_note` → 已补齐（2026-09-02）。
- 云开发通道原裸 `Object.assign` 无翻译 → 已加 `normalizeRemote` 检测 PG 风格字段并同构归一（2026-09-02）。
