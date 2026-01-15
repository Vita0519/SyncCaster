import type { PlatformAdapter } from './base';

/**
 * 思否（SegmentFault）适配器
 * 
 * 平台特点：
 * - 入口：https://segmentfault.com/write?freshman=1
 * - 编辑器：Markdown 编辑器
 * - 支持：Markdown 语法
 * - LaTeX 公式：
 *   - 行内公式和块级公式都使用 $$公式$$ 语法
 * - 结构：标题 + 正文
 */
export const segmentfaultAdapter: PlatformAdapter = {
  id: 'segmentfault',
  name: '思否',
  kind: 'dom',
  icon: 'segmentfault',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsTags: true,
    supportsCategories: false,
    supportsCover: false,
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
    // 思否 LaTeX 语法：行内和块级公式都使用双美元符号 $$...$$
    // 需要将标准 Markdown 的单 $ 行内公式转换为双 $$
    let markdown = post.body_md || '';

    // 使用特殊标记替换，避免 $ 符号的特殊处理问题
    const DOLLAR = '\uFFFF';  // 使用 Unicode 替换字符作为临时标记

    // 1. 先将所有 $$ 替换为临时标记（保护块级公式）
    markdown = markdown.split('$$').join(DOLLAR + DOLLAR);

    // 2. 将剩余的单个 $ 替换为双 $$（转换行内公式）
    markdown = markdown.split('$').join(DOLLAR + DOLLAR);

    // 3. 将临时标记还原为 $
    markdown = markdown.split(DOLLAR).join('$');

    // 4. 规范化分割线：将 "* * *" 转换为 "---"
    markdown = markdown.replace(/^\* \* \*$/gm, '---');
    markdown = markdown.replace(/^\*\*\*$/gm, '---');

    return {
      title: post.title,
      contentMarkdown: markdown,
      tags: post.tags,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('segmentfault: use DOM automation');
  },

  dom: {
    matchers: [
      // 注意：直接使用带参数的完整 URL，避免跳转到 howtowrite 提示页
      'https://segmentfault.com/write?freshman=1',
    ],
    fillAndPublish: async function (payload) {
      console.log('[segmentfault] fillAndPublish starting', payload);

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

      // 辅助函数：使用原生 setter 设置值，绕过 Vue/React 的受控组件机制
      function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
        // 获取原生的 value setter
        const proto = element instanceof HTMLInputElement
          ? window.HTMLInputElement.prototype
          : window.HTMLTextAreaElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        if (nativeSetter) {
          nativeSetter.call(element, value);
        } else {
          // 降级：直接设置
          element.value = value;
        }
      }

      // 辅助函数：模拟完整的用户输入，确保触发 Vue/React 表单验证
      async function simulateUserInput(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
        const title = value;

        // 移除 readonly 属性（如果存在）
        element.removeAttribute('readonly');
        element.removeAttribute('disabled');

        // 聚焦元素
        element.focus();
        element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        await sleep(50);

        // 清空当前值
        setNativeValue(element, '');
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContent' }));
        await sleep(50);

        // ============ 方法1: 使用原生 setter + InputEvent ============
        setNativeValue(element, title);

        // 触发 Vue v-model 需要的 input 事件
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: title
        }));

        // 触发 change 事件
        element.dispatchEvent(new Event('change', { bubbles: true }));

        await sleep(100);

        // 检查是否成功
        if (element.value === title) {
          console.log('[segmentfault] 方法1成功: 原生setter + InputEvent');
          // 触发 blur 以完成验证
          element.blur();
          element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          await sleep(100);
          // 再次聚焦以保持用户体验
          element.focus();
          return true;
        }

        // ============ 方法2: 使用 compositionstart/end 事件模拟中文输入 ============
        console.log('[segmentfault] 尝试方法2: compositionstart/end');
        element.focus();

        // 模拟输入法开始
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));

        setNativeValue(element, title);

        // 模拟输入法更新
        element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: title }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: title, inputType: 'insertCompositionText' }));

        // 模拟输入法结束
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: title }));
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: title, inputType: 'insertFromComposition' }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        await sleep(100);

        if (element.value === title) {
          console.log('[segmentfault] 方法2成功: compositionend');
          element.blur();
          element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          await sleep(100);
          element.focus();
          return true;
        }

        // ============ 方法3: 使用 document.execCommand ============
        console.log('[segmentfault] 尝试方法3: execCommand');
        element.focus();
        element.select(); // 选中所有文本

        try {
          // 先删除现有内容
          document.execCommand('selectAll', false);
          document.execCommand('delete', false);

          // 插入新内容
          const insertOk = document.execCommand('insertText', false, title);
          if (insertOk && element.value === title) {
            console.log('[segmentfault] 方法3成功: execCommand');
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.blur();
            element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
            await sleep(100);
            element.focus();
            return true;
          }
        } catch (e) {
          console.warn('[segmentfault] execCommand 失败:', e);
        }

        // ============ 方法4: 逐字符输入模拟 ============
        console.log('[segmentfault] 尝试方法4: 逐字符输入');
        element.focus();
        setNativeValue(element, '');
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContent' }));

        for (let i = 0; i < title.length; i++) {
          const char = title[i];
          const currentValue = title.substring(0, i + 1);

          element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
          setNativeValue(element, currentValue);
          element.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
          element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));

          // 每输入一些字符就稍微等待
          if (i % 5 === 4) await sleep(10);
        }

        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
        element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        await sleep(100);
        element.focus();

        if (element.value === title) {
          console.log('[segmentfault] 方法4成功: 逐字符输入');
          return true;
        }

        console.warn('[segmentfault] 所有方法都未能完全匹配，当前值:', element.value);
        return false;
      }

      try {
        // 0. 处理本地图片上传
        const downloadedImages = (payload as any).__downloadedImages as Array<{ url: string; base64: string; mimeType: string }> | undefined;
        let processedMarkdown = (payload as any).contentMarkdown || '';

        console.log('[segmentfault] 检查本地图片:', {
          hasDownloadedImages: !!downloadedImages,
          count: downloadedImages?.length || 0,
          markdownLength: processedMarkdown.length,
        });

        if (downloadedImages && downloadedImages.length > 0) {
          console.log('[segmentfault] 发现', downloadedImages.length, '张本地图片需要上传');

          // 尝试获取 CSRF token（思否可能需要）
          const getCsrfToken = (): string | null => {
            // 从 meta 标签获取
            const metaToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
            if (metaToken) return metaToken;

            // 从 cookie 获取
            const cookies = document.cookie.split(';');
            for (const cookie of cookies) {
              const [name, value] = cookie.trim().split('=');
              if (name === 'XSRF-TOKEN' || name === '_xsrf' || name === 'csrf_token') {
                return decodeURIComponent(value);
              }
            }
            return null;
          };

          const csrfToken = getCsrfToken();
          console.log('[segmentfault] CSRF token:', csrfToken ? '已获取' : '未找到');

          // 图片上传函数 - 直接使用 DOM 粘贴上传（API 端点已失效）
          const uploadImageToSegmentfault = async (base64: string, mimeType: string): Promise<string | null> => {
            try {
              console.log('[segmentfault] 开始转换 base64 到 Blob, mimeType:', mimeType);

              // 将 base64 转换为 Blob
              const response = await fetch(base64);
              const blob = await response.blob();
              console.log('[segmentfault] Blob 创建成功, size:', blob.size);

              // 直接使用 DOM 粘贴上传
              return await tryDomPasteUpload(blob, mimeType);

            } catch (e) {
              console.error('[segmentfault] 图片上传异常:', e);
              return null;
            }
          };

          // DOM 粘贴上传函数 - 参考简书的成功实现
          const tryDomPasteUpload = async (blob: Blob, mimeType: string): Promise<string | null> => {
            try {
              const cm = document.querySelector('.CodeMirror') as any;
              if (!cm?.CodeMirror) {
                console.log('[segmentfault] 未找到 CodeMirror 编辑器');
                return null;
              }

              const editor = cm.CodeMirror;

              // 辅助函数：提取 Markdown 中的图片 URL
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

              // 辅助函数：等待新的图片 URL 出现
              const waitForNewImageUrl = async (
                beforeUrls: Set<string>,
                timeoutMs: number
              ): Promise<string | null> => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                  const currentContent = editor.getValue() || '';
                  const currentUrls = extractImageUrls(currentContent);

                  for (const url of currentUrls) {
                    if (!url) continue;
                    if (beforeUrls.has(url)) continue;
                    // 排除 data: 和 blob: 开头的临时 URL
                    if (url.startsWith('data:') || url.startsWith('blob:')) continue;
                    // 排除 local:// 开头的本地 URL
                    if (url.startsWith('local://')) continue;
                    // 找到新的有效 URL
                    console.log('[segmentfault] 检测到新图片 URL:', url);
                    return url;
                  }

                  await new Promise(r => setTimeout(r, 500));
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
              const beforeContent = editor.getValue() || '';
              const beforeUrls = extractImageUrls(beforeContent);
              console.log('[segmentfault] 粘贴前图片 URL 数量:', beforeUrls.size);

              // 聚焦编辑器
              editor.focus();

              // 方法1: 使用 Object.defineProperty 设置 clipboardData（关键改进）
              console.log('[segmentfault] 尝试方法1: ClipboardEvent + Object.defineProperty');
              const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
              Object.defineProperty(pasteEvent, 'clipboardData', {
                get: () => dataTransfer,
                configurable: true
              });

              // 尝试多个可能的目标元素
              const targets = [
                cm.querySelector('.CodeMirror-code'),
                cm.querySelector('.CodeMirror-scroll'),
                cm.querySelector('textarea'),
                cm,
                document.activeElement,
              ].filter(Boolean);

              let dispatched = false;
              for (const target of targets) {
                try {
                  dispatched = target.dispatchEvent(pasteEvent);
                  console.log('[segmentfault] 粘贴事件触发到', target.className || target.tagName, ':', dispatched);
                  if (dispatched) break;
                } catch (e) {
                  console.log('[segmentfault] 粘贴到', target.className || target.tagName, '失败:', e);
                }
              }

              // 等待新 URL 出现（最多 15 秒）
              let newUrl = await waitForNewImageUrl(beforeUrls, 15000);
              if (newUrl) {
                console.log('[segmentfault] 方法1成功，新图片 URL:', newUrl);
                // 清除刚才粘贴的内容（因为我们会在后面统一替换）
                const currentContent = editor.getValue();
                const imgPattern = new RegExp(`!\\[[^\\]]*\\]\\(${newUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
                editor.setValue(currentContent.replace(imgPattern, ''));
                return newUrl;
              }

              // 方法2: 使用 DragEvent（拖拽事件）
              console.log('[segmentfault] 方法1未检测到新图片，尝试方法2: DragEvent');
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
                  console.log('[segmentfault] 拖拽事件触发到', target.className || target.tagName, ':', dispatched);
                  if (dispatched) break;
                } catch (e) {
                  console.log('[segmentfault] 拖拽到', target.className || target.tagName, '失败:', e);
                }
              }

              // 再次等待新 URL 出现（最多 15 秒）
              newUrl = await waitForNewImageUrl(beforeUrls, 15000);
              if (newUrl) {
                console.log('[segmentfault] 方法2成功，新图片 URL:', newUrl);
                const currentContent = editor.getValue();
                const imgPattern = new RegExp(`!\\[[^\\]]*\\]\\(${newUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
                editor.setValue(currentContent.replace(imgPattern, ''));
                return newUrl;
              }

              console.log('[segmentfault] DOM 粘贴/拖拽上传均未检测到新图片');
              return null;
            } catch (e) {
              console.error('[segmentfault] DOM 粘贴上传失败:', e);
              return null;
            }
          };

          // 上传每张图片并替换 URL
          for (const img of downloadedImages) {
            console.log('[segmentfault] 处理图片:', img.url, 'base64长度:', img.base64?.length || 0);

            if (!img.url.startsWith('local://')) {
              console.log('[segmentfault] 跳过非本地图片:', img.url);
              continue;
            }

            console.log('[segmentfault] 上传本地图片:', img.url);
            const newUrl = await uploadImageToSegmentfault(img.base64, img.mimeType);

            if (newUrl) {
              // 替换 Markdown 中的 local:// URL
              const escapedUrl = img.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const beforeReplace = processedMarkdown;
              processedMarkdown = processedMarkdown.replace(
                new RegExp(escapedUrl, 'g'),
                newUrl
              );
              const replaced = beforeReplace !== processedMarkdown;
              console.log('[segmentfault] 图片 URL 替换:', replaced ? '成功' : '未找到匹配', img.url, '->', newUrl);
            } else {
              console.warn('[segmentfault] 图片上传失败，保留原链接:', img.url);
            }
          }

          console.log('[segmentfault] 图片处理完成，Markdown 是否包含 local://:', processedMarkdown.includes('local://'));
        } else {
          console.log('[segmentfault] 没有需要上传的本地图片');
        }

        // 1. 填充标题
        console.log('[segmentfault] Step 1: 填充标题');
        const titleInput = await waitFor('input[placeholder*="标题"], .title-input input') as HTMLInputElement;
        const titleText = (payload as any).title || '';

        // 尝试填充标题，最多重试3次
        let titleFilled = false;
        for (let attempt = 0; attempt < 3 && !titleFilled; attempt++) {
          if (attempt > 0) {
            console.log(`[segmentfault] 标题填充重试 ${attempt + 1}/3`);
            await sleep(200);
          }
          titleFilled = await simulateUserInput(titleInput, titleText);
        }

        if (!titleFilled) {
          console.warn('[segmentfault] 标题可能未完全填充，但继续处理内容');
        }

        await sleep(300);

        // 2. 填充内容 - 思否使用 Markdown 编辑器
        console.log('[segmentfault] Step 2: 填充内容');
        const markdown = processedMarkdown;

        // 尝试 CodeMirror
        const cm = document.querySelector('.CodeMirror') as any;
        if (cm?.CodeMirror) {
          cm.CodeMirror.setValue(markdown);
          cm.CodeMirror.refresh();
        } else {
          // 降级：textarea
          const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
          if (textarea) {
            textarea.value = markdown;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            throw new Error('未找到思否编辑器');
          }
        }
        await sleep(500);

        // 3. 内容填充完成，不执行发布操作
        console.log('[segmentfault] 内容填充完成');
        console.log('[segmentfault] ⚠️ 发布操作需要用户手动完成');

        return {
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布',
          __debug: {
            hasDownloadedImages: !!(payload as any).__downloadedImages,
            downloadedImagesCount: (payload as any).__downloadedImages?.length || 0,
            markdownHasLocalUrl: processedMarkdown.includes('local://'),
            markdownLength: processedMarkdown.length,
          }
        };
      } catch (error: any) {
        console.error('[segmentfault] 填充失败:', error);
        return {
          url: window.location.href,
          __synccasterError: {
            message: error?.message || String(error),
            stack: error?.stack,
          },
          __debug: {
            hasDownloadedImages: !!(payload as any).__downloadedImages,
            downloadedImagesCount: (payload as any).__downloadedImages?.length || 0,
          }
        } as any;
      }
    },
  },
};
