import { useMemo, useState, useEffect, useCallback } from 'react';
import { Table, Tag, Button, Dialog, Steps, Select, Input, Space, Descriptions, Textarea, Form, MessagePlugin } from 'tdesign-react';

const { FormItem } = Form;
import type { PrimaryTableCol } from 'tdesign-react';
import Page from 'layouts/components/Page';
import ElectionSessionList from 'components/ElectionSessionList';
import SessionDetailBar from 'components/ElectionSessionList/SessionDetailBar';
import { ElectionActivity, sessionNo } from 'utils/electionStore';
import { getCandidates, putCandidateRound, sendReviewMail, Candidate, ReviewMailResult } from 'services/electionApi';
import { activityIdMap, isLiveSynced, syncAll } from 'utils/liveSync';
import Style from './index.module.less';

/**
 * 候选人管理（内部后台）· v6.2 人工录入版
 * ------------------------------------------------------------
 * 业务（甲方拍板，砍掉计算逻辑）：
 *   · 材料通过自动入池（R1 待审）
 *   · R1~R4 结果由甲方在系统手动点「通过/不通过」，可填理由（可选）
 *     ——评审方式：系统一键把材料链接打包发评审领导邮箱，线下评审，
 *       结果反馈后由经办在此录入。
 *   · 状态由轮次结果自动派生（待初审→待第2轮→…→正式候选人/落选）
 * 归属地隔离：登录后只读本归属地。
 * ------------------------------------------------------------
 */

const { StepItem } = Steps;

const ROUND_META: Record<string, { theme: 'success' | 'danger' | 'warning' | 'default'; label: string }> = {
  通过: { theme: 'success', label: '通过' },
  不通过: { theme: 'danger', label: '不通过' },
  待审: { theme: 'warning', label: '待审' },
};
const STATUS_THEME: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  当选: 'success',
  正式候选人: 'success',
  待初审: 'warning',
  待第2轮: 'warning',
  待第3轮: 'warning',
  待第4轮考察: 'warning',
  初审退出: 'default',
  预选未入围: 'default',
  联审不通过: 'danger',
  考察不通过: 'danger',
  落选: 'danger',
};
const SOURCE_META = { self: '自荐', org_recommend: '组织推荐' } as const;

interface IRound {
  result: '' | '通过' | '不通过' | '待审';
  reviewer?: string;
  time?: string;
  comment?: string;
}
interface ICandidate {
  id: string;
  activityId: number;
  name: string;
  gender: string;
  age: number;
  source: keyof typeof SOURCE_META;
  position: string;
  phone: string;
  rounds: [IRound, IRound, IRound, IRound];
  status: string;
  votes?: number;
}

const ROUND_NAMES = ['R1 初步提名·镇级初审', 'R2 竞选预选', 'R3 区级部门联审', 'R4 党委考察'];
const ROUND_SHORT = ['R1初审', 'R2预选', 'R3联审', 'R4考察'];

function mapRound(r: string | undefined, reviewer?: string, time?: string, comment?: string): IRound {
  return { result: (r || '') as IRound['result'], reviewer, time: (time || '').replace('T', ' ').slice(0, 16), comment };
}

/** 单个轮次小标签 */
function RoundTag({ r }: { r: IRound }) {
  if (!r.result) return <span className={Style.roundEmpty}>—</span>;
  return (
    <Tag size='small' theme={(ROUND_META[r.result] || { theme: 'default' }).theme} variant='light'>
      {(ROUND_META[r.result] || { label: r.result }).label}
    </Tag>
  );
}

export default function Candidates() {
  const [current, setCurrent] = useState<ElectionActivity | null>(null);
  const [list, setList] = useState<ICandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<ICandidate | null>(null);
  const [busy, setBusy] = useState(false);

  // 一键送审邮件（评审领导邮箱；SMTP 未配时返回文案复制转发）
  const [mailOpen, setMailOpen] = useState(false);
  const [mailRound, setMailRound] = useState(1);
  const [mailEmails, setMailEmails] = useState(() => localStorage.getItem('cxq_review_emails') || '');
  const [mailNote, setMailNote] = useState('');
  const [mailResult, setMailResult] = useState<ReviewMailResult | null>(null);
  const [mailBusy, setMailBusy] = useState(false);

  const sendMail = async () => {
    if (!mailEmails.trim()) {
      MessagePlugin.warning('请填写评审领导的邮箱（多个用逗号分隔）');
      return;
    }
    if (!current) return;
    const elId = [...activityIdMap.entries()].find(([, id]) => id === current.id)?.[0] || 'el-15';
    setMailBusy(true);
    try {
      const r = await sendReviewMail(elId, mailRound, mailEmails.trim(), mailNote.trim() || undefined);
      setMailResult(r);
      localStorage.setItem('cxq_review_emails', mailEmails.trim());
      if (r.mailed) MessagePlugin.success(`已发送 ${r.sent} 位评审（共 ${r.count} 名候选人材料）`);
      else MessagePlugin.info('SMTP 未配置：已生成送审文案，请复制后转发到领导邮箱');
    } catch (e) {
      MessagePlugin.error((e as Error).message || '送审失败');
    } finally { setMailBusy(false); }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getCandidates();
      setList((rows || []).map((c: Candidate) => ({
        id: c.id,
        activityId: activityIdMap.get(c.elId) || 90,
        name: c.candName,
        gender: c.candGender || '—',
        age: Number(c.candAge) || 0,
        source: (c.candSource === 'org_recommend' ? 'org_recommend' : 'self') as keyof typeof SOURCE_META,
        position: c.candPositionId || '委员',
        phone: c.candPhone || '',
        rounds: [
          mapRound(c.candR1, c.candR1Reviewer, c.candR1Time, c.candR1Comment),
          mapRound(c.candR2, c.candR2Reviewer, c.candR2Time, c.candR2Comment),
          mapRound(c.candR3, c.candR3Reviewer, c.candR3Time, c.candR3Comment),
          mapRound(c.candR4, c.candR4Reviewer, c.candR4Time, c.candR4Comment),
        ] as [IRound, IRound, IRound, IRound],
        status: c.candStatus || '待初审',
        votes: c.candVotes,
      })));
    } catch (e) {
      MessagePlugin.warning('候选人列表加载失败，请刷新重试');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    (async () => {
      if (!isLiveSynced()) await syncAll(); // 直达路由时补建映射
      await refresh();
    })();
  }, [refresh]);

  /** 录入某轮结果（可选理由），成功后刷新 */
  const putRound = async (cand: ICandidate, roundIdx: number, result: '通过' | '不通过', reason: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await putCandidateRound(cand.id, (roundIdx + 1) as 1 | 2 | 3 | 4, result, reason.trim() || undefined);
      MessagePlugin.success(`${cand.name} · R${roundIdx + 1} 已录入「${result}」，状态：${r.candStatus}`);
      await refresh();
      // 同步刷新详情弹窗
      const updated = list.length;
      if (detail && detail.id === cand.id) {
        const rows = await getCandidates();
        const nc = (rows || []).find((x: Candidate) => x.id === cand.id);
        if (nc) {
          setDetail({
            ...detail,
            rounds: [
              mapRound(nc.candR1, nc.candR1Reviewer, nc.candR1Time, nc.candR1Comment),
              mapRound(nc.candR2, nc.candR2Reviewer, nc.candR2Time, nc.candR2Comment),
              mapRound(nc.candR3, nc.candR3Reviewer, nc.candR3Time, nc.candR3Comment),
              mapRound(nc.candR4, nc.candR4Reviewer, nc.candR4Time, nc.candR4Comment),
            ] as [IRound, IRound, IRound, IRound],
            status: nc.candStatus || '待初审',
          });
        }
      }
      void updated;
    } catch (e) {
      MessagePlugin.error((e as Error).message || '录入失败');
    } finally { setBusy(false); }
  };

  const filtered = useMemo(
    () =>
      list.filter((c) => {
        if (current && c.activityId !== current.id) return false;
        if (statusFilter && c.status !== statusFilter) return false;
        if (sourceFilter && c.source !== sourceFilter) return false;
        if (keyword && !`${c.name}${c.phone}`.includes(keyword.trim())) return false;
        return true;
      }),
    [list, current, statusFilter, sourceFilter, keyword],
  );

  /** 当前可操作的轮（前置全通过的第一个空/待审轮）；全过=null */
  const activeRound = (c: ICandidate) => {
    for (let i = 0; i < 4; i += 1) {
      if (c.rounds[i].result !== '通过') return i;
    }
    return null;
  };

  const columns: PrimaryTableCol<ICandidate>[] = [
    { colKey: 'name', title: '姓名', width: 90, cell: ({ row }) => <b>{row.name}</b> },
    { colKey: 'info', title: '性别/年龄', width: 90, cell: ({ row }) => `${row.gender} · ${row.age}` },
    {
      colKey: 'source',
      title: '来源',
      width: 90,
      cell: ({ row }) => (
        <Tag size='small' variant='light' theme={row.source === 'org_recommend' ? 'default' : 'primary'}>
          {SOURCE_META[row.source]}
        </Tag>
      ),
    },
    { colKey: 'position', title: '岗位', width: 80 },
    { colKey: 'r1', title: 'R1初审', width: 80, cell: ({ row }) => <RoundTag r={row.rounds[0]} /> },
    { colKey: 'r2', title: 'R2预选', width: 80, cell: ({ row }) => <RoundTag r={row.rounds[1]} /> },
    { colKey: 'r3', title: 'R3联审', width: 80, cell: ({ row }) => <RoundTag r={row.rounds[2]} /> },
    { colKey: 'r4', title: 'R4考察', width: 80, cell: ({ row }) => <RoundTag r={row.rounds[3]} /> },
    {
      colKey: 'status',
      title: '当前状态',
      width: 110,
      cell: ({ row }) => (
        <Tag size='small' theme={STATUS_THEME[row.status] ?? 'warning'} variant='light'>
          {row.status}
        </Tag>
      ),
    },
    { colKey: 'votes', title: '得票', width: 70, cell: ({ row }) => row.votes ?? '—' },
    {
      colKey: 'op',
      title: '操作',
      width: 170,
      fixed: 'right',
      cell: ({ row }) => {
        const ar = activeRound(row);
        return (
          <Space size={4}>
            <Button size='small' variant='text' theme='primary' onClick={() => setDetail(row)}>
              审核详情
            </Button>
            {ar != null && (
              <Button size='small' variant='text' theme='warning' onClick={() => setDetail(row)}>
                录 R{ar + 1}
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  // 第一级：活动列表
  if (!current) {
    return (
      <ElectionSessionList
        breadcrumbs={['办理中', '候选人管理', '候选人']}
        title='候选人审核'
        sub='先选届：候选人四轮审核按选举活动（届）隔离，进入某一届后只看该届候选人。'
        statLabel='候选人数'
        enterText='查看候选人'
        statOf={(a) => list.filter((c) => c.activityId === a.id).length}
        onEnter={setCurrent}
      />
    );
  }

  // 第二级：该届候选人明细
  return (
    <Page breadcrumbs={['办理中', '候选人管理', sessionNo(current.name)]}>
      <SessionDetailBar activity={current} onBack={() => setCurrent(null)} />
      <div className={Style.toolbar}>
        <Space size={8}>
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as string)}
            placeholder='全部状态'
            clearable
            style={{ width: 140 }}
            options={['待初审', '待第2轮', '待第3轮', '待第4轮考察', '正式候选人', '当选', '落选', '初审退出', '预选未入围', '联审不通过', '考察不通过'].map((v) => ({
              label: v,
              value: v,
            }))}
          />
          <Select
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v as string)}
            placeholder='全部来源'
            clearable
            style={{ width: 120 }}
            options={[
              { label: '自荐', value: 'self' },
              { label: '组织推荐', value: 'org_recommend' },
            ]}
          />
          <Input
            value={keyword}
            onChange={setKeyword}
            placeholder='搜索姓名 / 手机号'
            clearable
            style={{ width: 200 }}
          />
        </Space>
        <span className={Style.tip}>评审流程：一键发邮箱 → 领导线下评 → 结果在此手动录入（可填理由）</span>
        <Button size='small' theme='primary' variant='outline' onClick={() => { setMailOpen(true); setMailResult(null); }}>
          ✉ 一键送审邮箱
        </Button>
      </div>

      <Table
        rowKey='id'
        columns={columns}
        data={filtered}
        loading={loading}
        bordered
        stripe
        hover
        tableLayout='fixed'
        maxHeight='calc(100vh - 280px)'
        empty='暂无候选人（材料审核通过后自动进入）'
      />

      {/* 一键送审邮件 */}
      <Dialog
        header='一键送审 · 候选人材料发评审领导邮箱'
        visible={mailOpen}
        onClose={() => setMailOpen(false)}
        width={680}
        footer={
          <Space>
            {mailResult && !mailResult.mailed && (
              <Button
                variant='outline'
                theme='primary'
                onClick={() => {
                  navigator.clipboard?.writeText(mailResult.text);
                  MessagePlugin.success('文案已复制，去邮箱粘贴发送即可');
                }}
              >
                复制送审文案
              </Button>
            )}
            <Button variant='outline' onClick={() => setMailOpen(false)}>
              关闭
            </Button>
            <Button theme='primary' loading={mailBusy} disabled={!!mailResult} onClick={sendMail}>
              {mailResult?.mailed ? '已发送' : '生成并发送'}
            </Button>
          </Space>
        }
      >
        <Form labelAlign='top'>
          <FormItem label='送审轮次'>
            <Select
              value={mailRound}
              onChange={(v) => setMailRound(Number(v))}
              options={ROUND_NAMES.map((n, i) => ({ label: n, value: i + 1 }))}
              style={{ width: 280 }}
            />
          </FormItem>
          <FormItem label='评审领导邮箱（多个用逗号分隔，下次自动记住）'>
            <Textarea
              value={mailEmails}
              onChange={setMailEmails}
              placeholder='zhang@cxq.gov.cn, li@cxq.gov.cn'
              autosize={{ minRows: 2, maxRows: 4 }}
            />
          </FormItem>
          <FormItem label='备注（可选）'>
            <Input value={mailNote} onChange={setMailNote} placeholder='如：请于本周五前反馈评审结果' />
          </FormItem>
        </Form>
        {mailResult && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{mailResult.subject}（{mailResult.count} 人）</div>
            <Textarea value={mailResult.text} readonly autosize={{ minRows: 8, maxRows: 16 }} />
            <div style={{ color: '#9aa3af', marginTop: 4 }}>
              {mailResult.mailed
                ? `已通过 SMTP 发送给 ${mailResult.receivers.join('、')}`
                : 'SMTP 未配置（运维配 server/smtp.env 后可直发），当前生成文案供复制转发，内含每位候选人的材料附件链接'}
            </div>
          </div>
        )}
      </Dialog>

      {/* 四轮审核详情：每轮手动录通过/不通过 + 可选理由 */}
      <Dialog
        header={`候选人四轮审核 · ${detail?.name ?? ''}`}
        visible={!!detail}
        onClose={() => setDetail(null)}
        width={720}
        footer={
          <Button variant='outline' onClick={() => setDetail(null)}>
            关闭
          </Button>
        }
      >
        {detail && (
          <div className={Style.detail}>
            <Descriptions
              column={3}
              bordered
              size='small'
              items={[
                { label: '姓名', content: detail.name },
                { label: '岗位', content: detail.position },
                { label: '来源', content: SOURCE_META[detail.source] },
                { label: '性别/年龄', content: `${detail.gender} · ${detail.age}` },
                { label: '手机号', content: detail.phone },
                {
                  label: '当前状态',
                  content: (
                    <Tag size='small' theme={STATUS_THEME[detail.status] ?? 'warning'}>
                      {detail.status}
                    </Tag>
                  ),
                },
              ]}
            />
            <Steps current={(() => { const ar = activeRound(detail); return ar == null ? 4 : ar; })()} layout='vertical' theme='default'>
              {detail.rounds.map((r, i) => (
                <StepItem
                  key={i}
                  title={ROUND_NAMES[i]}
                  status={
                    r.result === '通过' ? 'finish' : r.result === '不通过' ? 'error' : r.result === '待审' ? 'process' : 'default'
                  }
                />
              ))}
            </Steps>

            {/* 每轮：结果标签 + 审核人/时间/理由 + 手动录入按钮 */}
            <div className={Style.roundList}>
              {detail.rounds.map((r, i) => {
                const ar = activeRound(detail);
                const canEdit = ar === i; // 只有当前待审轮可录
                return (
                  <div key={i} className={Style.roundLine}>
                    <span className={Style.roundName}>{ROUND_NAMES[i]}</span>
                    {r.result ? <RoundTag r={r} /> : <span className={Style.roundEmpty}>未到轮次</span>}
                    <span className={Style.roundMeta}>
                      {r.reviewer ? `${r.reviewer}${r.time ? ` · ${r.time}` : ''}` : ''}
                    </span>
                    {r.comment && <span className={Style.roundComment}>｜{r.comment}</span>}
                    {canEdit && (
                      <RoundInput cand={detail} roundIdx={i} busy={busy} onSubmit={(result, reason) => putRound(detail, i, result, reason)} />
                    )}
                    {!canEdit && ar != null && i > ar && (
                      <span className={Style.roundWait}>（待第 {i} 轮录入后开放）</span>
                    )}
                  </div>
                );
              })}
            </div>

            {detail.votes != null && (
              <div className={Style.votes}>
                正式选举得票：<b>{detail.votes}</b> 票
              </div>
            )}
          </div>
        )}
      </Dialog>
    </Page>
  );
}

/** 单轮录入行：通过/不通过按钮 + 可选理由框 */
function RoundInput({ cand, roundIdx, busy, onSubmit }: {
  cand: ICandidate; roundIdx: number; busy: boolean;
  onSubmit: (result: '通过' | '不通过', reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  void cand;
  return (
    <div className={Style.roundInputRow}>
      <Input
        value={reason}
        onChange={setReason}
        placeholder='理由（可选，如：预选得票未过线 / 材料补齐合格）'
        style={{ width: 300 }}
        maxlength={60}
      />
      <Button size='small' theme='success' variant='outline' disabled={busy} onClick={() => onSubmit('通过', reason)}>
        通过
      </Button>
      <Button size='small' theme='danger' variant='outline' disabled={busy} onClick={() => onSubmit('不通过', reason)}>
        不通过
      </Button>
      <span className={Style.roundHint}>评审结果来自邮箱送审反馈，手动录入</span>
      <div className={Style.roundTagShort}>{ROUND_SHORT[roundIdx]}</div>
    </div>
  );
}
