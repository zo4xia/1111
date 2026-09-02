import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Table, Tag, Form, Select, MessagePlugin } from 'tdesign-react';
import dayjs from 'dayjs';
import Page from 'layouts/components/Page';
import { useActivities, ElectionActivity } from 'utils/electionStore';
import Style from './index.module.less';

const { FormItem } = Form;

const STATUS_META = {
  preparing: { label: '筹备中', theme: 'warning' as const },
  ongoing: { label: '进行中', theme: 'success' as const },
  finished: { label: '已归档', theme: 'default' as const },
};

/** 状态由时间算：D-35前=筹备中；D前=进行中；D后=已归档 */
function calcStatus(a: ElectionActivity): keyof typeof STATUS_META {
  const today = dayjs();
  const dday = dayjs(a.dday);
  if (today.isBefore(dday.subtract(35, 'day'))) return 'preparing';
  if (today.isBefore(dday) || today.isSame(dday, 'day')) return 'ongoing';
  return 'finished';
}

/** 从活动名提取届次：涧口社区第十届换届 → 第十届 */
function sessionNo(name: string): string {
  const m = name.match(/(第[一二三四五六七八九十百\d]+届)/);
  return m ? m[1] : name;
}

/** 选举活动管理：列表 → 点击某届进入本届正文页 */
export default function Activities() {
  const navigate = useNavigate();
  const activities = useActivities();
  // 筛选
  const [sessionFilter, setSessionFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  /** 筛选后的列表 */
  const list = useMemo(
    () =>
      activities.filter((a) => {
        if (sessionFilter && sessionNo(a.name) !== sessionFilter) return false;
        if (yearFilter && dayjs(a.dday).format('YYYY') !== yearFilter) return false;
        if (statusFilter && calcStatus(a) !== statusFilter) return false;
        return true;
      }),
    [activities, sessionFilter, yearFilter, statusFilter],
  );

  const sessionOptions = useMemo(
    () => Array.from(new Set(activities.map((a) => sessionNo(a.name)))).map((v) => ({ label: v, value: v })),
    [activities],
  );
  const yearOptions = useMemo(
    () => Array.from(new Set(activities.map((a) => dayjs(a.dday).format('YYYY')))).map((v) => ({ label: v, value: v })),
    [activities],
  );

  const columns = [
    {
      colKey: 'session',
      title: '届次',
      width: 100,
      cell: ({ row }: { row: ElectionActivity }) => <b>{sessionNo(row.name)}</b>,
    },
    { colKey: 'name', title: '活动名称', width: 200 },
    { colKey: 'election_mode', title: '选举方式', width: 120 },
    { colKey: 'dday', title: '正式选举日(D)', width: 140 },
    {
      colKey: 'posts',
      title: '岗位',
      minWidth: 200,
      cell: ({ row }: { row: ElectionActivity }) => row.posts.map((p) => `${p.position}${p.count}名`).join('、') || '—',
    },
    {
      colKey: 'status',
      title: '状态',
      width: 100,
      cell: ({ row }: { row: ElectionActivity }) => {
        const s = calcStatus(row);
        return (
          <Tag theme={STATUS_META[s].theme} variant='light'>
            {STATUS_META[s].label}
          </Tag>
        );
      },
    },
    {
      colKey: 'op',
      title: '操作',
      width: 120,
      cell: ({ row }: { row: ElectionActivity }) => (
        <Button variant='text' theme='primary' onClick={() => navigate(`/election/activity/${row.id}`)}>
          查看本届
        </Button>
      ),
    },
  ];

  return (
    <Page breadcrumbs={['首页工作台', '选举活动管理', '活动列表']}>
      <div className={Style.wrap}>
        <div className={Style.pageHead}>
          <div>
            <h2 className={Style.pageTitle}>活动列表（）</h2>
            <div className={Style.sub}>侧边栏进入为列表，点击某届进入本届正文</div>
          </div>
          <Button theme='primary' onClick={() => MessagePlugin.info('选举活动由提案审批通过后自动生成')}>
            ＋ 新建选举活动
          </Button>
        </div>

        {/* 筛选条：届次 / 年份 / 状态 */}
        <Form className={Style.filters} layout='inline'>
          <FormItem label='届次'>
            <Select
              clearable
              placeholder='全部届次'
              value={sessionFilter}
              options={sessionOptions}
              onChange={(v) => setSessionFilter((v as string) || '')}
            />
          </FormItem>
          <FormItem label='年份'>
            <Select
              clearable
              placeholder='全部年份'
              value={yearFilter}
              options={yearOptions}
              onChange={(v) => setYearFilter((v as string) || '')}
            />
          </FormItem>
          <FormItem label='状态'>
            <Select
              clearable
              placeholder='全部状态'
              value={statusFilter}
              options={[
                { label: '筹备中', value: 'preparing' },
                { label: '进行中', value: 'ongoing' },
                { label: '已归档', value: 'finished' },
              ]}
              onChange={(v) => setStatusFilter((v as string) || '')}
            />
          </FormItem>
          <FormItem>
            <Button
              variant='outline'
              onClick={() => {
                setSessionFilter('');
                setYearFilter('');
                setStatusFilter('');
              }}
            >
              重置
            </Button>
          </FormItem>
          <span className={Style.count}>共 {list.length} 条</span>
        </Form>

        <div className={Style.tableBox}>
          <Table rowKey='id' columns={columns} data={list} />
        </div>
      </div>
    </Page>
  );
}
