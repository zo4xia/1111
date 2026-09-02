import React, { memo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Menu, MenuValue } from 'tdesign-react';
import { MENU_CONFIG } from 'configs/menu';
import { useAppSelector } from 'modules/store';
import { selectGlobal } from 'modules/global';
import MenuLogo from './MenuLogo';
import Style from './Menu.module.less';

const { SubMenu, MenuItem, HeadMenu } = Menu;

interface IMenuProps {
  showLogo?: boolean;
  showOperation?: boolean;
}

/**
 * 顶部菜单（基于菜单配置平铺一级）
 */
export const HeaderMenu = memo(() => {
  const globalState = useAppSelector(selectGlobal);
  const location = useLocation();
  const [active, setActive] = useState<MenuValue>(location.pathname);
  const navigate = useNavigate();

  const topItems = MENU_CONFIG.flatMap((g) => g.items);

  return (
    <HeadMenu
      expandType='popup'
      style={{ marginBottom: 20 }}
      value={active}
      theme={globalState.theme}
      onChange={(v) => setActive(v)}
    >
      {topItems.map((item) => (
        <MenuItem
          key={item.path}
          value={item.path}
          icon={<span className={Style.menuIcon}>{item.icon}</span>}
          onClick={() => navigate(item.path)}
        >
          {item.title}
        </MenuItem>
      ))}
    </HeadMenu>
  );
});

/**
 * 左侧菜单：照「村长仪表盘」靶子结构 —— 分组标签 + 一级(emoji) + 子菜单
 */
export default memo((props: IMenuProps) => {
  const location = useLocation();
  const globalState = useAppSelector(selectGlobal);
  const navigate = useNavigate();

  const { version } = globalState;
  const bottomText = globalState.collapsed ? version : `城厢区换届选举系统 v${version}`;

  const renderItem = (item: (typeof MENU_CONFIG)[number]['items'][number]) => {
    if (!item.children || item.children.length === 0) {
      return (
        <MenuItem
          key={item.path}
          value={item.path}
          icon={<span className={Style.menuIcon}>{item.icon}</span>}
          onClick={() => navigate(item.path)}
        >
          {item.title}
        </MenuItem>
      );
    }
    return (
      <SubMenu
        key={item.path}
        value={item.path}
        title={item.title}
        icon={<span className={Style.menuIcon}>{item.icon}</span>}
      >
        {item.children.map((child) => (
          <MenuItem key={child.path} value={child.path} onClick={() => navigate(child.path)}>
            {child.title}
          </MenuItem>
        ))}
      </SubMenu>
    );
  };

  return (
    <Menu
      width='232px'
      style={{ flexShrink: 0, height: '100%' }}
      className={Style.menuPanel2}
      value={location.pathname}
      theme={globalState.theme}
      collapsed={globalState.collapsed}
      operations={props.showOperation ? <div className={Style.menuTip}>{bottomText}</div> : undefined}
      logo={props.showLogo ? <MenuLogo collapsed={globalState.collapsed} /> : undefined}
    >
      {MENU_CONFIG.map((group, gi) => (
        <React.Fragment key={gi}>
          {group.label ? <div className={Style.groupLabel}>{group.label}</div> : null}
          {group.items.map(renderItem)}
        </React.Fragment>
      ))}
    </Menu>
  );
});
