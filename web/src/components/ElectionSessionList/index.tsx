import { Button, Table, Tag } from 'tdesign-react';
import type { PrimaryTableCol } from 'tdesign-react';
import Page from 'layouts/components/Page';
import { useActivities, ElectionActivity, sessionNo, calcActivityStatus } from 'utils/electionStore';
import Style from './index.module.less';

/**
 * ElectionSessionList —— 选举类业务页统一的「第一级：活动列表」
 * ============================================================
 * 【层级铁律】材料 / 候选人 / 公告 等页面，进入后必须先看到选举活动列表
 *   （每行一届），点「查看本届」才进入该届明细 —— 与 活动列表(Activities)、
 *   岗位管理(Positions) 完全一致，禁止再做成跨届扁平大表 / 右上角下拉切换。
 * 数据：useActivities()（提案审批通过后生成的每一届活动，按 Dday 倒序）。
 * 用法（两级页面）：
 *   const [current, setCurrent] = useState<ElectionActivity|null>(null);
 *   if (!current) return <ElectionSessionList title=.. sub=.. statLabel='材料'
 *                        statOf={(a)=>list.filter(x=>x.activityId===a.id).length}
 *                        onEnter={setCurrent} breadcrumbs={[..]} />;
 *   // 否则渲染该届明细，顶部放「← 返回列表」按钮
 * ============================================================ */

const STATUS_META = {
  preparing: { label: '筹备中', theme: 'warning' as const },
  ongoing: { label: '进行中', theme: 'success' as const },
  finished: { label: '已归档', theme: 'default' as const },
};

interface Props {
  /** 面包屑，最后一级建议为「XX」 */
  breadcrumbs: string[];
  title: string;
  sub?: string;
  /** 统计列表头（如 材料 / 候选人 / 公告），不传则不显示统计列 */
  statLabel?: string;
  /** 每届统计值（通常是该届明细条数） */
  statOf?: (a: ElectionActivity) => number | string;
  /** 进入某一届（点「查看本届」） */
  onEnter: (a: ElectionActivity) => void;
  /** 操作按钮文案，默认「查看本届」 */
  enterText?: string;
  /** 可选右上角额外操作区 */
  extra?: React.ReactNode;
}

export default function ElectionSessionList({
  breadcrumbs,
  title,
  sub,
  statLabel,
  statOf,
  onEnter,
  enterText = '查看本届',
  extra,
}: Props) {
  const activities = useActivities();

  const columns: PrimaryTableCol<ElectionActivity>[] = [
    {
      colKey: 'session',
      title: '届次',
      width: 110,
      cell: ({ row }) => <b>{sessionNo(row.name)}</b>,
    },
    { colKey: 'name', title: '活动名称（提案名）', minWidth: 240 },
    { colKey: 'election_mode', title: '选举方式', width: 120 },
    { colKey: 'dday', title: '正式选举日(D)', width: 140 },
    ...(statLabel
      ? [
          {
            colKey: '__stat',
            title: statLabel,
            width: 110,
            cell: ({ row }: { row: ElectionActivity }) => (statOf ? statOf(row) : '—'),
          } as PrimaryTableCol<ElectionActivity>,
        ]
      : []),
    {
      colKey: 'status',
      title: '状态',
      width: 100,
      cell: ({ row }) => {
        const s = calcActivityStatus(row);
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
      fixed: 'right',
      cell: ({ row }) => (
        <Button variant='text' theme='primary' onClick={() => onEnter(row)}>
          {enterText}
        </Button>
      ),
    },
  ];

  return (
    <Page breadcrumbs={breadcrumbs}>
      <div className={Style.wrap}>
        <div className={Style.pageHead}>
          <div>
            <h2 className={Style.pageTitle}>{title}</h2>
            {sub && <div className={Style.sub}>{sub}</div>}
          </div>
          {extra}
        </div>
        <div className={Style.tableBox}>
          <Table
            rowKey='id'
            columns={columns}
            data={activities}
            bordered
            stripe
            hover
            empty='暂无活动（选举活动由提案审批通过后自动生成）'
          />
        </div>
      </div>
    </Page>
  );
}
