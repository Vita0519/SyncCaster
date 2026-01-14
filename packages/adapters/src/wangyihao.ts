import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 网易号适配器
 *
 * 平台特点：
 * - 入口：https://mp.163.com/
 * - 编辑器：Draft.js 富文本编辑器
 * - 不支持：Markdown 识别、表格、数学公式、超链接、代码块
 *
 * 发布策略：
 * - 将 Markdown 转换为简化的 HTML 格式
 * - 使用模拟粘贴事件注入内容（Draft.js 需要通过粘贴事件来正确处理内容）
 * - 不执行最终发布操作，由用户手动完成
 *
 * 已知限制：
 * - 网易号 Draft.js 编辑器对 HTML 粘贴支持有限
 * - 不支持超链接（<a> 标签会被忽略）
 * - 不支持代码块（会被转为普通文本）
 */

export const wangyihaoAdapter: PlatformAdapter = {
  id: 'wangyihao',
  name: '网易号',
  kind: 'dom',
  icon: 'wangyihao',
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
    // 网易号不支持 LaTeX/表格/代码块/超链接等复杂结构
    // 这里做降级处理，转换为网易号能识别的简单格式
    let markdown = post.body_md || '';

    // 公式降级：转为纯文本
    markdown = markdown.replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr) => `\n${String(expr).trim()}\n`);
    markdown = markdown.replace(/\$([^$\n]+)\$/g, (_m, expr) => String(expr).trim());

    // 代码块降级：转为纯文本（网易号不支持代码块）
    markdown = markdown.replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code) => {
      return '\n' + String(code).trim() + '\n';
    });

    // 行内代码降级：去掉反引号
    markdown = markdown.replace(/`([^`]+)`/g, '$1');

    // 超链接降级：只保留链接文本（网易号不支持超链接）
    // [text](url) -> text
    markdown = markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

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
    throw new Error('wangyihao: use DOM automation');
  },

  dom: {
    matchers: [
      'https://mp.163.com/*',
    ],
    getEditorUrl: () => 'https://mp.163.com/#/article-publish',
    fillAndPublish: async function (payload) {
      // 注意：此函数会被 `chrome.scripting.executeScript({ func })` 注入到目标页面执行。
      // 因此必须"完全自包含"，不能依赖模块作用域的函数/变量，否则会在页面里变成 undefined。
      try {
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

        /**
         * 将 HTML 转换为网易号 Draft.js 编辑器能识别的简化格式
         * 
         * 关键处理：
         * 1. 移除 <li> 内的 <p> 标签（避免多余换行）
         * 2. 移除 <a> 超链接标签（网易号不支持）
         * 3. 移除 <pre><code> 代码块（网易号不支持）
         */
        const normalizeHtmlForWangyihao = (rawHtml: string): string => {
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawHtml || '', 'text/html');
            const body = doc.body;

            // 1) 处理列表项：移除 <li> 内的 <p> 标签，直接保留内容
            // 这是导致多余换行的主要原因
            body.querySelectorAll('li').forEach((li) => {
              // 获取 li 内的所有 p 标签
              const paragraphs = li.querySelectorAll('p');
              paragraphs.forEach((p) => {
                // 将 p 的内容移动到 li 中，替换 p
                while (p.firstChild) {
                  p.parentNode?.insertBefore(p.firstChild, p);
                }
                p.remove();
              });
            });

            // 2) 超链接降级：只保留链接文本
            body.querySelectorAll('a').forEach((a) => {
              const text = a.textContent || '';
              const textNode = doc.createTextNode(text);
              a.replaceWith(textNode);
            });

            // 3) 代码块降级：转为普通段落
            body.querySelectorAll('pre').forEach((pre) => {
              const text = (pre.textContent || '').trim();
              const p = doc.createElement('p');
              p.textContent = text;
              pre.replaceWith(p);
            });

            // 4) 行内代码降级：去掉 code 标签，保留文本
            body.querySelectorAll('code').forEach((code) => {
              const text = code.textContent || '';
              const textNode = doc.createTextNode(text);
              code.replaceWith(textNode);
            });

            // 5) 标题降级：转换为粗体段落
            body.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
              const text = (h.textContent || '').trim();
              if (!text) {
                h.remove();
                return;
              }
              const p = doc.createElement('p');
              const strong = doc.createElement('strong');
              strong.textContent = text;
              p.appendChild(strong);
              h.replaceWith(p);
            });

            // 6) 表格降级：转为纯文本格式
            body.querySelectorAll('table').forEach((table) => {
              const rows = Array.from(table.querySelectorAll('tr'))
                .map((tr) =>
                  Array.from(tr.children)
                    .map((cell) => (cell.textContent || '').trim())
                    .join(' | ')
                )
                .filter((line) => line.trim().length > 0);
              const p = doc.createElement('p');
              p.textContent = rows.join('\n');
              table.replaceWith(p);
            });

            // 7) 清理空的 p 标签
            body.querySelectorAll('p').forEach((p) => {
              if (!(p.textContent || '').trim() && !p.querySelector('img')) {
                p.remove();
              }
            });

            return body.innerHTML || '';
          } catch (e) {
            console.log('[wangyihao] normalizeHtmlForWangyihao 失败，使用原始 HTML:', e);
            return rawHtml || '';
          }
        };

        /**
         * 将 HTML 转为纯文本
         */
        const htmlToPlainText = (html: string): string => {
          const div = document.createElement('div');
          div.innerHTML = html;
          return (div.innerText || div.textContent || '').trim();
        };

        /**
         * 模拟粘贴 HTML 内容到编辑器
         * 只触发一次粘贴事件，避免重复填充
         */
        const simulatePasteHtml = (target: HTMLElement, html: string, plain: string): boolean => {
          try {
            // 创建 DataTransfer 对象
            const dt: any =
              typeof (window as any).DataTransfer === 'function'
                ? new DataTransfer()
                : {
                    types: ['text/html', 'text/plain'],
                    getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? plain : ''),
                  };

            try {
              dt.setData?.('text/html', html);
              dt.setData?.('text/plain', plain);
            } catch {}

            // 创建粘贴事件
            let evt: Event;
            try {
              evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true } as any);
            } catch {
              evt = new Event('paste', { bubbles: true, cancelable: true });
            }
            
            // 注入 clipboardData
            try {
              Object.defineProperty(evt, 'clipboardData', { get: () => dt });
            } catch {}

            // 只在目标元素上触发一次粘贴事件
            return target.dispatchEvent(evt);
          } catch (e) {
            console.log('[wangyihao] simulatePasteHtml 失败:', e);
            return false;
          }
        };

        const titleText = String((payload as any).title || '').trim();
        const html = String((payload as any).contentHtml || '');
        const markdown = String((payload as any).contentMarkdown || '');

        console.log('[wangyihao] 开始填充内容，标题:', titleText?.substring(0, 20));

        // 等待页面加载完成
        await sleep(2000);

        // 1) 填充标题
        if (titleText) {
          const titleInput = await waitFor(() => {
            const neteaseTextarea = document.querySelector('textarea.netease-textarea') as HTMLTextAreaElement;
            if (neteaseTextarea) return neteaseTextarea;

            const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
            const candidates = textareas.filter((ta) => {
              const placeholder = ta.placeholder || '';
              return /标题/i.test(placeholder);
            });
            if (candidates.length > 0) return candidates[0];

            const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
            const inputCandidates = inputs.filter((i) => {
              const attrs = [i.placeholder || '', i.getAttribute('aria-label') || '', i.name || '', i.id || '', i.className || ''].join(' ');
              return /标题|title/i.test(attrs);
            });
            return inputCandidates[0] || null;
          }, 10000);

          if (titleInput) {
            titleInput.focus();
            const isTextarea = titleInput.tagName.toLowerCase() === 'textarea';
            const proto = isTextarea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(titleInput, titleText);
            } else {
              (titleInput as any).value = titleText;
            }
            try {
              titleInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: titleText, inputType: 'insertText' }));
            } catch {
              titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
            titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log('[wangyihao] 标题填充成功');
          } else {
            console.log('[wangyihao] 未找到标题输入框');
          }
          await sleep(500);
        }

        // 2) 等待编辑器加载
        await sleep(1000);

        // 3) 填充正文 - 网易号使用 Draft.js 编辑器
        const rawContentHtml = html || markdown.replace(/\n/g, '<br>');
        const contentHtml = normalizeHtmlForWangyihao(rawContentHtml);
        const plainText = htmlToPlainText(contentHtml);
        console.log('[wangyihao] 准备填充内容，HTML 长度:', contentHtml.length);
        console.log('[wangyihao] 处理后的 HTML:', contentHtml.substring(0, 500));

        // 查找 Draft.js 编辑器
        const editor = await waitFor(() => {
          // Draft.js 常见：.public-DraftEditor-content
          const draftEditor = document.querySelector('.public-DraftEditor-content') as HTMLElement | null;
          if (draftEditor) {
            if (draftEditor.getAttribute('contenteditable') === 'true' || (draftEditor as any).isContentEditable) return draftEditor;
            const ce = draftEditor.closest('[contenteditable="true"]') as HTMLElement | null;
            if (ce) return ce;
            return draftEditor;
          }

          // Draft.js 内部常见：data-contents="true"
          const dataContents = document.querySelector('[data-contents="true"]') as HTMLElement | null;
          if (dataContents) {
            const ce = dataContents.closest('[contenteditable="true"]') as HTMLElement | null;
            if (ce) return ce;
          }

          // 网易号可能使用其他编辑器容器
          const draftRoot = document.querySelector('.DraftEditor-root') as HTMLElement | null;
          if (draftRoot) {
            const content = draftRoot.querySelector('[contenteditable="true"]') as HTMLElement | null;
            if (content) return content;
          }

          // 更通用的可编辑文本框
          const roleTextbox = document.querySelector('[role="textbox"][contenteditable="true"]') as HTMLElement | null;
          if (roleTextbox) return roleTextbox;

          // 查找其他 contenteditable 元素
          const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
          const filtered = candidates.filter((el) => {
            const className = el.className || '';
            const parentClassName = el.parentElement?.className || '';
            // 排除标题输入框
            if (/title|标题/i.test(className) || /title|标题/i.test(parentClassName)) return false;
            // 排除不可见元素
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 200 || rect.height < 50) return false;
            return true;
          });
          filtered.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return rb.width * rb.height - ra.width * ra.height;
          });
          return filtered[0] || null;
        }, 30000);

        if (editor) {
          // 聚焦编辑器
          editor.focus();
          await sleep(200);

          // 点击编辑器以确保激活
          try {
            const rect = editor.getBoundingClientRect();
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + 30,
            });
            editor.dispatchEvent(clickEvent);
          } catch {}
          await sleep(200);

          // 确保光标在编辑器内
          try {
            const selection = window.getSelection();
            if (selection) {
              selection.removeAllRanges();
              const range = document.createRange();
              range.selectNodeContents(editor);
              range.collapse(false);
              selection.addRange(range);
            }
          } catch {}
          await sleep(100);

          console.log('[wangyihao] 编辑器已聚焦，开始填充内容');

          let filled = false;

          // 方法1：模拟粘贴事件（Draft.js 需要通过粘贴事件来正确处理内容）
          try {
            simulatePasteHtml(editor, contentHtml, plainText);
            await sleep(500);

            const textLen = (editor.textContent || '').trim().length;
            if (textLen >= 10) {
              console.log('[wangyihao] 粘贴事件填充成功，内容长度:', textLen);
              filled = true;
            }
          } catch (e) {
            console.log('[wangyihao] 粘贴事件填充失败:', e);
          }

          // 方法2：使用 execCommand insertText 作为备选
          if (!filled) {
            try {
              editor.focus();
              await sleep(100);
              
              document.execCommand('insertText', false, plainText);
              await sleep(300);

              const textLen = (editor.textContent || '').trim().length;
              if (textLen >= 10) {
                console.log('[wangyihao] insertText 填充成功，内容长度:', textLen);
                filled = true;
              }
            } catch (e) {
              console.log('[wangyihao] insertText 填充失败:', e);
            }
          }

          if (!filled) {
            const toast = document.createElement('div');
            toast.style.cssText =
              'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#b91c1c;color:#fff;padding:12px 24px;border-radius:8px;z-index:999999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
            toast.textContent = '网易号正文自动填充失败：请刷新页面后重试，或从 SyncCaster 复制正文并粘贴到编辑器';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 6500);
            console.log('[wangyihao] 正文自动填充失败');
          }

          await sleep(300);
        } else {
          console.log('[wangyihao] 未找到编辑器元素');
        }

        await sleep(300);
        return { editUrl: window.location.href, url: window.location.href } as any;
      } catch (e: any) {
        // 将错误结构化返回给 background
        const err = e instanceof Error ? e : new Error(String(e));
        console.error('[wangyihao] fillAndPublish failed', err);
        return {
          __synccasterError: {
            message: err.message || String(e),
            stack: err.stack || '',
          },
        } as any;
      }
    },
  },
};
