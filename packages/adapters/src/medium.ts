import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * Medium 适配器
 *
 * 平台特点：
 * - 入口：https://medium.com/new-story
 * - 编辑器：富文本（contenteditable）
 * - 不支持：Markdown 识别
 * - 图片：通常可接受外链，但为兼容性这里不强制依赖外链
 *
 * 发布策略：
 * - 将 Markdown 转为 HTML 后粘贴/注入到编辑器
 * - 不执行最终发布操作，由用户手动完成
 */
export const mediumAdapter: PlatformAdapter = {
  id: 'medium',
  name: 'Medium',
  kind: 'dom',
  icon: 'medium',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: false,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: false,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: { rpm: 20, concurrent: 1 },
  },

  async ensureAuth() {
    return { type: 'cookie', valid: true };
  },

  async transform(post) {
    const markdown = post.body_md || '';
    const contentHtml = renderMarkdownToHtmlForPaste(markdown);

    return {
      title: post.title,
      contentMarkdown: markdown,
      contentHtml,
      tags: post.tags,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish() {
    throw new Error('medium: use DOM automation');
  },

  dom: {
    matchers: ['https://medium.com/new-story', 'https://medium.com/p/*/edit', 'https://medium.com/me/stories/drafts*'],
    fillAndPublish: async function (payload) {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const waitFor = async <T>(getter: () => T | null, timeoutMs = 45000): Promise<T> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const v = getter();
          if (v) return v;
          await sleep(200);
        }
        throw new Error('等待元素超时');
      };

      const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) desc.set.call(el, value);
        else (el as any).value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const normalizeText = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

      // 1) 标题：Medium 使用 h1[contenteditable]
      const titleText = String((payload as any).title || '').trim();
      if (titleText) {
        const titleEl = await waitFor(() => {
          const h1s = Array.from(document.querySelectorAll('h1')) as HTMLElement[];
          const candidates = h1s.filter((h) => h.isContentEditable);
          if (candidates.length === 0) return null;
          // 选择最靠上的那个
          candidates.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
          return candidates[0];
        });

        try {
          titleEl.focus();
        } catch {}
        titleEl.textContent = titleText;
        titleEl.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(200);
      }

      // 2) 正文：优先插入 HTML（contenteditable 的 article 区域）
      const html = String((payload as any).contentHtml || '');
      const markdown = String((payload as any).contentMarkdown || '');
      const bodyText = normalizeText(markdown);

      const editorRoot = await waitFor(() => {
        // Medium 编辑区通常为 article 内的 contenteditable 容器
        const editable = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
        // 过滤掉标题，选取面积更大的区域
        const candidates = editable
          .filter((el) => el.tagName !== 'H1')
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width * r.height > 20000;
          });
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        });
        return candidates[0];
      });

      try {
        editorRoot.focus();
      } catch {}

      // 尽量使用 execCommand 以触发 Medium 内部编辑器事件；失败再降级 innerHTML。
      try {
        if (html) {
          document.execCommand('selectAll');
          document.execCommand('insertHTML', false, html);
        } else if (bodyText) {
          document.execCommand('selectAll');
          document.execCommand('insertText', false, bodyText);
        }
      } catch {
        if (html) (editorRoot as any).innerHTML = html;
        else if (bodyText) editorRoot.textContent = bodyText;
        editorRoot.dispatchEvent(new Event('input', { bubbles: true }));
      }

      await sleep(300);

      // Medium 通常不会在填充后跳转到文章页；返回当前页面 URL 作为 editUrl 供用户确认。
      return { editUrl: window.location.href, url: window.location.href } as any;
    },
  },
};
