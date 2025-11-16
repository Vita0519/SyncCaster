import type { PlatformAdapter } from './base';

/**
 * 知乎适配器
 */
export const zhihuAdapter: PlatformAdapter = {
  id: 'zhihu',
  name: '知乎',
  icon: 'zhihu',
  capabilities: {
    domAutomation: true,
    supportsHtml: true,
    supportsMarkdown: false,
    supportsTags: true,
    supportsCategories: false,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: {
      rpm: 30,
      concurrent: 1,
    },
  },

  async ensureAuth({ account }) {
    // 知乎主要依赖 Cookie 认证
    return {
      type: 'cookie',
      valid: true,
    };
  },

  async transform(post, { config }) {
    // 知乎编辑器支持 HTML
    return {
      title: post.title,
      contentHtml: post.body_md,
      cover: post.cover,
      tags: post.tags?.slice(0, 5), // 知乎最多5个标签
      summary: post.summary,
    };
  },

  async publish(payload, ctx) {
    // 知乎主要使用 DOM 自动化
    const title = typeof payload === 'string' ? 'draft' : payload.title;
    ctx.logger({
      level: 'info',
      step: 'publish',
      message: `准备发布到知乎: ${title}`,
    });
    
    return {
      url: 'https://zhuanlan.zhihu.com/...',
    };
  },

  dom: {
    matchers: [
      'https://zhuanlan.zhihu.com/write',
      'https://zhuanlan.zhihu.com/p/*/edit',
    ],
    async fillAndPublish(payload) {
      // TODO: 知乎 DOM 自动化
      // 1. 定位标题输入框
      // 2. 填充标题
      // 3. 定位内容编辑器（contenteditable）
      // 4. 粘贴 HTML
      // 5. 设置封面和标签
      // 6. 点击发布
      
      return {
        url: window.location.href,
      };
    },
  },
};
