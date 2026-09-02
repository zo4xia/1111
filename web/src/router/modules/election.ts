import { lazy } from 'react';
import { IRouter } from '../index';

/** 换届选举业务路由（与 config/menu.ts 菜单一一对应） */
const election: IRouter[] = [
  {
    path: '/election',
    meta: { title: '换届选举', hidden: true },
    children: [
      {
        path: 'home',
        Component: lazy(() => import('pages/Election/Home')),
        meta: { title: '首页工作台' },
      },
      {
        path: 'proposals',
        Component: lazy(() => import('pages/Election/Proposals')),
        meta: { title: '提案列表' },
      },
      {
        path: 'activities',
        Component: lazy(() => import('pages/Election/Activities')),
        meta: { title: '活动列表' },
      },
      {
        path: 'activity/:id',
        Component: lazy(() => import('pages/Election/ActivityDetail')),
        meta: { title: '本届详情', hidden: true },
      },
      {
        path: 'positions',
        Component: lazy(() => import('pages/Election/Positions')),
        meta: { title: '岗位选举表' },
      },
      {
        path: 'materials',
        Component: lazy(() => import('pages/Election/Materials')),
        meta: { title: '材料记录' },
      },
      {
        path: 'candidates',
        Component: lazy(() => import('pages/Election/Candidates')),
        meta: { title: '候选人审核' },
      },
      {
        path: 'announcements',
        Component: lazy(() => import('pages/Election/Announcements')),
        meta: { title: '公告记录' },
      },
      {
        path: 'quick-templates',
        Component: lazy(() => import('pages/Election/QuickTemplates')),
        meta: { title: '快捷模板' },
      },
      {
        path: 'archives',
        Component: lazy(() => import('pages/Election/Archives')),
        meta: { title: '活动列表' },
      },
    ],
  },
  {
    path: '/admin',
    meta: { title: '后台管理', hidden: true },
    children: [
      {
        path: 'users',
        Component: lazy(() => import('pages/Admin/Users')),
        meta: { title: '人员管理' },
      },
      {
        path: 'roles',
        Component: lazy(() => import('pages/Admin/Roles')),
        meta: { title: '角色管理' },
      },
      {
        path: 'sms',
        Component: lazy(() => import('pages/Placeholder')),
        meta: { title: '短信配置' },
      },
      {
        path: 'notifications',
        Component: lazy(() => import('pages/Placeholder')),
        meta: { title: '通知管理' },
      },
    ],
  },
  {
    // D-013 隐藏解锁页：不进菜单，仅平台超管可访问，用于为村/社区预设账号
    path: '/org-setup',
    Component: lazy(() => import('pages/Admin/OrgSetup')),
    meta: { title: '归属地账号预设', hidden: true },
  },
];

export default election;
