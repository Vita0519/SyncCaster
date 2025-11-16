# SyncCaster - 多平台内容同步助手

一个现代化的浏览器扩展，实现一次编辑，多平台发布的内容同步功能。

## 📦 项目结构

```
synccaster/
├── apps/
│   ├── extension/          # 浏览器插件（MV3）
│   └── bridge/            # 云端桥接服务（可选）
├── packages/
│   ├── core/              # 核心模型、任务引擎
│   ├── adapters/          # 平台适配器
│   ├── editor/            # 编辑器集成
│   └── utils/             # 工具库
```

## 🚀 技术栈

- **Vue 3** + TypeScript - 现代化响应式框架
- **Vite** - 快速构建工具
- **Pinia** - 状态管理
- **Naive UI** - 组件库
- **UnoCSS** - 原子化 CSS
- **Dexie.js** - IndexedDB 封装
- **TipTap** - 富文本编辑器

## 🎯 支持平台

- ✅ 微信公众号
- ✅ 知乎
- ✅ 掘金
- ✅ CSDN
- ✅ 简书
- ✅ Medium
- ✅ 今日头条

## 📝 开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 测试
pnpm test
```

## 📖 文档

详见 [docs](./docs) 目录。

## 📄 License

MIT
