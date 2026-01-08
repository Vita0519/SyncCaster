import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 百家号适配器
 *
 * 平台特点：
 * - 入口：https://baijiahao.baidu.com/builder/rc/edit 或相关写作页面
 * - 编辑器：富文本
 * - 不支持：Markdown 识别
 *
 * 发布策略：
 * - 将 Markdown 转为 HTML 后注入编辑器
 * - 不执行最终发布操作，由用户手动完成
 */
export const baijiahaoAdapter: PlatformAdapter = {
  id: 'baijiahao',
  name: '百家号',
  kind: 'dom',
  icon: 'baijiahao',
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
    throw new Error('baijiahao: use DOM automation');
  },

  dom: {
    matchers: [
      'https://baijiahao.baidu.com/builder/rc/edit*',
      'https://baijiahao.baidu.com/builder/rc/create*',
      'https://author.baidu.com/builder/rc/edit*',
    ],
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

      // 2) 正文
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
