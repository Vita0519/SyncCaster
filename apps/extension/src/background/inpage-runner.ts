/* In-page runner utilities: open target origin in a background tab and execute code in page MAIN world */

export async function waitForLoad(tabId: number, timeoutMs = 30000): Promise<void> {
  const started = Date.now();
  return new Promise<void>((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) return;
        if (tab.status === 'complete') {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error('waitForLoad timeout'));
        }
      } catch (e) {
        clearInterval(timer);
        reject(e as Error);
      }
    }, 300);
  });
}

export async function executeInOrigin<T>(
  url: string,
  fn: (...args: any[]) => Promise<T> | T,
  args: any[] = [],
  opts: { closeTab?: boolean; active?: boolean } = { closeTab: true, active: false }
): Promise<T> {
  console.log('[inpage-runner] executeInOrigin', { url, active: opts.active });
  
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.create({ url, active: !!opts.active });
    console.log('[inpage-runner] Tab created', { tabId: tab.id });
    
    if (!tab.id) {
      throw new Error('Failed to create tab');
    }
    
    await waitForLoad(tab.id);
    console.log('[inpage-runner] Tab loaded, executing script');
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: fn,
      args,
    });
    
    console.log('[inpage-runner] Script executed', { resultCount: results?.length });
    
    if (!results || results.length === 0) {
      throw new Error('Script execution returned no results');
    }
    
    const [result] = results;
    
    if (!result) {
      console.error('[inpage-runner] No result object returned');
      throw new Error('Script execution returned no result object');
    }
    
    console.log('[inpage-runner] Raw result:', result);
    
    // 检查是否有错误（某些情况下 Chrome 会返回错误信息）
    if ((result as any).error) {
      console.error('[inpage-runner] Script had error:', (result as any).error);
      throw new Error(`Script error: ${(result as any).error}`);
    }
    
    // 允许 null 和 undefined 作为有效的返回值，但记录警告
    if (result.result === null || result.result === undefined) {
      console.warn('[inpage-runner] Script returned null/undefined - this might indicate an error in the script');
      console.warn('[inpage-runner] Please check the target page console for errors');
    }
    
    console.log('[inpage-runner] Execution successful', result.result);
    return result.result as T;
  } catch (error: any) {
    console.error('[inpage-runner] executeInOrigin failed', error);
    throw error;
  } finally {
    if (opts.closeTab && tab?.id) {
      try { 
        await chrome.tabs.remove(tab.id); 
        console.log('[inpage-runner] Tab closed', { tabId: tab.id });
      } catch (e) {
        console.warn('[inpage-runner] Failed to close tab', e);
      }
    }
  }
}
