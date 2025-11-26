import type { PlatformAdapter } from './base';

/**
 * 知乎适配器
 * 
 * 平台特点：
 * - 入口：https://zhuanlan.zhihu.com/write
 * - 编辑器：富文本编辑器（不是 Markdown）
 * - 支持：HTML 内容粘贴
 * - LaTeX 公式：需通过"公式"插件输入，去除 $ 符号
 * - 结构：标题输入框 + 富文本正文
 */
export const zhihuAdapter: PlatformAdapter = {
  id: 'zhihu',
  name: '知乎',
  kind: 'dom',
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
    return { type: 'cookie', valid: true };
  },

  async transform(post, { config }) {
    // 知乎使用富文本编辑器，优先使用 HTML
    // 如果有采集的 HTML，使用它；否则用 Markdown
    const contentHtml = (post as any)?.meta?.body_html || '';
    const contentMarkdown = post.body_md;
    
    return {
      title: post.title,
      contentHtml,
      contentMarkdown,
      cover: post.cover,
      tags: post.tags?.slice(0, 5),
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('zhihu: use DOM automation');
  },

  dom: {
    matchers: [
      'https://zhuanlan.zhihu.com/write*',
    ],
    async fillAndPublish(payload) {
      console.log('[zhihu] fillAndPublish starting', payload);
      
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      
      async function waitFor(selector: string, timeout = 15000): Promise<HTMLElement> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const el = document.querySelector(selector);
          if (el) return el as HTMLElement;
          await sleep(200);
        }
        throw new Error(`等待元素超时: ${selector}`);
      }

      try {
        // 1. 填充标题
        console.log('[zhihu] Step 1: 填充标题');
        const titleInput = await waitFor('input[placeholder*="标题"], textarea[placeholder*="标题"]');
        (titleInput as HTMLInputElement).value = (payload as any).title || '';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);

        // 2. 填充内容 - 知乎使用 contenteditable 富文本编辑器
        console.log('[zhihu] Step 2: 填充内容');
        const content = (payload as any).contentHtml || (payload as any).contentMarkdown || '';
        
        const editor = await waitFor('[contenteditable="true"], .public-DraftEditor-content');
        editor.focus();
        
        // 优先使用 HTML 粘贴
        if ((payload as any).contentHtml) {
          const dt = new DataTransfer();
          dt.setData('text/html', content);
          const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
          editor.dispatchEvent(pasteEvent);
        } else {
          // 降级：直接设置文本
          editor.textContent = content;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep(500);

        // 3. 点击发布按钮
        console.log('[zhihu] Step 3: 点击发布按钮');
        const publishBtn = Array.from(document.querySelectorAll('button'))
          .find(btn => btn.textContent?.includes('发布')) as HTMLElement;
        if (!publishBtn) throw new Error('未找到发布按钮');
        publishBtn.click();
        await sleep(1500);

        // 4. 处理发布确认
        console.log('[zhihu] Step 4: 处理发布确认');
        const confirmBtn = Array.from(document.querySelectorAll('button'))
          .find(btn => /确认|发布/.test(btn.textContent || '')) as HTMLElement;
        if (confirmBtn) {
          confirmBtn.click();
          await sleep(2000);
        }

        // 5. 等待跳转获取文章 URL
        console.log('[zhihu] Step 5: 等待文章 URL');
        const checkUrl = () => /zhuanlan\.zhihu\.com\/p\/\d+/.test(window.location.href);
        for (let i = 0; i < 40; i++) {
          if (checkUrl()) {
            console.log('[zhihu] 发布成功:', window.location.href);
            return { url: window.location.href };
          }
          await sleep(500);
        }

        throw new Error('发布超时：未跳转到文章页');
      } catch (error: any) {
        console.error('[zhihu] 发布失败:', error);
        throw error;
      }
    },
  },
};
