/**
 * 侧边栏菜单配置
 * 结构照「村长仪表盘-美化版.html」靶子：分组标签 + 一级菜单(emoji) + 子菜单(带注释)
 * 组件统一用 TDesign，这里只定导航结构，不做美工。
 */
export interface IMenuChild {
  title: string;
  path: string;
  note?: string;
}

export interface IMenuItem {
  icon: string;
  title: string;
  path: string;
  children?: IMenuChild[];
}

export interface IMenuGroup {
  label?: string;
  items: IMenuItem[];
}

export const MENU_CONFIG: IMenuGroup[] = [
  {
    items: [{ icon: '🏠', title: '首页工作台', path: '/election/home' }],
  },
  {
    label: '选举管理',
    items: [
      {
        icon: '📄',
        title: '提案审批',
        path: '/election/proposals',
        children: [{ title: '提案列表', path: '/election/proposals', note: '本期+' }],
      },
      {
        icon: '📋',
        title: '选举活动管理',
        path: '/election/activities',
        children: [{ title: '活动列表', path: '/election/activities', note: '⭐母版' }],
      },
    ],
  },
  {
    label: '办理中',
    items: [
      {
        icon: '👥',
        title: '岗位管理',
        path: '/election/positions',
        children: [{ title: '岗位选举表', path: '/election/positions', note: '本期+' }],
      },
      {
        icon: '📝',
        title: '材料提交管理',
        path: '/election/materials',
        children: [{ title: '材料记录', path: '/election/materials', note: '本期+' }],
      },
      {
        icon: '🙋',
        title: '候选人管理',
        path: '/election/candidates',
        children: [{ title: '候选人审核', path: '/election/candidates', note: '含审批' }],
      },
      {
        icon: '📢',
        title: '公告通知',
        path: '/election/announcements',
        children: [
          { title: '公告记录', path: '/election/announcements', note: '母版镜像' },
          { title: '快捷模板', path: '/election/quick-templates', note: '公文速查' },
        ],
      },
    ],
  },
  {
    label: '收尾归档',
    items: [
      {
        icon: '🗄️',
        title: '历史归档',
        path: '/election/archives',
        children: [{ title: '活动列表', path: '/election/archives', note: '目录树' }],
      },
    ],
  },
  {
    label: '后台管理',
    items: [
      {
        icon: '⚙️',
        title: '后台管理',
        path: '/admin',
        children: [
          { title: '人员管理', path: '/admin/users' },
          { title: '角色管理', path: '/admin/roles', note: '角色权限' },
          { title: '短信配置', path: '/admin/sms' },
          { title: '通知管理', path: '/admin/notifications' },
        ],
      },
    ],
  },
];
