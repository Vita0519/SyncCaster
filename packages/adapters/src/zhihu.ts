import type { PlatformAdapter } from './base';
import { renderMarkdownToHtmlForPaste } from '@synccaster/core';

/**
 * 知乎适配器
 * 
 * 平台特点：
 * - 入口：https://zhuanlan.zhihu.com/write
 * - 编辑器：富文本编辑器，但支持 Markdown 粘贴解析
 * - 支持：Markdown 粘贴后弹窗确认解析、HTML 内容粘贴
 * - LaTeX 公式：需通过"公式"插件输入，去除 $ 符号
 * - 结构：标题输入框 + 富文本正文
 * 
 * 发布策略：
 * - 填充 Markdown 原文到编辑器
 * - 自动点击"确认并解析"按钮完成 Markdown → 富文本转换
 * - 不执行最终发布操作，由用户手动完成
 */
export const zhihuAdapter: PlatformAdapter = {
  id: 'zhihu',
  name: '知乎',
  kind: 'dom',
  icon: 'zhihu',
  capabilities: {
    domAutomation: true,
    supportsHtml: true,
    supportsMarkdown: true, // 知乎支持 Markdown 粘贴解析
    supportsTags: true,
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
    // 知乎支持 Markdown 粘贴解析：优先使用 Markdown 原文
    // 粘贴后平台会弹出"识别到 Markdown 格式"提示，插件自动点击确认解析
    const markdown = post.body_md || '';
    let contentHtml = (post as any)?.meta?.body_html || '';
    if (!contentHtml && markdown) {
      // 备用：若 Markdown 解析失败，使用预渲染的 HTML
      // 知乎不支持 LaTeX 渲染：去掉 $ 包裹
      contentHtml = renderMarkdownToHtmlForPaste(markdown, { stripMath: true });
    }
    
    return {
      title: post.title,
      contentHtml,
      contentMarkdown: markdown, // 优先使用 Markdown 原文
      cover: post.cover,
      tags: post.tags?.slice(0, 5),
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('zhihu: use DOM automation');
  },

  dom: {
    matchers: [
      'https://zhuanlan.zhihu.com/write*',
    ],
    fillAndPublish: async function(payload: any) {
      console.log('[zhihu] fillAndPublish starting', payload);
      console.log('[zhihu] Current URL:', window.location.href);
      console.log('[zhihu] Document ready state:', document.readyState);
      
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      
      // 等待页面完全加载
      if (document.readyState !== 'complete') {
        console.log('[zhihu] Waiting for page to load...');
        await new Promise<void>(resolve => {
          window.addEventListener('load', () => resolve(), { once: true });
          setTimeout(resolve, 5000); // 最多等 5 秒
        });
      }
      
      // 额外等待确保 React/Vue 组件渲染完成
      console.log('[zhihu] Waiting for editor to initialize...');
      await sleep(500);
      
      async function waitForAny(selectors: string[], timeout = 20000): Promise<HTMLElement> {
        const start = Date.now();
        console.log('[zhihu] Waiting for selectors:', selectors);
        while (Date.now() - start < timeout) {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
              console.log('[zhihu] Found element:', selector);
              return el as HTMLElement;
            }
          }
          await sleep(300);
        }
        // 打印当前页面的一些元素帮助调试
        console.log('[zhihu] Available inputs:', document.querySelectorAll('input, textarea').length);
        console.log('[zhihu] Available contenteditable:', document.querySelectorAll('[contenteditable]').length);
        throw new Error(`等待元素超时: ${selectors.join(', ')}`);
      }

      try {
        // 0. 处理图片上传（在填充内容之前）
        // 如果有 __downloadedImages，通过 DOM 粘贴方式上传图片并替换 local:// 链接
        const downloadedImages = (payload as any).__downloadedImages as Array<{ url: string; base64: string; mimeType: string }> | undefined;
        let contentMarkdownProcessed = String((payload as any).contentMarkdown || '');

        // 将 base64 转换为 Blob（不使用 fetch，绕过 CSP 限制）
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

        // 收集编辑器中的所有图片 URL（包括 blob URL）
        const collectImageUrls = (root: HTMLElement): string[] => {
          const urls: string[] = [];
          root.querySelectorAll('img').forEach(img => {
            if (img.src) {
              urls.push(img.src);  // 收集所有 URL，不排除 blob
            }
          });
          // 也从 figure 标签中收集
          root.querySelectorAll('figure').forEach(fig => {
            const img = fig.querySelector('img');
            if (img?.src) {
              urls.push(img.src);
            }
          });
          return urls;
        };

        // 删除知乎自动添加的图片注释占位符
        const removeImageCaptions = (root: HTMLElement) => {
          // 查找包含"添加图片注释"的元素
          const allElements = root.querySelectorAll('*');
          allElements.forEach(el => {
            const text = el.textContent || '';
            // 检查是否是图片注释占位符
            if (
              (text.includes('添加图片注释') || text.includes('不超过 140 字')) &&
              el.children.length === 0  // 只处理叶子节点
            ) {
              console.log('[zhihu] Removing image caption placeholder:', text.substring(0, 50));
              (el as HTMLElement).textContent = '';
            }
          });

          // 也检查 figcaption 和其他常见的图片注释容器
          const captions = root.querySelectorAll('figcaption, .image-caption, [data-placeholder*="图片注释"]');
          captions.forEach(caption => {
            const text = caption.textContent || '';
            if (text.includes('添加图片注释') || text.includes('可选')) {
              console.log('[zhihu] Removing figcaption:', text.substring(0, 50));
              (caption as HTMLElement).textContent = '';
            }
          });

          // 检查 contenteditable 的占位符属性
          const placeholders = root.querySelectorAll('[placeholder*="图片注释"], [placeholder*="可选"]');
          placeholders.forEach(el => {
            console.log('[zhihu] Clearing placeholder element');
            (el as HTMLElement).textContent = '';
          });
        };

        // 等待新图片 URL 出现（检测到 blob URL 立即返回，不再等待超时）
        const waitForNewImageUrl = (
          root: HTMLElement,
          beforeUrls: Set<string>,
          timeoutMs: number
        ): Promise<{ url: string | null; isBlob: boolean }> => {
          return new Promise((resolve) => {
            // 先声明 timer，避免在 checkOnce 中访问未初始化的变量
            let timer: ReturnType<typeof setTimeout>;

            const checkOnce = (): boolean => {
              const imgs = root.querySelectorAll('img');
              for (const img of imgs) {
                const url = img.src;
                if (!url || beforeUrls.has(url)) continue;

                if (url.includes('zhimg.com')) {
                  // 找到最终的 zhimg.com URL
                  observer.disconnect();
                  if (timer) clearTimeout(timer);
                  resolve({ url, isBlob: false });
                  return true;
                } else if (url.startsWith('blob:')) {
                  // 立即返回 blob URL，不再等待（优化用户体验）
                  observer.disconnect();
                  if (timer) clearTimeout(timer);
                  console.log('[zhihu] Found blob URL, returning immediately:', url);
                  resolve({ url, isBlob: true });
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
              console.log('[zhihu] waitForNewImageUrl timeout');
              resolve({ url: null, isBlob: false });
            }, timeoutMs);
          });
        };

        // 通过 DOM 粘贴方式上传图片
        const uploadImageViaPaste = async (
          editor: HTMLElement,
          base64: string,
          mimeType: string
        ): Promise<{ url: string | null; isBlob: boolean }> => {
          try {
            // 1. 将 base64 转换为 File 对象
            const blob = dataUrlToBlob(base64);
            const ext = mimeType.includes('png') ? 'png' : mimeType.includes('gif') ? 'gif' : 'jpg';
            const file = new File([blob], `image_${Date.now()}.${ext}`, { type: mimeType });

            // 2. 记录粘贴前的所有图片 URL
            const beforeUrls = new Set(collectImageUrls(editor));
            console.log('[zhihu] Before paste, existing URLs:', beforeUrls.size);

            // 3. 创建 DataTransfer 并添加文件
            const dt = new DataTransfer();
            dt.items.add(file);

            // 4. 聚焦编辑器
            editor.focus();
            await sleep(100);

            // 5. 尝试 drop 事件（更可靠）
            console.log('[zhihu] Trying drop event...');
            const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true });
            Object.defineProperty(dragOver, 'dataTransfer', { get: () => dt });
            editor.dispatchEvent(dragOver);

            const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true });
            Object.defineProperty(dropEvent, 'dataTransfer', { get: () => dt });
            editor.dispatchEvent(dropEvent);

            // 6. 如果 drop 失败，尝试 paste 事件
            await sleep(500);
            let newUrls = collectImageUrls(editor);
            let hasNewUrl = newUrls.some(url => !beforeUrls.has(url));

            if (!hasNewUrl) {
              console.log('[zhihu] Drop failed, trying paste event...');
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
              });
              Object.defineProperty(pasteEvent, 'clipboardData', { get: () => dt });
              editor.dispatchEvent(pasteEvent);
            }

            // 7. 等待新 URL 出现（知乎上传图片后会生成 zhimg.com 的 URL）
            console.log('[zhihu] Waiting for new image URL...');
            const result = await waitForNewImageUrl(editor, beforeUrls, 20000);

            if (result.url) {
              console.log('[zhihu] Got new image URL:', result.url, 'isBlob:', result.isBlob);
            } else {
              console.log('[zhihu] No new image URL found');
            }

            return result;
          } catch (e) {
            console.error('[zhihu] uploadImageViaPaste error:', e);
            return { url: null, isBlob: false };
          }
        };

        // v9 策略：分步填充 - 先用占位符替代图片，填充文本后再在占位符位置插入图片
        // 保存图片信息：占位符 -> 图片数据
        const imagePlaceholders = new Map<string, { base64: string; mimeType: string }>();

        if (downloadedImages && downloadedImages.length > 0) {
          console.log('[zhihu] Step 0: 处理图片 - 使用占位符替代图片链接', { count: downloadedImages.length });

          let imageIndex = 0;
          for (const img of downloadedImages) {
            if (img.url.startsWith('local://')) {
              imageIndex++;
              const placeholder = `【图片${imageIndex}】`;
              imagePlaceholders.set(placeholder, { base64: img.base64, mimeType: img.mimeType });

              // 替换 Markdown 中的图片链接为占位符
              const mdPattern = new RegExp(
                `!\\[[^\\]]*\\]\\(\\s*${img.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`,
                'g'
              );
              contentMarkdownProcessed = contentMarkdownProcessed.replace(mdPattern, placeholder);
              console.log('[zhihu] Replaced image with placeholder:', img.url, '->', placeholder);
            }
          }

          console.log('[zhihu] Created', imagePlaceholders.size, 'image placeholders');
        }

        // 更新 payload 中的 contentMarkdown
        (payload as any).contentMarkdown = contentMarkdownProcessed;

        // 1. 填充标题
        console.log('[zhihu] Step 1: 填充标题');
        const titleSelectors = [
          'textarea[placeholder*="标题"]',
          'input[placeholder*="标题"]',
          '.WriteIndex-titleInput textarea',
          '.WriteIndex-titleInput input',
          '.PostEditor-titleInput textarea',
          '.PostEditor-titleInput input',
          'textarea.Input',
        ];
        const titleInput = await waitForAny(titleSelectors);
        console.log('[zhihu] Title input found:', titleInput.tagName, titleInput.className);
        
        // 清空并填充标题
        // 知乎需要模拟真实用户输入才能激活发布按钮
        titleInput.focus();
        await sleep(100);
        
        const titleText = (payload as any).title || '';
        
        if (titleInput.tagName === 'TEXTAREA') {
          (titleInput as HTMLTextAreaElement).value = titleText;
        } else {
          (titleInput as HTMLInputElement).value = titleText;
        }
        
        // 触发各种事件确保 React 状态更新
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
        
        // 模拟用户输入：添加一个字符然后删除，触发表单验证
        await sleep(200);
        titleInput.focus();
        
        // 使用 execCommand 模拟真实输入
        document.execCommand('insertText', false, ' ');
        await sleep(100);
        document.execCommand('delete', false);
        
        // 再次触发事件
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        console.log('[zhihu] Title filled with input simulation:', titleText);
        await sleep(200);

        // 2. 填充内容 - 知乎支持 Markdown 粘贴解析
        // 优先使用 Markdown 原文，让平台自动识别并弹出解析确认框
        console.log('[zhihu] Step 2: 填充内容');

        const contentMarkdown = String((payload as any).contentMarkdown || '');
        const contentHtml = String((payload as any).contentHtml || '');

        // 优先使用 Markdown 原文（知乎支持 Markdown 解析）
        const useMarkdown = !!contentMarkdown;
        const contentToFill = useMarkdown ? contentMarkdown : contentHtml;

        console.log('[zhihu] Content mode:', useMarkdown ? 'Markdown' : 'HTML');
        console.log('[zhihu] Content length:', contentToFill.length);

        const editorSelectors = [
          '.public-DraftEditor-content[contenteditable="true"]',
          '.DraftEditor-editorContainer [contenteditable="true"]',
          '.PostEditor-content [contenteditable="true"]',
          '[data-contents="true"]',
          '[contenteditable="true"]',
        ];
        const editor = await waitForAny(editorSelectors);
        console.log('[zhihu] Editor found:', editor.tagName, editor.className);

        // 检查编辑器中是否已有内容（图片）
        const hasExistingContent = editor.innerHTML.trim().length > 0;

        // 聚焦编辑器
        editor.focus();
        await sleep(200);

        // 如果编辑器中已有内容（图片），将光标移到末尾
        if (hasExistingContent) {
          console.log('[zhihu] 编辑器中已有内容（图片），将光标移到末尾');
          try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);  // false = 折叠到末尾
            selection?.removeAllRanges();
            selection?.addRange(range);
            await sleep(100);
          } catch (e) {
            console.warn('[zhihu] 移动光标失败:', e);
          }
        }

        // 使用 DataTransfer + ClipboardEvent 模拟真实粘贴事件
        // Draft.js 编辑器需要通过 clipboardData 获取粘贴内容
        console.log('[zhihu] Triggering paste event with DataTransfer...');

        const contentToPaste = useMarkdown ? contentMarkdown : contentHtml;

        try {
          // 方案1: 使用 ClipboardEvent 构造函数的 clipboardData 参数
          const dt = new DataTransfer();
          dt.setData('text/plain', contentToPaste);

          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          });

          editor.dispatchEvent(pasteEvent);
          console.log('[zhihu] Paste event dispatched with ClipboardEvent constructor');
        } catch (e) {
          console.warn('[zhihu] ClipboardEvent constructor failed:', e);

          // 方案2: 使用 Object.defineProperty 设置 clipboardData
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', contentToPaste);

            const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
            Object.defineProperty(pasteEvent, 'clipboardData', {
              get: () => dt,
              configurable: true
            });

            editor.dispatchEvent(pasteEvent);
            console.log('[zhihu] Paste event dispatched with Object.defineProperty');
          } catch (e2) {
            console.warn('[zhihu] Object.defineProperty paste also failed:', e2);
          }
        }

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(800);

        // 3. 处理 Markdown 解析弹窗（仅格式解析确认，不涉及发布）
        // 当知乎识别到 Markdown 格式时，会弹出"确认并解析"提示
        console.log('[zhihu] Step 3: 处理 Markdown 解析弹窗');
        await sleep(500);

        // 查找并点击"确认并解析"按钮（格式解析确认）
        let parseClicked = false;
        for (let i = 0; i < 20; i++) {
          // 查找所有按钮
          const allButtons = Array.from(document.querySelectorAll('button, [role="button"], .Button'));
          const parseBtn = allButtons.find((btn) => {
            const text = (btn.textContent || '').trim();
            // 匹配各种可能的解析确认按钮文案
            return text.includes('确认并解析') || 
                   text.includes('解析为') ||
                   text.includes('转换为') ||
                   text === '确认' ||
                   (text.includes('Markdown') && (text.includes('确认') || text.includes('解析')));
          });

          if (parseBtn) {
            console.log('[zhihu] Found Markdown parse button:', parseBtn.textContent);
            console.log('[zhihu] Clicking parse button (format conversion only, not publish)...');
            (parseBtn as HTMLElement).click();
            parseClicked = true;
            await sleep(2000);
            console.log('[zhihu] Markdown parse completed');
            break;
          }
          
          // 也检查弹窗/对话框中的按钮
          const dialogs = document.querySelectorAll('[role="dialog"], .Modal, .Popover, .css-1morss8');
          for (const dialog of dialogs) {
            const dialogBtn = Array.from(dialog.querySelectorAll('button')).find(btn => {
              const text = (btn.textContent || '').trim();
              return text.includes('确认') || text.includes('解析');
            });
            if (dialogBtn) {
              console.log('[zhihu] Found parse button in dialog:', dialogBtn.textContent);
              (dialogBtn as HTMLElement).click();
              parseClicked = true;
              await sleep(2000);
              break;
            }
          }
          if (parseClicked) break;
          
          await sleep(300);
        }
        
        if (!parseClicked) {
          console.log('[zhihu] No Markdown parse dialog found (may not be needed)');
        }

        // 3.5 在占位符位置插入图片
        if (imagePlaceholders.size > 0) {
          console.log('[zhihu] Step 3.5: 在占位符位置插入图片', { count: imagePlaceholders.size });

          // 重新获取编辑器（Markdown 解析后 DOM 可能已更新）
          const editorForImages = await waitForAny(editorSelectors);
          await sleep(500);

          // 在编辑器中查找并替换占位符
          const findAndReplacePlaceholder = async (
            placeholder: string,
            imageData: { base64: string; mimeType: string }
          ): Promise<boolean> => {
            // 使用 TreeWalker 遍历所有文本节点
            const walker = document.createTreeWalker(
              editorForImages,
              NodeFilter.SHOW_TEXT,
              null
            );

            let node: Text | null;
            while ((node = walker.nextNode() as Text)) {
              const text = node.textContent || '';
              const index = text.indexOf(placeholder);
              if (index !== -1) {
                console.log('[zhihu] Found placeholder:', placeholder, 'in text:', text.substring(0, 50));

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
                  const beforeUrls = new Set(collectImageUrls(editorForImages));

                  // 尝试 paste 事件
                  const pasteEvent = new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: dt
                  });
                  Object.defineProperty(pasteEvent, 'clipboardData', { get: () => dt });
                  editorForImages.dispatchEvent(pasteEvent);

                  // 4. 等待图片上传
                  console.log('[zhihu] Waiting for image upload...');
                  const result = await waitForNewImageUrl(editorForImages, beforeUrls, 15000);

                  if (result.url) {
                    console.log('[zhihu] Image uploaded successfully:', result.url);
                  } else {
                    console.warn('[zhihu] Image upload may have failed for placeholder:', placeholder);
                  }

                  // 5. 删除图片注释占位符
                  await sleep(300);
                  removeImageCaptions(editorForImages);

                  return true;
                } catch (e) {
                  console.error('[zhihu] Error replacing placeholder:', placeholder, e);
                  return false;
                }
              }
            }

            console.warn('[zhihu] Placeholder not found:', placeholder);
            return false;
          };

          // 逐个处理占位符
          for (const [placeholder, imageData] of imagePlaceholders) {
            console.log('[zhihu] Processing placeholder:', placeholder);
            await findAndReplacePlaceholder(placeholder, imageData);
            await sleep(500);
          }

          console.log('[zhihu] All image placeholders processed');
        }

        // 4. 内容填充完成，不执行发布操作
        // 根据统一发布控制原则：最终发布必须由用户手动完成
        console.log('[zhihu] Step 4: 内容填充完成');
        console.log('[zhihu] ⚠️ 发布操作需要用户手动完成');
        
        // 返回当前编辑页 URL，表示内容已填充完成
        return { 
          url: window.location.href,
          __synccasterNote: '内容已填充完成，请手动点击发布按钮完成发布'
        };
      } catch (error: any) {
        console.error('[zhihu] 填充失败:', error);
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
