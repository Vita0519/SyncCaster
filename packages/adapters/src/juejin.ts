import type { PlatformAdapter } from './base';

/**
 * 掘金适配器
 * 
 * 平台特点：
 * - 入口：https://juejin.cn/editor/drafts/new?v=2
 * - 编辑器：Markdown 编辑器（bytemd）
 * - 支持：Markdown 语法、LaTeX 公式
 * - 结构：标题输入框 + 正文编辑器
 */
export const juejinAdapter: PlatformAdapter = {
  id: 'juejin',
  name: '掘金',
  kind: 'dom',
  icon: 'juejin',
  capabilities: {
    domAutomation: true,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsTags: true,
    supportsCategories: true,
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
    // 掘金支持标准 Markdown + LaTeX，无需特殊转换
    return {
      title: post.title,
      contentMarkdown: post.body_md,
      cover: post.cover,
      tags: post.tags,
      categories: post.categories,
      summary: post.summary,
      meta: { assets: post.assets || [] },
    };
  },

  async publish(payload, ctx) {
    throw new Error('juejin: use DOM automation');
  },

  dom: {
    // 第一个必须是具体 URL（用于 chrome.tabs.create）
    matchers: [
      'https://juejin.cn/editor/drafts/new?v=2',
    ],
    fillAndPublish: function(payload: any): Promise<{ url: string }> {
      // 使用纯 JavaScript 风格函数（避免 TypeScript 类型注解在注入时的问题）
      console.log('[juejin] fillAndPublish starting', payload);
      
      function sleep(ms: number): Promise<void> {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
      }
      
      function waitFor(selector: string, timeout?: number): Promise<HTMLElement> {
        const t = timeout || 15000;
        return new Promise(function(resolve, reject) {
          const start = Date.now();
          function check() {
            const el = document.querySelector(selector) as HTMLElement | null;
            if (el) {
              resolve(el);
            } else if (Date.now() - start > t) {
              reject(new Error('等待元素超时: ' + selector));
            } else {
              setTimeout(check, 200);
            }
          }
          check();
        });
      }

      return (async function() {
        try {
          // 1. 填充标题
          console.log('[juejin] Step 1: 填充标题');
          const titleInput = await waitFor('.title-input input, input[placeholder*="标题"]') as HTMLInputElement;
          titleInput.value = payload.title || '';
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(300);

          // 2. 填充内容 - 掘金使用 bytemd 编辑器
          console.log('[juejin] Step 2: 填充内容');
          const markdown = payload.contentMarkdown || '';
          
          // 尝试找到 bytemd 的 textarea
          const bytemdTextarea = document.querySelector('.bytemd-editor textarea, .CodeMirror textarea') as HTMLTextAreaElement | null;
          if (bytemdTextarea) {
            bytemdTextarea.focus();
            bytemdTextarea.value = markdown;
            bytemdTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            // 尝试 CodeMirror
            const cm = document.querySelector('.CodeMirror') as any;
            if (cm && cm.CodeMirror) {
              cm.CodeMirror.setValue(markdown);
            } else {
              throw new Error('未找到掘金编辑器');
            }
          }
          await sleep(500);

          // 3. 点击顶部"发布"按钮打开发布弹窗
          console.log('[juejin] Step 3: 点击发布按钮');
          // 顶部发布按钮通常在 header 区域，文字是"发布"而不是"确定并发布"
          const allBtns = Array.from(document.querySelectorAll('button'));
          const publishBtn = allBtns.find(function(btn) { 
            const text = btn.textContent?.trim();
            // 排除"确定并发布"，只找"发布"
            return text === '发布'; 
          }) as HTMLElement | null;
          
          if (!publishBtn) throw new Error('未找到顶部发布按钮');
          console.log('[juejin] 找到顶部发布按钮:', publishBtn.textContent);
          publishBtn.click();
          await sleep(2000);

          // 4. 处理发布弹窗
          console.log('[juejin] Step 4: 处理发布弹窗');
          
          // 等待弹窗出现
          let modalFound = false;
          for (let retry = 0; retry < 10; retry++) {
            const modal = document.querySelector('.publish-popup, [class*="publish-popup"], [class*="modal"], .editor-publish-dialog');
            if (modal) {
              modalFound = true;
              console.log('[juejin] 发现发布弹窗');
              break;
            }
            await sleep(500);
          }
          
          if (!modalFound) {
            console.log('[juejin] 警告：未发现弹窗');
          }
          
          // 4.1 选择分类（必选）
          console.log('[juejin] Step 4.1: 选择分类');
          const categorySelectors = [
            '.category-list .item:not(.active)',
            '[class*="category"] .item:not(.active)',
          ];
          
          let categorySelected = false;
          for (const sel of categorySelectors) {
            const items = document.querySelectorAll(sel);
            console.log('[juejin] 尝试分类选择器', sel, '找到', items.length, '个');
            if (items.length > 0) {
              // 选择第一个分类（后端）
              (items[0] as HTMLElement).click();
              categorySelected = true;
              console.log('[juejin] 已选择分类:', (items[0] as HTMLElement).textContent?.trim());
              await sleep(500);
              break;
            }
          }
          
          if (!categorySelected) {
            console.warn('[juejin] 未能选择分类');
          }
          
          // 4.2 添加标签（必选，至少一个）
          console.log('[juejin] Step 4.2: 添加标签');
          // 掘金标签是点击输入框后从下拉列表选择
          const tagInput = document.querySelector('input[placeholder*="标签"], input[placeholder*="搜索添加标签"], .tag-input input') as HTMLInputElement | null;
          if (tagInput) {
            console.log('[juejin] 找到标签输入框');
            tagInput.focus();
            tagInput.click();
            await sleep(500);
            
            // 等待标签下拉列表出现，选择第一个推荐标签
            const tagDropdown = document.querySelector('.tag-list, [class*="tag-list"], [class*="dropdown"]');
            if (tagDropdown) {
              const tagItem = tagDropdown.querySelector('.item, .tag-item, li') as HTMLElement | null;
              if (tagItem) {
                tagItem.click();
                console.log('[juejin] 已选择标签:', tagItem.textContent?.trim());
                await sleep(300);
              }
            } else {
              // 尝试直接输入一个常见标签
              tagInput.value = '前端';
              tagInput.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(500);
              // 回车确认
              tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              await sleep(300);
            }
          } else {
            // 尝试其他方式：找到"添加标签"按钮
            const addTagBtn = Array.from(document.querySelectorAll('span, div, button')).find(function(el) {
              return el.textContent?.includes('添加标签') || el.textContent?.includes('搜索添加');
            }) as HTMLElement | null;
            if (addTagBtn) {
              console.log('[juejin] 找到添加标签按钮');
              addTagBtn.click();
              await sleep(500);
            }
          }
          await sleep(500);
          
          // 4.3 填写摘要（必选，不超过100字）
          console.log('[juejin] Step 4.3: 填写摘要');
          const summaryTextarea = document.querySelector('textarea[placeholder*="摘要"], textarea[placeholder*="简介"], .summary-input textarea, [class*="abstract"] textarea') as HTMLTextAreaElement | null;
          if (summaryTextarea) {
            // 使用文章摘要，或截取内容前100字
            const summary = payload.summary || (payload.contentMarkdown || '').substring(0, 100).replace(/[#*`\[\]]/g, '');
            summaryTextarea.focus();
            summaryTextarea.value = summary;
            summaryTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('[juejin] 已填写摘要:', summary.substring(0, 30) + '...');
            await sleep(300);
          } else {
            console.warn('[juejin] 未找到摘要输入框');
          }
          
          await sleep(500);
          
          // 5. 点击"确定并发布"按钮
          console.log('[juejin] Step 5: 点击确定并发布');
          const confirmBtn = Array.from(document.querySelectorAll('button')).find(function(btn) { 
            const text = btn.textContent?.trim() || '';
            return text.includes('确定并发布') || text === '确认发布';
          }) as HTMLElement | null;
          
          if (confirmBtn) {
            console.log('[juejin] 找到确定并发布按钮');
            confirmBtn.click();
            await sleep(2000);
          } else {
            console.error('[juejin] 未找到确定并发布按钮');
            throw new Error('未找到确定并发布按钮');
          }

          // 6. 等待跳转获取文章 URL
          console.log('[juejin] Step 6: 等待文章 URL');
          for (let i = 0; i < 40; i++) {
            if (/juejin\.cn\/post\/\d+/.test(window.location.href)) {
              console.log('[juejin] 发布成功:', window.location.href);
              return { url: window.location.href };
            }
            await sleep(500);
          }

          throw new Error('发布超时：未跳转到文章页');
        } catch (error) {
          console.error('[juejin] 发布失败:', error);
          throw error;
        }
      })();
    },
  },
};
