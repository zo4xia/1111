import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Table,
  Tag,
  Button,
  Dialog,
  Form,
  Textarea,
  Select,
  Input,
  Descriptions,
  Space,
  MessagePlugin,
  Upload,
} from 'tdesign-react';
import type { PrimaryTableCol } from 'tdesign-react';
import Page from 'layouts/components/Page';
import ElectionSessionList from 'components/ElectionSessionList';
import SessionDetailBar from 'components/ElectionSessionList/SessionDetailBar';
import { ElectionActivity, sessionNo } from 'utils/electionStore';
import { getMaterials, reviewMaterial, createMaterial, appendMaterialFile, getPositions, Material } from 'services/electionApi';
import { activityIdMap, isLiveSynced, syncAll } from 'utils/liveSync';
import Style from './index.module.less';

/**
 * 材料提交管理（内部后台）· v6.2 真实接线版
 * ------------------------------------------------------------
 * 业务（甲方拍板简化）：
 *   · 选民小程序「左示例右拍照」提交 → 此处待审
 *   · 通过 → 自动进候选人池（R1 待审）；驳回 → 私信回流参选人
 *   · 内推：经办/子管理/编辑手工新增（组织推荐，按岗位要求代交）
 * 归属地隔离：登录后只看本归属地（req.user.org_id）。
 * 写操作全部走 electionApi（PUT 铁律）。
 * ------------------------------------------------------------
 */

const { FormItem } = Form;

/** 材料状态（对齐 materials.mat_status；submitted=已提交待审） */
const STATUS_META: Record<string, { label: string; theme: 'warning' | 'success' | 'danger' | 'default' }> = {
  pending: { label: '待上传', theme: 'default' },
  submitted: { label: '待审核', theme: 'warning' },
  approved: { label: '已通过', theme: 'success' },
  rejected: { label: '已驳回', theme: 'danger' },
};
/** 材料类型（对齐 materials.mat_type） */
const TYPE_META: Record<string, { label: string; theme: 'primary' | 'default' }> = {
  个人自荐: { label: '个人自荐', theme: 'primary' },
  组织推荐: { label: '组织推荐', theme: 'default' },
};

interface IMaterial {
  id: string;
  activityId: number;
  submitter: string;
  phone: string;
  type: '个人自荐' | '组织推荐';
  position: string;
  stage: string;
  submitTime: string;
  status: keyof typeof STATUS_META;
  attachments: { name: string; url?: string }[];
  reviewComment?: string;
  reviewer?: string;
  reviewTime?: string;
  note?: string;
  candidateId?: string;
}

const POSITIONS = ['主任', '副主任', '委员'];

/** 附件辅助：图片判断 / 去时间戳前缀 / 强制下载 */
const isImageFile = (name: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name || '');
const prettyFileName = (name: string) => {
  // 上传时存为「时间戳-随机串.扩展名」，去掉前缀还原可读名；不匹配则原样
  const m = (name || '').match(/^\d{10,}-[a-z0-9]+(\..+)$/i);
  return m ? m[1] : name;
};
const downloadAttachment = (url: string, name: string) => {
  const a = document.createElement('a');
  a.href = url;
  a.download = prettyFileName(name);
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

export default function Materials() {
  const [current, setCurrent] = useState<ElectionActivity | null>(null);
  const [list, setList] = useState<IMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<IMaterial | null>(null);
  const [rejectTarget, setRejectTarget] = useState<IMaterial | null>(null);
  const [rejectMsg, setRejectMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // 内推新增表单
  const [referralOpen, setReferralOpen] = useState(false);
  const [refName, setRefName] = useState('');
  const [refPhone, setRefPhone] = useState('');
  const [refPosition, setRefPosition] = useState('委员');
  const [refNote, setRefNote] = useState('');
  const [refFiles, setRefFiles] = useState<File[]>([]);

  /** 拉真实数据（失败回落空列表，不白屏不假数据） */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getMaterials();
      setList((rows || []).map((m: Material) => ({
        id: m.id,
        activityId: activityIdMap.get(m.elId) || 90,
        submitter: m.matSubmitter || '—',
        phone: m.matSubmitterPhone || '',
        type: (TYPE_META[m.matType || ''] ? m.matType : '个人自荐') as IMaterial['type'],
        position: m.matPositionId || '委员',
        stage: m.matStage || '提名阶段',
        submitTime: (m.matSubmitTime || '').replace('T', ' ').slice(0, 16),
        status: (STATUS_META[m.matStatus] ? m.matStatus : 'pending') as keyof typeof STATUS_META,
        attachments: (m.matFiles || []).map((f) => ({ name: f.name, url: f.url })),
        reviewComment: m.matReviewComment || '',
        reviewer: m.matReviewer || '',
        reviewTime: (m.matReviewTime || '').replace('T', ' ').slice(0, 16),
        note: m.matNote || '',
        candidateId: m.matCandidateId,
      })));
    } catch (e) {
      MessagePlugin.warning('材料列表加载失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    (async () => {
      if (!isLiveSynced()) await syncAll(); // 直达路由时补建 elId↔activityId 映射
      await refresh();
    })();
  }, [refresh]);

  const filtered = useMemo(
    () =>
      list.filter((m) => {
        if (current && m.activityId !== current.id) return false;
        if (statusFilter && m.status !== statusFilter) return false;
        if (typeFilter && m.type !== typeFilter) return false;
        if (keyword && !`${m.submitter}${m.phone}`.includes(keyword.trim())) return false;
        return true;
      }),
    [list, current, statusFilter, typeFilter, keyword],
  );

  /** 通过（真实 PUT → 自动入池） */
  const approve = async (row: IMaterial) => {
    if (busy) return;
    setBusy(true);
    try {
      await reviewMaterial(row.id, 'approved', '材料齐全，审核通过。');
      MessagePlugin.success(`已通过「${row.submitter}」的材料，进入候选人池（R1 待审）`);
      await refresh();
    } catch (e) {
      MessagePlugin.error((e as Error).message || '操作失败');
    } finally { setBusy(false); }
  };

  /** 确认驳回（真实 PUT → 私信回流） */
  const confirmReject = async () => {
    if (!rejectTarget) return;
    if (!rejectMsg.trim()) {
      MessagePlugin.warning('请填写驳回原因（会反馈给参选人）');
      return;
    }
    setBusy(true);
    try {
      await reviewMaterial(rejectTarget.id, 'rejected', rejectMsg.trim());
      MessagePlugin.success('已驳回，私信已通知参选人');
      setRejectTarget(null);
      setRejectMsg('');
      await refresh();
    } catch (e) {
      MessagePlugin.error((e as Error).message || '操作失败');
    } finally { setBusy(false); }
  };

  /** 内推提交（POST /api/materials + 附件代传） */
  const confirmReferral = async () => {
    if (!refName.trim() || !refPhone.trim()) {
      MessagePlugin.warning('请填写姓名和手机号');
      return;
    }
    if (!/^1\d{10}$/.test(refPhone.trim())) {
      MessagePlugin.warning('手机号须为 11 位数字');
      return;
    }
    setBusy(true);
    try {
      // 当前届 elId（材料挂届；后端由 elId 反查归属村，超管跨村也准）
      const elId = current ? [...activityIdMap.entries()].find(([, id]) => id === current.id)?.[0] : undefined;
      const created = await createMaterial({
        name: refName.trim(),
        phone: refPhone.trim(),
        positionId: refPosition,
        note: refNote.trim(),
        elId,
      });
      for (const f of refFiles) {
        await appendMaterialFile(created.id, f);
      }
      MessagePlugin.success(`内推已创建「${refName.trim()}」（组织推荐），附件 ${refFiles.length} 张`);
      setReferralOpen(false);
      setRefName(''); setRefPhone(''); setRefNote(''); setRefFiles([]);
      await refresh();
    } catch (e) {
      MessagePlugin.error((e as Error).message || '内推创建失败');
    } finally { setBusy(false); }
  };

  const columns: PrimaryTableCol<IMaterial>[] = [
    { colKey: 'submitter', title: '提交人', width: 100, cell: ({ row }) => <b>{row.submitter}</b> },
    { colKey: 'phone', title: '手机号', width: 130 },
    {
      colKey: 'type',
      title: '类型',
      width: 100,
      cell: ({ row }) => (
        <Tag size='small' theme={TYPE_META[row.type].theme} variant='light'>
          {TYPE_META[row.type].label}
        </Tag>
      ),
    },
    { colKey: 'position', title: '自荐岗位', width: 90 },
    {
      colKey: 'files',
      title: '附件',
      width: 90,
      cell: ({ row }) => row.attachments.length ? (
        <Button size='small' variant='text' theme='primary' onClick={() => setDetail(row)}>
          {row.attachments.length} 个
        </Button>
      ) : '—',
    },
    { colKey: 'submitTime', title: '提交时间', width: 150 },
    {
      colKey: 'status',
      title: '状态',
      width: 100,
      cell: ({ row }) => (
        <Tag size='small' theme={STATUS_META[row.status].theme} variant='light'>
          {STATUS_META[row.status].label}
        </Tag>
      ),
    },
    {
      colKey: 'op',
      title: '操作',
      width: 220,
      fixed: 'right',
      cell: ({ row }) => (
        <Space size={4}>
          <Button size='small' variant='text' theme='primary' onClick={() => setDetail(row)}>
            查看
          </Button>
          {['pending', 'submitted'].includes(row.status) && (
            <>
              <Button size='small' variant='text' theme='success' disabled={busy} onClick={() => approve(row)}>
                通过
              </Button>
              <Button
                size='small'
                variant='text'
                theme='danger'
                onClick={() => {
                  setRejectTarget(row);
                  setRejectMsg('');
                }}
              >
                驳回
              </Button>
            </>
          )}
          {row.candidateId && (
            <Tag size='small' theme='success' variant='light'>
              已入池
            </Tag>
          )}
        </Space>
      ),
    },
  ];

  // 第一级：活动列表（每行一届）
  if (!current) {
    return (
      <ElectionSessionList
        breadcrumbs={['办理中', '材料提交管理', '材料']}
        title='材料提交'
        sub='先选届：材料按选举活动（届）隔离，进入某一届后只审核该届参选人提交的材料。'
        statLabel='待审/总数'
        enterText='查看材料'
        statOf={(a) => {
          const all = list.filter((m) => m.activityId === a.id);
          return `${all.filter((m) => m.status === 'submitted').length}/${all.length}`;
        }}
        onEnter={setCurrent}
      />
    );
  }

  // 第二级：该届材料明细
  return (
    <Page breadcrumbs={['办理中', '材料提交管理', sessionNo(current.name)]}>
      <SessionDetailBar
        activity={current}
        onBack={() => setCurrent(null)}
        extra={
          <Tag theme='warning' variant='light'>
            本届待审核 {filtered.filter((m) => m.status === 'submitted').length} 份
          </Tag>
        }
      />
      <div className={Style.toolbar}>
        <Space size={8}>
          <Button theme='primary' onClick={() => setReferralOpen(true)}>
            ＋ 内推新增（组织推荐）
          </Button>
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as string)}
            placeholder='全部状态'
            clearable
            style={{ width: 130 }}
            options={[
              { label: '待上传', value: 'pending' },
              { label: '待审核', value: 'submitted' },
              { label: '已通过', value: 'approved' },
              { label: '已驳回', value: 'rejected' },
            ]}
          />
          <Select
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as string)}
            placeholder='全部类型'
            clearable
            style={{ width: 130 }}
            options={[
              { label: '个人自荐', value: '个人自荐' },
              { label: '组织推荐', value: '组织推荐' },
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
        <span className={Style.tip}>通过即入候选人池（R1 待审）；驳回自动私信参选人</span>
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
        empty='暂无材料（小程序端提交后在此审核）'
      />

      {/* 材料详情（真实附件，点击新窗口打开） */}
      <Dialog
        header='材料详情'
        visible={!!detail}
        onClose={() => setDetail(null)}
        width={640}
        footer={
          <Space>
            <Button variant='outline' onClick={() => setDetail(null)}>
              关闭
            </Button>
          </Space>
        }
      >
        {detail && (
          <div className={Style.detail}>
            <Descriptions
              column={2}
              items={[
                { label: '提交人', content: detail.submitter },
                { label: '手机号', content: detail.phone },
                { label: '类型', content: TYPE_META[detail.type].label },
                { label: '自荐岗位', content: detail.position },
                { label: '提交时间', content: detail.submitTime },
                {
                  label: '状态',
                  content: (
                    <Tag size='small' theme={STATUS_META[detail.status].theme}>
                      {STATUS_META[detail.status].label}
                    </Tag>
                  ),
                },
                { label: '备注', content: detail.note || '—' },
                { label: '候选人池', content: detail.candidateId ? '已入池' : '未入池' },
              ]}
            />
            <div className={Style.secTitle}>附件材料（共 {detail.attachments.length} 个 · 图片可预览，所有文件可下载）</div>
            {detail.attachments.length > 0 ? (
              <div className={Style.files}>
                {detail.attachments.filter((f) => isImageFile(f.name)).map((f) => (
                  <div key={f.name} className={Style.imgCard}>
                    <img src={f.url} alt={f.name} className={Style.imgThumb} onClick={() => f.url && window.open(f.url, '_blank')} />
                    <div className={Style.imgName} title={f.name}>{prettyFileName(f.name)}</div>
                    <div className={Style.imgActions}>
                      <Button size='small' variant='text' theme='primary' onClick={() => f.url && window.open(f.url, '_blank')}>预览</Button>
                      <Button size='small' variant='text' onClick={() => f.url && downloadAttachment(f.url, f.name)}>下载</Button>
                    </div>
                  </div>
                ))}
                {detail.attachments.filter((f) => !isImageFile(f.name)).map((f) => (
                  <div key={f.name} className={Style.fileRow}>
                    <span className={Style.fileIcon}>📄</span>
                    <span className={Style.fileName} title={f.name}>{prettyFileName(f.name)}</span>
                    <Button size='small' variant='text' theme='primary' onClick={() => f.url && window.open(f.url, '_blank')}>预览</Button>
                    <Button size='small' variant='text' onClick={() => f.url && downloadAttachment(f.url, f.name)}>下载</Button>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ color: '#9aa3af' }}>暂无附件（内推材料可由经办代传）</span>
            )}
            {/* 代传附件（工作人员兜底能力） */}
            <Upload
              theme='file'
              multiple
              accept='image/*,.pdf'
              withCredentials={false}
              autoUpload={false}
              onChange={(files) => {
                const picked = (Array.isArray(files) ? files : [files])
                  .map((f: { raw?: File }) => f?.raw)
                  .filter(Boolean) as File[];
                if (!picked.length || !detail) return;
                setBusy(true);
                (async () => {
                  try {
                    for (const f of picked) await appendMaterialFile(detail.id, f);
                    MessagePlugin.success(`已代传 ${picked.length} 个附件`);
                    await refresh();
                    const updated = await getMaterials();
                    const mine = (updated || []).find((m: Material) => m.id === detail.id);
                    if (mine) setDetail({ ...detail, attachments: (mine.matFiles || []).map((f) => ({ name: f.name, url: f.url })) });
                  } catch (e) {
                    MessagePlugin.error((e as Error).message || '代传失败');
                  } finally { setBusy(false); }
                })();
              }}
            />
            {detail.reviewComment && (
              <>
                <div className={Style.secTitle}>审核记录</div>
                <div className={Style.reviewBox}>
                  <div>
                    审核人：{detail.reviewer}　{detail.reviewTime}
                  </div>
                  <div>意见：{detail.reviewComment}</div>
                </div>
              </>
            )}
          </div>
        )}
      </Dialog>

      {/* 内推新增（甲方手工：组织推荐材料） */}
      <Dialog
        header='内推新增材料（组织推荐）'
        visible={referralOpen}
        onClose={() => setReferralOpen(false)}
        width={520}
        onConfirm={confirmReferral}
        confirmBtn={{ content: '创建材料', theme: 'primary', loading: busy }}
        cancelBtn='取消'
      >
        <Form labelAlign='top'>
          <FormItem label='参选人姓名' requiredMark>
            <Input value={refName} onChange={setRefName} placeholder='如：郑建国' maxlength={20} />
          </FormItem>
          <FormItem label='手机号' requiredMark>
            <Input value={refPhone} onChange={setRefPhone} placeholder='11 位手机号（参选人本人）' maxlength={11} />
          </FormItem>
          <FormItem label='推荐岗位'>
            <Select value={refPosition} onChange={(v) => setRefPosition(v as string)} options={POSITIONS.map((p) => ({ label: p, value: p }))} />
          </FormItem>
          <FormItem label='推荐说明（可选）'>
            <Textarea
              value={refNote}
              onChange={setRefNote}
              placeholder='如：村党组织推荐，材料已线下收取'
              autosize={{ minRows: 2, maxRows: 4 }}
            />
          </FormItem>
          <FormItem label='材料附件（可选，创建后也可在详情里代传）'>
            <Upload
              theme='file'
              multiple
              accept='image/*,.pdf'
              autoUpload={false}
              onChange={(files) => {
                const picked = (Array.isArray(files) ? files : [files])
                  .map((f: { raw?: File }) => f?.raw)
                  .filter(Boolean) as File[];
                setRefFiles(picked);
              }}
            />
          </FormItem>
        </Form>
      </Dialog>

      {/* 驳回原因 */}
      <Dialog
        header={`驳回材料 · ${rejectTarget?.submitter ?? ''}`}
        visible={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        width={480}
        onConfirm={confirmReject}
        confirmBtn={{ content: '确认驳回', theme: 'danger', loading: busy }}
        cancelBtn='取消'
      >
        <Form labelAlign='top'>
          <FormItem label='驳回原因（将反馈给参选人，便于其补正）'>
            <Textarea
              value={rejectMsg}
              onChange={setRejectMsg}
              placeholder='如：户籍不在本社区 / 材料缺身份证复印件 / 报名表未签字…'
              autosize={{ minRows: 3, maxRows: 6 }}
            />
          </FormItem>
        </Form>
      </Dialog>
    </Page>
  );
}
