import type { PlatformAdapter } from './base';

/**
 * 微信公众号适配器
 * 
 * 平台特点：
 * - 入口：https://mp.weixin.qq.com/ -> 点击"文章"进入发布页
 * - 编辑器：富文本编辑器（不支持 Markdown）
 * - 结构：标题 + 作者 + 正文
 * - 不支持：Markdown、LaTeX
 * - 注意：Session 可能过期，需要重新登录
 */
export const wechatAdapter: PlatformAdapter = {
  id: 'wechat',
  name: '微信公众号',
  kind: 'dom',
  icon: 'wechat',
  capabilities: {
    domAutomation: true,
    supportsHtml: true,
    supportsMarkdown: false,
    supportsTags: false,
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
    // 微信只支持富文本，需要将 Markdown 转换为 HTML
    // 移除 LaTeX 公式标记
    let markdown = post.body_md;
    markdown = markdown.replace(/\$([^$\n]+)\$/g, '$1');
    markdown = markdown.replace(/\$\$([^$]+)\$\$/g, '\n$1\n');
    
    const contentHtml = (post as any)?.meta?.body_html || '';
    
    return {
      title: post.title,
      contentHtml,
      contentMarkdown: markdown,
      cover: post.cover,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('wechat: use DOM automation');
  },

  dom: {
    matchers: [
      'https://mp.weixin.qq.com/cgi-bin/appmsg*',
    ],
    async fillAndPublish(payload) {
      console.log('[wechat] fillAndPublish starting', payload);
      
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
        // 微信公众号编辑器结构：
        // - 标题：input[placeholder*="标题"]
        // - 作者：input[placeholder*="作者"]
        // - 正文：[contenteditable="true"]

        // 1. 填充标题
        console.log('[wechat] Step 1: 填充标题');
        const titleInput = await waitFor('#title, input[placeholder*="标题"]');
        (titleInput as HTMLInputElement).value = (payload as any).title || '';
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);

        // 2. 填充正文
        console.log('[wechat] Step 2: 填充正文');
        const content = (payload as any).contentHtml || (payload as any).contentMarkdown || '';
        
        const editor = await waitFor('#ueditor_0, [contenteditable="true"]');
        editor.focus();
        
        // 使用 HTML 粘贴
        if ((payload as any).contentHtml) {
          const dt = new DataTransfer();
          dt.setData('text/html', content);
          const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
          editor.dispatchEvent(pasteEvent);
        } else {
          editor.innerHTML = content;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await sleep(500);

        // 3. 微信公众号的发布流程比较复杂
        // 通常需要：保存草稿 -> 预览 -> 发布
        console.log('[wechat] Step 3: 保存草稿');
        const saveBtn = Array.from(document.querySelectorAll('button, a'))
          .find(el => /保存|草稿/.test(el.textContent || '')) as HTMLElement;
        if (saveBtn) {
          saveBtn.click();
          await sleep(2000);
        }

        // 微信公众号发布后通常不会跳转，返回当前页面 URL
        console.log('[wechat] 草稿已保存');
        return { url: window.location.href };
      } catch (error: any) {
        console.error('[wechat] 发布失败:', error);
        throw error;
      }
    },
  },
};
