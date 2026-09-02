import React from 'react';
import Style from './index.module.less';

export default function Header() {
  return (
    <div>
      <header className={Style.loginHeader}>
        <div className={Style.brand}>
          <span className={Style.brandMark}>选</span>
          <span className={Style.brandName}>城厢区村居换届选举系统</span>
        </div>
      </header>
    </div>
  );
}
