import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 开源中国适配器
 *
 * 平台特点：
 * - 入口：https://my.oschina.net/u/{userId}/blog/write（需要登录）
 * - 编辑器：支持 HTML 富文本编辑器和 Markdown 模式
 * - 支持：Markdown 格式
 * - 结构：标题 + 正文
 *
 * 发布策略：
 * - 使用 DOM 自动化填充内容
 * - 优先使用 Markdown 编辑器模式
 * - 不执行最终发布操作，由用户手动完成
 */
export const oschinaAdapter: PlatformAdapter = {
  id: 'oschina',
  name: '开源中国',
  kind: 'dom',
  icon: 'oschina',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsTags: true,
    supportsCategories: true,
    supportsCover: false,
    supportsSchedule: false,
    imageUpload: 'dom',
    rateLimit: {
      rpm: 30,
      concurrent: 1,
    },
  },

  async ensureAuth() {
    return { type: 'cookie', valid: true };
  },

  async transform(post) {
    const markdown = post.body_md || '';
    
    // 将 Markdown 转换为 HTML，确保图片链接被正确渲染为 <img> 标签
    // 这对于公式图片（来自 codecogs）和普通图片都很重要
    const contentHtml = renderMarkdownToHtmlForPaste(markdown);
    
    return {
      title: post.title,
      contentMarkdown: markdown,
      contentHtml: contentHtml,
      tags: post.tags,
      categories: post.categories,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish() {
    throw new Error('oschina: use DOM automation');
  },

  dom: {
    matchers: [
      // 开源中国发文页面需要用户 ID，使用通用入口
      'https://my.oschina.net/blog/write',
      'https://my.oschina.net/u/*/blog/write',
      'https://my.oschina.net/*/blog/write',
    ],
    // 动态生成编辑器 URL（需要用户 ID）
    getEditorUrl: (accountId?: string): string => {
      console.log('[oschina:getEditorUrl] accountId:', accountId);
      
      if (accountId) {
        // accountId 格式为 "oschina-{userId}" 或 "oschina_{userId}"，需要提取纯数字的 userId
        // 例如：oschina-9580420 -> 9580420
        let userId = accountId;
        
        // 移除平台前缀（支持连字符和下划线两种格式）
        if (accountId.startsWith('oschina-')) {
          userId = accountId.substring('oschina-'.length);
        } else if (accountId.startsWith('oschina_')) {
          userId = accountId.substring('oschina_'.length);
        }
        
        // 确保 userId 是有效的（非空且为纯数字）
        if (userId && userId.trim() && /^\d+$/.test(userId.trim())) {
          const url = `https://my.oschina.net/u/${userId.trim()}/blog/write`;
          console.log('[oschina:getEditorUrl] Generated URL:', url);
          return url;
        }

        // 兼容特殊 accountId（例如含有其它后缀）：尝试从字符串中提取 userId 数字片段（避免 Date.now() 13位时间戳）
        const m = userId.match(/(?:^|[^0-9])(\d{5,12})(?:[^0-9]|$)/);
        if (m?.[1]) {
          const url = `https://my.oschina.net/u/${m[1]}/blog/write`;
          console.log('[oschina:getEditorUrl] Generated URL (fallback):', url);
          return url;
        }
      }
      // 回退到通用入口（可能会重定向）
      console.log('[oschina:getEditorUrl] Using fallback URL');
      return 'https://my.oschina.net/blog/write';
    },
    fillAndPublish: async function (payload) {
      console.log('[oschina] fillAndPublish starting', payload);
      console.log('[oschina] Current URL:', window.location.href);
      
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

      // 检查当前 URL 是否是编辑页面
      const currentUrl = window.location.href;
      const isEditorPage = /\/blog\/write\b/i.test(currentUrl);
      
      if (!isEditorPage) {
        console.error('[oschina] 当前页面不是编辑页面，请检查 URL');
        console.log('[oschina] Expected URL pattern: /blog/write');
        console.log('[oschina] Current URL:', currentUrl);
        
        // 尝试从当前 URL 提取用户 ID 并跳转到编辑页
        const userIdMatch = currentUrl.match(/\/u\/(\d+)/);
        if (userIdMatch?.[1]) {
          const editorUrl = `https://my.oschina.net/u/${userIdMatch[1]}/blog/write`;
          console.log('[oschina] Redirecting to editor page:', editorUrl);
          window.location.href = editorUrl;
          return {
            url: editorUrl,
            __synccasterError: {
              message: '页面已重定向到编辑页，请重新发布',
              redirected: true,
            },
          } as any;
        }
        
        return {
          url: currentUrl,
          __synccasterError: {
            message: '当前页面不是编辑页面，请手动打开编辑页后重试',
          },
        } as any;
      }

      // 等待页面完全加载
      if (document.readyState !== 'complete') {
        console.log('[oschina] Waiting for page to load...');
        await new Promise<void>(resolve => {
          window.addEventListener('load', () => resolve(), { once: true });
          setTimeout(resolve, 5000);
        });
      }

      const isVisible = (el: Element) => {
        const he = el as HTMLElement;
        const win = he.ownerDocument?.defaultView || window;
        const style = win.getComputedStyle(he);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = he.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const getRectArea = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width * r.height;
      };

      const getAllDocs = (): Document[] => {
        const docs: Document[] = [document];
        const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument;
            if (doc) docs.push(doc);
          } catch {}
        }
        return docs;
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

      const waitFor = async <T>(getter: () => T | null, timeoutMs = 30000): Promise<T> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const v = getter();
          if (v) return v;
          await sleep(200);
        }
        throw new Error('等待元素超时');
      };

      const isLikelyTitle = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < 0 || rect.top > 320) return false;
        if (rect.height <= 0 || rect.height > 140) return false;
        const attrs = [
          el.getAttribute('placeholder') || '',
          el.getAttribute('aria-label') || '',
          el.getAttribute('name') || '',
          el.id || '',
          el.className || '',
        ].join(' ').toLowerCase();
        
        // 排除搜索框
        if (/search|搜索/.test(attrs)) return false;
        
        return /标题|title/i.test(attrs) || rect.width > 200;
      };

      // 查找标题输入框
      const findTitleField = (): HTMLElement | null => {
        // 开源中国发文页面的标题输入框选择器
        const selectors = [
          // 开源中国特有的选择器
          '.blog-editor input[placeholder*="标题"]',
          '.editor-header input[placeholder*="标题"]',
          '.write-header input[placeholder*="标题"]',
          '.article-title input',
          '.post-title input',
          // 通用选择器
          'input[placeholder*="标题"]',
          'input[placeholder*="请输入标题"]',
          'input[name="title"]',
          'input#title',
          '.blog-title input',
          '.title-input input',
          '.editor-title input',
        ];
        
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && isVisible(el)) {
            // 排除搜索框
            const className = (el.className || '').toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            if (className.includes('search') || placeholder.includes('搜索')) {
              continue;
            }
            console.log('[oschina] Found title via selector:', sel);
            return el as HTMLElement;
          }
        }
        
        // 回退：查找页面顶部的输入框（排除搜索框）
        const inputs = Array.from(document.querySelectorAll('input'))
          .filter(e => {
            if (!isVisible(e)) return false;
            if (e.type === 'hidden' || e.type === 'checkbox' || e.type === 'radio') return false;
            // 排除搜索框
            const className = (e.className || '').toLowerCase();
            const placeholder = (e.getAttribute('placeholder') || '').toLowerCase();
            const name = (e.getAttribute('name') || '').toLowerCase();
            if (className.includes('search') || placeholder.includes('搜索') || name.includes('search')) {
              return false;
            }
            return isLikelyTitle(e);
          });
        
        if (inputs.length > 0) {
          inputs.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.top - rectB.top;
          });
          console.log('[oschina] Found title via fallback:', inputs[0].tagName);
          return inputs[0];
        }
        
        return null;
      };

      // 填充 CodeMirror 5
      const tryFillCodeMirror5 = (markdown: string): boolean => {
        console.log('[oschina] Trying CodeMirror 5...');
        const all = getAllDocs().flatMap((doc) => Array.from(doc.querySelectorAll('.CodeMirror')) as any[]);
        const visibleCount = all.filter((e) => {
          try { return isVisible(e as any); } catch { return false; }
        }).length;
        console.log('[oschina] Found .CodeMirror elements:', all.length, '(visible:', visibleCount, ')');

        const withInstance = all.filter((cmEl) => cmEl?.CodeMirror?.setValue);
        const ordered = [
          ...withInstance.filter((e) => {
            try { return isVisible(e as any); } catch { return false; }
          }),
          ...withInstance.filter((e) => {
            try { return !isVisible(e as any); } catch { return true; }
          }),
        ];

        for (const cmEl of ordered) {
          const cm = cmEl?.CodeMirror;
          if (cm?.setValue) {
            console.log('[oschina] CodeMirror 5 instance found, setting value');
            try { cm.focus?.(); } catch {}
            try { (cmEl as HTMLElement)?.scrollIntoView?.({ block: 'center' }); } catch {}
            cm.setValue('');
            cm.setValue(markdown);
            cm.refresh?.();
            try {
              const ta = cmEl.querySelector?.('textarea') as HTMLTextAreaElement | null;
              ta?.dispatchEvent(new Event('input', { bubbles: true }));
            } catch {}
            return true;
          }
        }
        return false;
      };

      // 填充 textarea
      const tryFillTextarea = (markdown: string): boolean => {
        console.log('[oschina] Trying textarea...');
        const all = getAllDocs().flatMap((doc) => Array.from(doc.querySelectorAll('textarea')) as HTMLTextAreaElement[]);
        const candidates = all.filter((ta) => {
          const attrs = [
            ta.getAttribute('placeholder') || '',
            ta.getAttribute('aria-label') || '',
            ta.getAttribute('name') || '',
            ta.id || '',
            ta.className || '',
          ]
            .join(' ')
            .toLowerCase();
          if (/title|标题/i.test(attrs)) return false;
          return true;
        });

        const scored = candidates.map((ta) => {
          const area = getRectArea(ta);
          let visible = false;
          try { visible = isVisible(ta); } catch {}
          return { ta, area, visible };
        });

        console.log('[oschina] Found textareas:', scored.length);
        if (!scored.length) return false;

        scored.sort((a, b) => (Number(b.visible) - Number(a.visible)) || (b.area - a.area));
        const ta = scored[0].ta;
        console.log('[oschina] Using textarea:', ta.className, 'area=', scored[0].area, 'visible=', scored[0].visible);
        try { (ta as any).scrollIntoView?.({ block: 'center' }); } catch {}
        setNativeValue(ta, '');
        setNativeValue(ta, markdown);
        return true;
      };

      // 填充 contenteditable
      const tryFillContentEditable = async (markdown: string): Promise<boolean> => {
        console.log('[oschina] Trying contenteditable...');
        const editables = getAllDocs()
          .flatMap((doc) => Array.from(doc.querySelectorAll('[contenteditable="true"]')) as HTMLElement[])
          .filter(e => {
            try { return !isLikelyTitle(e as HTMLElement) && getRectArea(e) > 5000; } catch { return false; }
          }) as HTMLElement[];
        console.log('[oschina] Found contenteditable elements:', editables.length);
        if (!editables.length) return false;
        
        editables.sort((a, b) => getRectArea(b) - getRectArea(a));
        const target = editables[0];
        console.log('[oschina] Using contenteditable:', target.className, getRectArea(target));
        
        try { target.scrollIntoView?.({ block: 'center' }); } catch {}
        target.innerHTML = '';
        target.focus();
        await sleep(100);
        
        // 逐行插入
        const lines = markdown.split('\n');
        for (const line of lines) {
          const div = document.createElement('div');
          div.textContent = line || '\u200B';
          target.appendChild(div);
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(200);
        return true;
      };

      try {
        console.log('[oschina] Waiting for page initialization...');
        await sleep(300);
        
        console.log('[oschina] Page elements:');
        console.log('  - inputs:', document.querySelectorAll('input').length);
        console.log('  - textareas:', document.querySelectorAll('textarea').length);
        console.log('  - contenteditable:', document.querySelectorAll('[contenteditable="true"]').length);
        console.log('  - CodeMirror:', document.querySelectorAll('.CodeMirror').length);
        
        // 0. 切换到 Markdown 编辑器（如果存在切换按钮）
        console.log('[oschina] Step 0: 切换到 Markdown 编辑器');
        const switchToHtmlEditor = async (): Promise<boolean> => {
          const htmlSwitchSelectors = [
            'button:contains("HTML")',
            'a:contains("HTML")',
            '[data-type="html"]',
            '[data-editor="html"]',
            '.editor-switch-html',
            '.switch-html',
            '.html-tab',
            '.tab-html',
            '.editor-type-switch [data-type="html"]',
            '.editor-tabs [data-type="html"]',
            '.editor-mode-switch .html',
          ];

          const allButtons = Array.from(
            document.querySelectorAll(
              'button, a, [role="tab"], [role="radio"], [role="button"], label, .tab, .switch-item, .editor-type-switch *, .editor-tabs *, .editor-mode-switch *'
            )
          );

          const htmlButton = allButtons.find((el) => {
            const t = String(el.textContent || '').replace(/\\s+/g, '').toLowerCase();
            const isHtml = t === 'html' || t.includes('html编辑器') || t.includes('htmleditor') || t.includes('html');
            const isActive =
              el.classList.contains('active') ||
              el.classList.contains('selected') ||
              el.classList.contains('current') ||
              el.classList.contains('is-active') ||
              el.getAttribute('aria-selected') === 'true' ||
              el.getAttribute('aria-checked') === 'true' ||
              el.getAttribute('aria-pressed') === 'true' ||
              el.getAttribute('data-active') === 'true';
            return isHtml && !isActive && isVisible(el);
          });

          if (htmlButton) {
            console.log('[oschina] Found HTML switch button:', htmlButton.textContent?.trim());
            const clickable = (htmlButton as HTMLElement).closest(
              'button, a, [role=\"tab\"], [role=\"radio\"], [role=\"button\"], label'
            ) as HTMLElement | null;
            (clickable || (htmlButton as HTMLElement)).click();
            await sleep(250);
            return true;
          }

          for (const selector of htmlSwitchSelectors) {
            try {
              const el = document.querySelector(selector);
              if (el && isVisible(el)) {
                console.log('[oschina] Found HTML switch via selector:', selector);
                (el as HTMLElement).click();
                await sleep(250);
                return true;
              }
            } catch {}
          }

          // Fallback: find a toggle group that contains both HTML/Markdown
          try {
            const norm = (s: string) => (s || '').replace(/\\s+/g, '').toLowerCase();
            const isActive = (el: Element) => {
              const he = el as HTMLElement;
              return (
                he.classList.contains('active') ||
                he.classList.contains('selected') ||
                he.classList.contains('current') ||
                he.classList.contains('is-active') ||
                he.getAttribute('aria-selected') === 'true' ||
                he.getAttribute('aria-checked') === 'true' ||
                he.getAttribute('aria-pressed') === 'true' ||
                he.getAttribute('data-active') === 'true'
              );
            };

            const candidates = Array.from(
              document.querySelectorAll('button, a, [role=\"tab\"], [role=\"radio\"], [role=\"button\"], label, li, div, span')
            ).filter(isVisible);

            const containers = candidates
              .map((el) => ({ el, t: norm(el.textContent || '') }))
              .filter(({ t }) => t.includes('markdown') && (t.includes('html') || t.includes('html编辑器')))
              .sort((a, b) => getRectArea(a.el) - getRectArea(b.el));

            const container = containers[0]?.el as HTMLElement | undefined;
            if (container) {
              const inside = Array.from(
                container.querySelectorAll('button, a, [role=\"tab\"], [role=\"radio\"], [role=\"button\"], label, li, div, span')
              )
                .filter((el) => {
                  const t = norm(el.textContent || '');
                  return isVisible(el) && (t.includes('html') || t.includes('html编辑器'));
                })
                .find((el) => !isActive(el));

              if (inside) {
                console.log('[oschina] Found HTML switch via HTML/Markdown toggle');
                const clickable = (inside as HTMLElement).closest('button, a, [role=\"tab\"], [role=\"radio\"], [role=\"button\"], label') as HTMLElement | null;
                (clickable || (inside as HTMLElement)).click();
                await sleep(250);
                return true;
              }
            }
          } catch {}

          console.log('[oschina] No HTML switch button found, may already be in HTML mode');
          return false;
        };
        const switchToMarkdown = async (): Promise<boolean> => {
          // 查找 Markdown 切换按钮/标签
          const mdSwitchSelectors = [
            // 常见的 Markdown 切换按钮
            'button:contains("Markdown")',
            'a:contains("Markdown")',
            '[data-type="markdown"]',
            '[data-editor="markdown"]',
            '.editor-switch-markdown',
            '.switch-markdown',
            '.markdown-tab',
            '.tab-markdown',
            // 开源中国特有的选择器
            '.editor-type-switch [data-type="markdown"]',
            '.editor-tabs [data-type="markdown"]',
            '.editor-mode-switch .markdown',
          ];
          
          // 使用更通用的方式查找包含 "Markdown" 文本的按钮/链接
          const allButtons = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="radio"], [role="button"], label, .tab, .switch-item, .editor-type-switch *, .editor-tabs *, .editor-mode-switch *'));
          const mdButton = allButtons.find(el => {
            const text = el.textContent?.trim().toLowerCase() || '';
            const isMarkdown = text === 'markdown' || text.includes('markdown');
            // 排除已激活的按钮
            const isActive =
              el.classList.contains('active') ||
              el.classList.contains('selected') ||
              el.classList.contains('current') ||
              el.classList.contains('is-active') ||
              el.getAttribute('aria-selected') === 'true' ||
              el.getAttribute('aria-checked') === 'true' ||
              el.getAttribute('aria-pressed') === 'true' ||
              el.getAttribute('data-active') === 'true';
            return isMarkdown && !isActive && isVisible(el);
          });
          
          if (mdButton) {
            console.log('[oschina] Found Markdown switch button:', mdButton.textContent?.trim());
            const clickable = (mdButton as HTMLElement).closest('button, a, [role=\"tab\"], [role=\"radio\"], [role=\"button\"], label') as HTMLElement | null;
            (clickable || (mdButton as HTMLElement)).click();
            await sleep(250);
            return true;
          }
          
          // 尝试使用选择器查找
          for (const selector of mdSwitchSelectors) {
            try {
              const el = document.querySelector(selector);
              if (el && isVisible(el)) {
                console.log('[oschina] Found Markdown switch via selector:', selector);
                (el as HTMLElement).click();
                await sleep(250);
                return true;
              }
            } catch {}
          }

          // 兜底：开源中国编辑页可能提供 “HTML编辑器 / Markdown” 的格式切换
          try {
            const norm = (s: string) => (s || '').replace(/\s+/g, '').toLowerCase();
            const isActive = (el: Element) => {
              const he = el as HTMLElement;
              return (
                he.classList.contains('active') ||
                he.classList.contains('selected') ||
                he.classList.contains('current') ||
                he.classList.contains('is-active') ||
                he.getAttribute('aria-selected') === 'true' ||
                he.getAttribute('aria-checked') === 'true' ||
                he.getAttribute('aria-pressed') === 'true' ||
                he.getAttribute('data-active') === 'true'
              );
            };

            const candidates = Array.from(
              document.querySelectorAll('button, a, [role="tab"], [role="radio"], [role="button"], label, li, div, span')
            ).filter(isVisible);

            const containers = candidates
              .map((el) => ({ el, t: norm(el.textContent || '') }))
              .filter(({ t }) => t.includes('markdown') && (t.includes('html编辑器') || t.includes('html')))
              .sort((a, b) => getRectArea(a.el) - getRectArea(b.el));

            const container = containers[0]?.el as HTMLElement | undefined;
            if (container) {
              const inside = Array.from(
                container.querySelectorAll('button, a, [role="tab"], [role="radio"], [role="button"], label, li, div, span')
              )
                .filter((el) => isVisible(el) && norm(el.textContent || '').includes('markdown'))
                .find((el) => !isActive(el));

              if (inside) {
                console.log('[oschina] Found Markdown switch via HTML/Markdown toggle');
                const clickable = (inside as HTMLElement).closest('button, a, [role="tab"], [role="radio"], [role="button"], label') as HTMLElement | null;
                (clickable || (inside as HTMLElement)).click();
                await sleep(250);
                return true;
              }
            }
          } catch {}
          
          console.log('[oschina] No Markdown switch button found, may already be in Markdown mode');
          return false;
        };

        // 0.5 处理本地图片上传 - 先检查是否有本地图片需要上传
        const downloadedImages = (payload as any).__downloadedImages as Array<{ url: string; base64: string; mimeType: string }> | undefined;
        let processedHtml = String((payload as any).contentHtml || '');
        let processedMarkdown = String((payload as any).contentMarkdown || '');

        const hasLocalImages = downloadedImages && downloadedImages.length > 0 &&
          downloadedImages.some(img => img.url.startsWith('local://'));

        console.log('[oschina] 检查本地图片:', {
          hasDownloadedImages: !!downloadedImages,
          count: downloadedImages?.length || 0,
          hasLocalImages,
        });

        // 辅助函数：提取内容中的图片 URL
        const extractImageUrls = (text: string): Set<string> => {
          const urls = new Set<string>();
          // 匹配 Markdown 图片语法: ![alt](url)
          const mdImgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
          let match;
          while ((match = mdImgRegex.exec(text)) !== null) {
            if (match[1]) urls.add(match[1]);
          }
          // 匹配 HTML img 标签
          const htmlImgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
          while ((match = htmlImgRegex.exec(text)) !== null) {
            if (match[1]) urls.add(match[1]);
          }
          return urls;
        };

        // 如果有本地图片，先在 HTML 编辑器中上传
        if (hasLocalImages) {
          console.log('[oschina] 发现本地图片，先切换到 HTML 编辑器上传');

          // 切换到 HTML 编辑器
          await switchToHtmlEditor();
          await sleep(200);

          // 等待 HTML 编辑器出现
          await waitFor(
            () => {
              const docs = getAllDocs();
              const hasRich = docs.some((d) => d.querySelectorAll('.ql-editor, .ProseMirror, [contenteditable="true"]').length > 0);
              return hasRich ? ({} as any) : null;
            },
            8000
          ).catch(() => null);
          await sleep(100);

          // DOM 粘贴上传函数 - 在 HTML 编辑器中执行
          const tryDomPasteUploadInHtml = async (blob: Blob, mimeType: string): Promise<string | null> => {
            try {
              // 添加调试日志
              console.log('[oschina] 查找编辑器元素...');
              console.log('[oschina] .ql-editor:', document.querySelectorAll('.ql-editor').length);
              console.log('[oschina] .ProseMirror:', document.querySelectorAll('.ProseMirror').length);
              console.log('[oschina] [contenteditable]:', document.querySelectorAll('[contenteditable="true"]').length);
              console.log('[oschina] iframe:', document.querySelectorAll('iframe').length);

              // 查找 HTML 编辑器元素（优先富文本编辑器）
              const editors: Element[] = [
                // Quill 编辑器
                ...Array.from(document.querySelectorAll('.ql-editor')),
                // ProseMirror 编辑器
                ...Array.from(document.querySelectorAll('.ProseMirror')),
                // 开源中国可能使用的编辑器 class
                ...Array.from(document.querySelectorAll('.editor-content')),
                ...Array.from(document.querySelectorAll('.rich-editor')),
                ...Array.from(document.querySelectorAll('.content-editor')),
                ...Array.from(document.querySelectorAll('.blog-editor')),
                ...Array.from(document.querySelectorAll('.write-editor')),
                ...Array.from(document.querySelectorAll('.article-editor')),
                ...Array.from(document.querySelectorAll('.edui-body-container')),
                ...Array.from(document.querySelectorAll('.w-e-text')),
                ...Array.from(document.querySelectorAll('.note-editable')),
                // iframe 中的编辑器
                ...Array.from(document.querySelectorAll('iframe')).flatMap(iframe => {
                  try {
                    const iframeDoc = (iframe as HTMLIFrameElement).contentDocument || (iframe as HTMLIFrameElement).contentWindow?.document;
                    if (iframeDoc) {
                      const iframeEditors = Array.from(iframeDoc.querySelectorAll('body[contenteditable="true"], [contenteditable="true"]'));
                      console.log('[oschina] iframe 内编辑器数量:', iframeEditors.length);
                      return iframeEditors;
                    }
                  } catch (e) {
                    console.log('[oschina] 无法访问 iframe:', e);
                  }
                  return [];
                }),
                // 通用 contenteditable 元素（面积大于 2000）
                ...Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(e => getRectArea(e) > 2000),
              ];

              // 去重
              const uniqueEditors = [...new Set(editors)];
              console.log('[oschina] 找到编辑器元素数量:', uniqueEditors.length);

              if (uniqueEditors.length === 0) {
                console.log('[oschina] 未找到 HTML 编辑器元素');
                return null;
              }

              const editor = uniqueEditors[0] as HTMLElement;
              console.log('[oschina] 使用 HTML 编辑器元素:', editor.className || editor.tagName, 'nodeName:', editor.nodeName);

              // 辅助函数：获取编辑器内容（支持多种编辑器类型）
              const getEditorContent = (): string => {
                // Quill 编辑器
                const qlEditor = document.querySelector('.ql-editor');
                if (qlEditor) return qlEditor.innerHTML || '';
                // ProseMirror 编辑器
                const pm = document.querySelector('.ProseMirror');
                if (pm) return pm.innerHTML || '';
                // 其他常见编辑器
                const editorSelectors = [
                  '.editor-content', '.rich-editor', '.content-editor',
                  '.blog-editor', '.write-editor', '.article-editor',
                  '.edui-body-container', '.w-e-text', '.note-editable'
                ];
                for (const sel of editorSelectors) {
                  const el = document.querySelector(sel);
                  if (el) return (el as HTMLElement).innerHTML || '';
                }
                // iframe 中的编辑器
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                  try {
                    const iframeDoc = (iframe as HTMLIFrameElement).contentDocument || (iframe as HTMLIFrameElement).contentWindow?.document;
                    if (iframeDoc) {
                      const body = iframeDoc.body;
                      if (body && body.getAttribute('contenteditable') === 'true') {
                        return body.innerHTML || '';
                      }
                      const ce = iframeDoc.querySelector('[contenteditable="true"]') as HTMLElement;
                      if (ce) return ce.innerHTML || '';
                    }
                  } catch {}
                }
                // 通用 contenteditable 元素
                const ce = document.querySelector('[contenteditable="true"]') as HTMLElement;
                if (ce && getRectArea(ce) > 2000) return ce.innerHTML || '';
                return '';
              };

              // 辅助函数：等待新的图片 URL 出现
              const waitForNewImageUrl = async (
                beforeUrls: Set<string>,
                timeoutMs: number
              ): Promise<string | null> => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                  const currentContent = getEditorContent();
                  const currentUrls = extractImageUrls(currentContent);

                  for (const url of currentUrls) {
                    if (!url) continue;
                    if (beforeUrls.has(url)) continue;
                    if (url.startsWith('data:') || url.startsWith('blob:')) continue;
                    if (url.startsWith('local://')) continue;
                    console.log('[oschina] 检测到新图片 URL:', url);
                    return url;
                  }

                  await sleep(300);
                }
                return null;
              };

              // 创建 File 对象
              const ext = mimeType.includes('png') ? 'png' : mimeType.includes('gif') ? 'gif' : 'jpg';
              const file = new File([blob], `image_${Date.now()}.${ext}`, { type: mimeType });

              // 创建 DataTransfer 对象
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(file);

              // 记录粘贴前的所有图片 URL
              const beforeContent = getEditorContent();
              const beforeUrls = extractImageUrls(beforeContent);
              console.log('[oschina] 粘贴前图片 URL 数量:', beforeUrls.size);

              // 聚焦编辑器
              editor.focus?.();

              // 使用 Object.defineProperty 设置 clipboardData
              console.log('[oschina] 尝试在 HTML 编辑器中粘贴上传');
              const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
              Object.defineProperty(pasteEvent, 'clipboardData', {
                get: () => dataTransfer,
                configurable: true
              });

              // 尝试多个可能的目标元素
              const targets = [
                editor,
                document.querySelector('.ql-editor'),
                document.querySelector('.ProseMirror'),
                document.activeElement,
              ].filter(Boolean) as Element[];

              let dispatched = false;
              for (const target of targets) {
                try {
                  dispatched = target.dispatchEvent(pasteEvent);
                  console.log('[oschina] 粘贴事件触发到', (target as HTMLElement).className || target.tagName, ':', dispatched);
                  if (dispatched) break;
                } catch (e) {
                  console.log('[oschina] 粘贴失败:', e);
                }
              }

              // 等待新 URL 出现（最多 3 秒）
              let newUrl = await waitForNewImageUrl(beforeUrls, 3000);
              if (newUrl) {
                console.log('[oschina] HTML 编辑器粘贴上传成功，新图片 URL:', newUrl);
                return newUrl;
              }

              // 方法2: 使用 DragEvent
              console.log('[oschina] 粘贴未检测到新图片，尝试拖拽上传');
              const dropDataTransfer = new DataTransfer();
              dropDataTransfer.items.add(file);

              const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true });
              Object.defineProperty(dragOverEvent, 'dataTransfer', { get: () => dropDataTransfer });

              const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true });
              Object.defineProperty(dropEvent, 'dataTransfer', { get: () => dropDataTransfer });

              for (const target of targets) {
                try {
                  target.dispatchEvent(dragOverEvent);
                  dispatched = target.dispatchEvent(dropEvent);
                  console.log('[oschina] 拖拽事件触发到', (target as HTMLElement).className || target.tagName, ':', dispatched);
                  if (dispatched) break;
                } catch (e) {
                  console.log('[oschina] 拖拽失败:', e);
                }
              }

              // 再次等待新 URL 出现（最多 3 秒）
              newUrl = await waitForNewImageUrl(beforeUrls, 3000);
              if (newUrl) {
                console.log('[oschina] HTML 编辑器拖拽上传成功，新图片 URL:', newUrl);
                return newUrl;
              }

              console.log('[oschina] HTML 编辑器上传未检测到新图片');
              return null;
            } catch (e) {
              console.error('[oschina] HTML 编辑器上传失败:', e);
              return null;
            }
          };

          // 上传每张图片并替换 URL
          for (const img of downloadedImages!) {
            if (!img.url.startsWith('local://')) {
              console.log('[oschina] 跳过非本地图片:', img.url);
              continue;
            }

            console.log('[oschina] 上传本地图片:', img.url);

            try {
              const response = await fetch(img.base64);
              const blob = await response.blob();
              console.log('[oschina] Blob 创建成功, size:', blob.size);

              const newUrl = await tryDomPasteUploadInHtml(blob, img.mimeType);

              if (newUrl) {
                const escapedUrl = img.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                processedHtml = processedHtml.replace(new RegExp(escapedUrl, 'g'), newUrl);
                processedMarkdown = processedMarkdown.replace(new RegExp(escapedUrl, 'g'), newUrl);
                console.log('[oschina] 图片 URL 替换成功:', img.url, '->', newUrl);
              } else {
                console.warn('[oschina] 图片上传失败，保留原链接:', img.url);
              }
            } catch (e) {
              console.error('[oschina] 处理图片异常:', e);
            }
          }

          // 清除 HTML 编辑器中因粘贴产生的内容
          console.log('[oschina] 清除 HTML 编辑器内容');
          try {
            const qlEditor = document.querySelector('.ql-editor') as HTMLElement;
            if (qlEditor) qlEditor.innerHTML = '<p><br></p>';
            const pm = document.querySelector('.ProseMirror') as HTMLElement;
            if (pm) pm.innerHTML = '';
            const ce = Array.from(document.querySelectorAll('[contenteditable="true"]'))
              .filter(e => getRectArea(e) > 2000)[0] as HTMLElement;
            if (ce && !ce.classList.contains('ql-editor') && !ce.classList.contains('ProseMirror')) {
              ce.innerHTML = '';
            }
          } catch (e) {
            console.log('[oschina] 清除编辑器内容失败:', e);
          }

          console.log('[oschina] 图片处理完成，Markdown 是否包含 local://:', processedMarkdown.includes('local://'));
        }

        // 切换到 Markdown 编辑器
        console.log('[oschina] 切换到 Markdown 编辑器');
        await switchToMarkdown();
        // 确保切换完成后再开始填充（Markdown 编辑器通常为 CodeMirror/textarea）
        await waitFor(
          () => {
            const docs = getAllDocs();
            const hasCm = docs.some((d) => d.querySelectorAll('.CodeMirror').length > 0);
            if (hasCm) return {} as any;
            const hasTextarea = docs.some((d) => d.querySelectorAll('textarea').length > 0);
            return hasTextarea ? ({} as any) : null;
          },
          8000
        ).catch(() => null);
        await sleep(100);

        // 1. 填充标题
        console.log('[oschina] Step 1: 填充标题');
        const titleField = await waitFor(() => findTitleField(), 25000);
        const title = String((payload as any).title || '');
        console.log('[oschina] 找到标题输入框:', titleField?.tagName, titleField?.className);
        
        titleField.focus();
        await sleep(100);
        
        if (titleField instanceof HTMLInputElement || titleField instanceof HTMLTextAreaElement) {
          setNativeValue(titleField, title);
        } else {
          titleField.textContent = title;
          titleField.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        await sleep(200);
        titleField.dispatchEvent(new Event('input', { bubbles: true }));
        titleField.dispatchEvent(new Event('change', { bubbles: true }));
        
        console.log('[oschina] Title filled:', title);
        await sleep(120);

        // 2. 填充内容
        console.log('[oschina] Step 2: 填充内容');
        const contentHtml = processedHtml;
        const markdown = processedMarkdown;
        console.log('[oschina] HTML length:', contentHtml.length, 'Markdown length:', markdown.length);
        
        // 等待编辑器出现
        await waitFor(
          () => {
            const docs = getAllDocs();
            const hasCm = docs.some((d) => d.querySelectorAll('.CodeMirror').length > 0);
            const hasTextarea = docs.some((d) => d.querySelectorAll('textarea').length > 0);
            const hasEditable = docs.some((d) => d.querySelectorAll('.ql-editor, .ProseMirror, [contenteditable="true"]').length > 0);
            return (hasCm || hasTextarea || hasEditable) ? ({} as any) : null;
          },
          12000
        ).catch(() => null);
        
        await sleep(150);

        const tryFillQuillHtml = (html: string): boolean => {
          if (!html) return false;
          for (const doc of getAllDocs()) {
            const editors = Array.from(doc.querySelectorAll<HTMLElement>('.ql-editor'));
            for (const el of editors) {
              const win = el.ownerDocument.defaultView || window;
              const QuillCtor = (win as any).Quill;
              const quill =
                QuillCtor?.find?.(el) ||
                (el as any).__quill ||
                ((el.closest('.ql-container') as any)?.__quill ?? null);
              if (quill?.clipboard?.dangerouslyPasteHTML) {
                try {
                  quill.clipboard.dangerouslyPasteHTML(0, html);
                  quill.setSelection?.(quill.getLength?.() ?? 0, 0);
                  return true;
                } catch {}
              }
              try {
                el.innerHTML = html;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              } catch {}
            }
          }
          return false;
        };

        const tryFillRichHtml = async (html: string): Promise<boolean> => {
          if (!html) return false;
          const candidates: HTMLElement[] = [];
          for (const doc of getAllDocs()) {
            candidates.push(...Array.from(doc.querySelectorAll<HTMLElement>('.ProseMirror, [contenteditable="true"]')));
          }
          const filtered = candidates.filter((e) => {
            try { return !isLikelyTitle(e) && getRectArea(e) > 2000; } catch { return false; }
          });
          if (filtered.length === 0) return false;
          filtered.sort((a, b) => getRectArea(b) - getRectArea(a));
          const target = filtered[0];
          try { target.scrollIntoView?.({ block: 'center' }); } catch {}
          try {
            target.focus?.();
            target.innerHTML = html;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(80);
            return true;
          } catch {
            return false;
          }
        };

        const tryFillIframeHtml = async (html: string): Promise<boolean> => {
          if (!html) return false;
          const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
          for (const iframe of iframes) {
            try {
              const doc = iframe.contentDocument;
              const body = doc?.body as HTMLElement | null;
              if (!body) continue;
              const editor = (doc!.querySelector('[contenteditable=\"true\"]') as HTMLElement | null) || body;
              editor.focus?.();
              editor.innerHTML = html;
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              editor.dispatchEvent(new Event('change', { bubbles: true }));
              await sleep(80);
              return true;
            } catch {}
          }
          return false;
        };

        const ok =
          // 优先使用 Markdown 编辑器（CodeMirror/textarea）
          tryFillCodeMirror5(markdown) ||
          tryFillTextarea(markdown) ||
          // 兜底：Markdown 模式失败时，尝试写入 HTML 编辑器
          tryFillQuillHtml(contentHtml) ||
          (await tryFillRichHtml(contentHtml)) ||
          (await tryFillIframeHtml(contentHtml)) ||
          (await tryFillContentEditable(markdown));

        if (!ok) {
          throw new Error('未找到可写入的编辑器控件');
        }

        await sleep(150);

        console.log('[oschina] 内容填充完成');
        console.log('[oschina] ⚠️ 发布操作需要用户手动完成');

        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[oschina] 填充失败:', error);
        return {
          url: window.location.href,
          __synccasterError: {
            message: error?.message || String(error),
            stack: error?.stack,
          },
        } as any;
      }
    },
  },
};
