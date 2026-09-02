import React, { useEffect, useMemo, useState } from 'react';
import { Card, Tag, Progress } from 'tdesign-react';
import { CalendarIcon, TimeIcon, UserIcon, NotificationIcon } from 'tdesign-icons-react';
import {
  currentUser, getElections, getStages, getAnnouncements, getRoster,
  daysBetween, todayStr,
  type Election, type Stage, type Announcement,
} from 'services/electionApi';

import Style from './index.module.less';

/* ================= 演示兜底（后端不可用时保底不白屏） ================= */
const DEMO_ORG = '涧口社区居委会';
const DEMO_TERM = '第十届';
const DEMO_D_DATE = '2026-10-30';
const DEMO_DAYS_TO_D = 12;
const DEMO_PROGRESS = 60;
const DEMO_CURRENT_STAGE = { name: '候选人提名', start: '2026-10-15', end: '2026-10-20' };
const DEMO_ANNOUNCEMENTS = [
  { pin: true, type: '公告', code: '第1号', title: '关于公布选举委员会成员名单的公告', date: '2026-10-01' },
  { pin: false, type: '公告', code: '第2号', title: '关于选民名单登记的公告', date: '2026-10-08' },
  { pin: false, type: '公告', code: '第3号', title: '关于候选人提名的公告', date: '2026-10-12' },
];
const DEMO_NEXT_STAGE = { name: '候选人资格审核', start: '2026-10-21', end: '2026-10-25' };
const DEMO_ROSTER = [
  { name: '陈建国', position: '村（居）委会主任', term: '第十届' },
  { name: '林秀英', position: '村（居）委会副主任', term: '第十届' },
  { name: '王志强', position: '村（居）委会委员', term: '第十届' },
];

/** live 数据形状（后端真实返回） */
interface LiveState {
  org: string; term: string; dDate: string; daysToD: number; progress: number;
  currentStage: { name: string; start: string; end: string };
  nextStage: { name: string; start: string; end: string };
  anns: Array<{ pin: boolean; type: string; code: string; title: string; date: string }>;
  roster: Array<{ name: string; position: string; term: string }>;
}

const fmt = (d?: string) => (d ? String(d).slice(0, 10) : '');

export default function Home() {
  const [live, setLive] = useState<LiveState | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const user = currentUser();
      if (!user) return; // 未登录走演示兜底
      try {
        // 进行中的届优先，否则最新一届
        const elections: Election[] = await getElections();
        if (!alive || !elections.length) return;
        const el = elections.find((x) => x.elStatus === 'in_progress') || elections[0];
        const [stages, anns, rosterAll] = await Promise.all([
          getStages(el.electionId).catch(() => [] as Stage[]),
          getAnnouncements().catch(() => [] as Announcement[]),
          getRoster().catch(() => [] as Array<{ rosName: string; rosPosition: string; rosTerm: string; orgId: string }>),
        ]);
        if (!alive) return;
        const D = fmt(el.elElectionDate);
        const today = todayStr();
        const daysToD = D ? daysBetween(D, today) : 0;
        const cur = stages.find((s) => s.stageStatus === '进行中');
        const past = stages.filter((s) => s.stageStatus === '已完成').length;
        const progress = stages.length ? Math.round((past / stages.length) * 100) : 0;
        const future = stages.filter((s) => s.stageStatus === '未开始');
        const next = future[0] || cur;
        const myAnns = anns
          .filter((a) => a.annStatus === 'published')
          .slice(0, 5)
          .map((a) => ({
            pin: false, type: '公告',
            code: a.annCode || '', title: a.annTitle,
            date: fmt(a.annPublishTime),
          }));
        const roster = (rosterAll as Array<{ rosName: string; rosPosition: string; rosTerm: string; orgId: string }>)
          .filter((r) => r.orgId === el.orgId)
          .slice(0, 6)
          .map((r) => ({ name: r.rosName, position: r.rosPosition, term: r.rosTerm || el.elTerm }));
        setLive({
          org: el.orgName || el.orgId, term: el.elTerm, dDate: D, daysToD, progress,
          currentStage: cur
            ? { name: cur.stageName, start: fmt(cur.stageStartDate), end: fmt(cur.stageEndDate) }
            : { name: '日程生成中', start: D, end: D },
          nextStage: next
            ? { name: next.stageName, start: fmt(next.stageStartDate), end: fmt(next.stageEndDate) }
            : { name: '—', start: D, end: D },
          anns: myAnns.length ? myAnns : DEMO_ANNOUNCEMENTS.map((a) => ({ ...a, pin: false })),
          roster: roster.length ? roster : DEMO_ROSTER,
        });
      } catch { /* 保持 mock 兜底 */ }
    })();
    return () => { alive = false; };
  }, []);

  const v = live;
  const roster = v?.roster || DEMO_ROSTER;
  const anns = v?.anns || DEMO_ANNOUNCEMENTS;
  const currentStage = v?.currentStage || DEMO_CURRENT_STAGE;
  const nextStage = v?.nextStage || DEMO_NEXT_STAGE;

  return (
    <div className={Style.page}>
      {/* ===== live 横幅 ===== */}
      {v && (
        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', color: '#1b5e20', borderRadius: 8, padding: '6px 14px', marginBottom: 12, fontSize: 13 }}>
          ● 已接入后端实时数据（Neon 云库）
        </div>
      )}

      {/* ===== 换届进度横幅 ===== */}
      <Card className={Style.heroCard} bordered={false}>
        <div className={Style.heroHead}>
          <div>
            <div className={Style.heroOrg}>
              {(v?.org || DEMO_ORG)} · {(v?.term || DEMO_TERM)}换届选举
            </div>
            <div className={Style.heroTitle}>依法选举 公正公开</div>
          </div>
          <Tag theme='warning' variant='light'>
            进行中
          </Tag>
        </div>
        <div className={Style.heroStats}>
          <div className={Style.heroStat}>
            <div className={Style.heroNum}>{v ? v.daysToD : DEMO_DAYS_TO_D}</div>
            <div className={Style.heroLbl}>距投票日（天）</div>
          </div>
          <div className={Style.heroStat}>
            <div className={Style.heroNum}>
              <span className={Style.breathDot} />
              {v ? v.dDate : DEMO_D_DATE}
            </div>
            <div className={Style.heroLbl}>正式选举日</div>
          </div>
          <div className={Style.heroStat}>
            <div className={Style.heroNum}>{v ? v.progress : DEMO_PROGRESS}%</div>
            <div className={Style.heroLbl}>流程进度</div>
          </div>
        </div>
        <Progress percentage={v ? v.progress : DEMO_PROGRESS} color='#0052d9' trackColor='#eef0f4' />
        <div className={Style.heroStage}>
          <span className={Style.heroStageDot} />
          当前阶段：<b>{currentStage.name}</b>
          <span className={Style.heroStageRange}>
            （{currentStage.start} ~ {currentStage.end}）
          </span>
        </div>
      </Card>

      <div className={Style.grid}>
        {/* ===== 最新公告 ===== */}
        <Card
          title={
            <div className={Style.cardTitle}>
              <NotificationIcon /> 最新公告
            </div>
          }
          className={Style.colMain}
        >
          <div className={Style.annList}>
            {anns.map((a, i) => (
              <div key={a.code + i} className={Style.annRow}>
                <span className={Style.annPin}>
                  {a.pin ? (
                    <Tag theme='warning' size='small'>
                      置顶
                    </Tag>
                  ) : (
                    ''
                  )}
                </span>
                <Tag theme='default' variant='outline' size='small'>
                  {a.type}
                </Tag>
                <span className={Style.annTitle}>
                  {a.code} · {a.title}
                </span>
                <span className={Style.annDate}>{a.date}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ===== 近期选举预告 ===== */}
        <Card
          title={
            <div className={Style.cardTitle}>
              <CalendarIcon /> 近期选举预告
            </div>
          }
          className={Style.colSide}
        >
          <div className={Style.fcName}>{nextStage.name}</div>
          <div className={Style.fcLine}>
            <TimeIcon />
            计划时间：{nextStage.start} ~ {nextStage.end}
          </div>
          <div className={Style.fcNote}>具体时间以正式公告为准（日期由 D 日锚点自动推算）</div>
        </Card>
      </div>

      {/* ===== 干部花名册 ===== */}
      <Card
        title={
          <div className={Style.cardTitle}>
            <UserIcon /> 村（居）委会干部花名册
          </div>
        }
      >
        <div className={Style.rosterList}>
          {roster.map((r, i) => (
            <div key={r.name + i} className={Style.rosterRow}>
              <span className={Style.rosterName}>{r.name}</span>
              <span className={Style.rosterPos}>{r.position}</span>
              <span className={Style.rosterTerm}>{r.term} 届期</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
