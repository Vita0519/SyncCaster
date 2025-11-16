import type { PlatformAdapter } from './base';

/**
 * 微信公众号适配器
 */
export const wechatAdapter: PlatformAdapter = {
  id: 'wechat',
  name: '微信公众号',
  icon: 'wechat',
  capabilities: {
    api: true,
    domAutomation: true,
    supportsHtml: true,
    supportsTags: false,
    supportsCategories: false,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'api',
    requiresBackend: true,
    rateLimit: {
      rpm: 60,
      concurrent: 1,
    },
  },

  async ensureAuth({ account }) {
    // TODO: 实现微信认证检查
    // 对 bridge 发起 token 刷新或检查
    return {
      type: 'wechat',
      valid: true,
      expiresAt: Date.now() + 3600_000,
    };
  },

  async transform(post, { config }) {
    // TODO: 实现 Markdown -> 微信安全 HTML 转换
    // 需要：
    // 1. 内联样式（微信不支持外链 CSS）
    // 2. 代码块处理（高亮或转图片）
    // 3. 图片处理（上传到微信或转本地）
    // 4. 表格简化或转图片
    
    return {
      title: post.title,
      contentHtml: post.body_md, // 临时直接使用
      cover: post.cover,
      summary: post.summary,
    };
  },

  async uploadAsset(file, meta, ctx) {
    // TODO: 调用 bridge 上传到微信
    ctx.logger({
      level: 'info',
      step: 'upload',
      message: `上传资源: ${meta.kind}`,
    });
    
    return {
      platform: 'wechat',
      remoteId: 'temp-media-id',
    };
  },

  async createDraft(payload, ctx) {
    // TODO: 调用 bridge 创建草稿
    ctx.logger({
      level: 'info',
      step: 'draft',
      message: `创建草稿: ${payload.title}`,
    });
    
    return {
      draftId: 'temp-draft-id',
      editUrl: 'https://mp.weixin.qq.com/...',
    };
  },

  async publish(draftId, ctx) {
    // TODO: 调用 bridge 发布
    ctx.logger({
      level: 'info',
      step: 'publish',
      message: `发布文章: ${draftId}`,
    });
    
    return {
      url: 'https://mp.weixin.qq.com/...',
      remoteId: String(draftId),
    };
  },

  dom: {
    matchers: ['https://mp.weixin.qq.com/*'],
    async fillAndPublish(payload) {
      // TODO: DOM 自动化实现
      // 1. 等待编辑器加载
      // 2. 填充标题
      // 3. 粘贴 HTML 内容
      // 4. 上传封面
      // 5. 点击发布
      
      return {
        url: window.location.href,
      };
    },
  },
};
