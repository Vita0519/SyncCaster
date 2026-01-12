import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 百家号适配器
 *
 * 平台特点：
 * - 入口：https://baijiahao.baidu.com/builder/rc/edit 或相关写作页面
 * - 编辑器：UEditor 富文本（内容在 iframe 中）
 * - 标题：contenteditable div
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
    // 百家号不支持 LaTeX 渲染：去掉 $ 包裹符号，公式以纯文本形式显示
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

      const titleText = String((payload as any).title || '').trim();
      const html = String((payload as any).contentHtml || '');
      const markdown = String((payload as any).contentMarkdown || '');

      // 1) 填充标题 - 百家号标题在 contenteditable div 中
      if (titleText) {
        await sleep(1000); // 等待页面加载
        
        const titleEditor = await waitFor(() => {
          // 百家号标题输入框在 .client_components_titleInput 内的 contenteditable div
          const candidates = [
            document.querySelector('.client_components_titleInput [contenteditable="true"]'),
            document.querySelector('.client_pages_edit_components_titleInput [contenteditable="true"]'),
            document.querySelector('[class*="titleInput"] [contenteditable="true"]'),
          ];
          return (candidates.find(el => el) as HTMLElement) || null;
        }, 10000);

        if (titleEditor) {
          titleEditor.focus();
          // 清空现有内容
          titleEditor.innerHTML = '';
          // 使用 document.execCommand 插入文本
          document.execCommand('insertText', false, titleText);
          // 如果 execCommand 不生效，使用备用方案
          if (!titleEditor.textContent) {
            titleEditor.innerHTML = `<p dir="auto">${titleText}</p>`;
          }
          titleEditor.dispatchEvent(new Event('input', { bubbles: true }));
          titleEditor.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[baijiahao] 标题填充成功');
        } else {
          console.log('[baijiahao] 未找到标题输入框');
        }
      }

      // 2) 等待编辑器加载
      await sleep(2500);

      // 3) 填充正文内容 - 百家号使用 UEditor，内容在 iframe 中
      // 将 markdown 转换为 HTML 段落格式
      const htmlContent = html || markdown.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
      
      console.log('[baijiahao] 开始填充正文内容，长度:', htmlContent.length);

      let filled = false;

      // 方法1：通过 iframe 的 window 对象访问 UEditor API（最可靠）
      // 百家号的 UEditor 实例在 iframe 的 window 中，不在主 window 中
      const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
      console.log('[baijiahao] 找到 iframe 数量:', iframes.length);
      
      for (const iframe of iframes) {
        if (filled) break;
        try {
          const iframeWin = iframe.contentWindow as any;
          const iframeDoc = iframe.contentDocument || iframeWin?.document;
          if (!iframeWin || !iframeDoc) continue;
          
          console.log('[baijiahao] 检查 iframe:', iframe.id || iframe.className || 'unnamed');
          
          // 尝试通过 iframe window 访问 UEditor
          // 方式1: UE.getEditor 或 UE.instants
          if (!filled && iframeWin.UE) {
            console.log('[baijiahao] 在 iframe 中找到 UE 对象');
            // 尝试 getEditor
            if (typeof iframeWin.UE.getEditor === 'function') {
              try {
                const editor = iframeWin.UE.getEditor('ueditor');
                if (editor && typeof editor.setContent === 'function') {
                  editor.setContent(htmlContent);
                  console.log('[baijiahao] 通过 iframe UE.getEditor 填充成功');
                  filled = true;
                  continue;
                }
              } catch (e) {
                console.log('[baijiahao] UE.getEditor 失败:', e);
              }
            }
            // 尝试 instants
            if (!filled && iframeWin.UE.instants) {
              const keys = Object.keys(iframeWin.UE.instants);
              console.log('[baijiahao] UE.instants keys:', keys);
              for (const key of keys) {
                try {
                  const editor = iframeWin.UE.instants[key];
                  if (editor && typeof editor.setContent === 'function') {
                    editor.setContent(htmlContent);
                    console.log('[baijiahao] 通过 iframe UE.instants 填充成功, key:', key);
                    filled = true;
                    break;
                  }
                } catch (e) {
                  console.log('[baijiahao] UE.instants 调用失败:', e);
                }
              }
            }
          }
          
          // 方式2: 全局 ue 变量
          if (!filled && iframeWin.ue && typeof iframeWin.ue.setContent === 'function') {
            try {
              iframeWin.ue.setContent(htmlContent);
              console.log('[baijiahao] 通过 iframe 全局 ue 变量填充成功');
              filled = true;
              continue;
            } catch (e) {
              console.log('[baijiahao] iframe ue 变量调用失败:', e);
            }
          }
          
          // 方式3: 直接操作 iframe body（UEditor 的编辑区域是 body contenteditable）
          if (!filled) {
            const iframeBody = iframeDoc.body;
            if (iframeBody && (iframeBody.contentEditable === 'true' || iframeBody.getAttribute('contenteditable') === 'true')) {
              iframeBody.focus();
              iframeBody.innerHTML = htmlContent;
              iframeBody.dispatchEvent(new Event('input', { bubbles: true }));
              console.log('[baijiahao] 通过 iframe body innerHTML 填充成功');
              filled = true;
              continue;
            }
          }
        } catch (e) {
          console.log('[baijiahao] iframe 访问失败:', e);
        }
      }

      // 方法2：尝试主 window 的 UEditor（某些版本可能在主 window）
      if (!filled) {
        const win = window as any;
        
        // 尝试 UE_V2 (新版 UEditor)
        if (!filled && win.UE_V2 && win.UE_V2.instants) {
          const keys = Object.keys(win.UE_V2.instants);
          console.log('[baijiahao] 主 window UE_V2.instants keys:', keys);
          for (const key of keys) {
            try {
              const editor = win.UE_V2.instants[key];
              if (editor && typeof editor.setContent === 'function') {
                editor.setContent(htmlContent);
                console.log('[baijiahao] 通过主 window UE_V2 API 填充成功, key:', key);
                filled = true;
                break;
              }
            } catch (e) {
              console.log('[baijiahao] UE_V2 API 调用失败:', e);
            }
          }
        }
        
        // 尝试 UE (旧版 UEditor)
        if (!filled && win.UE && win.UE.instants) {
          const keys = Object.keys(win.UE.instants);
          console.log('[baijiahao] 主 window UE.instants keys:', keys);
          for (const key of keys) {
            try {
              const editor = win.UE.instants[key];
              if (editor && typeof editor.setContent === 'function') {
                editor.setContent(htmlContent);
                console.log('[baijiahao] 通过主 window UE API 填充成功, key:', key);
                filled = true;
                break;
              }
            } catch (e) {
              console.log('[baijiahao] UE API 调用失败:', e);
            }
          }
        }
        
        // 尝试全局 ue 变量
        if (!filled && win.ue && typeof win.ue.setContent === 'function') {
          try {
            win.ue.setContent(htmlContent);
            console.log('[baijiahao] 通过主 window 全局 ue 变量填充成功');
            filled = true;
          } catch (e) {
            console.log('[baijiahao] 全局 ue 变量调用失败:', e);
          }
        }
      }

      // 方法3：降级到主文档中的 contenteditable 元素（排除标题区域）
      if (!filled) {
        const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
        // 排除标题区域
        const filtered = candidates.filter(el => {
          const className = el.className || '';
          const parentClassName = el.parentElement?.className || '';
          const id = el.id || '';
          // 排除标题相关元素
          if (/title/i.test(className) || /title/i.test(parentClassName) || /title/i.test(id)) {
            return false;
          }
          // 排除太小的元素
          const rect = el.getBoundingClientRect();
          if (rect.width < 200 || rect.height < 100) {
            return false;
          }
          return true;
        });
        
        // 按面积排序，取最大的
        filtered.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        });
        
        if (filtered.length > 0) {
          const contentEditor = filtered[0];
          contentEditor.focus();
          contentEditor.innerHTML = htmlContent;
          contentEditor.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[baijiahao] 通过 contenteditable 降级填充成功');
          filled = true;
        }
      }

      if (!filled) {
        console.log('[baijiahao] 未找到编辑器元素，内容填充失败');
      }

      await sleep(500);
      return { editUrl: window.location.href, url: window.location.href } as any;
    },
  },
};
