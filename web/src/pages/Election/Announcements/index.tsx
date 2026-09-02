import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, Table, Tag, MessagePlugin } from 'tdesign-react';
import Page from 'layouts/components/Page';
import { ElectionActivity, sessionNo } from 'utils/electionStore';
import { useNotices, publishNotice, Notice } from 'utils/noticeStore';
import { getAnnouncement, type AnnouncementTemplate } from 'utils/announcementTemplates';
import NoticeDoc from 'components/NoticeDoc';
import ElectionSessionList from 'components/ElectionSessionList';
import SessionDetailBar from 'components/ElectionSessionList/SessionDetailBar';
import Style from './index.module.less';

const STATUS_META = {
  draft: { label: '待发布', theme: 'warning' as const },
  published: { label: '已发布', theme: 'success' as const },
};

/** 从届名提取中文届次：涧口社区第十届换届 → 十 */
function sessionCN(name: string): string {
  const m = name.match(/第([一二三四五六七八九十百\d]+)届/);
  return m ? m[1] : '';
}

/**
 * 公告记录 = 只读台账（唯一真相原则）：
 * 公文的「编辑/预览/附件/发布方式」唯一收敛在「活动详情·小编工作台」；
 * 本页只记录每份公告发没发、附件几份，并提供只读查看与跳转工作台，不再提供第二处编辑。
 */
export default function Announcements() {
  const navigate = useNavigate();
  const notices = useNotices();
  const [current, setCurrent] = useState<ElectionActivity | null>(null); // 当前届（第一级→第二级）
  const [viewing, setViewing] = useState<Notice | null>(null); // 只读查看

  const activity: ElectionActivity | undefined = current ?? undefined;
  const fills = useMemo<Record<string, string>>(
    (): Record<string, string> => (activity ? { 选举日: activity.dday, 届: sessionCN(activity.name) } : {}),
    [activity],
  );

  const list = useMemo(() => notices.filter((n) => current && n.activityId === current.id), [notices, current]);

  // 只读查看时的标准公文模板（内容取小编在工作台编辑后的最新值，保证与工作台同一长相）
  const viewTpl: AnnouncementTemplate | null = viewing
    ? { ...(getAnnouncement(viewing.no) as AnnouncementTemplate), title: viewing.title, body: viewing.body, sign: viewing.sign }
    : null;

  const columns = [
    { colKey: 'no', title: '公告', width: 80, cell: ({ row }: { row: Notice }) => <b>{row.no}号</b> },
    { colKey: 'title', title: '公告标题', minWidth: 220, cell: ({ row }: { row: Notice }) => row.title },
    {
      colKey: 'stage',
      title: '所属阶段',
      width: 170,
      cell: ({ row }: { row: Notice }) => (
        <span className={Style.stageCell}>
          <Tag size='small' variant='light'>
            {row.stageKey}
          </Tag>
          {row.stageName}
        </span>
      ),
    },
    {
      colKey: 'files',
      title: '附件',
      width: 70,
      cell: ({ row }: { row: Notice }) => `${row.files?.length ?? 0} 份`,
    },
    { colKey: 'publishDate', title: '发布日期', width: 110 },
    {
      colKey: 'status',
      title: '状态',
      width: 90,
      cell: ({ row }: { row: Notice }) => (
        <Tag theme={STATUS_META[row.status].theme} variant='light'>
          {STATUS_META[row.status].label}
        </Tag>
      ),
    },
    {
      colKey: 'op',
      title: '操作',
      width: 230,
      cell: ({ row }: { row: Notice }) => (
        <div className={Style.opCell}>
          <Button variant='text' theme='primary' size='small' onClick={() => setViewing(row)}>
            查看
          </Button>
          <Button
            variant='text'
            theme='warning'
            size='small'
            onClick={() => navigate(`/election/activity/${row.activityId}?stage=${encodeURIComponent(row.stageKey)}&no=${encodeURIComponent(row.no)}`)}
          >
            去工作台编辑
          </Button>
          {row.status !== 'published' && (
            <Button
              variant='text'
              theme='success'
              size='small'
              onClick={() => {
                publishNotice(row.id);
                MessagePlugin.success('公告已发布');
              }}
            >
              发布
            </Button>
          )}
        </div>
      ),
    },
  ];

  // 第一级：活动列表（每行一届），点「查看公告」进入该届
  if (!current) {
    return (
      <ElectionSessionList
        breadcrumbs={['选举管理', '公告通知', '公告']}
        title='公告记录'
        sub='公告按日程阶段自动生成；编辑/预览/附件/发布方式统一在「活动详情·小编工作台」完成，本页只记录每份公告的发布状态。'
        statLabel='待发/总'
        enterText='查看公告'
        statOf={(a) => {
          const ns = notices.filter((n) => n.activityId === a.id);
          return `${ns.filter((n) => n.status !== 'published').length}/${ns.length}`;
        }}
        onEnter={setCurrent}
      />
    );
  }

  return (
    <Page breadcrumbs={['选举管理', '公告通知', current ? sessionNo(current.name) : '本届公告']}>
      {current && <SessionDetailBar activity={current} onBack={() => setCurrent(null)} />}
      <div className={Style.wrap}>
        <div className={Style.pageHead}>
          <div>
            <h2 className={Style.pageTitle}>公告记录（只读台账）</h2>
            <div className={Style.sub}>
              每份公告各自独立、附件各自挂载；编辑与发布方式请点「去工作台编辑」，在小编工作台一处完成，避免两处维护。
            </div>
          </div>
        </div>

        <div className={Style.tableBox}>
          <Table rowKey='id' columns={columns} data={list} />
        </div>
      </div>

      {/* 只读查看：标准公文格式 + 该公告各自附件（不可在此编辑，唯一编辑器在工作台） */}
      <Dialog
        header={viewing ? `${viewing.no}号 · ${viewing.title}` : '公告查看'}
        visible={!!viewing}
        onClose={() => setViewing(null)}
        width={760}
        footer={
          <Button variant='outline' onClick={() => setViewing(null)}>
            关闭
          </Button>
        }
      >
        {viewing && viewTpl && activity && (
          <>
            <NoticeDoc tpl={viewTpl} orgType={activity.org_type} fills={fills} signDate={viewing.signDate} />
            <div className={Style.previewFiles}>
              <div className={Style.previewFilesTitle}>本公告附件（{viewing.files?.length ?? 0} 份）</div>
              {(viewing.files ?? []).map((f) => (
                <div key={f.url}>
                  <a href={f.url} target='_blank' rel='noreferrer'>
                    附件 · {f.name}
                  </a>
                </div>
              ))}
              {(viewing.files ?? []).length === 0 && <span className={Style.muted}>暂无附件，可在工作台上传。</span>}
            </div>
          </>
        )}
      </Dialog>
    </Page>
  );
}
