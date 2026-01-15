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

      // ========== 图片处理辅助函数 ==========

      // 将 base64 转换为 Blob
      const dataUrlToBlob = (dataUrl: string): Blob => {
        const parts = dataUrl.split(',');
        if (parts.length !== 2) {
          throw new Error('Invalid data URL format');
        }
        const meta = parts[0];
        const base64Data = parts[1];
        const mimeMatch = meta.match(/data:([^;]+)/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes], { type: mimeType });
      };

      // 收集编辑器中的所有图片 URL
      const collectImageUrls = (root: HTMLElement): string[] => {
        const urls: string[] = [];
        root.querySelectorAll('img').forEach(img => {
          if (img.src) urls.push(img.src);
        });
        return urls;
      };

      // 等待新图片 URL 出现
      const waitForNewImageUrl = (
        root: HTMLElement,
        beforeUrls: Set<string>,
        timeoutMs: number
      ): Promise<{ url: string | null }> => {
        return new Promise((resolve) => {
          let timer: ReturnType<typeof setTimeout>;

          const checkOnce = (): boolean => {
            const imgs = root.querySelectorAll('img');
            for (const img of imgs) {
              const url = img.src;
              if (!url || beforeUrls.has(url)) continue;
              // 找到新的图片 URL（头条图床 URL 或 blob URL）
              if (url.includes('toutiao') || url.includes('bytedance') || url.includes('byteimg') || url.startsWith('blob:')) {
                observer.disconnect();
                if (timer) clearTimeout(timer);
                console.log('[toutiao] Found new image URL:', url);
                resolve({ url });
                return true;
              }
            }
            return false;
          };

          const observer = new MutationObserver(() => checkOnce());
          observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src']
          });

          if (checkOnce()) return;

          timer = setTimeout(() => {
            observer.disconnect();
            console.log('[toutiao] waitForNewImageUrl timeout');
            resolve({ url: null });
          }, timeoutMs);
        });
      };

      // 在编辑器中查找并替换占位符
      const findAndReplacePlaceholder = async (
        editorRoot: HTMLElement,
        placeholder: string,
        imageData: { base64: string; mimeType: string }
      ): Promise<boolean> => {
        // 使用 TreeWalker 遍历所有文本节点
        const walker = document.createTreeWalker(
          editorRoot,
          NodeFilter.SHOW_TEXT,
          null
        );

        let node: Text | null;
        while ((node = walker.nextNode() as Text)) {
          const text = node.textContent || '';
          const index = text.indexOf(placeholder);
          if (index !== -1) {
            console.log('[toutiao] Found placeholder:', placeholder, 'in text:', text.substring(0, 50));

            try {
              // 1. 选中占位符
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, index + placeholder.length);

              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              await sleep(100);

              // 2. 删除占位符
              document.execCommand('delete', false);
              await sleep(100);

              // 3. 在该位置粘贴图片
              const blob = dataUrlToBlob(imageData.base64);
              const ext = imageData.mimeType.includes('png') ? 'png' : imageData.mimeType.includes('gif') ? 'gif' : 'jpg';
              const file = new File([blob], `image_${Date.now()}.${ext}`, { type: imageData.mimeType });

              const dt = new DataTransfer();
              dt.items.add(file);

              // 记录粘贴前的图片 URL
              const beforeUrls = new Set(collectImageUrls(editorRoot));

              // 尝试 paste 事件
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
              });
              Object.defineProperty(pasteEvent, 'clipboardData', { get: () => dt });
              editorRoot.dispatchEvent(pasteEvent);

              // 4. 等待图片上传
              console.log('[toutiao] Waiting for image upload...');
              const result = await waitForNewImageUrl(editorRoot, beforeUrls, 20000);

              if (result.url) {
                console.log('[toutiao] Image uploaded successfully:', result.url);
              } else {
                console.warn('[toutiao] Image upload may have failed for placeholder:', placeholder);
              }

              return true;
            } catch (e) {
              console.error('[toutiao] Error replacing placeholder:', placeholder, e);
              return false;
            }
          }
        }

        console.warn('[toutiao] Placeholder not found:', placeholder);
        return false;
      };

      try {
        const titleText = String((payload as any).title || '').trim();
        let html = String((payload as any).contentHtml || '');
        const markdown = String((payload as any).contentMarkdown || '');

        // ========== 图片占位符处理 ==========
        const downloadedImages = (payload as any).__downloadedImages as Array<{ url: string; base64: string; mimeType: string }> | undefined;
        const imagePlaceholders = new Map<string, { base64: string; mimeType: string }>();

        if (downloadedImages && downloadedImages.length > 0) {
          console.log('[toutiao] 处理图片 - 使用占位符替代 local:// 图片链接', { count: downloadedImages.length });

          let imageIndex = 0;
          for (const img of downloadedImages) {
            if (img.url.startsWith('local://')) {
              imageIndex++;
              const placeholder = `【图片${imageIndex}】`;
              imagePlaceholders.set(placeholder, { base64: img.base64, mimeType: img.mimeType });

              // 替换 HTML 中的图片为占位符
              const htmlPattern = new RegExp(
                `<img[^>]*src=["']${img.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
                'gi'
              );
              html = html.replace(htmlPattern, placeholder);
              console.log('[toutiao] Replaced image with placeholder:', img.url, '->', placeholder);
            }
          }

          console.log('[toutiao] Created', imagePlaceholders.size, 'image placeholders');
        }

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

          // 使用 HTML 内容或将 markdown 转为简单 HTML（已处理占位符）
          const contentToFill = html || markdown.replace(/\n/g, '<br>');

          // 方法1：直接设置 innerHTML（ProseMirror 通常能识别）
          editor.innerHTML = contentToFill;
          editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
          console.log('[toutiao] 内容填充成功');

          // ========== 在占位符位置插入图片 ==========
          if (imagePlaceholders.size > 0) {
            console.log('[toutiao] 开始在占位符位置插入图片', { count: imagePlaceholders.size });

            // 等待内容渲染完成
            await sleep(1000);

            // 逐个处理占位符
            for (const [placeholder, imageData] of imagePlaceholders) {
              console.log('[toutiao] Processing placeholder:', placeholder);
              await findAndReplacePlaceholder(editor, placeholder, imageData);
              await sleep(500);
            }

            console.log('[toutiao] All image placeholders processed');
          }
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

            // 在降级编辑器中也处理图片占位符
            if (imagePlaceholders.size > 0) {
              console.log('[toutiao] 开始在占位符位置插入图片（降级编辑器）', { count: imagePlaceholders.size });
              await sleep(1000);

              for (const [placeholder, imageData] of imagePlaceholders) {
                console.log('[toutiao] Processing placeholder:', placeholder);
                await findAndReplacePlaceholder(fallbackEditor, placeholder, imageData);
                await sleep(500);
              }

              console.log('[toutiao] All image placeholders processed');
            }
          } else {
            console.log('[toutiao] 未找到编辑器');
          }
        }

        await sleep(300);
        return { editUrl: window.location.href, url: window.location.href } as any;
      } catch (error: any) {
        console.error('[toutiao] Error:', error);
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
