<div align="center">

# ✨ SyncCaster

_**一次编辑，处处发布**_

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension%20MV3-4285F4?logo=googlechrome&logoColor=white)](#)
[![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vuedotjs&logoColor=white)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](#)

</div>

SyncCaster 是一个浏览器扩展，帮助内容创作者将文章一键同步到多个博客平台。

> 🔒 本扩展完全本地运行，不收集、不存储任何用户信息。**如需添加更多平台或改善同步准确度，欢迎提 Issue 或 PR**。

## 特性

- 📝 编辑一次，同步到多个平台
- 🔍 智能采集任意网页文章内容
- 🔐 自动检测各平台登录状态
- 📁 同步的标签页自动归入分组，便于管理
- 🎨 微信公众号同步时完整保留渲染样式

## 已支持的平台

| 平台 | Markdown | LaTeX | 备注 |
|:----:|:--------:|:-----:|:-----|
| 掘金 | ✅ | ✅ | |
| CSDN | ✅ | ✅ | |
| 博客园 | ✅ | ✅ | 需开启数学公式支持 |
| 51CTO | ✅ | ✅ | |
| 腾讯云 | ✅ | ✅ | |
| 知乎 | ❌ | ⚠️ | 富文本编辑器 |
| 简书 | ✅ | ❌ | |
| 阿里云 | ✅ | ⚠️ | |
| 思否 | ✅ | ⚠️ | |
| 哔哩哔哩 | ✅ | ❌ | |
| 微信公众号 | ❌ | ❌ | 富文本编辑器 |

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build
```

### 加载扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `apps/extension/dist` 目录

## 项目结构

```
SyncCaster/
├── apps/
│   └── extension/          # Chrome 扩展应用
│       ├── src/
│       │   ├── background/ # Service Worker（后台脚本）
│       │   │   ├── index.ts           # 消息处理、任务调度
│       │   │   ├── publish-engine.ts  # 发布引擎核心
│       │   │   └── inpage-runner.ts   # 站内脚本执行器
│       │   ├── content-scripts/       # 内容脚本（页面注入）
│       │   └── ui/                    # 用户界面
│       │       ├── popup/             # 弹出窗口
│       │       ├── sidepanel/         # 侧边栏
│       │       └── options/           # 设置页面
│       └── dist/           # 构建输出
├── packages/
│   ├── adapters/           # 平台适配器
│   │   └── src/
│   │       ├── base.ts     # 适配器基类和接口定义
│   │       ├── juejin.ts   # 掘金适配器
│   │       ├── csdn.ts     # CSDN 适配器
│   │       ├── zhihu.ts    # 知乎适配器
│   │       ├── jianshu.ts  # 简书适配器
│   │       ├── cnblogs.ts  # 博客园适配器
│   │       ├── wechat.ts   # 微信公众号适配器
│   │       ├── 51cto.ts    # 51CTO 适配器
│   │       ├── tencent-cloud.ts  # 腾讯云开发者社区
│   │       ├── aliyun.ts   # 阿里云开发者社区
│   │       ├── segmentfault.ts   # 思否适配器
│   │       ├── bilibili.ts # 哔哩哔哩专栏适配器
│   │       └── index.ts    # 适配器注册
│   ├── core/               # 核心类型和数据库
│   │   └── src/
│   │       ├── types/      # TypeScript 类型定义
│   │       └── db/         # IndexedDB 数据库（Dexie）
│   └── utils/              # 工具函数
└── docs/                   # 文档
```

## 技术栈

- **前端框架**: Vue 3 + TypeScript
- **构建工具**: Vite + pnpm (monorepo)
- **UI 框架**: UnoCSS + 自定义组件
- **数据存储**: IndexedDB (Dexie.js)
- **扩展 API**: Chrome Extension Manifest V3

## 核心功能

### 1. 内容采集
- 从任意网页采集文章内容
- 智能提取标题、正文、图片、公式
- 转换为统一的 Markdown 格式（CanonicalPost）

### 2. 多平台发布
- 支持 11+ 主流博客平台
- DOM 自动化模拟人工发布
- 统一的适配器接口

### 3. 任务管理
- 发布任务队列
- 进度跟踪和日志
- 失败重试机制

## 支持的平台

| 平台 | 入口 URL | 编辑器类型 | Markdown | LaTeX |
|------|----------|-----------|----------|-------|
| 掘金 | juejin.cn/editor/drafts/new | Markdown | ✅ | ✅ |
| CSDN | mp.csdn.net/mp_blog/creation/editor | Markdown | ✅ | ✅ |
| 博客园 | i.cnblogs.com/posts/edit | Markdown | ✅ | ✅* |
| 51CTO | blog.51cto.com/blogger/publish | Markdown | ✅ | ✅ |
| 腾讯云 | cloud.tencent.com/developer/article/write-new | Markdown | ✅ | ✅ |
| 知乎 | zhuanlan.zhihu.com/write | 富文本 | ❌ | ⚠️** |
| 简书 | www.jianshu.com/writer | Markdown | ✅ | ❌ |
| 阿里云 | developer.aliyun.com/article/new | Markdown | ✅ | ⚠️*** |
| 思否 | segmentfault.com/write | Markdown | ✅ | ⚠️**** |
| 哔哩哔哩 | member.bilibili.com/platform/upload/text/edit | 富文本 | ✅ | ❌ |
| 微信公众号 | mp.weixin.qq.com | 富文本 | ❌ | ❌ |

**注释**:
- *博客园：需在后台设置开启"启用数学公式支持"
- **知乎：需通过"公式"插件手动输入，去除 $ 符号
- ***阿里云：需点击"数学公式"按钮转换，公式前后不能有 $ 符号
- ****思否：特殊语法，行间 `$$...$$`，行内 `\(...\)`

## 适配器架构

### 适配器接口

```typescript
interface PlatformAdapter {
  id: PlatformId;           // 平台标识
  name: string;             // 平台名称
  kind: 'dom' | 'metaweblog' | 'restApi';  // 适配器类型
  capabilities: {           // 平台能力
    supportsMarkdown: boolean;
    supportsHtml: boolean;
    supportsTags: boolean;
    // ...
  };
  
  ensureAuth(ctx): Promise<AuthSession>;     // 认证检查
  transform(post, ctx): Promise<Payload>;    // 内容转换
  publish(payload, ctx): Promise<Result>;    // 发布（API 模式）
  
  dom?: {                   // DOM 自动化配置
    matchers: string[];     // 匹配的 URL 模式
    fillAndPublish(payload): Promise<Result>;  // 填充并发布
  };
}
```

### 发布流程

```
1. 用户点击"发布"
2. 创建发布任务（Job）
3. 对每个目标平台：
   a. 获取适配器
   b. 检查认证状态
   c. 转换内容格式
   d. 执行发布：
      - DOM 模式：打开目标页面，执行 fillAndPublish
      - API 模式：直接调用平台 API
   e. 记录结果
4. 更新任务状态
```

### DOM 自动化

DOM 自动化通过 `executeInOrigin` 在目标平台页面内执行脚本：

```typescript
// 1. 创建后台标签页，加载目标 URL
const tab = await chrome.tabs.create({ url: targetUrl });

// 2. 等待页面加载完成
await waitForLoad(tab.id);

// 3. 在页面主世界执行脚本
const result = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  world: 'MAIN',  // 主世界，可访问页面 JS 对象
  func: adapter.dom.fillAndPublish,
  args: [payload],
});
```

## 数据模型

### CanonicalPost（统一内容模型）

```typescript
interface CanonicalPost {
  id: string;
  title: string;
  body_md: string;      // Markdown 正文
  summary?: string;
  cover?: AssetRef;
  tags?: string[];
  categories?: string[];
  assets?: AssetRef[];  // 图片等资源
  formulas?: MathNode[]; // 提取的公式
  // ...
}
```

### Job（发布任务）

```typescript
interface Job {
  id: string;
  postId: string;
  targets: PublishTarget[];  // 发布目标列表
  state: 'PENDING' | 'RUNNING' | 'PAUSED' | 'FAILED' | 'DONE';
  progress: number;
  logs: LogEntry[];
  // ...
}
```

## 开发指南

### 添加新适配器

1. 在 `packages/adapters/src/` 创建新文件（如 `newplatform.ts`）
2. 实现 `PlatformAdapter` 接口
3. 在 `index.ts` 中导出并注册
4. 在 `packages/core/src/types/index.ts` 添加平台 ID

```typescript
// newplatform.ts
import type { PlatformAdapter } from './base';

export const newplatformAdapter: PlatformAdapter = {
  id: 'newplatform',
  name: '新平台',
  kind: 'dom',
  // ...
  
  dom: {
    matchers: ['https://newplatform.com/editor*'],
    async fillAndPublish(payload) {
      // 实现 DOM 自动化逻辑
    },
  },
};
```

### 调试技巧

1. **查看后台日志**: 右键扩展图标 → 检查 Service Worker
2. **查看页面日志**: 在目标平台页面打开开发者工具
3. **调试模式**: 修改 `publish-engine.ts` 中的 `closeTab: false` 保持标签页打开

## 版本历史

### v2.0.0
- 重构适配器架构
- 统一 DOM 自动化流程
- 支持 11 个主流平台
- 改进错误处理和日志

## License

MIT
