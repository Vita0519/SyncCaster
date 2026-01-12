import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 今日头条（头条号）适配器
 *
 * 平台特点：
 * - 入口：https://mp.toutiao.com/profile_v4/graphic/publish 或 /profile_v4/graphic/publish
 * - 编辑器：ProseMirror 富文本
 * - 标题：textarea
 * - 不支持：Markdown 识别
 *
 * 发布策略：
 * - 将 Markdown 转换为 HTML 后注入编辑器
 * - 不执行最终发布操作，由用户手动完成
 */
export const toutiaoAdapter: PlatformAdapter = {
  id: 'toutiao',
  name: '今日头条',
  kind: 'dom',
  icon: 'toutiao',
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
    // 头条不支持 LaTeX 渲染：去掉 $ 包裹符号，公式以纯文本形式显示
    const contentHtml = renderMarkdownToHtmlForPaste(markdown, { stripMath: true });
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
    throw new Error('toutiao: use DOM automation');
  },

  dom: {
    matchers: [
      'https://mp.toutiao.com/profile_v4/graphic/publish*',
      'https://mp.toutiao.com/profile_v4/graphic/article/publish*',
      'https://mp.toutiao.com/profile_v4/graphic/publish',
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

      const titleText = String((payload as any).title || '').trim();
      const html = String((payload as any).contentHtml || '');
      const markdown = String((payload as any).contentMarkdown || '');

      // 1) 填充标题 - 头条使用 textarea
      if (titleText) {
        const titleInput = await waitFor(() => {
          // 头条标题是 textarea，placeholder 包含"标题"
          const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
          const candidates = textareas.filter((ta) => {
            const placeholder = ta.placeholder || '';
            return /标题/i.test(placeholder);
          });
          return candidates[0] || null;
        }, 10000);

        if (titleInput) {
          titleInput.focus();
          // 使用 native setter 来绕过 React 的受控组件
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(titleInput, titleText);
          } else {
            titleInput.value = titleText;
          }
          // 触发 React 能识别的事件
          titleInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: titleText, inputType: 'insertText' }));
          titleInput.dispatchEvent(new Event('change', { bubbles: true }));
          titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
          console.log('[toutiao] 标题填充成功:', titleText);
        } else {
          console.log('[toutiao] 未找到标题输入框');
        }
        await sleep(200);
      }

      // 2) 等待编辑器加载
      await sleep(500);

      // 3) 填充正文 - 头条使用 ProseMirror 富文本编辑器
      const editor = await waitFor(() => {
        return document.querySelector('.ProseMirror') as HTMLElement | null;
      }, 10000);

      if (editor) {
        editor.focus();
        
        // 使用 HTML 内容或将 markdown 转为简单 HTML
        const contentToFill = html || markdown.replace(/\n/g, '<br>');
        
        // 方法1：直接设置 innerHTML（ProseMirror 通常能识别）
        editor.innerHTML = contentToFill;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        console.log('[toutiao] 内容填充成功');
      } else {
        // 降级：尝试查找其他 contenteditable 元素
        const fallbackEditor = await waitFor(() => {
          const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
          candidates.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return rb.width * rb.height - ra.width * ra.height;
          });
          return candidates[0] || null;
        }, 5000).catch(() => null);

        if (fallbackEditor) {
          fallbackEditor.focus();
          const contentToFill = html || markdown.replace(/\n/g, '<br>');
          fallbackEditor.innerHTML = contentToFill;
          fallbackEditor.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[toutiao] 降级编辑器填充成功');
        } else {
          console.log('[toutiao] 未找到编辑器');
        }
      }

      await sleep(300);
      return { editUrl: window.location.href, url: window.location.href } as any;
    },
  },
};
