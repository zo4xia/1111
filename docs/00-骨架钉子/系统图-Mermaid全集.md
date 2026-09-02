# 系统图 · Mermaid 全集

> 2026-08-31 · 村居换届选举系统（傻瓜式官宣平台）
> 配套：PRD-村居换届选举系统.md / 页面结构-小程序蓝本.md / 设计规范-青墨鎏金.md

---

## 1. 系统全景图（四条主线）

```mermaid
flowchart TD
    U[用户] --> F[登录漏斗<br/>归属地 → 账号 → 角色]
    F --> V[进入自己的村/社区]
    V --> H[首页 · 官宣<br/>换届进度 / 距投票日 / 当前阶段 / 最新公告]
    H --> M1[材料提交<br/>唯一交互]
    H --> M2[候选人公示<br/>四轮审核结果]
    H --> M3[日程预告<br/>D-day 倒排]
    H --> M4[公告按日期发布]
    H --> M5[岗位要求说明]
    H --> M6[资料下载]

    subgraph 发动机[日程 pipeline 发动机]
        E1[输入 D 正式选举日] --> E2[stage_templates 阶段偏移]
        E2 --> E3[自动生成 election_stages 日程]
        E3 --> E4[公告跟随日程 · 提前提示]
        E4 --> E5[管理员确认可发 → 发布]
    end

    M1 --> A[后台审核材料]
    M2 --> A
    A --> A1[四轮审核结果公示]
    M3 -. 由发动机驱动 .-> E3
    M4 -. 由发动机驱动 .-> E4
```

---

## 2. 登录漏斗（防串台）

```mermaid
flowchart LR
    subgraph 漏斗[漏斗式 · 缺一不可]
        O[① 归属地<br/>130+ 村/社区] --> T[② 组织类型<br/>村 / 社区]
        T --> AC[③ 账号<br/>手机号 + 密码]
        AC --> R[④ 角色<br/>参选人 / 子管理 / 编辑经办]
    end
    R --> IN[进入自己的村<br/>数据隔离 · 不会串台]

    note1[参选人：无编辑公告权限<br/>子管理 / 编辑经办：可编辑公告]
```

---

## 3. 日程 pipeline 发动机（D-day 自动倒排）

```mermaid
flowchart TD
    D[管理员输入<br/>D = 正式选举日<br/>如 2026-10-30] --> S[读取 stage_templates<br/>16 阶段 · 每阶段偏移量]
    S --> G[自动生成完整日程<br/>election_stages 每阶段真实日期]
    G --> C{当前日期 → 判定阶段}
    C -->|未到| W[日程预告 · 待办阶段]
    C -->|进行中| N[现在进行中 · 该发公告了]
    C -->|已过| P[历史归档]
    N --> B[公告模板预填充<br/>按阶段对应公告正文]
    B --> OK[管理员登录确认 → 发布]
    OK --> PUB[公告按日期官宣]
```

---

## 4. 前端页面结构（小程序蓝本）

```mermaid
flowchart TD
    LOGIN[登录页<br/>归属地 → 账号 → 密码 → 角色] --> HOME[首页<br/>进度 / 倒计时 / 当前阶段 / 最新公告]
    HOME --> NTC[公告通知<br/>三 Tab + 阶段分组 + 红头详情]
    HOME --> CND[候选人公示<br/>公文头 + 岗位分组 + 四轮轨迹]
    HOME --> MAT[材料提交<br/>窗口自动开关 + 上传 + 记录]
    HOME --> MTH[选举流程 / 岗位<br/>岗位清单 + 报名 + 公告模板 + 花名册]
    HOME --> PRO[我的]
```

---

## 5. 数据表关系（ER）

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ ACCOUNTS : "归属地-账号"
    ORGANIZATIONS ||--o{ ELECTIONS : "归属地-历届选举"
    ACCOUNTS }o--o{ ROLES : "账号-角色"
    ELECTIONS ||--o{ ELECTION_STAGES : "一届-多阶段"
    STAGE_TEMPLATES ||--o{ ELECTION_STAGES : "模板-实例"
    ELECTIONS ||--o{ POSITIONS : "一届-岗位"
    ELECTIONS ||--o{ ANNOUNCEMENTS : "一届-公告"
    ELECTIONS ||--o{ PROPOSALS : "选举申请"
    POSITIONS ||--o{ MATERIALS : "岗位-材料"
    ACCOUNTS ||--o{ MATERIALS : "提交人-材料"

    ORGANIZATIONS {
        string org_id PK
        string name "村/社区名"
        string org_type "村/社区"
    }
    ELECTIONS {
        string el_id PK
        string org_id FK
        date el_election_date "D 正式选举日"
        string el_term "第几届"
    }
    ELECTION_STAGES {
        string st_id PK
        string el_id FK
        int st_day_offset "相对 D 偏移"
        date st_date "推算日期"
    }
    ANNOUNCEMENTS {
        string ann_id PK
        string el_id FK
        date ann_publish_date "按日期发布"
    }
```

---

> 变更树：2026-08-31 创建系统图全集（全景/漏斗/pipeline/页面/ER）
