import { useEffect, useState } from 'react';
import { Button } from 'tdesign-react';
import { currentUser, LoginUser } from 'services/electionApi';

const DONE_KEY = 'cxq_guide_done_v1';

/** 业务角色 → 中文（与后端 roles/account_roles 对齐） */
const roleLabel = (u: LoginUser): string => {
  if (u.role === 'admin' || u.roles === 'platform_admin') return '平台超管';
  const map: Record<string, string> = {
    sub_admin: '村/社区子管理（本村全权限）',
    operator: '经办/书记',
    editor: '运营编辑',
    reviewer: '审核员',
    voters: '参选人',
  };
  const keys = u.roleKeys || [];
  const hit = keys.map((k) => map[k]).filter(Boolean);
  return hit[0] || (u.roles && map[u.roles]) || '工作人员';
};

interface Step {
  title: string;
  body: React.ReactNode;
}

/**
 * 登录后气泡引导（D-013）：居中卡片式四步，不做元素坐标定位，避免不同分辨率错位。
 * 「跳过 / 我知道了」写入 localStorage，不再弹出；可在控制台 localStorage.removeItem 重看。
 */
export default function GuideTour() {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [user, setUser] = useState<LoginUser | null>(null);

  useEffect(() => {
    const u = currentUser();
    if (!u) return; // 未登录不弹
    if (localStorage.getItem(DONE_KEY) === '1') return;
    setUser(u);
    const t = setTimeout(() => setOpen(true), 350); // 等主框架渲染稳
    return () => clearTimeout(t);
  }, []);

  const close = () => {
    setOpen(false);
    localStorage.setItem(DONE_KEY, '1');
  };

  if (!open || !user) return null;

  const steps: Step[] = [
    {
      title: `欢迎，${user.name || user.phone}`,
      body: (
        <>
          <p>你当前归属：<b>{user.orgName || user.orgId}</b></p>
          <p>你的身份：<b>{roleLabel(user)}</b></p>
          <p className="gt-sub">系统按「归属地」隔离数据，你只能看到本村/社区的内容；超管可跨归属地。</p>
        </>
      ),
    },
    {
      title: '一条主线走完换届',
      body: (
        <ol className="gt-flow">
          <li><b>① 提案审批</b>：新建提案，填选举日(D-day)、岗位、说明，提交审核</li>
          <li><b>② 审核通过</b>：系统自动生成这一届的日程表、公告草稿、岗位记录</li>
          <li><b>③ 小编工作台</b>：唯一编辑口，改公告、选发布方式、发布</li>
          <li><b>④ 材料 / 候选人</b>：参选人小程序交材料，线下审核后在这里回填结果</li>
          <li><b>⑤ 归档</b>：提案、公告、材料、结果按届归档</li>
        </ol>
      ),
    },
    {
      title: '唯一编辑口，避免两处打架',
      body: (
        <>
          <p>公告内容<b>只在「活动列表 → 小编工作台」编辑和预览</b>。</p>
          <p>「公告通知 → 公告记录」只负责<b>记录发没发</b>，不再提供第二处编辑，保证只有一个真相。</p>
          <p className="gt-sub">同一天发多份公告时，在工作台逐份切换编辑，每份各自带下载附件。</p>
        </>
      ),
    },
    {
      title: 'D 日怎么算 & 线下环节',
      body: (
        <>
          <p><b>D-day</b> = 选举正式日；<b>D-N</b> = 提前 N 天；<b>D+N</b> = 之后 N 天，日程自动排。</p>
          <p>材料审核、候选人资格审查是<b>线下人工</b>完成后，回到后台「材料管理 / 候选人管理」回填结果即可。</p>
          <p className="gt-sub">遇到问题随时联系平台管理员。祝顺利完成换届！</p>
        </>
      ),
    },
  ];
  const step = steps[idx];
  const last = idx === steps.length - 1;

  return (
    <div className="gt-mask">
      <div className="gt-card" role="dialog" aria-label="新手引导">
        <div className="gt-head">
          <span className="gt-step-no">{idx + 1} / {steps.length}</span>
          <button className="gt-skip" onClick={close} type="button">跳过</button>
        </div>
        <h3 className="gt-title">{step.title}</h3>
        <div className="gt-body">{step.body}</div>
        <div className="gt-dots">
          {steps.map((_, i) => (
            <span key={i} className={`gt-dot ${i === idx ? 'on' : ''}`} />
          ))}
        </div>
        <div className="gt-footer">
          {idx > 0 && <Button variant="text" onClick={() => setIdx(idx - 1)}>上一步</Button>}
          <div style={{ flex: 1 }} />
          {!last ? (
            <Button theme="primary" onClick={() => setIdx(idx + 1)}>下一步</Button>
          ) : (
            <Button theme="primary" onClick={close}>我知道了，开始办公</Button>
          )}
        </div>
      </div>
      <style>{`
        .gt-mask{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:24px;}
        .gt-card{width:520px;max-width:100%;max-height:86vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.22);padding:22px 24px;}
        .gt-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}
        .gt-step-no{font-size:12px;color:#8a94a6;background:#f2f4f8;border-radius:10px;padding:2px 10px;}
        .gt-skip{border:none;background:none;color:#8a94a6;cursor:pointer;font-size:13px;}
        .gt-skip:hover{color:#4a5568;}
        .gt-title{margin:6px 0 12px;font-size:18px;color:#1f2329;}
        .gt-body{font-size:14px;color:#3d4350;line-height:1.75;}
        .gt-body p{margin:6px 0;}
        .gt-sub{color:#8a94a6;font-size:12.5px;}
        .gt-flow{margin:4px 0;padding-left:0;list-style:none;}
        .gt-flow li{padding:7px 10px;margin:6px 0;background:#f7f9fc;border-radius:8px;border-left:3px solid #9EACEA;}
        .gt-dots{display:flex;gap:6px;margin:14px 0 4px;}
        .gt-dot{width:7px;height:7px;border-radius:50%;background:#dde2ea;}
        .gt-dot.on{background:#6b7fb8;width:18px;border-radius:4px;}
        .gt-footer{display:flex;align-items:center;margin-top:8px;}
      `}</style>
    </div>
  );
}
