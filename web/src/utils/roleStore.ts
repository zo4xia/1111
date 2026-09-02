/**
 * 角色权限 共享 store（module 级单例 + useSyncExternalStore）
 * 权限点：view（查看，所有人默认）/ edit（编辑）/ approve（审批）
 * 规则：驳回后谁可重新编辑 → edit；谁可审批 → approve；查看 → view
 */
import { useSyncExternalStore } from 'react';

export type Permission = 'view' | 'edit' | 'approve';

export interface Role {
  id: number;
  name: string;
  code: string;
  note?: string;
  perms: Permission[];
}

let nextId = 100;

const DEFAULT_ROLES: Role[] = [
  { id: 1, name: '超管', code: 'super_admin', note: '系统管理员，全部权限', perms: ['view', 'edit', 'approve'] },
  { id: 2, name: '子管理', code: 'sub_admin', note: '本村/居管理员，可编辑可审批', perms: ['view', 'edit', 'approve'] },
  { id: 3, name: '经办编辑', code: 'editor', note: '可编辑提案，不可审批', perms: ['view', 'edit'] },
  { id: 4, name: '审核员', code: 'reviewer', note: '可审批，不可编辑', perms: ['view', 'approve'] },
  { id: 5, name: '参选人', code: 'candidate', note: '小程序端：查看与提交材料', perms: ['view'] },
];

let roles: Role[] = DEFAULT_ROLES;
/** 当前登录用户角色（默认超管；localStorage 持久化，整页刷新/跳转不丢） */
const CURRENT_ROLE_KEY = 'election_current_role';
let currentRole: Role = (() => {
  const saved = localStorage.getItem(CURRENT_ROLE_KEY);
  if (saved) {
    const found = DEFAULT_ROLES.find((r) => String(r.id) === saved);
    if (found) return found;
  }
  return DEFAULT_ROLES[0];
})();

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function getRoles(): Role[] {
  return roles;
}

export function getCurrentRole(): Role {
  return currentRole;
}

export function subscribeRole(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 创建角色 */
export function createRole(r: Omit<Role, 'id'>): number {
  const id = nextId++;
  roles = [...roles, { id, ...r }];
  emit();
  return id;
}

/** 更新角色 */
export function updateRole(id: number, patch: Partial<Omit<Role, 'id'>>) {
  roles = roles.map((r) => (r.id === id ? { ...r, ...patch } : r));
  if (currentRole.id === id) {
    currentRole = { ...currentRole, ...patch };
  }
  emit();
}

/** 删除角色（当前角色不可删） */
export function removeRole(id: number) {
  if (currentRole.id === id) return false;
  roles = roles.filter((r) => r.id !== id);
  emit();
  return true;
}

/** 切换当前用户角色（演示用，后续接登录） */
export function setCurrentRole(id: number) {
  const r = roles.find((x) => x.id === id);
  if (r) {
    currentRole = r;
    localStorage.setItem(CURRENT_ROLE_KEY, String(r.id));
    emit();
  }
}

/** 当前用户角色（hook） */
export function useCurrentRole(): Role {
  return useSyncExternalStore(subscribeRole, getCurrentRole);
}

/** 全部角色（hook） */
export function useRoles(): Role[] {
  return useSyncExternalStore(subscribeRole, getRoles);
}
