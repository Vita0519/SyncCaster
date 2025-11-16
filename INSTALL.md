# 安装指南

## 🚀 快速安装

### 步骤 1: 安装依赖

确保已安装 Node.js (>= 18) 和 PNPM

```bash
# 安装 PNPM
npm install -g pnpm

# 克隆项目
git clone https://github.com/your-repo/synccaster.git
cd synccaster

# 安装依赖
pnpm install
```

### 步骤 2: 构建扩展

```bash
# 开发模式（监听文件变化）
pnpm dev

# 或构建生产版本
pnpm build
```

### 步骤 3: 加载到浏览器

#### Chrome / Edge

1. 打开浏览器，访问 `chrome://extensions/`
2. 启用右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目的 `apps/extension/dist` 目录
5. 完成！扩展已安装

#### Firefox（待支持）

Firefox 支持即将推出...

## 📖 使用说明

### 首次使用

1. 点击浏览器工具栏的 SyncCaster 图标
2. 点击⚙️图标进入设置页面
3. 在"账号管理"中绑定你的平台账号
4. 开始使用！

### 采集文章

1. 浏览任意文章页面
2. 点击页面右下角的"📤 SyncCaster"按钮
3. 或点击扩展图标 → "📥 采集当前页"
4. 内容将自动保存到草稿箱

### 发布文章

1. 在扩展中点击"✍️ 新建文章"或编辑已有草稿
2. 完成编辑后，选择目标平台和账号
3. 点击"发布"按钮
4. 在任务中心查看发布进度

## 🔧 故障排除

### 扩展加载失败

- 确保已启用开发者模式
- 检查 dist 目录是否存在
- 尝试重新构建：`pnpm build`

### 采集功能不工作

- 检查当前网站是否支持采集
- 查看 DevTools Console 是否有错误
- 确保已授予必要权限

### 发布失败

- 检查账号是否已登录对应平台
- 查看任务中心的错误日志
- 某些平台可能需要手动登录

## 💡 提示

- 首次使用建议先测试采集和编辑功能
- 发布前可在编辑器中预览效果
- 重要内容建议先保存草稿再发布

## 🆘 获取帮助

- 查看文档：[docs/](./docs/)
- 提交 Issue：[GitHub Issues](https://github.com/your-repo/synccaster/issues)
- 加入讨论：[GitHub Discussions](https://github.com/your-repo/synccaster/discussions)
