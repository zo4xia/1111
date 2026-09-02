/**
 * liveSync.ts — 后端 → 前端本地 store 同步引擎（v6.1）
 *
 * 思路（与小程序 data/map.js 同款，实证有效）：
 *   页面/组件一律读本地 store（useActivities/useNotices/...），
 *   本文件把后端真实数据映射成本地形状灌进 store —— 一行页面代码不改，全部变 live。
 *
 * 映射表：
 *   GET /api/elections(+stages) → electionStore.activities（ElectionActivity[]）
 *   GET /api/announcements      → noticeStore.notices（Notice[]）
 *   uuid ↔ 数字 activityId 字典  → API 写操作回查用
 *
 * 触发：登录成功后 / App 启动时已登录 —— syncAll()
 * 失败：静默保持 mock 兜底，页面照常渲染（演示不白屏铁律）
 */
import { getElections, getStages, getAnnouncements, getPositions, currentUser } from 'services/electionApi';
import type { Election, Stage, Announcement, Position } from 'services/electionApi';
import { STAGE_TEMPLATES } from './stageTemplates';
import { setLiveActivities, calcActivityStatus, type ElectionActivity } from './electionStore';
import { setLiveNotices } from './noticeStore';
import { getAnnouncement } from './announcementTemplates';

/** uuid(elId) → 数字 activityId（页面层用数字 id 关联，API 层用 uuid/elId） */
export const activityIdMap = new Map<string, number>(); // elId -> numeric
export const activityUuidMap = new Map<number, string>(); // numeric -> electionUuid
export const activityElNameMap = new Map<number, string>(); // numeric -> elId

let syncing = false;
let synced = false;
// v6.2：共享 Promise —— 并发调用等同一次同步完成，消除页面 race（拿半空映射表）
let syncingPromise: Promise<boolean> | null = null;
export const isLiveSynced = () => synced;

const fmtDate = (d?: string) => (d ? String(d).slice(0, 10) : '');
const fmtTime = (d?: string) => (d ? String(d).replace('T', ' ').slice(0, 16) : '');
/** timestamptz ISO → datetime-local 本地输入串（YYYY-MM-DDTHH:mm） */
const toLocalInput = (iso?: string): string | undefined => {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** 提醒对象字符串 → 数组（仅保留合法值，空则默认经办+管理员） */
const parseRemindTo = (s?: string): Array<'editor' | 'admin'> => {
  const valid = (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is 'editor' | 'admin' => x === 'editor' || x === 'admin');
  return valid.length ? valid : ['editor', 'admin'];
};

/** API 阶段 × 本地模板 → 页面用阶段（模板带 work/sys_action 等富字段，API 带真实日期） */
function mergeStages(apiStages: Stage[]): ElectionActivity['stages'] {
  return apiStages.map((s) => {
    const tpl = STAGE_TEMPLATES.find((t) => t.key === s.stageKey);
    return {
      key: s.stageKey,
      name: s.stageName || tpl?.name || s.stageKey,
      offset: Number(s.stageOrder ?? tpl?.offset ?? 0),
      date: fmtDate(s.stageStartDate),
      endDate: fmtDate(s.stageEndDate),
      work: tpl?.work || '',
      sys_action: tpl?.sys_action || '',
      announcement: tpl?.announcement || '',
      announcements: tpl?.announcements || [],
      review: tpl?.review || '',
      material: tpl?.material || '',
    };
  });
}

let numericSeq = 90;

/** 全量同步：拉届次+日程+公告，灌进 store */
export function syncAll(): Promise<boolean> {
  if (!syncingPromise) syncingPromise = doSync();
  return syncingPromise;
}
/** 强制重新同步（提案审批通过/数据变更后调用，绕过已完成缓存） */
export function forceResync(): Promise<boolean> {
  syncingPromise = null;
  synced = false;
  return syncAll();
}
async function doSync(): Promise<boolean> {
  syncing = true;
  try {
    if (!currentUser()) { syncing = false; syncingPromise = null; return false; }

    const elections: Election[] = await getElections();
    if (!elections?.length) { syncing = false; syncingPromise = null; return false; }

    // ① 届次 → ElectionActivity（含每届日程并行拉取）
    const stagesList = await Promise.all(
      elections.map((e) => getStages(e.electionId).catch(() => [] as Stage[])),
    );
    // 岗位（审批通过时由提案岗位生成，含已上传附件）
    const positionsAll = await getPositions().catch(() => [] as Position[]);

    const activities: ElectionActivity[] = elections.map((e, i) => {
      const id = ++numericSeq;
      activityIdMap.set(e.elId, id);
      activityUuidMap.set(id, e.electionId);
      activityElNameMap.set(id, e.elId);
      const myPos = positionsAll.filter((p) => p.elId === e.elId);
      const act: ElectionActivity = {
        id,
        name: e.elName || `${e.orgName || e.orgId}${e.elTerm || ''}换届选举`,
        org_type: (e.orgId || '').startsWith('v') ? 'village' : 'community',
        election_mode: e.elMethod || '全民直选',
        dday: fmtDate(e.elElectionDate),
        status: 'preparing',
        posts: myPos.map((p) => ({
          posId: p.id, position: p.posType, count: p.posQuota, requirement: p.posDesc || '', files: p.posFiles || [],
        })),
        downloadFiles: myPos.flatMap((p) => p.posFiles || []),
        stages: mergeStages(stagesList[i] || []),
        createdAt: fmtDate(e.elElectionDate),
      };
      act.status = calcActivityStatus(act);
      return act;
    });
    setLiveActivities(activities);

    // ② 公告 → Notice
    const anns: Announcement[] = await getAnnouncements().catch(() => [] as Announcement[]);
    if (anns.length) {
      const stageNameOf = (elId: string, key: string): string => {
        const aid = activityIdMap.get(elId);
        const act = activities.find((a) => a.id === aid);
        return act?.stages.find((s) => s.key === key)?.name || key;
      };
      setLiveNotices(anns.map((a, idx) => {
        const tpl = getAnnouncement(a.annCode || '');
        const files = a.annFiles || [];
        return {
          id: idx + 1,
          uuid: a.id,
          activityId: activityIdMap.get(a.elId) || 91,
          activityName: (elections.find((e) => e.elId === a.elId)?.orgName || '') +
            (elections.find((e) => e.elId === a.elId)?.elTerm || '') + '换届选举提案',
          stageKey: a.annStageKey || '',
          stageName: stageNameOf(a.elId, a.annStageKey || ''),
          no: a.annCode || '',
          title: a.annTitle || tpl?.title || '',
          body: a.annContent || tpl?.body || '',
          sign: a.annSign || tpl?.sign || '',
          signDate: a.annSignDate || '',
          publishDate: fmtDate(a.annPublishTime),
          publishMode: (a.annPublishMode === 'scheduled' ? 'scheduled' : 'immediate') as 'immediate' | 'scheduled',
          publishAt: toLocalInput(a.annPublishAt),
          // 每份公告各自的真实附件（切换公告随之变化，根治下载链接写死）
          downloads: files.map((f) => ({ name: f.name, url: f.url })),
          files,
          openMaterialSubmit: !!a.annOpenMaterialSubmit,
          remindBeforeHours: a.annRemindHours ?? 24,
          remindTo: parseRemindTo(a.annRemindTo),
          status: (a.annStatus === 'published' ? 'published' : 'draft') as 'draft' | 'published',
        };
      }));
    }

    synced = true;
    console.log('[liveSync] ✓ 已接入后端实时数据：', {
      届次: activities.length,
      日程: activities.reduce((n, a) => n + a.stages.length, 0),
      公告: anns.length,
    });
    return true;
  } catch (e) {
    console.warn('[liveSync] 同步失败（保持本地兜底）：', (e as Error).message);
    syncingPromise = null; // 失败允许下次重试
    return false;
  } finally {
    syncing = false;
  }
}
