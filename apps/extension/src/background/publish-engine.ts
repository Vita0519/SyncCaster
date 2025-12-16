import { db, type CanonicalPost, type PublishTarget, type LogEntry } from '@synccaster/core';
import { getAdapter } from '@synccaster/adapters';
import { executeInOrigin } from './inpage-runner';
import { ImageUploadPipeline, getImageStrategy, type ImageUploadProgress } from '@synccaster/core';
import type { AssetManifest } from '@synccaster/core';

export interface EngineResult {
  success: boolean;
  url?: string;
  remoteId?: string;
  error?: string;
  meta?: Record<string, any>;
}

export async function appendJobLog(jobId: string, entry: Omit<LogEntry, 'id' | 'timestamp'>) {
  const job = await db.jobs.get(jobId);
  if (!job) return;
  const log: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    level: entry.level,
    step: entry.step,
    message: entry.message,
    meta: entry.meta,
  };
  await db.jobs.update(jobId, { logs: [...job.logs, log], updatedAt: Date.now() });
}

/**
 * 获取微信公众号编辑页面 URL
 * 需要先打开主页获取 token，然后构建编辑页面 URL
 */
async function getWechatEditorUrl(homeUrl: string): Promise<string> {
  // 在微信公众号主页执行脚本获取 token
  const getTokenScript = async () => {
    // 尝试从 URL 获取 token
    const urlParams = new URLSearchParams(window.location.search);
    let token = urlParams.get('token');
    
    // 如果 URL 没有 token，尝试从页面中查找
    if (!token) {
      // 查找页面中的 token
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const match = script.textContent?.match(/token['":\s]+['"]?(\d+)['"]?/);
        if (match) {
          token = match[1];
          break;
        }
      }
    }
    
    // 尝试从全局变量获取
    if (!token && (window as any).wx && (window as any).wx.cgiData) {
      token = (window as any).wx.cgiData.token;
    }
    
    // 尝试从 localStorage 获取
    if (!token) {
      try {
        const stored = localStorage.getItem('wx_token');
        if (stored) token = stored;
      } catch (e) {}
    }
    
    return token;
  };
  
  // 执行脚本获取 token
  const token = await executeInOrigin(homeUrl, getTokenScript, [], { closeTab: false, active: true });
  
  if (!token) {
    throw new Error('无法获取微信公众号 token，请确保已登录');
  }
  
  // 构建编辑页面 URL
  const timestamp = Date.now();
  return `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&token=${token}&lang=zh_CN&timestamp=${timestamp}`;
}

export async function publishToTarget(
  jobId: string,
  post: CanonicalPost,
  target: PublishTarget,
): Promise<EngineResult> {
  console.log('[publish-engine] publishToTarget called', { jobId, platform: target.platform });
  
  let adapter: any;
  try {
    adapter = getAdapter(target.platform);
    console.log('[publish-engine] adapter loaded', { id: adapter.id, kind: adapter.kind });
  } catch (error: any) {
    console.error('[publish-engine] Failed to get adapter', error);
    return { success: false, error: `Adapter not found: ${target.platform}` };
  }

  const jobLogger = async (entry: Omit<LogEntry, 'id' | 'timestamp'>) => {
    console.log(`[publish-engine:${entry.step}]`, entry.message, entry.meta || '');
    await appendJobLog(jobId, entry);
  };

  try {
    await jobLogger({ level: 'info', step: 'adapter', message: `使用适配器: ${adapter.name} (${adapter.id}, kind: ${adapter.kind})` });

    // 读取账号
    const account = await db.accounts.get(target.accountId);
    if (!account) {
      await jobLogger({ level: 'error', step: 'auth', message: '账号不存在或未登录', meta: { accountId: target.accountId } });
      return { success: false, error: 'Account not found' };
    }

    // 认证
    const auth = await adapter.ensureAuth({ account });
    if (!auth?.valid) {
      await jobLogger({ level: 'error', step: 'auth', message: '认证无效，请先登录该平台', meta: { accountId: target.accountId } });
      return { success: false, error: 'Auth invalid' };
    }

    // 处理图片 - 对于 DOM 模式，图片将在发布时一起处理
    // 注意：部分来源的 Markdown 图片链接会混入空格/换行（例如 `. jpeg`），导致平台/上传无法识别。
    // 这里先规范化图片语法里的 URL，保证后续提取、上传、替换都基于同一个“干净 URL”。
    let processedPost = {
      ...post,
      body_md: normalizeMarkdownImageUrls(post.body_md || ''),
    };
    const manifest = buildAssetManifest(processedPost);
    const strategy = getImageStrategy(target.platform);
    
    // 处理图片：若目标平台不接受外链，需先上传并替换 URL（包括 domPasteUpload 模式）
    let downloadedImages: { url: string; base64: string; mimeType: string }[] = [];

    if (manifest.images.length > 0 && strategy && strategy.mode !== 'externalUrlOnly') {
      await jobLogger({ 
        level: 'info', 
        step: 'upload_images', 
        message: `发现 ${manifest.images.length} 张图片需要处理` 
      });
      
      try {
        const imageResult = await uploadImagesInPlatform(
          manifest.images.map(img => img.originalUrl),
          target.platform,
          strategy,
          (progress) => {
            jobLogger({
              level: 'info',
              step: 'upload_images',
              message: `图片上传: ${progress.completed}/${progress.total}`,
              meta: { progress },
            });
          }
        );
        
        if (imageResult.urlMapping.size > 0) {
          processedPost = {
            ...processedPost,
            body_md: ImageUploadPipeline.replaceImageUrls(processedPost.body_md || '', imageResult.urlMapping),
          };
          await jobLogger({
            level: 'info',
            step: 'upload_images',
            message: `图片处理完成: ${imageResult.stats.success}/${imageResult.stats.total} 成功`,
            meta: imageResult.stats,
          });
        } else {
          await jobLogger({ 
            level: 'warn', 
            step: 'upload_images', 
            message: '图片上传失败，将使用原始链接' 
          });
        }
      } catch (imgError: any) {
        console.error('[publish-engine] 图片处理失败', imgError);
        await jobLogger({
          level: 'warn',
          step: 'upload_images',
          message: '图片处理失败，将使用原始链接',
          meta: { error: imgError?.message },
        });
      }
    } else {
      await jobLogger({ level: 'info', step: 'upload_images', message: '无需处理图片或平台不支持' });
    }

    // 转换内容
    await jobLogger({ level: 'info', step: 'transform', message: '转换内容以适配目标平台' });
    const payload = await adapter.transform(processedPost as any, { config: target.config || {} });

    // 发布（根据 kind 路由）
    await jobLogger({ level: 'info', step: 'publish', message: `开始发布... (模式: ${adapter.kind})` });
    let result: any = null;

    // 路由策略
    if (adapter.kind === 'dom') {
      // DOM 自动化模式：直接走站内执行
      if ((adapter as any).dom) {
        const dom = (adapter as any).dom as { matchers: string[]; fillAndPublish: Function; getEditorUrl?: Function };
        
        // 获取目标 URL
        let targetUrl: string;
        
        // 微信公众号等平台需要动态获取编辑页面 URL
        if (target.platform === 'wechat') {
          // 微信公众号需要先打开主页获取 token，然后跳转到编辑页面
          await jobLogger({ level: 'info', step: 'dom', message: '微信公众号：获取编辑页面 URL' });
          
          try {
            // 先打开微信公众号主页
            const homeUrl = 'https://mp.weixin.qq.com/';
            const editorUrl = await getWechatEditorUrl(homeUrl);
            targetUrl = editorUrl;
            await jobLogger({ level: 'info', step: 'dom', message: `编辑页面 URL: ${targetUrl}` });
          } catch (e: any) {
            await jobLogger({ level: 'error', step: 'dom', message: '获取微信编辑页面失败，请确保已登录微信公众号', meta: { error: e?.message } });
            throw new Error('获取微信编辑页面失败，请确保已登录微信公众号');
          }
        } else {
          targetUrl = toDomOpenUrl(dom.matchers?.[0] || '');
        }
        
        if (!targetUrl) {
          throw new Error('DOM adapter missing target URL');
        }
        await jobLogger({ level: 'info', step: 'dom', message: '使用站内执行（DOM 自动化）' });
        console.log('[publish-engine] Executing DOM automation', { targetUrl });
        try {
          // 将下载的图片数据附加到 payload 中，供 fillAndPublish 使用
          const payloadWithImages = {
            ...payload,
            __downloadedImages: downloadedImages,
            __imageStrategy: strategy,
          };
          // 调试模式：不关闭标签页，显示窗口
          result = await executeInOrigin(targetUrl, dom.fillAndPublish as any, [payloadWithImages], { closeTab: false, active: true });
          console.log('[publish-engine] DOM automation result', result);
        } catch (e: any) {
          console.error('[publish-engine] DOM automation error', e);
          await jobLogger({ level: 'error', step: 'dom', message: 'DOM 自动化失败', meta: { error: e?.message, stack: e?.stack } });
          throw e;
        }
      } else {
        throw new Error('DOM adapter missing dom configuration');
      }
    } else if (adapter.kind === 'metaweblog' || adapter.kind === 'restApi') {
      // API 模式：直接调用 adapter.publish
      try {
        result = await adapter.publish(payload as any, {
          account,
          auth,
          assets: post.assets || [],
          logger: jobLogger,
        } as any);
      } catch (e: any) {
        await jobLogger({ level: 'error', step: 'publish', message: 'API 发布失败', meta: { error: e?.message } });
        // 尝试 DOM 降级（如果支持）
        if ((adapter as any).dom) {
          await jobLogger({ level: 'warn', step: 'publish', message: 'API 失败，尝试 DOM 降级' });
          const dom = (adapter as any).dom as { matchers: string[]; fillAndPublish: Function };
          const targetUrl = toDomOpenUrl(dom.matchers?.[0] || '');
          if (targetUrl) {
            result = await executeInOrigin(targetUrl, dom.fillAndPublish as any, [payload], { closeTab: true, active: false });
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    }

    // 对于 DOM 模式，如果 result 是 null（页面跳转导致脚本上下文丢失），认为发布成功
    if (!result || !result.url) {
      if (adapter.kind === 'dom') {
        // DOM 模式下，脚本返回 null 通常是因为页面跳转导致上下文丢失
        // 这种情况下我们假设发布成功
        console.log('[publish-engine] DOM automation returned null, assuming success due to page navigation');
        await jobLogger({ 
          level: 'info', 
          step: 'publish', 
          message: '发布完成（页面已跳转）',
          meta: { note: '由于页面跳转，无法获取文章链接，请手动查看' }
        });
        return { 
          success: true, 
          url: `https://${target.platform === 'juejin' ? 'juejin.cn/creator/content/article/essays?status=all' : target.platform + '.com'}`,
          meta: { autoDetected: true }
        };
      }
      throw new Error('发布未返回有效链接');
    }

    await jobLogger({ level: 'info', step: 'publish', message: '发布完成', meta: { url: result?.url } });

    return { success: true, url: result?.url, remoteId: result?.remoteId, meta: result?.meta };
  } catch (error: any) {
    console.error('[publish-engine] Publish failed', error);
    await jobLogger({ level: 'error', step: 'publish', message: '发布失败', meta: { error: error?.message || String(error), stack: error?.stack } });
    return { success: false, error: error?.message || error?.toString() || 'Publish failed' };
  }
}

async function fetchImageWithBestEffort(url: string): Promise<Response> {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();

  const commonHeaders: Record<string, string> = {
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  };

  const tryFetch = async (referrer?: string, referrerPolicy?: ReferrerPolicy) => {
    const init: RequestInit = {
      method: 'GET',
      credentials: 'omit',
      headers: commonHeaders,
      cache: 'no-store',
    };
    if (referrer !== undefined) (init as any).referrer = referrer;
    if (referrerPolicy !== undefined) init.referrerPolicy = referrerPolicy;
    return await fetch(url, init);
  };

  // CSDN 图床通常有防盗链：优先模拟来自 CSDN 博客域名的 Referer
  const referrerCandidates: Array<{ referrer?: string; policy?: ReferrerPolicy }> = [];

  if (host.endsWith('csdnimg.cn')) {
    referrerCandidates.push({ referrer: 'https://blog.csdn.net/', policy: 'unsafe-url' });
    referrerCandidates.push({ referrer: 'https://www.csdn.net/', policy: 'unsafe-url' });
  }

  // 默认：使用图片自身 origin 的 referrer（部分站点会校验同源/同站 referer）
  referrerCandidates.push({ referrer: u.origin + '/', policy: 'origin' });

  // 兜底：使用当前目标站点 origin（有些 CDN 仅要求存在可用 referer）
  referrerCandidates.push({ referrer: 'https://developer.aliyun.com/', policy: 'origin' });

  // 最后：不设置 referrer（浏览器默认策略）
  referrerCandidates.push({ referrer: undefined, policy: undefined });

  let lastError: any;
  for (const c of referrerCandidates) {
    try {
      const resp = await tryFetch(c.referrer, c.policy);
      if (resp.ok) return resp;

      // 若是 403/401，继续换 referrer 尝试
      if (resp.status === 401 || resp.status === 403) {
        continue;
      }
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('image download failed');
}


/**
 * 在 background 中下载图片（绕过 CORS/防盗链）
 */
async function downloadImagesInBackground(
  imageUrls: string[],
  onProgress?: (progress: { completed: number; total: number }) => void
): Promise<{ url: string; base64: string; mimeType: string }[]> {
  const downloadedImages: { url: string; base64: string; mimeType: string }[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    try {
      console.log(`[publish-engine] 下载图片 ${i + 1}/${imageUrls.length}: ${url}`);
      const response = await fetchImageWithBestEffort(url);

      if (!response.ok) {
        console.error(`[publish-engine] 下载失败: HTTP ${response.status}`);
        continue;
      }

      const blob = await response.blob();
      const base64 = await blobToBase64(blob);

      downloadedImages.push({
        url,
        base64,
        mimeType: blob.type || 'image/png',
      });

      onProgress?.({ completed: i + 1, total: imageUrls.length });
    } catch (error) {
      console.error(`[publish-engine] 下载异常: ${url}`, error);
    }
  }

  return downloadedImages;
}

/**
 * 平台主页 URL 映射
 */
const PLATFORM_URLS: Record<string, string> = {
  juejin: 'https://juejin.cn/',
  csdn: 'https://blog.csdn.net/',
  zhihu: 'https://www.zhihu.com/',
  wechat: 'https://mp.weixin.qq.com/',
  jianshu: 'https://www.jianshu.com/',
  cnblogs: 'https://www.cnblogs.com/',
  '51cto': 'https://blog.51cto.com/',
  'tencent-cloud': 'https://cloud.tencent.com/developer/',
  // 阿里云图片上传接口可能依赖页面环境（如 CSRF meta），使用新建文章页更稳妥
  aliyun: 'https://developer.aliyun.com/article/new#/',
  segmentfault: 'https://segmentfault.com/',
  bilibili: 'https://www.bilibili.com/',
  oschina: 'https://www.oschina.net/',
};

function toDomOpenUrl(matcherOrUrl: string) {
  // DOM adapter matchers 通常包含通配符（用于匹配页面），但 executeInOrigin 需要真实 URL。
  // 规则：取第一个 `*` 之前的部分作为可打开的 URL（避免把 `*` 当作字面量打开）。
  const idx = matcherOrUrl.indexOf('*');
  return idx >= 0 ? matcherOrUrl.slice(0, idx) : matcherOrUrl;
}

/**
 * 在目标平台页面中执行图片上传
 * 
 * 策略：
 * 1. 在 background (Service Worker) 中下载图片 - 可以绑过 CORS/防盗链
 * 2. 将图片数据（base64）传递给目标平台页面
 * 3. 在目标平台页面中上传图片 - 利用用户的登录状态
 */
async function uploadImagesInPlatform(
  imageUrls: string[],
  platformId: string,
  strategy: any,
  onProgress?: (progress: { completed: number; total: number }) => void
): Promise<{
  urlMapping: Map<string, string>;
  stats: { total: number; success: number; failed: number };
}> {
  const targetUrl =
    strategy?.mode === 'domPasteUpload' && strategy.domPasteConfig?.editorUrl
      ? strategy.domPasteConfig.editorUrl
      : PLATFORM_URLS[platformId];

  if (!targetUrl) {
    console.log(`[publish-engine] 未知平台 ${platformId}，跳过图片上传`);
    return {
      urlMapping: new Map(),
      stats: { total: imageUrls.length, success: 0, failed: imageUrls.length },
    };
  }

  console.log(`[publish-engine] 准备上传 ${imageUrls.length} 张图片到 ${platformId}`);
  console.log('[publish-engine] 步骤1: 在 background 中下载图片...');
  const downloadedImages: { url: string; base64: string; mimeType: string }[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    try {
      console.log(`[publish-engine] 下载图片 ${i + 1}/${imageUrls.length}: ${url}`);
      const response = await fetchImageWithBestEffort(url);

      if (!response.ok) {
        console.error(`[publish-engine] 下载失败: HTTP ${response.status}`);
        continue;
      }

      const blob = await response.blob();
      const base64 = await blobToBase64(blob);

      downloadedImages.push({
        url,
        base64,
        mimeType: blob.type || 'image/png',
      });

      onProgress?.({ completed: i + 1, total: imageUrls.length * 2 });
    } catch (error) {
      console.error(`[publish-engine] 下载异常: ${url}`, error);
    }
  }

  if (downloadedImages.length === 0) {
    console.log('[publish-engine] 没有成功下载任何图片');
    return {
      urlMapping: new Map(),
      stats: { total: imageUrls.length, success: 0, failed: imageUrls.length },
    };
  }

  console.log(`[publish-engine] 步骤2: 在 ${targetUrl} 中上传 ${downloadedImages.length} 张图片`);

  const uploadFunction = async (
    images: { url: string; base64: string; mimeType: string }[],
    strategyConfig: any
  ) => {
    console.log('[image-upload] 开始在页面中上传图片', { count: images.length, mode: strategyConfig.mode });
    
    const results: { originalUrl: string; newUrl: string; success: boolean; error?: string }[] = [];

    const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
      const res = await fetch(dataUrl);
      if (!res.ok) {
        throw new Error('dataURL fetch failed: ' + res.status);
      }
      return await res.blob();
    };

    const collectUrls = (root: ParentNode): string[] => {
      const urls: string[] = [];
      Array.from(root.querySelectorAll<HTMLImageElement>('img')).forEach((el) => el.src && urls.push(el.src));
      Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).forEach((a) => a.href && urls.push(a.href));
      const text = (root as HTMLElement).innerText || '';
      const regex = /(https?:\/\/[^\s"'<>]+)/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        urls.push(m[1]);
      }
      return urls;
    };

    const waitForNewUrl = (
      root: HTMLElement,
      beforeSet: Set<string>,
      timeoutMs: number
    ): Promise<string> => {
      return new Promise((resolve, reject) => {
        const seen = new Set(beforeSet);

        const checkOnce = () => {
          const urls = collectUrls(root);
          for (const u of urls) {
            if (!u || seen.has(u)) continue;
            if (u.startsWith('data:') || u.startsWith('blob:')) continue;
            observer.disconnect();
            clearTimeout(timer);
            resolve(u);
            return;
          }
        };

        const observer = new MutationObserver(() => checkOnce());
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src', 'href'],
        });

        checkOnce();

        const timer = window.setTimeout(() => {
          observer.disconnect();
          reject(new Error('waitForNewUrl timeout'));
        }, timeoutMs);
      });
    };

    const waitForNewUrlInText = async (
      el: HTMLTextAreaElement | HTMLInputElement,
      beforeText: string,
      originalUrl: string,
      timeoutMs: number
    ): Promise<string> => {
      const start = Date.now();
      const norm = (u: string) => (u.startsWith('//') ? 'https:' + u : u);
      const urlRe = /(?:https?:)?\/\/[^\s)'"<>]+/g;

      while (Date.now() - start < timeoutMs) {
        const current = el.value || '';
        if (current !== beforeText) {
          const matches = current.match(urlRe) || [];
          for (let i = matches.length - 1; i >= 0; i--) {
            const candidate = norm(matches[i]);
            if (!candidate) continue;
            if (candidate === originalUrl) continue;
            if (beforeText.includes(candidate)) continue;
            return candidate;
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      throw new Error('waitForNewUrlInText timeout');
    };

    const ensureEditor = async (selector: string, timeoutMs: number): Promise<HTMLElement | null> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const node = document.querySelector<HTMLElement>(selector);
        if (node) return node;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    };

    const focusEditor = async (el: HTMLElement) => {
      try {
        if (typeof window !== 'undefined' && typeof window.focus === 'function') {
          window.focus();
        }
      } catch (_) {}
      if (typeof el.focus === 'function') {
        el.focus();
      }
      try {
        el.dispatchEvent(new Event('focus', { bubbles: true }));
      } catch (_) {}
      if (typeof (el as any).click === 'function') {
        try {
          (el as any).click();
        } catch (_) {}
      }
      await new Promise((r) => setTimeout(r, 80));
    };
    
    if (strategyConfig.mode === 'domPasteUpload' && (window as any).__juejinDomPaste) {
      const cfg = strategyConfig.domPasteConfig || {};
      try {
        const resp = await (window as any).__juejinDomPaste(images, cfg);
        return resp;
      } catch (e) {
        console.error('[image-upload] __juejinDomPaste failed, fallback to local logic', e);
      }
    }

    for (const img of images) {
      try {
        if (strategyConfig.mode === 'domPasteUpload') {
          const cfg = strategyConfig.domPasteConfig || {};
          const editor =
            (cfg.editorSelector &&
              (await ensureEditor(cfg.editorSelector, cfg.timeoutMs || 15000))) ||
            document.querySelector<HTMLElement>(cfg.editorSelector || 'body');
          if (!editor) {
            throw new Error('未找到编辑区：' + (cfg.editorSelector || 'body'));
          }

          const blob = await dataUrlToBlob(img.base64);
          const file = new File([blob], 'image_' + Date.now(), { type: blob.type || img.mimeType });

          const isTextInput = (node: any): node is HTMLTextAreaElement | HTMLInputElement =>
            node && typeof node.value === 'string';

          const pasteTarget =
            (editor.matches?.('textarea, input, [contenteditable="true"]') ? editor : null) ||
            (editor.querySelector?.('textarea, input, [contenteditable="true"]') as HTMLElement | null) ||
            editor;

          await focusEditor(pasteTarget);

          const beforeText = isTextInput(pasteTarget) ? (pasteTarget.value || '') : '';

          const beforeSrcSet = new Set(Array.from(editor.querySelectorAll('img')).map((el: any) => el.src));

          const simulatePaste = (): boolean => {
            try {
              const dt = new DataTransfer();
              dt.items.add(file);
              const event = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt,
              } as ClipboardEventInit);
              Object.defineProperty(event, 'clipboardData', {
                get: () => dt,
              });
              return pasteTarget.dispatchEvent(event);
            } catch (e) {
              console.error('[image-upload] simulate paste failed', e);
              return false;
            }
          };

          const simulateDrop = (): boolean => {
            try {
              const dt = new DataTransfer();
              dt.items.add(file);
              const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true });
              Object.defineProperty(dragOver, 'dataTransfer', { get: () => dt });
              pasteTarget.dispatchEvent(dragOver);
              const drop = new DragEvent('drop', { bubbles: true, cancelable: true });
              Object.defineProperty(drop, 'dataTransfer', { get: () => dt });
              return pasteTarget.dispatchEvent(drop);
            } catch (e) {
              console.error('[image-upload] simulate drop failed', e);
              return false;
            }
          };

          let pastedOk = simulatePaste();

          // 若浏览器阻止 clipboardData，尝试 drop 事件；再不行再试 execCommand 备选
          if (!pastedOk) {
            pastedOk = simulateDrop();
          }
          if (!pastedOk && document.execCommand) {
            await focusEditor(pasteTarget);
            pastedOk = document.execCommand('paste');
          }

          if (!pastedOk) {
            throw new Error('触发粘贴失败：浏览器未接受事件');
          }

          const newUrl = isTextInput(pasteTarget)
            ? await waitForNewUrlInText(pasteTarget, beforeText, img.url, cfg.timeoutMs || 30000)
            : await waitForNewUrl(editor, beforeSrcSet, cfg.timeoutMs || 30000);

          console.log('[image-upload] DOM 粘贴成功:', newUrl);
          results.push({ originalUrl: img.url, newUrl, success: true });
          continue;
        }

        if (!strategyConfig.uploadUrl) {
          throw new Error('未配置上传 URL');
        }

        const blob = await dataUrlToBlob(img.base64);

        const formData = new FormData();
        const ext = img.mimeType.split('/')[1] || 'png';
        const filename = 'image_' + Date.now() + '.' + ext;
        const file = new File([blob], filename, { type: img.mimeType });
        formData.append(strategyConfig.fileFieldName || 'file', file);

        if (strategyConfig.extraFields) {
          for (const [key, value] of Object.entries(strategyConfig.extraFields)) {
            formData.append(key, value as string);
          }
        }

        const headers: Record<string, string> = {};

        if (strategyConfig.csrfToken) {
          const { type, name, headerName } = strategyConfig.csrfToken;
          let token: string | null = null;

          if (type === 'cookie') {
            const match = document.cookie.match(new RegExp(name + '=([^;]+)'));
            token = match ? match[1] : null;
          } else if (type === 'meta') {
            const meta = document.querySelector('meta[name="' + name + '"]');
            token = meta?.getAttribute('content') || null;
          }

          if (token) {
            headers[headerName || name] = token;
          }
        }

        // 通用兜底：很多站点（含阿里系）会把 CSRF/XSRF 放在 cookie 或 meta 中，
        // 但策略可能未显式配置。这里做一次轻量自动探测，提升“站内上传 API”的成功率。
        const getCookie = (name: string) => {
          const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
          return m ? decodeURIComponent(m[1]) : null;
        };
        const getMeta = (name: string) => {
          const meta = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
          return meta?.getAttribute('content') || null;
        };

        const xsrfCookie =
          getCookie('XSRF-TOKEN') ||
          getCookie('xsrf-token') ||
          getCookie('_xsrf') ||
          getCookie('csrfToken') ||
          getCookie('csrf-token') ||
          getCookie('_csrf');

        const csrfMeta =
          getMeta('csrf-token') ||
          getMeta('_csrf') ||
          getMeta('csrf') ||
          getMeta('x-csrf-token');

        if (xsrfCookie) {
          if (!headers['x-xsrf-token']) headers['x-xsrf-token'] = xsrfCookie;
          if (!headers['x-csrftoken']) headers['x-csrftoken'] = xsrfCookie;
        }
        if (csrfMeta) {
          if (!headers['x-csrf-token']) headers['x-csrf-token'] = csrfMeta;
          if (!headers['csrf-token']) headers['csrf-token'] = csrfMeta;
        }
        if (!headers['x-requested-with']) headers['x-requested-with'] = 'XMLHttpRequest';

        const uploadResponse = await fetch(strategyConfig.uploadUrl, {
          method: strategyConfig.method || 'POST',
          headers,
          body: formData,
          credentials: 'include',
        });

        if (!uploadResponse.ok) {
          const textResp = await uploadResponse.text();
          throw new Error('上传失败: HTTP ' + uploadResponse.status + ' - ' + textResp.substring(0, 100));
        }

        const data = await uploadResponse.json();
        let newUrl: string | undefined;

        if (data.data) {
          newUrl = data.data.url || data.data.url_1 || data.data.image_url || data.data.imageUrl;
        }

        if (!newUrl) {
          newUrl = data.url || data.result?.url || data.imageUrl || data.src || data.image_url;
        }

        if (!newUrl && typeof data === 'object') {
          const findUrl = (obj: any, depth = 0): string | undefined => {
            if (depth > 3 || !obj) return undefined;
            if (typeof obj === 'string' && (obj.startsWith('http://') || obj.startsWith('https://'))) {
              return obj;
            }
            if (typeof obj === 'object') {
              for (const key of ['url', 'url_1', 'image_url', 'imageUrl', 'src', 'path']) {
                if (obj[key] && typeof obj[key] === 'string') {
                  const val = obj[key];
                  if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('//')) {
                    return val.startsWith('//') ? 'https:' + val : val;
                  }
                }
              }
              for (const val of Object.values(obj)) {
                const found = findUrl(val, depth + 1);
                if (found) return found;
              }
            }
            return undefined;
          };
          newUrl = findUrl(data);
        }

        if (!newUrl) {
          throw new Error('无法从响应中解析图片 URL: ' + JSON.stringify(data).substring(0, 200));
        }

        results.push({ originalUrl: img.url, newUrl, success: true });
      } catch (error: any) {
        console.error('[image-upload] 上传失败:', img.url, error);
        results.push({ originalUrl: img.url, newUrl: img.url, success: false, error: (error?.message ?? String(error)) });
      }
    }

    return results;
  };

  try {
    // `chrome.scripting.executeScript` 参数需要可结构化克隆，策略对象里可能包含函数等不可序列化字段。
    // 这里显式做一次 JSON 序列化以剥离不可序列化字段（如 responseParser）。
    const serializableStrategy = JSON.parse(JSON.stringify(strategy));
    const results = await executeInOrigin(
      targetUrl,
      uploadFunction,
      [downloadedImages, serializableStrategy],
      { closeTab: true, active: strategy.mode === 'domPasteUpload' }
    );

    const urlMapping = new Map<string, string>();
    let success = 0;
    let failed = 0;

    for (const result of results) {
      if (result.success) {
        urlMapping.set(result.originalUrl, result.newUrl);
        success++;
      } else {
        failed++;
      }
      onProgress?.({ completed: success + failed, total: imageUrls.length });
    }

    return {
      urlMapping,
      stats: { total: imageUrls.length, success, failed },
    };
  } catch (error: any) {
    console.error('[publish-engine] 图片上传执行失败', error);
    return {
      urlMapping: new Map(),
      stats: { total: imageUrls.length, success: 0, failed: imageUrls.length },
    };
  }
}

async function processImagesForPlatform(
  post: CanonicalPost,
  platformId: string,
  onProgress?: (progress: ImageUploadProgress) => void
): Promise<{
  urlMapping: Map<string, string>;
  stats: { total: number; success: number; failed: number };
}> {
  // 获取平台的图片上传策略
  const strategy = getImageStrategy(platformId);
  
  if (!strategy) {
    console.log(`[publish-engine] 平台 ${platformId} 无图片上传策略，跳过图片处理`);
    return {
      urlMapping: new Map(),
      stats: { total: 0, success: 0, failed: 0 },
    };
  }

  // 如果策略是直接使用外链，跳过处理
  if (strategy.mode === 'externalUrlOnly') {
    console.log(`[publish-engine] 平台 ${platformId} 使用外链模式，跳过图片处理`);
    return {
      urlMapping: new Map(),
      stats: { total: 0, success: 0, failed: 0 },
    };
  }

  // 构建资产清单
  const manifest = buildAssetManifest(post);
  
  if (manifest.images.length === 0) {
    return {
      urlMapping: new Map(),
      stats: { total: 0, success: 0, failed: 0 },
    };
  }

  console.log(`[publish-engine] 发现 ${manifest.images.length} 张图片需要处理`);

  // 创建图片上传管道
  const pipeline = new ImageUploadPipeline({
    concurrency: 3,
    timeout: 30000,
    maxRetries: 2,
    onProgress,
  });

  // 处理图片
  const urlMapping = await pipeline.processImages(manifest, strategy, platformId);

  const stats = {
    total: manifest.images.length,
    success: urlMapping.size,
    failed: manifest.images.length - urlMapping.size,
  };

  return { urlMapping, stats };
}

/**
 * 从文章内容构建资产清单
 */
function buildAssetManifest(post: CanonicalPost): AssetManifest {
  const images: AssetManifest['images'] = [];
  const seen = new Set<string>();

  // 从 Markdown 内容提取图片
  if (post.body_md) {
    const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = mdImageRegex.exec(post.body_md)) !== null) {
      const url = (match[2] || '').trim();
      if (url && !seen.has(url) && isExternalImage(url)) {
        seen.add(url);
        images.push({
          id: `img-${images.length}`,
          originalUrl: url,
          metadata: {
            format: guessImageFormat(url),
            size: 0,
            alt: match[1] || undefined,
          },
          status: 'pending',
        });
      }
    }
  }

  // 如果文章已有 assets，合并
  if (post.assets) {
    for (const asset of post.assets) {
      // AssetRef 使用 url 字段
      if (asset.type === 'image' && asset.url && !seen.has(asset.url)) {
        seen.add(asset.url);
        images.push({
          id: asset.id || `img-${images.length}`,
          originalUrl: asset.url,
          metadata: {
            format: guessImageFormat(asset.url),
            size: 0,
            alt: asset.alt,
          },
          status: 'pending',
        });
      }
    }
  }

  return {
    images,
    formulas: [],
  };
}

/**
 * 判断是否为外部图片（需要处理的图片）
 */
function isExternalImage(url: string): boolean {
  if (!url) return false;
  
  // 跳过 data URL
  if (url.startsWith('data:')) return false;
  
  // 跳过相对路径
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  
  // 可以添加更多规则，比如跳过某些已知的公共 CDN
  return true;
}

/**
 * 猜测图片格式
 */
function guessImageFormat(url: string): 'jpeg' | 'png' | 'webp' | 'gif' | 'svg' | 'avif' {
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'gif':
      return 'gif';
    case 'svg':
      return 'svg';
    case 'avif':
      return 'avif';
    default:
      return 'jpeg';
  }
}

function normalizeMarkdownImageUrls(markdown: string): string {
  if (!markdown) return markdown;

  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, rawInner: string) => {
    let inner = String(rawInner || '').trim();

    // 分离可选 title（通常以引号开始），避免把 title 里的空格也压缩掉
    let titlePart = '';
    const quoteIdx = inner.search(/["']/);
    if (quoteIdx > 0) {
      titlePart = inner.slice(quoteIdx).trim();
      inner = inner.slice(0, quoteIdx).trimEnd();
    }

    // 支持 ![](<url>) 写法：去掉包裹的尖括号
    if (inner.startsWith('<') && inner.endsWith('>')) {
      inner = inner.slice(1, -1);
    }

    // 去除 URL 中可能混入的空格/换行（如 `. jpeg`）
    const normalizedUrl = inner.replace(/\s+/g, '');

    return `![${alt}](${normalizedUrl}${titlePart ? ' ' + titlePart : ''})`;
  });
}


/**
 * 将 Blob 转换为 base64 字符串（Service Worker 兼容）
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const mimeType = blob.type || 'image/png';
  return `data:${mimeType};base64,${base64}`;
}
