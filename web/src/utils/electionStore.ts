/**
 * 归档 共享 store（module 级单例 + useSyncExternalStore）
 * 结构：归档 → 每一届一个文件夹（按届名称） → 上传的资料 / 收集的资料
 * mock 演示，后续接真实文件服务/接口替换即可。
 */
import { useSyncExternalStore } from 'react';
import { STAGE_TEMPLATES } from './stageTemplates';

export interface ArchiveFile {
  name: string;
  url?: string;
}

export interface ArchiveFolder {
  id: number;
  name: string; // 届名称，如「涧口社区第十一届换届」
  election_date?: string;
  election_mode?: string;
  uploaded: ArchiveFile[]; // 上传的资料（提案附件、报名表等）
  collected: ArchiveFile[]; // 收集的资料（材料提交、公告、公示等）
}

/** 选举活动（提案通过后生成，Dday + 岗位 + 日程 pipeline） */
export interface ElectionActivity {
  id: number;
  name: string; // 届名，如「涧口社区第十一届换届」
  org_type: 'village' | 'community';
  election_mode: string;
  dday: string; // 正式选举日 D
  status: 'preparing' | 'ongoing' | 'finished';
  posts: { posId?: string; position: string; count: number; requirement?: string; file?: ArchiveFile; files?: ArchiveFile[] }[];
  /** 岗位资料信息（报名表/资料下载链接，后台可上传，= 小程序前端「选举方式」展示内容） */
  downloadFiles: ArchiveFile[];
  /** 日程 pipeline（由 stage_templates 官方模板按 D 日倒排生成） */
  stages: {
    key: string; // 如 D-35 / D0 / D+1~+10
    name: string;
    offset: number;
    offsetEnd?: number; // 区间阶段结束偏移（单日阶段缺省=offset）
    date: string; // 起始日 = Dday + offset 天
    endDate: string; // 结束日 = Dday + offsetEnd 天（三色状态判断用）
    work: string; // 核心工作
    sys_action: string; // 系统动作
    announcement: string; // 关联公告描述
    announcements: string[]; // 关联公告模板编号
    review: string; // 审核轮次
    material: string; // 材料类型
  }[];
  createdAt: string;
}

/** Dday 推演：日期 = Dday + offset 天（offset 负为 D 前、0 为 D 日、正为 D 后） */
function addDays(dateStr: string, offset: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + offset);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/* ============ 列表通用元函数（活动/岗位/材料/候选人/公告共用，禁止各页重复实现） ============ */

/** 从届名提取中文届次：涧口社区第十届换届 → 第十届；提取不到则返回原名 */
export function sessionNo(name: string): string {
  const m = name.match(/(第[一二三四五六七八九十百\d]+届)/);
  return m ? m[1] : name;
}

/**
 * 活动状态由 Dday 时间算（纯本地日期，不走 UTC，避免时区偏移）：
 * D-35 之前=筹备中 preparing；Dday(含)之前=进行中 ongoing；Dday 之后=已归档 finished
 */
export function calcActivityStatus(a: ElectionActivity): ElectionActivity['status'] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dday = new Date(`${a.dday}T00:00:00`);
  const prepStart = new Date(dday);
  prepStart.setDate(prepStart.getDate() - 35);
  if (today.getTime() < prepStart.getTime()) return 'preparing';
  if (today.getTime() <= dday.getTime()) return 'ongoing';
  return 'finished';
}

/** 由官方日程模板生成某活动全部阶段 */
function buildStages(dday: string) {
  // date=阶段起始日(D+offset)，endDate=阶段结束日(D+offsetEnd，单日阶段等于起始日)
  return STAGE_TEMPLATES.map((s) => ({
    ...s,
    date: addDays(dday, s.offset),
    endDate: addDays(dday, s.offsetEnd ?? s.offset),
  }));
}

/** 选举活动列表（提案通过后生成） */
let activities: ElectionActivity[] = [
  {
    id: 90,
    name: '涧口社区第十届换届选举提案',
    org_type: 'community',
    election_mode: '全民直选',
    dday: '2026-10-30',
    status: 'preparing',
    posts: [
      { position: '主任', count: 1, requirement: '年满18周岁，本社区户籍' },
      { position: '副主任', count: 2, requirement: '熟悉社区工作' },
    ],
    downloadFiles: [{ name: '涧口社区第十届换届选举报名表.docx' }, { name: '参选人资格条件说明.docx' }],
    stages: buildStages('2026-10-30'),
    createdAt: '2026-09-01',
  },
];

/** v6.1 live：后端真实届次灌入（liveSync 调用，mock 被替换） */
export function setLiveActivities(list: ElectionActivity[]) {
  if (list?.length) {
    activities = list;
    emit();
  }
}

let nextId = 100;

// v6.1 唯一真相：归档真实数据走 services/electionApi.getArchives()（后端 archives 表），
// 此处不再预置任何演示文件夹，避免后台出现「假归档」第二真相。
let folders: ArchiveFolder[] = [];

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function getArchiveFolders(): ArchiveFolder[] {
  return folders;
}

export function subscribeToArchive(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 新建一届文件夹（提案提交/通过时调用） */
export function createFolder(folder: Omit<ArchiveFolder, 'id'>): number {
  const id = nextId++;
  folders = [{ id, ...folder }, ...folders];
  emit();
  return id;
}

/** 往某届文件夹追加「上传的资料」 */
export function addUploaded(folderId: number, files: ArchiveFile[]) {
  if (!files.length) return;
  folders = folders.map((f) => (f.id === folderId ? { ...f, uploaded: [...f.uploaded, ...files] } : f));
  emit();
}

/** 往某届文件夹追加「收集的资料」 */
export function addCollected(folderId: number, files: ArchiveFile[]) {
  if (!files.length) return;
  folders = folders.map((f) => (f.id === folderId ? { ...f, collected: [...f.collected, ...files] } : f));
  emit();
}

/** React hook：订阅归档数据 */
export function useArchiveFolders(): ArchiveFolder[] {
  return useSyncExternalStore(subscribeToArchive, getArchiveFolders);
}

/* ================= 选举活动（提案通过后生成） ================= */

export function getActivities(): ElectionActivity[] {
  return activities;
}

/** React hook：订阅选举活动 */
export function useActivities(): ElectionActivity[] {
  return useSyncExternalStore(subscribeToArchive, getActivities);
}

/** 提案通过 → 生成选举活动（Dday + 岗位 + 日程 pipeline） */
export function createActivity(a: Omit<ElectionActivity, 'id' | 'createdAt' | 'stages' | 'status'>): number {
  const id = nextId++;
  const activity: ElectionActivity = {
    id,
    name: a.name,
    org_type: a.org_type,
    election_mode: a.election_mode,
    dday: a.dday,
    status: 'preparing',
    posts: a.posts || [],
    downloadFiles: [],
    stages: buildStages(a.dday),
    createdAt: new Date().toISOString().slice(0, 10),
  };
  activities = [activity, ...activities];
  emit();
  return id;
}

/** 往某届追加岗位资料（报名表/资料下载） */
export function addDownloadFiles(activityId: number, files: ArchiveFile[]) {
  if (!files.length) return;
  activities = activities.map((a) =>
    a.id === activityId ? { ...a, downloadFiles: [...a.downloadFiles, ...files] } : a,
  );
  emit();
}
