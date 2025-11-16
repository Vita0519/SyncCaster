# 架构设计文档

## 总体架构

SyncCaster 采用分层架构，将核心逻辑、平台适配、UI 和浏览器扩展分离：

```
┌─────────────────────────────────────────┐
│         Browser Extension (MV3)         │
├─────────────────────────────────────────┤
│  Popup  │  Options  │  SidePanel        │
├─────────────────────────────────────────┤
│  Background Service Worker              │
│  - 任务队列管理                          │
│  - 消息总线                             │
│  - 定时任务                             │
├─────────────────────────────────────────┤
│  Content Scripts (各平台发布页)          │
│  - DOM 自动化                           │
│  - 内容采集                             │
├─────────────────────────────────────────┤
│         Adapters (平台适配器)            │
│  WeChat │ Zhihu │ Juejin │ CSDN ...    │
├─────────────────────────────────────────┤
│      Core (核心逻辑 + 数据模型)          │
│  - 类型定义                             │
│  - IndexedDB (Dexie)                   │
│  - 内容转换管道                         │
└─────────────────────────────────────────┘
```

## 核心模块

### 1. Core 层

**职责**：提供核心数据模型、类型定义和数据库访问

**关键组件**：
- `types/`: TypeScript 类型定义
- `db/`: Dexie 数据库封装

**数据表结构**：

```typescript
posts          // 文章内容（SSOT）
  - id, title, body_md, assets, tags, ...

assets         // 资源文件
  - id, type, blobUrl, hash, ...

jobs           // 发布任务
  - id, postId, targets, state, progress, ...

platformMaps   // 平台映射关系
  - id, postId, platform, remoteId, url, status, ...

accounts       // 账号信息
  - id, platform, nickname, enabled, ...

secrets        // 加密凭证
  - id, accountId, encrypted, iv, ...

templates      // 内容模板
  - id, name, content, variables, ...

config         // 应用配置
  - id, key, value, ...
```

### 2. Adapters 层

**职责**：实现各平台的发布逻辑

**设计模式**：策略模式 + 适配器模式

**接口定义**：

```typescript
interface PlatformAdapter {
  // 元数据
  id: PlatformId;
  name: string;
  capabilities: PlatformCapabilities;
  
  // 认证
  ensureAuth(ctx): Promise<AuthSession>;
  
  // 内容转换
  transform(post, ctx): Promise<PlatformPayload>;
  
  // 资源上传
  uploadAsset?(file, meta, ctx): Promise<AssetRemoteRef>;
  
  // 发布流程
  createDraft?(payload, ctx): Promise<PublishResult>;
  publish(payloadOrDraftId, ctx): Promise<PublishResult>;
  
  // DOM 自动化
  dom?: DOMAutomation;
}
```

**实现策略**：
- **API 优先**：优先使用官方 API（如 Medium）
- **DOM 自动化**：在编辑页面执行 DOM 操作（如知乎、掘金）
- **混合模式**：API + DOM 结合（如微信）

### 3. Background Service Worker

**职责**：任务编排、消息路由、定时器管理

**核心流程**：

```typescript
// 任务状态机
IDLE → PREPARE → AUTH → TRANSFORM 
    → ASSET_UPLOAD → CREATE_DRAFT 
    → PUBLISH → VERIFY → DONE | FAILED
    
// 错误重试
FAILED → (exponential backoff) → RETRY (max 3 times)
```

**消息类型**：
- `CREATE_JOB`: 创建发布任务
- `START_JOB`: 启动任务
- `CANCEL_JOB`: 取消任务
- `GET_JOB_STATUS`: 查询任务状态
- `COLLECT_CONTENT`: 采集网页内容

### 4. Content Scripts

**职责**：在目标网站执行内容采集和 DOM 自动化

**注入策略**：
- `run_at: document_idle`: 在页面加载完成后注入
- 按域名匹配：只在指定平台网站注入

**主要功能**：
1. **内容采集**：使用 Readability 提取文章
2. **DOM 自动化**：填充表单、上传图片、点击发布
3. **状态反馈**：向 background 报告执行进度

### 5. UI 层

**技术栈**：Vue 3 + Naive UI + UnoCSS + Pinia

**页面组成**：

#### Popup（弹出窗口）
- 快速采集当前页
- 查看最近草稿
- 任务进度展示

#### Options（设置页面）
- **仪表盘**：统计数据、最近活动
- **文章管理**：草稿列表、编辑、删除
- **账号管理**：绑定/解绑平台账号
- **任务中心**：查看任务状态、重试失败任务
- **设置**：全局配置、数据导入导出

#### SidePanel（侧边栏）
- 编辑器预览
- 平台差异化设置

## 数据流转

### 采集流程

```
用户浏览文章页面
  ↓
点击"采集"按钮
  ↓
Content Script 提取内容 (Readability)
  ↓
转换为 Markdown (Turndown)
  ↓
保存到 IndexedDB (posts表)
  ↓
打开编辑器页面
```

### 发布流程

```
用户在编辑器完成编辑
  ↓
选择目标平台 + 账号
  ↓
创建 Job (PENDING状态)
  ↓
Background 启动任务
  ↓
逐平台执行：
  1. 检查认证
  2. 转换内容格式
  3. 上传图片/视频
  4. 创建草稿（可选）
  5. 发布
  6. 保存平台映射
  ↓
更新 Job 状态 (DONE/FAILED)
  ↓
发送浏览器通知
```

## 安全设计

### 1. 凭证存储

- 使用 WebCrypto API 加密敏感信息
- 密钥派生：用户密码 → PBKDF2 → AES-GCM Key
- 会话管理：chrome.storage.session 保持解锁状态

### 2. 权限最小化

- 仅请求必要的 host_permissions
- 按平台限定域名白名单
- 不跨域持久化 Cookie

### 3. CSP 策略

```
script-src 'self'
object-src 'self'
```

## 性能优化

### 1. 代码分割

- 按平台懒加载适配器
- UI 组件按路由分割
- 使用 Vite 的 tree-shaking

### 2. 资源处理

- 图片在 Offscreen Document 中转码（避免阻塞主线程）
- 使用 WebP 格式压缩
- 大文件分块上传

### 3. 数据库优化

- 合理使用索引
- 批量操作使用事务
- 定期清理过期日志

## 扩展性设计

### 1. 插件化适配器

每个平台适配器独立开发和维护：

```typescript
// 注册新适配器
import { registry } from '@synccaster/adapters';
import { myAdapter } from './my-adapter';

registry.register(myAdapter);
```

### 2. 内容转换管道

使用 unified/remark/rehype 生态：

```typescript
const pipeline = unified()
  .use(remarkParse)        // MD → AST
  .use(remarkGfm)          // GitHub Flavored Markdown
  .use(remarkRehype)       // MD AST → HTML AST
  .use(rehypeSanitize)     // 安全过滤
  .use(rehypeStringify);   // HTML AST → HTML String
```

### 3. 模板系统

支持自定义模板变量：

```markdown
# {{title}}

{{content}}

---
原文链接：{{canonicalUrl}}
发布于：{{date}}
```

## 未来规划

### Phase 1: MVP（已完成）
- ✅ 核心架构
- ✅ 微信、知乎、掘金适配器
- ✅ 基础 UI
- ✅ 任务队列

### Phase 2: 增强功能
- [ ] 富文本编辑器（TipTap）
- [ ] 图片处理（压缩、水印）
- [ ] 代码高亮/公式渲染
- [ ] 更多平台（CSDN、简书、Medium、今日头条）

### Phase 3: 高级特性
- [ ] 内容模板系统
- [ ] 排期发布
- [ ] 数据分析（阅读量统计）
- [ ] 云端同步（可选）

### Phase 4: 生态建设
- [ ] 插件市场
- [ ] 第三方适配器
- [ ] API 开放
- [ ] 桌面客户端
