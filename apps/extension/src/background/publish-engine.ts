import { db, type CanonicalPost, type PublishTarget, type LogEntry } from '@synccaster/core';
import { getAdapter } from '@synccaster/adapters';
import { executeInOrigin } from './inpage-runner';

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

    // 转换内容
    await jobLogger({ level: 'info', step: 'transform', message: '转换内容以适配目标平台' });
    const payload = await adapter.transform(post as any, { config: target.config || {} });

    // 发布（根据 kind 路由）
    await jobLogger({ level: 'info', step: 'publish', message: `开始发布... (模式: ${adapter.kind})` });
    let result: any = null;

    // 路由策略
    if (adapter.kind === 'dom') {
      // DOM 自动化模式：直接走站内执行
      if ((adapter as any).dom) {
        const dom = (adapter as any).dom as { matchers: string[]; fillAndPublish: Function };
        const targetUrl = dom.matchers?.[0];
        if (!targetUrl) {
          throw new Error('DOM adapter missing target URL');
        }
        await jobLogger({ level: 'info', step: 'dom', message: '使用站内执行（DOM 自动化）' });
        console.log('[publish-engine] Executing DOM automation', { targetUrl });
        try {
          // 调试模式：不关闭标签页，显示窗口
          result = await executeInOrigin(targetUrl, dom.fillAndPublish as any, [payload], { closeTab: false, active: true });
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
          const targetUrl = dom.matchers?.[0];
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

    if (!result || !result.url) {
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
