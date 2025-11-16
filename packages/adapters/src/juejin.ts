import type { PlatformAdapter } from './base';

/**
 * 掘金适配器
 */
export const juejinAdapter: PlatformAdapter = {
  id: 'juejin',
  name: '掘金',
  icon: 'juejin',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsTags: true,
    supportsCategories: true,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: {
      rpm: 30,
      concurrent: 1,
    },
  },

  async ensureAuth({ account }) {
    return {
      type: 'cookie',
      valid: true,
    };
  },

  async transform(post, { config }) {
    // 掘金优先使用 Markdown
    return {
      title: post.title,
      contentMarkdown: post.body_md,
      cover: post.cover,
      tags: post.tags,
      categories: post.categories,
      summary: post.summary,
    };
  },

  async publish(payload, ctx) {
    const title = typeof payload === 'string' ? 'draft' : payload.title;
    ctx.logger({
      level: 'info',
      step: 'publish',
      message: `准备发布到掘金: ${title}`,
    });
    
    return {
      url: 'https://juejin.cn/post/...',
    };
  },

  dom: {
    matchers: [
      'https://juejin.cn/editor/drafts/*',
      'https://juejin.cn/post/*/edit',
    ],
    async fillAndPublish(payload) {
      // TODO: 掘金 DOM 自动化
      // 掘金编辑器支持 Markdown
      
      return {
        url: window.location.href,
      };
    },
  },
};
