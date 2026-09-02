/**
 * 公告通知 store（后台发布 + 小程序前端共用）
 * 数据来源：由活动的日程 pipeline（stages）→ 关联公告模板编号 → 自动生成待发布公告。
 * 小编/运营编辑可点开编辑内容（填日期、改措辞），右侧公文格式实时预览，确认后发布。
 */
import { useSyncExternalStore } from 'react';
import { getAnnouncement } from './announcementTemplates';
import { getActivities } from './electionStore';

export interface Notice {
  id: number;
  /** v6.1 live：后端公告 uuid（发布时回查用；mock 数据无此字段） */
  uuid?: string;
  activityId: number;
  activityName: string;
  stageKey: string; // 所属阶段，如 D-34
  stageName: string; // 阶段名称
  no: string; // 公告编号
  title: string;
  body: string;
  sign: string; // 落款单位
  signDate: string; // 成文日期
  publishDate: string; // 发布日期 = 阶段日期
  publishMode: 'immediate' | 'scheduled'; // 发布方式：立即 / 定时
  publishAt?: string; // 定时发布时间
  /** 给参选人下载的附件（报名表/说明等，后台上传，小程序公告下方展示下载） */
  downloads: { name: string; url?: string }[];
  /** 后端真实附件（uploads 目录扫描 annFiles，每份公告独立；切换公告随之变化，不写死） */
  files?: { name: string; url: string }[];
  /** 是否在本公告阶段开放参选人材料提交入口（开启后小程序公告下出现「提交材料」按钮） */
  openMaterialSubmit: boolean;
  /** 日程提醒：提前多少小时提醒经办（活动详情右栏工作台设置） */
  remindBeforeHours: number;
  /** 提醒发送对象：editor=编辑经办 admin=管理员 */
  remindTo: Array<'editor' | 'admin'>;
  status: 'draft' | 'published';
}

let nextId = 1;

/** 由活动全部阶段生成公告（一阶段一公告，关联模板） */
function buildAllNotices(): Notice[] {
  const list: Notice[] = [];
  getActivities().forEach((a) => {
    a.stages.forEach((s) => {
      s.announcements.forEach((no) => {
        const tpl = getAnnouncement(no);
        if (!tpl) return;
        list.push({
          id: nextId++,
          activityId: a.id,
          activityName: a.name,
          stageKey: s.key,
          stageName: s.name,
          no,
          title: tpl.title,
          body: tpl.body,
          sign: tpl.sign || '',
          signDate: '',
          publishDate: s.date,
          publishMode: 'immediate',
          downloads: [],
          openMaterialSubmit: false,
          remindBeforeHours: 24,
          remindTo: ['editor', 'admin'],
          status: 'draft',
        });
      });
    });
  });
  return list;
}

let notices: Notice[] = buildAllNotices();

/** v6.1 live：后端真实公告灌入（liveSync 调用，mock 被替换） */
export function setLiveNotices(list: Notice[]) {
  if (list?.length) {
    notices = list;
    emit();
  }
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function getNotices(): Notice[] {
  return notices;
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(subscribeToNotices, getNotices);
}

export function subscribeToNotices(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// 需落库的编辑态字段（status 走 publishNotice，附件走 uploadNoticeFile，均不在此列）
const PERSIST_KEYS: (keyof Notice)[] = [
  'title', 'body', 'no', 'sign', 'signDate', 'openMaterialSubmit',
  'publishMode', 'publishAt', 'remindBeforeHours', 'remindTo',
];
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** 全量编辑态防抖落库（小编工作台唯一编辑器，改任意字段都真落库、刷新不丢） */
function persistNotice(n: Notice) {
  if (!n.uuid) return;
  const uuid = n.uuid;
  const old = persistTimers.get(uuid);
  if (old) clearTimeout(old);
  persistTimers.set(
    uuid,
    setTimeout(() => {
      import('services/electionApi').then(({ updateAnnouncement }) =>
        updateAnnouncement(uuid, {
          annTitle: n.title, annContent: n.body, annCode: n.no, annSign: n.sign, annSignDate: n.signDate,
          annOpenMaterialSubmit: n.openMaterialSubmit, annPublishMode: n.publishMode,
          annPublishAt: n.publishMode === 'scheduled' ? n.publishAt || null : null,
          annRemindHours: n.remindBeforeHours, annRemindTo: (n.remindTo || []).join(','),
        }).catch((e: Error) => console.warn('[persistNotice] 后端同步失败（本地已生效）：', e.message)),
      );
    }, 400),
  );
}

/** 编辑公告内容（本地即时生效；任意编辑态字段变化都防抖 PUT 全量落库，刷新不丢） */
export function updateNotice(id: number, patch: Partial<Notice>) {
  notices = notices.map((n) => (n.id === id ? { ...n, ...patch } : n));
  emit();
  const next = notices.find((n) => n.id === id);
  if (next && Object.keys(patch).some((k) => PERSIST_KEYS.includes(k as keyof Notice))) persistNotice(next);
}

/** 上传公告真实附件（每份公告独立目录）；成功后本地即时追加，切换公告各自独立不写死 */
export async function uploadNoticeFile(id: number, file: File) {
  const n = notices.find((x) => x.id === id);
  if (!n?.uuid) throw new Error('公告尚未生成，无法上传附件');
  const { uploadAnnouncementFile } = await import('services/electionApi');
  const r = await uploadAnnouncementFile(n.uuid, file);
  const item = { name: file.name, url: r.file };
  notices = notices.map((x) =>
    x.id === id ? { ...x, files: [...(x.files || []), item], downloads: [...x.downloads, item] } : x,
  );
  emit();
  return r;
}

/** 发布公告（v6.1：本地即时生效 + 后端真写库 PUT） */
export function publishNotice(id: number) {
  notices = notices.map((n) => (n.id === id ? { ...n, status: 'published' } : n));
  emit();
  const uuid = notices.find((n) => n.id === id)?.uuid;
  if (uuid) {
    import('services/electionApi').then(({ publishAnnouncement }) =>
      publishAnnouncement(uuid).catch((e: Error) => console.warn('[publishNotice] 后端同步失败（本地已生效）：', e.message)));
  }
}

/** 重置公告为模板默认内容（不改发布状态），并落库避免刷新回退到旧值 */
export function resetNotice(id: number) {
  notices = notices.map((n) => {
    const tpl = getAnnouncement(n.no);
    return tpl ? { ...n, title: tpl.title, body: tpl.body, sign: tpl.sign || '', signDate: '' } : n;
  });
  emit();
  const next = notices.find((n) => n.id === id);
  if (next) persistNotice(next);
}
