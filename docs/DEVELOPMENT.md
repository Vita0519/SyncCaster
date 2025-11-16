# 开发指南

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- PNPM >= 8
- Chrome/Edge 浏览器（开发者模式）

### 安装依赖

```bash
# 安装 pnpm（如果尚未安装）
npm install -g pnpm

# 安装项目依赖
pnpm install
```

### 开发模式

```bash
# 启动开发模式（监听文件变化并自动重新构建）
pnpm dev

# 或者直接在 extension 目录下开发
cd apps/extension
pnpm dev
```

### 加载扩展到浏览器

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 启用右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `apps/extension/dist` 目录

### 构建生产版本

```bash
# 构建所有包
pnpm build:all

# 或只构建扩展
pnpm build
```

## 📁 项目结构

```
synccaster/
├── apps/
│   └── extension/              # 浏览器扩展
│       ├── src/
│       │   ├── background/     # Service Worker
│       │   ├── content-scripts/# 内容脚本
│       │   ├── ui/            # Vue 界面
│       │   │   ├── popup/     # 弹出窗口
│       │   │   ├── options/   # 设置页面
│       │   │   └── sidepanel/ # 侧边栏
│       │   └── manifest.ts    # MV3 配置
│       └── vite.config.ts
├── packages/
│   ├── core/                  # 核心类型和数据库
│   │   ├── src/
│   │   │   ├── types/        # TypeScript 类型定义
│   │   │   └── db/           # Dexie 数据库
│   ├── adapters/             # 平台适配器
│   │   └── src/
│   │       ├── base.ts       # 适配器基础接口
│   │       ├── wechat.ts     # 微信公众号
│   │       ├── zhihu.ts      # 知乎
│   │       └── juejin.ts     # 掘金
│   └── utils/                # 工具函数
│       └── src/
│           ├── logger.ts     # 日志
│           └── dom.ts        # DOM 操作
└── docs/                     # 文档
```

## 🔧 核心概念

### 1. 统一内容模型（CanonicalPost）

所有平台的内容都转换为统一的 Markdown 格式：

```typescript
interface CanonicalPost {
  id: string;
  title: string;
  body_md: string;        // Markdown 正文
  summary?: string;       // 摘要
  cover?: AssetRef;       // 封面
  tags?: string[];
  categories?: string[];
  assets?: AssetRef[];    // 附件（图片、视频）
  // ...
}
```

### 2. 平台适配器（PlatformAdapter）

每个平台实现统一的适配器接口：

```typescript
interface PlatformAdapter {
  id: PlatformId;
  name: string;
  capabilities: PlatformCapabilities;
  
  ensureAuth(ctx): Promise<AuthSession>;
  transform(post, ctx): Promise<PlatformPayload>;
  uploadAsset?(file, meta, ctx): Promise<AssetRemoteRef>;
  createDraft?(payload, ctx): Promise<PublishResult>;
  publish(payloadOrDraftId, ctx): Promise<PublishResult>;
  dom?: DOMAutomation;
}
```

### 3. 任务队列

发布任务通过队列管理：

```
PENDING → RUNNING → (DONE | FAILED)
         ↓
      (可重试)
```

### 4. 数据流

```
网页内容 → 采集(Readability) → CanonicalPost(Markdown)
         → 编辑器 → 平台转换 → 适配器 → 发布
```

## 🛠️ 开发任务

### 添加新平台适配器

1. 在 `packages/adapters/src/` 创建新文件（如 `csdn.ts`）
2. 实现 `PlatformAdapter` 接口
3. 在 `packages/adapters/src/index.ts` 中注册
4. 更新 `apps/extension/src/manifest.ts` 添加权限

示例：

```typescript
// packages/adapters/src/csdn.ts
export const csdnAdapter: PlatformAdapter = {
  id: 'csdn',
  name: 'CSDN',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    // ...
  },
  
  async ensureAuth({ account }) {
    // 实现认证检查
  },
  
  async transform(post, { config }) {
    // 转换内容格式
  },
  
  async publish(payload, ctx) {
    // 发布逻辑
  },
  
  dom: {
    matchers: ['https://editor.csdn.net/*'],
    async fillAndPublish(payload) {
      // DOM 自动化
    }
  }
};
```

### DOM 自动化最佳实践

1. **选择器鲁棒性**：优先使用 `data-*` 属性或语义化选择器
2. **等待元素**：使用 `waitForElement` 等待动态加载
3. **模拟人类行为**：添加随机延迟、hover、滚动
4. **错误处理**：捕获异常并记录详细日志
5. **分步验证**：每步操作后验证结果

```typescript
import { waitForElement, simulateInput, randomSleep } from '@synccaster/utils';

// 1. 等待编辑器加载
const editor = await waitForElement('[data-editor]', 10000);

// 2. 模拟人类行为
await randomSleep(200, 500);

// 3. 填充内容
simulateInput(editor, payload.content);

// 4. 验证
if (!editor.textContent?.includes(payload.title)) {
  throw new Error('Title not filled correctly');
}
```

## 🧪 测试

```bash
# 运行单元测试
pnpm test

# 监听模式
pnpm test --watch
```

## 📝 代码规范

- 使用 TypeScript strict 模式
- 遵循 ESLint 规则
- 使用 Prettier 格式化代码
- 提交信息遵循 Conventional Commits

```bash
# 格式化代码
pnpm format

# 检查代码
pnpm lint
```

## 🐛 调试技巧

### 1. 查看 Service Worker 日志

1. 访问 `chrome://extensions/`
2. 找到 SyncCaster 扩展
3. 点击"Service Worker"链接
4. 在 DevTools 中查看日志

### 2. 调试 Content Script

1. 打开目标网页
2. 按 F12 打开 DevTools
3. 在 Console 中可以看到 content script 日志

### 3. 查看 IndexedDB 数据

1. 打开 DevTools
2. 切换到 Application 标签
3. 展开 IndexedDB → synccaster

### 4. 启用调试日志

在扩展设置中启用"调试模式"，可以看到更详细的日志输出。

## 📦 发布流程

### 1. 版本号管理

遵循语义化版本（SemVer）：

- MAJOR: 不兼容的 API 变更
- MINOR: 向后兼容的功能新增
- PATCH: 向后兼容的问题修复

### 2. 构建和打包

```bash
# 构建生产版本
pnpm build

# 打包为 zip（用于上传商店）
cd apps/extension/dist
zip -r synccaster-v2.0.0.zip .
```

### 3. 上传到商店

- Chrome Web Store: https://chrome.google.com/webstore/devconsole
- Edge Add-ons: https://partner.microsoft.com/dashboard

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📚 相关资源

- [Chrome Extensions MV3 文档](https://developer.chrome.com/docs/extensions/mv3/)
- [Dexie.js 文档](https://dexie.org/)
- [Vue 3 文档](https://vuejs.org/)
- [Naive UI 文档](https://www.naiveui.com/)
- [UnoCSS 文档](https://unocss.dev/)
