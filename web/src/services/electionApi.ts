/**
 * electionApi.ts — 后端唯一调用层（v6.1 · Neon 云库版）
 *
 * 铁律：
 *  · 所有页面禁止直接 fetch/axios，一律走本文件
 *  · token 存 localStorage cxq_token / cxq_user，请求拦截器自动挂 JWT
 *  · 响应 code !== 0 → reject；401 → 清 token 跳登录
 *  · 写操作（发布/审核/得票）全部 PUT —— 后端 app.put 不响应 POST（实测坑）
 */
import axios from 'axios';
import type { AxiosResponse } from 'axios';

const http = axios.create({ baseURL: '', timeout: 20000 });

http.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('cxq_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

http.interceptors.response.use(
  (resp: AxiosResponse) => {
    const body = resp.data;
    if (body && typeof body.code === 'number' && body.code !== 0) {
      if (body.code === 401) {
        localStorage.removeItem('cxq_token');
        localStorage.removeItem('cxq_user');
        if (!location.pathname.includes('/login')) location.href = '/login';
      }
      return Promise.reject(new Error(body.message || `接口错误 ${body.code}`));
    }
    return body?.data !== undefined ? body.data : body;
  },
  (err) => {
    const status = err?.response?.status;
    if (status === 401) {
      localStorage.removeItem('cxq_token');
      localStorage.removeItem('cxq_user');
      if (!location.pathname.includes('/login')) location.href = '/login';
    }
    return Promise.reject(new Error(err?.response?.data?.message || err.message || '网络异常'));
  },
);

// ── 类型（后端返回 camelCase 别名）───────────────────────
export interface Org { orgId: string; name: string; town?: string; type?: string; status?: string }
export interface Election { electionId: string; orgId: string; orgName?: string; elId: string; elTerm: string; elName: string; elStatus: string; elElectionDate: string; elMethod?: string; elProposalId?: string; elNote?: string }
export interface Stage { stageKey: string; stageName: string; stageStatus: string; stageStartDate: string; stageEndDate: string; stageOrder: number }
export interface Announcement { id: string; orgId: string; elId: string; annCode: string; annTitle: string; annStageKey: string; annStatus: string; annVersion?: number; annEditor?: string; annPublishTime?: string; annContent?: string;
  annSign?: string; annSignDate?: string; annOpenMaterialSubmit?: boolean; annPublishMode?: 'immediate' | 'scheduled'; annPublishAt?: string;
  annRemindHours?: number; annRemindTo?: string; annFiles?: MaterialFile[]; annPublicityDeadline?: string }
export interface Candidate extends _CandidateBase { }
interface _CandidateBase {
  id: string; orgId: string; elId: string; candName: string; candPositionId?: string; candSource?: string; candGender?: string; candAge?: number; candPhone?: string;
  candR1?: string; candR1Reviewer?: string; candR1Time?: string; candR1Comment?: string;
  candR2?: string; candR2Reviewer?: string; candR2Time?: string; candR2Comment?: string;
  candR3?: string; candR3Reviewer?: string; candR3Time?: string; candR3Comment?: string;
  candR4?: string; candR4Reviewer?: string; candR4Time?: string; candR4Comment?: string;
  candStatus?: string; candVotes?: number;
}
export interface MaterialFile { name: string; url: string }
export interface Material {
  id: string; orgId: string; elId: string; matType?: string; matStatus: string; matPositionId?: string; matCandidateId?: string;
  matSubmitter?: string; matSubmitterPhone?: string; matSubmitTime?: string; matReviewTime?: string; matReviewer?: string; matReviewComment?: string;
  matStage?: string; matNote?: string; matFiles?: MaterialFile[];
}
export interface LoginUser { id: string; phone: string; orgId: string; orgName?: string; name?: string; role: string; roles?: string; crossOrg?: boolean; roleKeys?: string[] }
export interface ReviewMailResult { round: number; receivers: string[]; count: number; mailed: boolean; sent: number; subject: string; text: string }
export interface ProposalPost { id?: string; position: string; count: number; requirement?: string | null }
export interface Proposal {
  id: string; orgId: string; elId: string; propTitle: string; propMethod?: string;
  propStatus: string; propVersion?: number; propSubmitTime?: string;
  propReviewerId?: string; propReviewTime?: string; propReviewComment?: string;
  propElectionDate?: string; electionDate?: string; posts?: ProposalPost[]; files?: MaterialFile[];
}
export interface Position { id: string; orgId: string; elId: string; posType: string; posQuota: number; posStatus: string; posDesc?: string; posFiles?: MaterialFile[] }

export interface ApiError { code?: number; message?: string }

// ── 认证 ───────────────────────────────────────────────
export const apiLogin = (phone: string, password: string, orgId: string) =>
  http.post('/api/login', { phone, password, orgId }) as Promise<{ token: string; user: LoginUser }>;
export const apiOrgs = () => http.get('/api/orgs') as Promise<Org[]>;
export const apiHealth = () => http.get('/api/health') as Promise<{ db: string; today?: string }>;

// ── 读 ────────────────────────────────────────────────
export const getElections = () => http.get('/api/elections') as Promise<Election[]>;
export const getStages = (electionUuid: string) => http.get(`/api/elections/${electionUuid}/stages`) as Promise<Stage[]>;
export const getAnnouncements = (elId?: string) =>
  http.get('/api/announcements', { params: elId ? { electionId: elId } : {} }) as Promise<Announcement[]>;
export const getCandidates = () => http.get('/api/candidates') as Promise<Candidate[]>;
export const getMaterials = () => http.get('/api/materials') as Promise<Material[]>;
export const getPositions = () => http.get('/api/positions') as Promise<Position[]>;
export const getNotifications = () => http.get('/api/notifications');
export const getRoster = () => http.get('/api/roster');
export const getResults = () => http.get('/api/results');
export const getProposals = () => http.get('/api/proposals') as Promise<Proposal[]>;
export interface ArchiveItem { id: string; orgId: string; elId: string; archSourceType: string; archDisplayName: string; archVisibility: string; archFileVersion?: string }
export const getArchives = () => http.get('/api/archives') as Promise<ArchiveItem[]>;
export const getDashboardAlerts = () => http.get('/api/dashboard/alerts') as Promise<Array<{ level: string; text: string }>>;

// ── 写（PUT！）─────────────────────────────────────────
export const publishAnnouncement = (id: string) => http.put(`/api/announcements/${id}/publish`);
export const createAnnouncement = (draft: { elId: string; annCode?: string; annTitle: string; annStageKey?: string; annContent?: string }) =>
  http.post('/api/announcements', draft);
export const reviewMaterial = (id: string, status: 'approved' | 'rejected', comment?: string) =>
  http.put(`/api/materials/${id}/review`, { status, comment });
export const setCandidateResult = (id: string, votes: number, candStatus?: string) =>
  http.put(`/api/candidates/${id}/result`, { votes, status: candStatus });
// v6.2 人工录入某轮结果（可选理由）
export const putCandidateRound = (id: string, round: 1 | 2 | 3 | 4, result: '通过' | '不通过', reason?: string) =>
  http.put(`/api/candidates/${id}/round`, { round, result, reason }) as Promise<{ id: string; candName: string; round: number; result: string; reviewer: string; reason?: string; candStatus: string }>;
// v6.2 一键送审邮件（SMTP 未配时返回文案供复制）
export const sendReviewMail = (elId: string, round: number, emails: string, note?: string) =>
  http.post('/api/candidates/send-review', { elId, round, emails, note }) as Promise<ReviewMailResult>;
// v6.2 内推手工新增（组织推荐）
export const createMaterial = (draft: { name: string; phone: string; positionId?: string; note?: string; orgId?: string; elId?: string }) =>
  http.post('/api/materials', draft) as Promise<{ id: string; matStatus: string; matType: string; matPositionId?: string }>;
// v6.2 追加附件（代传）
export const appendMaterialFile = (matId: string, file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return http.post(`/api/materials/${matId}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) as Promise<{ id: string; file: string; size: number; total: number }>;
};
export const generateStages = (electionUuid: string) => http.post(`/api/elections/${electionUuid}/generate-stages`);

// ── 提案：创建 / 审批联动 / 附件（真实落库，刷新不丢）─────
export const createProposal = (draft: { title: string; method: string; electionDate: string; posts: ProposalPost[]; orgId?: string; report?: string }) =>
  http.post('/api/proposals', draft) as Promise<{ id: string; elId: string; title: string; status: string }>;
export const updateProposal = (id: string, draft: { title: string; method: string; electionDate: string; posts: ProposalPost[]; report?: string }) =>
  http.put(`/api/proposals/${id}`, draft) as Promise<{ id: string; status: string }>;
export const reviewProposal = (id: string, action: 'approve' | 'reject', comment?: string) =>
  http.put(`/api/proposals/${id}/review`, { action, comment }) as Promise<{ id: string; status: string; elId?: string; stagesGenerated?: number; positionsGenerated?: number; announcementsGenerated?: number }>;
export const uploadProposalFile = (proposalId: string, file: File) => {
  const fd = new FormData(); fd.append('file', file);
  return http.post(`/api/proposals/${proposalId}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
// 公告草稿全量编辑持久化（小编工作台唯一编辑器：标题/正文/落款/材料开关/发布方式/定时/提醒，刷新不丢）
export interface AnnouncementPatch {
  annTitle?: string; annContent?: string; annCode?: string; annSign?: string; annSignDate?: string;
  annOpenMaterialSubmit?: boolean; annPublishMode?: 'immediate' | 'scheduled'; annPublishAt?: string | null;
  annRemindHours?: number; annRemindTo?: string;
}
export const updateAnnouncement = (id: string, patch: AnnouncementPatch) =>
  http.put(`/api/announcements/${id}`, patch);
// 公告附件真实上传（每份公告独立目录，切换公告不写死）
export const uploadAnnouncementFile = (id: string, file: File) => {
  const fd = new FormData(); fd.append('file', file);
  return http.post(`/api/announcements/${id}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) as Promise<{ id: string; file: string; size: number }>;
};
// 岗位附件真实上传
export const uploadPositionFile = (posId: string, file: File) => {
  const fd = new FormData(); fd.append('file', file);
  return http.post(`/api/positions/${posId}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) as Promise<{ id: string; file: string; size: number }>;
};

// ── 后台账号管理（D-013：仅 platform_admin；隐藏解锁页/人员管理共用）────────
export interface AdminAccount {
  id: string; orgId: string; orgName?: string; name: string; phone: string;
  status: string; note?: string; createdAt?: string; roleKey?: string;
}
export interface PresetAccountRow { name?: string; phone: string; roleKey: 'sub_admin' | 'operator' | 'editor' | 'reviewer'; password?: string }
export interface PresetResult { created: string[]; updated: string[]; skipped: { phone: string; reason: string }[]; orgId: string; orgName: string }
// 账号列表（可按归属地筛）
export const adminListAccounts = (orgId?: string) =>
  http.get('/api/admin/accounts', { params: orgId ? { orgId } : {} }) as Promise<AdminAccount[]>;
// 批量预设账号（需解锁码，后端校验 123456 / env.UNLOCK_CODE）
export const adminPresetAccounts = (unlockCode: string, orgId: string, accounts: PresetAccountRow[]) =>
  http.post('/api/admin/accounts', { unlockCode, orgId, accounts }) as Promise<PresetResult>;
// 启用/停用
export const adminSetAccountStatus = (id: string, status: 'active' | 'disabled') =>
  http.put(`/api/admin/accounts/${id}/status`, { status });
// 重置密码（默认 123456）
export const adminResetPassword = (id: string, password?: string) =>
  http.put(`/api/admin/accounts/${id}/reset-password`, { password: password || '123456' });

// ── 小程序端 ───────────────────────────────────────────
export const mpLogin = (phone: string) => http.post('/api/mp/login', { phone });
export const mpRegister = (phone: string, orgId: string, name?: string) => http.post('/api/mp/register', { phone, orgId, name });

// ── 本地登录态 ─────────────────────────────────────────
export const currentUser = (): LoginUser | null => {
  try { return JSON.parse(localStorage.getItem('cxq_user') || 'null'); } catch { return null; }
};
export const currentToken = () => localStorage.getItem('cxq_token') || '';
export const saveLogin = (token: string, user: LoginUser) => {
  localStorage.setItem('cxq_token', token);
  localStorage.setItem('cxq_user', JSON.stringify(user));
  localStorage.setItem('election_login', JSON.stringify({ orgId: user.orgId, orgLabel: user.orgName || user.orgId, phone: user.phone, role: user.role }));
};
export const clearLogin = () => {
  localStorage.removeItem('cxq_token');
  localStorage.removeItem('cxq_user');
};

// ── 工具：日期与倒计时（与后端 D 日引擎同口径）─────────
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(a + 'T00:00:00').getTime() - new Date(b + 'T00:00:00').getTime()) / 86400000);
// 本地日期（不能用 toISOString：UTC+8 凌晨会回退到前一天，与后端 D 日本地口径对齐）
export const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
