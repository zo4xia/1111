import { Button, Tag } from 'tdesign-react';
import { ElectionActivity, sessionNo } from 'utils/electionStore';
import Style from './index.module.less';

/**
 * SessionDetailBar —— 选举业务页「第二级：某一届明细」顶部条
 * 与 ElectionSessionList（第一级）配套：左侧返回列表，中间显示当前届 / Dday / 方式。
 * 用法：进入某届明细后，在工具栏上方放一条；onBack 把 current 置 null 即回到列表。
 */
interface Props {
  activity: ElectionActivity;
  onBack: () => void;
  /** 右侧附加（如「待审核 N 份」统计） */
  extra?: React.ReactNode;
}

export default function SessionDetailBar({ activity, onBack, extra }: Props) {
  return (
    <div className={Style.detailBar}>
      <Button variant='outline' size='small' onClick={onBack}>
        ← 返回列表
      </Button>
      <div className={Style.detailTitle}>
        <b>{sessionNo(activity.name)}</b>
        <span className={Style.detailName}>{activity.name}</span>
      </div>
      <Tag size='small' theme='primary' variant='light'>
        {activity.election_mode}
      </Tag>
      <Tag size='small' variant='light'>
        正式选举日(D)：{activity.dday}
      </Tag>
      <div className={Style.detailExtra}>{extra}</div>
    </div>
  );
}
