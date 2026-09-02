import React, { memo, useMemo, useState, useEffect, useCallback } from 'react';
import {
  Button,
  Dialog,
  Form,
  Input,
  InputNumber,
  Select,
  Radio,
  Table,
  Tag,
  Textarea,
  Descriptions,
  DatePicker,
  Upload,
  MessagePlugin,
} from 'tdesign-react';
import Page from 'layouts/components/Page';
import { useCurrentRole } from 'utils/roleStore';
import { forceResync } from 'utils/liveSync';
import {
  getProposals,
  createProposal,
  updateProposal,
  reviewProposal,
  uploadProposalFile,
  apiOrgs,
  currentUser,
  type Org,
  type Proposal,
} from 'services/electionApi';
import Style from './index.module.less';

const { FormItem } = Form;

/** 选举方式（按组织类型联动）：村=全民直选唯一；社区=三选一 */
const ELECTION_MODE_BY_TYPE: Record<string, string[]> = {
  village: ['全民直选'],
  community: ['全民直选', '户代表选举', '居民代表选举'],
};
/** 全部选举方式（筛选用） */
const ALL_MODES = ['全民直选', '户代表选举', '居民代表选举'];
const STATUS_META = {
  draft: { label: '草稿', theme: 'default' as const },
  pending: { label: '待审批', theme: 'warning' as const },
  approved: { label: '已通过', theme: 'success' as const },
  rejected: { label: '已驳回', theme: 'danger' as const },
};

interface IProposal {
  id: string;
  orgId?: string;
  submitted_at: string;
  title: string;
  org_type: 'village' | 'community';
  election_mode: string;
  election_date?: string;
  status: keyof typeof STATUS_META;
  proposer: string;
  positions: string;
  posts?: IPostRow[];
  report: string;
  attachments: { name: string; url?: string }[];
  reject_reason?: string;
}

/** 岗位配置行（创建提案时表格填写） */
interface IPostRow {
  key: number;
  position: string;
  count: number;
  requirement: string;
  /** 报名表：支持后台上传文件（主），或外链（备用）；any=TDesign UploadFile（含 raw 原始文件用于本地预览下载） */
  file?: any;
  link: string;
}

/** 岗位名称候选（一期：主任/副主任/委员，可自定义） */
const POSITION_OPTIONS = ['主任', '副主任', '委员'];

/** 后端 Proposal → 页面 IProposal（真实落库，刷新不丢） */
const normStatus = (s?: string): keyof typeof STATUS_META =>
  s === 'submitted' ? 'pending' : ((s as keyof typeof STATUS_META) || 'pending');
const mapProposal = (p: Proposal): IProposal => ({
  id: p.id,
  orgId: p.orgId,
  submitted_at: (p.propSubmitTime || '').replace('T', ' ').slice(0, 10),
  title: p.propTitle,
  org_type: 'community',
  election_mode: p.propMethod || '全民直选',
  election_date: (p.propElectionDate || p.electionDate || '').slice(0, 10),
  status: normStatus(p.propStatus),
  proposer: '村居经办人',
  positions: (p.posts || []).map((x) => `${x.position}${x.count}名`).join('、') || '—',
  posts: (p.posts || []).map((x, i) => ({
    key: i + 1, position: x.position, count: x.count, requirement: x.requirement || '', link: '',
  })),
  report: (p as Proposal & { propReport?: string }).propReport || '（暂无详细说明）',
  attachments: (p.files || []).map((f) => ({ name: f.name, url: f.url })),
  reject_reason: p.propReviewComment || undefined,
});

/** 默认岗位配置（创建提案初始行） */
const DEFAULT_POSTS: IPostRow[] = [
  { key: 1, position: '主任', count: 1, requirement: '', link: '' },
  { key: 2, position: '副主任', count: 2, requirement: '', link: '' },
];

/** 状态流转：草稿 → 待审批 → 通过/驳回；驳回后可重编再提交；通过只读 */
export default memo(() => {
  const [proposals, setProposals] = useState<IProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const loadProposals = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getProposals();
      setProposals(rows.map(mapProposal));
    } catch (e) {
      MessagePlugin.error('提案加载失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    loadProposals();
  }, [loadProposals]);
  /** 当前登录角色（控制编辑/审批按钮显隐） */
  const currentRole = useCurrentRole();
  const canEdit = currentRole.perms.includes('edit');
  const canApprove = currentRole.perms.includes('approve');
  const [keyword, setKeyword] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [createVisible, setCreateVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [current, setCurrent] = useState<IProposal | null>(null);
  /** 正在编辑的提案（驳回后可重新编辑；null=新建） */
  const [editing, setEditing] = useState<IProposal | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  /** 岗位配置行（创建提案时表格填写） */
  const [postRows, setPostRows] = useState<IPostRow[]>(DEFAULT_POSTS.map((r) => ({ ...r })));
  /** 创建提案附件（TDesign Upload） */
  const [createFiles, setCreateFiles] = useState<any[]>([]);
  /** 外链文件地址（双保险：上传有问题时用外链应急） */
  const [externalLinks, setExternalLinks] = useState<string[]>([]);
  const addExtLink = () => setExternalLinks((prev) => [...prev, '']);
  const updateExtLink = (i: number, v: string) => setExternalLinks((prev) => prev.map((u, idx) => (idx === i ? v : u)));
  const removeExtLink = (i: number) => setExternalLinks((prev) => prev.filter((_, idx) => idx !== i));
  /** 组织类型（村/社区）→ 决定选举方式可选范围 */
  const [orgType, setOrgType] = useState<'village' | 'community'>('community');

  /** 当前登录人：超管(crossOrg)创建提案必须选归属地；村镇账号自动锁定本归属地 */
  const me = currentUser();
  const isCross = !!me?.crossOrg;
  const [orgOptions, setOrgOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [createOrgId, setCreateOrgId] = useState(me?.orgId || '');
  useEffect(() => {
    if (!isCross) return;
    apiOrgs()
      .then((list: Org[]) => {
        setOrgOptions(
          list
            .filter((o) => o.orgId !== 'boss')
            .map((o) => ({ label: `${o.town ? o.town + ' · ' : ''}${o.name}`, value: o.orgId })),
        );
      })
      .catch(() => undefined);
  }, [isCross]);

  const [form] = Form.useForm();
  const [createForm] = Form.useForm();

  /** 更新岗位行 */
  const updatePostRow = (key: number, field: keyof IPostRow, value: string | number) => {
    setPostRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };
  /** 添加/删除岗位行 */
  const addPostRow = () => {
    setPostRows((prev) => [...prev, { key: Date.now(), position: '委员', count: 1, requirement: '', link: '' }]);
  };
  const removePostRow = (key: number) => {
    setPostRows((prev) => prev.filter((r) => r.key !== key));
  };

  /** 筛选后的列表 */
  const list = useMemo(
    () =>
      proposals.filter((p) => {
        if (keyword && !p.title.includes(keyword)) return false;
        if (modeFilter && p.election_mode !== modeFilter) return false;
        if (statusFilter && p.status !== statusFilter) return false;
        return true;
      }),
    [proposals, keyword, modeFilter, statusFilter],
  );

  /** 打开创建弹窗：新建（无参）或编辑驳回提案（传 row） */
  const openCreate = (row?: IProposal) => {
    setEditing(row || null);
    setCreateVisible(true);
    if (row) {
      // 编辑：预填驳回提案数据（归属地锁定，不可改）
      setCreateOrgId(row.orgId || me?.orgId || '');
      setOrgType(row.org_type);
      setPostRows((row.posts && row.posts.length ? row.posts : DEFAULT_POSTS).map((r) => ({ ...r })));
      // 上传文件回填（排除外链）
      setCreateFiles(
        row.attachments
          .filter((a) => !a.url || !/^https?:/.test(a.url))
          .map((a) => ({ name: a.name, status: 'success' })),
      );
      // 外链回填（http(s) 开头的视为外链）
      setExternalLinks(row.attachments.filter((a) => a.url && /^https?:/.test(a.url)).map((a) => a.url as string));
      createForm.setFieldsValue({
        title: row.title,
        election_mode: row.election_mode,
        election_date: row.election_date || '',
        report: row.report,
      });
    } else {
      // 新建：重置（村镇账号自动锁定本归属地；超管留空待选）
      setCreateOrgId(me?.crossOrg ? '' : me?.orgId || '');
      setOrgType('community');
      setPostRows(DEFAULT_POSTS.map((r) => ({ ...r })));
      setCreateFiles([]);
      setExternalLinks([]);
      createForm.reset();
    }
  };

  /** 打开详情 */
  const openDetail = (row: IProposal) => {
    setCurrent(row);
    setReviewComment(row.reject_reason || '');
    setDetailVisible(true);
  };

  /** 通过/驳回（真实落库；通过后后端一次性生成 D日+日程+岗位+公告草稿，并强制刷新全局） */
  const review = async (action: 'approve' | 'reject', target?: IProposal | null) => {
    const item = target ?? current;
    if (!item) return;
    if (action === 'reject' && !reviewComment.trim()) {
      MessagePlugin.warning('驳回必须填写原因');
      return;
    }
    try {
      const r = await reviewProposal(item.id, action, reviewComment.trim());
      if (action === 'approve') {
        MessagePlugin.success(
          `已通过：自动生成 ${r.stagesGenerated ?? 0} 个日程、${r.positionsGenerated ?? 0} 个岗位、${r.announcementsGenerated ?? 0} 份公告草稿`,
        );
        // 后端已生成活动/日程/岗位/公告 → 强制重灌本地 store，活动列表与公告记录立即出现
        await forceResync().catch(() => undefined);
      } else {
        MessagePlugin.success('提案已驳回');
      }
      setDetailVisible(false);
      loadProposals();
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    }
  };

  /** DatePicker 值（string/dayjs/Date）→ YYYY-MM-DD */
  const fmtPicker = (val: unknown): string => {
    if (!val) return '';
    if (typeof val === 'string') return val.slice(0, 10);
    const v = val as { format?: (f: string) => string };
    if (typeof v.format === 'function') return v.format('YYYY-MM-DD');
    return new Date(val as string).toISOString().slice(0, 10);
  };

  /** 创建提案 / 驳回后编辑重提（真实落库；附件与岗位报名表随后真实上传） */
  const onCreate = async () => {
    const v = await createForm.validate();
    if (!v) return;
    const values = createForm.getFieldsValue(true);
    const dday = fmtPicker(values.election_date);
    const targetOrg = isCross ? createOrgId : me?.orgId || '';
    if (!targetOrg) {
      MessagePlugin.warning('请先选择本提案归属的村/社区');
      return;
    }
    const payload = {
      title: values.title,
      method: values.election_mode,
      electionDate: dday,
      posts: postRows.map((r) => ({ position: r.position, count: r.count, requirement: r.requirement })),
      report: values.report || '',
      orgId: targetOrg,
    };
    try {
      let proposalId = editing?.id || '';
      if (editing) {
        await updateProposal(editing.id, payload);
        MessagePlugin.success('提案已重新提交审批');
      } else {
        const created = await createProposal(payload);
        proposalId = created.id;
        MessagePlugin.success(`提案已提交审批，D 日锚点：${dday || '未填'}`);
      }
      // 附件 + 岗位报名表真实上传到该提案（TDesign 本地暂存的 raw File）
      const files: File[] = [
        ...createFiles.map((f) => f.raw as File).filter(Boolean),
        ...postRows.filter((r) => r.file?.raw).map((r) => r.file.raw as File),
      ];
      if (proposalId && files.length) {
        await Promise.all(files.map((f) => uploadProposalFile(proposalId, f))).catch(() => undefined);
      }
      setCreateVisible(false);
      createForm.reset();
      setEditing(null);
      loadProposals();
    } catch (e) {
      MessagePlugin.error('提交失败：' + (e as Error).message);
    }
  };

  /** 详情弹窗 footer */
  const detailFooter = null;

  const columns = [
    { colKey: 'submitted_at', title: '提交时间', width: 110 },
    {
      colKey: 'title',
      title: '提案名称',
      width: 220,
      cell: ({ row }: { row: IProposal }) => <span className={Style.tt}>{row.title}</span>,
    },
    { colKey: 'election_mode', title: '选举方式', width: 100 },
    {
      colKey: 'status',
      title: '状态',
      width: 100,
      cell: ({ row }: { row: IProposal }) => (
        <Tag theme={STATUS_META[row.status].theme} variant='light'>
          {STATUS_META[row.status].label}
        </Tag>
      ),
    },
    {
      colKey: 'op',
      title: '操作',
      width: 180,
      cell: ({ row }: { row: IProposal }) => (
        <>
          <Button variant='text' theme='primary' onClick={() => openDetail(row)}>
            查看详情
          </Button>
          {row.status === 'pending' && canApprove && (
            <>
              <Button
                variant='text'
                theme='success'
                onClick={() => {
                  setCurrent(row);
                  review('approve', row);
                }}
              >
                通过
              </Button>
              <Button
                variant='text'
                theme='danger'
                onClick={() => {
                  setCurrent(row);
                  setReviewComment('');
                  setDetailVisible(true);
                }}
              >
                驳回
              </Button>
            </>
          )}
          {row.status === 'rejected' && canEdit && (
            <Button variant='text' theme='warning' onClick={() => openCreate(row)}>
              编辑
            </Button>
          )}
        </>
      ),
    },
  ];

  return (
    <Page breadcrumbs={['首页工作台', '提案审批', '提案列表']}>
      <div className={Style.wrap}>
        <div className={Style.pageHead}>
          <h2 className={Style.pageTitle}>提案列表</h2>
          <Button theme='primary' onClick={() => openCreate()}>
            ＋ 创建提案
          </Button>
        </div>

        {/* 筛选条 */}
        <Form form={form} className={Style.filters} layout='inline'>
          <FormItem name='keyword' label='提案名称'>
            <Input placeholder='输入关键词...' value={keyword} onChange={(v) => setKeyword(v as string)} />
          </FormItem>
          <FormItem name='election_mode' label='选举方式'>
            <Select
              value={modeFilter}
              onChange={(v) => setModeFilter(v as string)}
              options={[{ label: '全部', value: '' }, ...ALL_MODES.map((m) => ({ label: m, value: m }))]}
            />
          </FormItem>
          <FormItem name='status' label='状态'>
            <Select
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as string)}
              options={[
                { label: '全部', value: '' },
                { label: '待审批', value: 'pending' },
                { label: '已通过', value: 'approved' },
                { label: '已驳回', value: 'rejected' },
              ]}
            />
          </FormItem>
          <FormItem>
            <Button type='submit' variant='outline'>
              查询
            </Button>
            <Button
              variant='text'
              onClick={() => {
                setKeyword('');
                setModeFilter('');
                setStatusFilter('');
                form.reset();
              }}
            >
              重置
            </Button>
          </FormItem>
        </Form>

        {/* 提案表格 */}
        <div className={Style.tableCard}>
          <div className={Style.thBar}>
            <h3>历史提案列表（本期 + ）</h3>
            <span className={Style.count}>共 {list.length} 条</span>
          </div>
          <Table rowKey='id' columns={columns} data={list} loading={loading} />
        </div>
      </div>

      {/* 创建提案弹窗 */}
      <Dialog
        header={editing ? `✏️ 编辑提案：${editing.title}` : '＋ 创建提案'}
        visible={createVisible}
        width={820}
        onClose={() => setCreateVisible(false)}
        footer={
          <>
            <Button variant='text' onClick={() => setCreateVisible(false)}>
              取消
            </Button>
            <Button theme='primary' onClick={onCreate}>
              {editing ? '重新提交' : '提交审批'}
            </Button>
          </>
        }
      >
        <div className={Style.flow}>
          <span className={Style.flowOn}>草稿</span>
          <span>→</span>
          <span>待审批</span>
          <span>→</span>
          <span>审批完成</span>
        </div>
        <Form form={createForm} labelWidth={110}>
          {isCross ? (
            <FormItem name='orgId' label='归属地' rules={[{ required: true, message: '请选择归属地（村/社区）' }]}>
              <Select
                value={createOrgId}
                onChange={(v) => setCreateOrgId(v as string)}
                options={orgOptions}
                filterable
                disabled={!!editing}
                placeholder={editing ? '归属地不可修改' : '超管需选择本提案归属的村/社区'}
              />
            </FormItem>
          ) : (
            <FormItem label='归属地'>
              <Input value={editing ? (orgOptions.find((o) => o.value === createOrgId)?.label || me?.orgName || me?.orgId || '') : (me?.orgName || me?.orgId || '')} disabled />
            </FormItem>
          )}
          <FormItem name='title' label='提案名称' rules={[{ required: true, message: '请填写提案名称' }]}>
            <Input placeholder='例：涧口社区第十届换届选举提案' />
          </FormItem>
          <FormItem name='org_type' label='组织类型' initialData='community'>
            <Radio.Group
              variant='default-filled'
              value={orgType}
              onChange={(v) => setOrgType(v as 'village' | 'community')}
            >
              <Radio.Button value='village'>村（村委会）</Radio.Button>
              <Radio.Button value='community'>社区（居委会）</Radio.Button>
            </Radio.Group>
          </FormItem>
          <FormItem name='election_mode' label='选举方式' rules={[{ required: true, message: '请选择选举方式' }]}>
            {orgType === 'village' ? (
              <Select value='全民直选' options={[{ label: '全民直选（唯一模式）', value: '全民直选' }]} disabled />
            ) : (
              <Select
                options={ELECTION_MODE_BY_TYPE.community.map((m) => ({ label: m, value: m }))}
                placeholder='请选择选举方式'
              />
            )}
          </FormItem>
          <FormItem
            name='election_date'
            label='正式选举日(D日)'
            rules={[{ required: true, message: '请选择正式选举日' }]}
          >
            <DatePicker placeholder='提案通过后即确认 D 日锚点' format='YYYY-MM-DD' />
          </FormItem>

          {/* 岗位配置（表格填写，可增删行） */}
          <FormItem name='posts' label='适用岗位' requiredMark={false}>
            <div className={Style.postTable}>
              <div className={Style.postHead}>
                <span className={Style.cPos}>岗位</span>
                <span className={Style.cCnt}>人数</span>
                <span className={Style.cReq}>岗位要求</span>
                <span className={Style.cLink}>报名表（上传）</span>
                <span className={Style.cOp}>操作</span>
              </div>
              {postRows.map((row) => (
                <div className={Style.postRow} key={row.key}>
                  <span className={Style.cPos}>
                    <Select
                      value={row.position}
                      onChange={(v) => updatePostRow(row.key, 'position', v as string)}
                      options={POSITION_OPTIONS.map((p) => ({ label: p, value: p }))}
                      creatable
                    />
                  </span>
                  <span className={Style.cCnt}>
                    <InputNumber
                      value={row.count}
                      onChange={(v) => updatePostRow(row.key, 'count', Number(v))}
                      min={0}
                    />
                  </span>
                  <span className={Style.cReq}>
                    <Input
                      value={row.requirement}
                      onChange={(v) => updatePostRow(row.key, 'requirement', v as string)}
                      placeholder='年龄/学历等'
                    />
                  </span>
                  <span className={Style.cLink}>
                    <Upload
                      theme='file'
                      accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx'
                      autoUpload={false}
                      files={row.file ? [row.file as any] : []}
                      onChange={(files) => updatePostRow(row.key, 'file', (Array.isArray(files) ? files[0] : files) as unknown as string)}
                    />
                  </span>
                  <span className={Style.cOp}>
                    <Button variant='text' theme='danger' onClick={() => removePostRow(row.key)}>
                      删除
                    </Button>
                  </span>
                </div>
              ))}
              <Button variant='outline' size='small' onClick={addPostRow}>
                ＋ 添加岗位
              </Button>
            </div>
          </FormItem>

          <FormItem name='report' label='详细说明'>
            <Textarea placeholder='提案依据、时间安排、片区划分等（后续接富文本）' />
          </FormItem>
          <FormItem name='attachments' label='附件材料'>
            <div className={Style.attachBox}>
              <Upload
                theme='file'
                accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx'
                multiple
                draggable
                autoUpload={false}
                files={createFiles}
                onChange={(files) => setCreateFiles(Array.isArray(files) ? files : [files])}
              />
              <div className={Style.extLinks}>
                <div className={Style.extLabel}>外链文件地址（双保险·应急备用，可选）</div>
                {externalLinks.map((url, i) => (
                  <div key={i} className={Style.extRow}>
                    <Input value={url} onChange={(v) => updateExtLink(i, v as string)} placeholder='https://...' />
                    <Button variant='text' theme='danger' onClick={() => removeExtLink(i)}>
                      删除
                    </Button>
                  </div>
                ))}
                <Button variant='outline' size='small' onClick={addExtLink}>
                  ＋ 添加外链
                </Button>
              </div>
            </div>
          </FormItem>
        </Form>
      </Dialog>

      {/* 详情 + 审批弹窗 */}
      <Dialog
        header={current?.title || '提案详情'}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        footer={detailFooter}
        width={820}
      >
        {current && (
          <div className={Style.detail}>
            <Descriptions
              title='提案基本信息'
              bordered
              items={[
                { label: '提案人', content: current.proposer },
                { label: '提交时间', content: current.submitted_at },
                { label: '组织类型', content: current.org_type === 'village' ? '村（村委会）' : '社区（居委会）' },
                { label: '选举方式', content: current.election_mode },
                { label: '正式选举日(D日)', content: current.election_date || '未填' },
                { label: '适用岗位', content: current.positions },
                {
                  label: '状态',
                  content: (
                    <Tag theme={STATUS_META[current.status].theme} variant='light'>
                      {STATUS_META[current.status].label}
                    </Tag>
                  ),
                },
              ]}
            />

            {current.posts && current.posts.length > 0 && (
              <div className={Style.block}>
                <h4>岗位配置</h4>
                <Table
                  rowKey='key'
                  size='small'
                  bordered
                  data={current.posts}
                  columns={[
                    { colKey: 'position', title: '岗位', width: 100 },
                    { colKey: 'count', title: '人数', width: 80, cell: ({ row }) => `${row.count} 名` },
                    { colKey: 'requirement', title: '要求说明', minWidth: 200, cell: ({ row }) => row.requirement || '—' },
                  ]}
                />
                <div className={Style.muted}>岗位报名表、资格审查表等资料请在下方「附件材料」区统一上传下载。</div>
              </div>
            )}

            <div className={Style.block}>
              <h4>提案详细说明</h4>
              <div className={Style.report}>{current.report}</div>
            </div>

            <div className={Style.block}>
              <h4>附件材料{current.status === 'approved' ? '（已通过，仅可预览/下载）' : ''}</h4>
              {current.status !== 'approved' && (
                <Upload
                  theme='file'
                  accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx'
                  multiple
                  autoUpload={false}
                  onChange={(files) => {
                    const picked = (Array.isArray(files) ? files : [files])
                      .map((f: { raw?: File }) => f?.raw)
                      .filter(Boolean) as File[];
                    if (!picked.length) return;
                    (async () => {
                      try {
                        for (const f of picked) await uploadProposalFile(current.id, f);
                        MessagePlugin.success(`已上传 ${picked.length} 个附件`);
                        const rows = await getProposals();
                        const mapped = rows.map(mapProposal);
                        setProposals(mapped);
                        const updated = mapped.find((p) => p.id === current.id);
                        if (updated) setCurrent(updated);
                      } catch (e) {
                        MessagePlugin.error((e as Error).message || '上传失败');
                      }
                    })();
                  }}
                />
              )}
              {current.attachments.length === 0 && <div className={Style.muted}>暂无附件</div>}
              {current.attachments.map((a) => (
                <div key={a.name} className={Style.att}>
                  📎 {a.name}
                  {a.url ? (
                    <a className={Style.dl} href={a.url} download={a.name} target='_blank' rel='noreferrer'>
                      下载预览
                    </a>
                  ) : (
                    <span className={Style.dlMuted}>演示数据</span>
                  )}
                </div>
              ))}
            </div>

            {/* 审批操作区（仅待审批 + 有审批权限可见） */}
            {current.status === 'pending' && canApprove && (
              <div className={Style.approveBox}>
                <Textarea
                  value={reviewComment}
                  onChange={(v) => setReviewComment(v as string)}
                  placeholder='请输入审批意见，驳回必须填写原因'
                />
                <div className={Style.acts}>
                  <Button theme='danger' variant='outline' onClick={() => review('reject')}>
                    ✗ 驳回提案
                  </Button>
                  <Button theme='success' onClick={() => review('approve')}>
                    ✓ 通过提案
                  </Button>
                </div>
              </div>
            )}
            {current.status === 'rejected' && current.reject_reason && (
              <div className={Style.rejectBox}>驳回原因：{current.reject_reason}</div>
            )}
            {current.status === 'rejected' && canEdit && (
              <div className={Style.reEditBox}>
                <Button
                  theme='warning'
                  variant='outline'
                  onClick={() => {
                    setDetailVisible(false);
                    openCreate(current);
                  }}
                >
                  ✏️ 重新编辑并再次提交
                </Button>
                <span className={Style.reEditTip}>驳回后可修改后重新提交，重新提交后进入待审批</span>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </Page>
  );
});
