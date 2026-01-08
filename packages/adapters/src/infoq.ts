import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * InfoQ（写作台 xie.infoq.cn）适配器
 *
 * 平台特点：
 * - 入口：https://xie.infoq.cn/
 * - 编辑器：富文本
 * - 需要先创建草稿才能进入编辑页（参考 cose：/api/v1/draft/create）
 *
 * 发布策略：
 * - transform: 将 Markdown 转 HTML
 * - dom.getEditorUrl: 尝试复用当前页面已登录 Cookie，通过 fetch 创建草稿并返回 draft URL
 * - dom.fillAndPublish: 在草稿页填充标题/正文（不点发布按钮）
 */
export const infoqAdapter: PlatformAdapter = {
  id: 'infoq',
  name: 'InfoQ',
  kind: 'dom',
  icon: 'infoq',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: false,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: false,
    supportsCover: true,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: { rpm: 15, concurrent: 1 },
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
    throw new Error('infoq: use DOM automation');
  },

  dom: {
    matchers: ['https://xie.infoq.cn/*'],

    // 在页面上下文创建草稿，返回编辑 URL
    getEditorUrl: async () => {
      // 参考 cose：POST https://xie.infoq.cn/api/v1/draft/create
      const endpoint = 'https://xie.infoq.cn/api/v1/draft/create';

      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        throw new Error(`infoq create draft failed: HTTP ${res.status}`);
      }

      const data = await res.json();
      const draftId = data?.data?.id || data?.id || data?.data?.draftId;
      if (!draftId) {
        throw new Error('infoq create draft failed: missing draftId');
      }

      return `https://xie.infoq.cn/draft/${draftId}`;
    },

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
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      };

      const titleText = String((payload as any).title || '').trim();
      const html = String((payload as any).contentHtml || '');
      const markdown = String((payload as any).contentMarkdown || '');

      // 1) 标题
      if (titleText) {
        const titleInput = await waitFor(() => {
          const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
          const candidates = inputs.filter((i) => {
            const attrs = [i.placeholder || '', i.getAttribute('aria-label') || '', i.name || '', i.id || '', i.className || ''].join(' ');
            return /标题|title/i.test(attrs);
          });
          return candidates[0] || null;
        });
        setNativeValue(titleInput, titleText);
        await sleep(200);
      }

      // 2) 正文（contenteditable）
      const editor = await waitFor(() => {
        const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
        candidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        });
        return candidates[0] || null;
      });

      try {
        editor.focus();
      } catch {}

      try {
        if (html) {
          document.execCommand('selectAll');
          document.execCommand('insertHTML', false, html);
        } else {
          document.execCommand('selectAll');
          document.execCommand('insertText', false, markdown);
        }
      } catch {
        if (html) (editor as any).innerHTML = html;
        else editor.textContent = markdown;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }

      await sleep(300);
      return { editUrl: window.location.href, url: window.location.href } as any;
    },
  },
};
