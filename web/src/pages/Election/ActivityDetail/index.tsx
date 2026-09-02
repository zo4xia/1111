import { useMemo, useState, useRef, type ChangeEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button,
  Tag,
  Timeline,
  TimelineItem,
  Empty,
  Dialog,
  MessagePlugin,
  Input,
  Textarea,
  Radio,
  Checkbox,
  Switch,
  InputNumber,
} from 'tdesign-react';
import dayjs from 'dayjs';
import Page from 'layouts/components/Page';
import { useActivities } from 'utils/electionStore';
import { useNotices, updateNotice, publishNotice, resetNotice, uploadNoticeFile } from 'utils/noticeStore';
import { getAnnouncement, type AnnouncementTemplate } from 'utils/announcementTemplates';
import NoticeDoc from 'components/NoticeDoc';
import { uploadPositionFile } from 'services/electionApi';
import { forceResync } from 'utils/liveSync';
import Style from './index.module.less';

const STATUS_META = {
  preparing: { label: '筹备中', theme: 'warning' as const },
  ongoing: { label: '进行中', theme: 'success' as const },
  finished: { label: '已归档', theme: 'default' as const },
};

function calcStatus(dday: string): keyof typeof STATUS_META {
  const today = dayjs();
  const d = dayjs(dday);
  if (today.isBefore(d.subtract(35, 'day'))) return 'preparing';
  if (today.isBefore(d) || today.isSame(d, 'day')) return 'ongoing';
  return 'finished';
}

/** 从届名提取中文届次：涧口社区第十届换届 → 十 */
function sessionCN(name: string): string {
  const m = name.match(/第([一二三四五六七八九十百\d]+)届/);
  return m ? m[1] : '';
}

/**
 * 阶段三色状态（按「今天」相对阶段日期区间判断）
 * done 已走过=浅绿 / current 当前=红 / todo 未开始=浅灰
 */
type StageState = 'done' | 'current' | 'todo';
function stageState(s: { date: string; endDate: string }): StageState {
  const today = dayjs().startOf('day');
  const start = dayjs(s.date).startOf('day');
  const end = dayjs(s.endDate).startOf('day');
  if (today.isAfter(end)) return 'done';
  if (today.isBefore(start)) return 'todo';
  return 'current';
}

/**
 * 活动详情 = 左「只读流程时间轴」+ 右「小编工作台」。
 * 设计原则（用户拍板）：小编在这一个页面做完一个阶段的全部事——
 * 编辑公告正文 / 预览 / 立即或定时发布 / 日程提醒 / 开放材料提交 / 查看材料 / 更新候选人，
 * 不需要跳到独立的「公告通知」页；该页仅作公告模板库。
 */
export default function ActivityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const activities = useActivities();
  const notices = useNotices();
  const activity = activities.find((a) => String(a.id) === String(id));

  // 左栏选中的阶段；右栏当前切换到的公告编号
  const [searchParams] = useSearchParams();
  // 支持从公告记录「去工作台编辑」带 ?stage=&no= 直接定位到该阶段/公告
  const [selKey, setSelKey] = useState(searchParams.get('stage') || '');
  const [curNo, setCurNo] = useState(searchParams.get('no') || '');
  const [previewVisible, setPreviewVisible] = useState(false);
  // 公告附件 / 岗位附件的隐藏文件选择器（真上传到后端，每份独立目录）
  const annFileRef = useRef<HTMLInputElement>(null);
  const posFileRef = useRef<HTMLInputElement>(null);
  const posUploadId = useRef<string | undefined>(undefined);

  const stage = useMemo(() => {
    if (!activity) return undefined;
    return activity.stages.find((s) => s.key === selKey) ?? activity.stages[0];
  }, [activity, selKey]);

  // 当前阶段对应的公告（noticeStore 已按 activityId+stageKey 预生成草稿）
  const stageNotices = useMemo(() => {
    if (!stage) return [];
    return notices.filter((n) => n.activityId === Number(id) && n.stageKey === stage.key);
  }, [notices, stage, id]);

  // 多份公告时的有效选中编号（防止切换阶段后 curNo 失效）
  const activeNo = stage && stage.announcements.includes(curNo) ? curNo : stage?.announcements[0] ?? '';
  const current = stageNotices.find((n) => n.no === activeNo);

  if (!activity) {
    return (
      <Page breadcrumbs={['选举活动管理', '本届详情']}>
        <div className={Style.missing}>
          <Empty description='未找到该届活动' />
          <Button variant='outline' onClick={() => navigate('/election/activities')}>
            返回活动列表
          </Button>
        </div>
      </Page>
    );
  }

  const status = calcStatus(activity.dday);
  const tplVars = { 选举日: activity.dday, 届: sessionCN(activity.name) };
  const activeTpl = activeNo ? getAnnouncement(activeNo) : null;
  const previewDocTpl: AnnouncementTemplate | null = activeTpl && current
    ? { ...activeTpl, title: current.title, body: current.body, sign: current.sign || activeTpl.sign || '' }
    : activeTpl ?? null;

  const patch = (p: Parameters<typeof updateNotice>[1]) => {
    if (current) updateNotice(current.id, p);
  };

  const handleSaveDraft = () => {
    if (!current) return;
    updateNotice(current.id, { status: 'draft' });
    MessagePlugin.success('已保存草稿');
  };
  const handlePublish = () => {
    if (!current) return;
    if (current.publishMode === 'scheduled' && !current.publishAt) {
      MessagePlugin.warning('请先选择定时发布时间');
      return;
    }
    publishNotice(current.id);
    MessagePlugin.success(current.publishMode === 'scheduled' ? `已设定定时发布：${current.publishAt}` : '公告已发布');
  };

  // 公告附件：真上传到该公告独立目录，成功后本地即时追加（切换公告各自独立）
  const onPickAnnFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !current) return;
    try {
      await uploadNoticeFile(current.id, f);
      MessagePlugin.success(`附件已上传：${f.name}`);
    } catch (err) {
      MessagePlugin.error(`上传失败：${(err as Error).message}`);
    }
  };
  // 岗位附件：真上传后强制重同步，刷新岗位附件清单
  const onPickPosFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    const posId = posUploadId.current;
    if (!f || !posId) return;
    try {
      await uploadPositionFile(posId, f);
      MessagePlugin.success(`岗位附件已上传：${f.name}`);
      await forceResync();
    } catch (err) {
      MessagePlugin.error(`上传失败：${(err as Error).message}`);
    }
  };

  return (
    <Page breadcrumbs={['选举活动管理', '活动列表', activity.name]}>
      <div className={Style.wrap}>
        {/* 头部 */}
        <div className={Style.header}>
          <div className={Style.headerTitle}>
            <span className={Style.bar} />
            {activity.name}
          </div>
          <div className={Style.headerSub}>
            <Tag theme={STATUS_META[status].theme} variant='light'>
              {STATUS_META[status].label}
            </Tag>
            <span>组织类型：{activity.org_type === 'village' ? '村（村委会）' : '社区（居委会）'}</span>
            <span>选举方式：{activity.election_mode}</span>
            <span className={Style.dday}>
              正式选举日(D)：<b>{activity.dday}</b>
            </span>
          </div>
        </div>

        {/* 左：流程时间轴 ｜ 右：小编工作台 */}
        <div className={Style.mainGrid}>
          {/* ============ 左栏：只读流程 ============ */}
          <div className={Style.leftCol}>
            <div className={Style.card}>
              <div className={Style.cardTitle}>选举时间轴（按 D 日倒排 · 点选阶段）</div>
              <div className={Style.stageHint}>
                D = 正式选举日（{activity.dday}）；点左侧任一阶段，在右侧工作台集中处理该阶段的公告、材料与提醒。
              </div>
              <Timeline mode='same' className={Style.timeline}>
                {activity.stages.map((s) => {
                  const ss = stageState(s);
                  const selected = stage?.key === s.key;
                  const dot =
                    ss === 'current'
                      ? 'var(--td-error-color)'
                      : ss === 'done'
                      ? 'var(--td-success-color)'
                      : 'var(--td-text-color-placeholder)';
                  return (
                    <TimelineItem
                      key={s.key}
                      label={
                        <div className={Style.tlLabel}>
                          <div className={Style.tlDate}>{s.date}</div>
                          <div className={Style.tlKey}>{s.key}</div>
                        </div>
                      }
                      dotColor={dot}
                    >
                      <div
                        className={`${Style.stageCard} ${Style[ss]} ${selected ? Style.stageSelected : ''}`}
                        onClick={() => {
                          setSelKey(s.key);
                          setCurNo(s.announcements[0] ?? '');
                        }}
                      >
                        <div className={Style.stageHead}>
                          <b className={Style.stageName}>{s.name}</b>
                          {ss === 'current' && (
                            <Tag size='small' theme='danger' variant='light'>
                              当前
                            </Tag>
                          )}
                          {ss === 'done' && (
                            <Tag size='small' theme='success' variant='light'>
                              已完成
                            </Tag>
                          )}
                          {s.review && (
                            <Tag size='small' variant='light' theme='primary'>
                              {s.review}
                            </Tag>
                          )}
                          {selected && (
                            <Tag size='small' theme='warning' variant='dark'>
                              编辑中
                            </Tag>
                          )}
                        </div>
                        {s.work && (
                          <div className={Style.stageRow}>
                            <span className={Style.stageLabel}>核心工作</span>
                            <span>{s.work}</span>
                          </div>
                        )}
                        {s.sys_action && (
                          <div className={Style.stageRow}>
                            <span className={Style.stageLabel}>系统动作</span>
                            <span>{s.sys_action}</span>
                          </div>
                        )}
                        {s.announcement && (
                          <div className={Style.stageRow}>
                            <span className={Style.stageLabel}>关联公告</span>
                            <span className={Style.announcementDesc}>
                              {s.announcement}
                              {s.announcements.length > 0 && (
                                <span className={Style.noticeChips}>
                                  {s.announcements.map((no) => (
                                    <Tag
                                      key={no}
                                      size='small'
                                      variant={no === activeNo && selected ? 'dark' : 'outline'}
                                      theme='primary'
                                      className={Style.noticeChip}
                                      onClick={(ctx) => {
                                        ctx.e.stopPropagation();
                                        setSelKey(s.key);
                                        setCurNo(no);
                                      }}
                                    >
                                      {no}号
                                    </Tag>
                                  ))}
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        {s.material && (
                          <div className={Style.stageRow}>
                            <span className={Style.stageLabel}>材料类型</span>
                            <span>{s.material}</span>
                          </div>
                        )}
                      </div>
                    </TimelineItem>
                  );
                })}
              </Timeline>
            </div>
          </div>

          {/* ============ 右栏：小编工作台（一个地方做完所有事） ============ */}
          <div className={Style.workCol}>
            <div className={`${Style.card} ${Style.workbench}`}>
              <div className={Style.wbTitle}>
                <span className={Style.bar} />
                小编工作台 · {stage ? stage.name : '—'}
              </div>
              {stage && (
                <div className={Style.wbSub}>
                  {stage.date}
                  {stage.endDate !== stage.date && ` ~ ${stage.endDate}`}　·　{stage.key}
                  {stage.review && (
                    <Tag size='small' theme='primary' variant='light'>
                      {stage.review}
                    </Tag>
                  )}
                </div>
              )}

              {!stage || stage.announcements.length === 0 ? (
                <div className={Style.wbEmpty}>本阶段无需发布公告，按左侧「核心工作」线下推进即可。</div>
              ) : !current ? (
                <div className={Style.wbEmpty}>公告草稿加载中…</div>
              ) : (
                <>
                  {/* 多份公告切换：若本阶段要发多份，则在此切换编辑 */}
                  {stage.announcements.length > 1 && (
                    <div className={Style.wbField}>
                      <div className={Style.wbLabel}>本阶段公告（多份切换）</div>
                      <Radio.Group
                        variant='default-filled'
                        size='small'
                        value={activeNo}
                        onChange={(v) => setCurNo(v as string)}
                        options={stage.announcements.map((no) => ({ label: `${no}号公告`, value: no }))}
                      />
                    </div>
                  )}

                  {/* 公告正文编辑 */}
                  <div className={Style.wbField}>
                    <div className={Style.wbLabel}>公告标题</div>
                    <Input value={current.title} onChange={(v) => patch({ title: v as string })} placeholder='公告标题' />
                    <div className={Style.wbLabel} style={{ marginTop: 8 }}>
                      公告正文（「____」为待填项，日期/届次自动代入，可直接改）
                    </div>
                    <Textarea
                      value={current.body}
                      onChange={(v) => patch({ body: v as string })}
                      autosize={{ minRows: 7, maxRows: 14 }}
                    />
                    <div className={Style.wbBtns}>
                      <Button size='small' variant='outline' onClick={() => setPreviewVisible(true)}>
                        预览公文
                      </Button>
                      <Button
                        size='small'
                        variant='outline'
                        theme='warning'
                        onClick={() => {
                          resetNotice(current.id);
                          MessagePlugin.info('已恢复为官方模板默认内容');
                        }}
                      >
                        重置为模板
                      </Button>
                      {current.status === 'published' && (
                        <Tag size='small' theme='success' variant='light'>
                          已发布
                        </Tag>
                      )}
                    </div>
                  </div>

                  {/* 落款 / 成文日期（唯一编辑器，真落库刷新不丢） */}
                  <div className={Style.wbField}>
                    <div className={Style.wbLabel}>落款单位 / 成文日期</div>
                    <div className={Style.wbRow}>
                      <Input size='small' value={current.sign} placeholder='落款单位（默认取官方模板）' onChange={(v) => patch({ sign: v as string })} />
                      <Input size='small' style={{ width: 210 }} value={current.signDate} placeholder='成文日期，如 2026年10月30日' onChange={(v) => patch({ signDate: v as string })} />
                    </div>
                  </div>

                  {/* 本公告附件：真上传 + 每份独立下载（切换公告随之变化，根治链接写死） */}
                  <div className={Style.wbField}>
                    <div className={Style.wbLabel}>
                      本公告附件（{current.files?.length ?? 0} 份 · 每份公告独立，小程序公告下方供下载）
                    </div>
                    <div className={Style.wbRow}>
                      <Button size='small' variant='outline' onClick={() => annFileRef.current?.click()}>
                        上传附件
                      </Button>
                      <span className={Style.wbHint}>pdf / jpg / png / doc / xls / txt，单份 ≤ 20MB</span>
                    </div>
                    {(current.files ?? []).map((f) => (
                      <div key={f.url} className={Style.wbRow}>
                        <a href={f.url} target='_blank' rel='noreferrer'>
                          附件 · {f.name}
                        </a>
                      </div>
                    ))}
                    {stage.material && (
                      <div className={Style.wbRow}>
                        <Switch
                          value={current.openMaterialSubmit}
                          onChange={(v) => patch({ openMaterialSubmit: v as boolean })}
                        />
                        <span className={Style.wbHint}>
                          开启后，小程序本公告下方出现「提交材料」按钮（材料类型：{stage.material}）
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 发布 + 日程提醒（集中一处） */}
                  <div className={Style.wbPublish}>
                    <div className={Style.wbLabel}>发布方式</div>
                    <Radio.Group
                      value={current.publishMode}
                      onChange={(v) => patch({ publishMode: v as 'immediate' | 'scheduled' })}
                    >
                      <Radio value='immediate'>确认后立即发布</Radio>
                      <Radio value='scheduled'>定时发布</Radio>
                    </Radio.Group>
                    {current.publishMode === 'scheduled' && (
                      <input
                        type='datetime-local'
                        className={Style.dtInput}
                        value={current.publishAt ?? ''}
                        onChange={(e) => patch({ publishAt: e.target.value })}
                      />
                    )}

                    <div className={Style.wbLabel} style={{ marginTop: 10 }}>
                      日程提醒（别让经办忘事）
                    </div>
                    <div className={Style.wbRow}>
                      <span className={Style.wbHint}>提早</span>
                      <InputNumber
                        size='small'
                        theme='column'
                        min={0}
                        max={720}
                        value={current.remindBeforeHours}
                        onChange={(v) => patch({ remindBeforeHours: (v as number) ?? 0 })}
                        style={{ width: 90 }}
                      />
                      <span className={Style.wbHint}>小时，提醒发送给：</span>
                      <Checkbox.Group
                        value={current.remindTo}
                        onChange={(v: Array<'editor' | 'admin'>) => patch({ remindTo: v })}
                        options={[
                          { label: '编辑经办', value: 'editor' },
                          { label: '管理员', value: 'admin' },
                        ]}
                      />
                    </div>

                    <div className={Style.wbFootBtns}>
                      <Button variant='outline' onClick={handleSaveDraft}>
                        保存草稿
                      </Button>
                      <Button theme='primary' onClick={handlePublish}>
                        {current.publishMode === 'scheduled' ? '设定定时发布' : '确认发布'}
                      </Button>
                    </div>
                  </div>

                  {/* 阶段其他事项（按阶段类型出现，同样不用跳页） */}
                  <div className={Style.wbOthers}>
                    {stage.material && (
                      <Button size='small' variant='outline' onClick={() => navigate('/election/materials')}>
                        前往材料记录（线下审核后回填）
                      </Button>
                    )}
                    {stage.review && (
                      <Button size='small' variant='outline' onClick={() => navigate('/election/candidates')}>
                        前往候选人审核（线下审核后回填：{stage.review}）
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 岗位配置（全宽） */}
          <div className={Style.postsFull}>
            <div className={Style.card}>
              <div className={Style.cardTitle}>本届岗位配置</div>
              <div className={Style.postsGrid}>
                {activity.posts.map((p) => (
                  <div key={p.position} className={Style.postItem}>
                    <b>{p.position}</b>
                    <span className={Style.postCount}>{p.count} 名</span>
                    <span className={Style.postReq}>{p.requirement || '—'}</span>
                    <div className={Style.postFiles}>
                      {(p.files ?? []).map((f) => (
                        <a key={f.url} href={f.url} target='_blank' rel='noreferrer'>
                          附件 · {f.name}
                        </a>
                      ))}
                      <Button
                        size='small'
                        variant='text'
                        theme='primary'
                        onClick={() => {
                          posUploadId.current = p.posId;
                          posFileRef.current?.click();
                        }}
                      >
                        上传/补传附件
                      </Button>
                    </div>
                  </div>
                ))}
                {activity.posts.length === 0 && <div className={Style.muted}>暂无岗位配置</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 公文预览（小编改后实时预览，自动代入日期/届次并适配村-社区称谓） */}
      <Dialog
        header={current ? `${current.no}号 · ${current.title}` : '公文预览'}
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        width={720}
        footer={
          <Button variant='outline' onClick={() => setPreviewVisible(false)}>
            关闭
          </Button>
        }
      >
        {current && activeTpl && (
          <NoticeDoc
            tpl={previewDocTpl as AnnouncementTemplate}
            orgType={activity.org_type}
            fills={tplVars}
            signDate={current.signDate}
          />
        )}
        <div className={Style.noticeHint}>「____」为待填项，仅日期/届次已自动代入；核对后回到右侧发布。</div>
      </Dialog>

      {/* 隐藏文件选择器：公告附件 / 岗位附件（真上传，每份独立目录） */}
      <input ref={annFileRef} type='file' hidden accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt' onChange={onPickAnnFile} />
      <input ref={posFileRef} type='file' hidden accept='.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt' onChange={onPickPosFile} />
    </Page>
  );
}
