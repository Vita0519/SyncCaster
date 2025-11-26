import { executeInOrigin } from './inpage-runner';

export async function startZhihuLearn(): Promise<{ success: boolean }>{
  await executeInOrigin('https://zhuanlan.zhihu.com/write', async () => {
    // Install recorder in page MAIN world
    (window as any).__SC_REC__ = [];

    function log(rec: any) {
      try { (window as any).__SC_REC__.push({ ...rec, ts: Date.now() }); } catch {}
    }

    // Visual overlay to guide user
    try {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;z-index:2147483647;left:0;right:0;top:0;padding:10px 16px;background:#111;color:#fff;font-size:14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      overlay.textContent = 'SyncCaster 学习模式：请在本页正常发布一次文章，发布完成后保持本页不关闭，扩展将自动提取API模板。';
      document.documentElement.appendChild(overlay);
    } catch {}

    // Patch fetch
    const origFetch = window.fetch;
    window.fetch = async (...args: any[]) => {
      const [input, init] = args as [RequestInfo, RequestInit?];
      const url = (typeof input === 'string') ? input : (input as Request).url;
      const method = (init?.method || (input as any)?.method || 'GET').toUpperCase();
      const body = init?.body || (input as any)?.body;
      const headers = init?.headers;
      const res = await origFetch.apply(window, args as any);
      try {
        if (/zhuanlan\.zhihu\.com\/api\//.test(url) && /POST|PUT/i.test(method)) {
          log({ kind: 'fetch', url, method, headers, body: body ? String(body) : undefined, status: res.status });
        }
      } catch {}
      return res;
    };

    // Patch XHR
    const XHR = (window as any).XMLHttpRequest;
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function(this: XMLHttpRequest, method: string, url: string, ...rest: any[]) {
      (this as any).__sc__ = { method, url };
      return open.call(this, method, url, ...rest);
    } as any;
    XHR.prototype.send = function(this: XMLHttpRequest, body?: any) {
      try {
        const meta = (this as any).__sc__ || {};
        const url: string = meta.url || '';
        const method: string = (meta.method || 'GET').toUpperCase();
        this.addEventListener('loadend', () => {
          try {
            if (/zhuanlan\.zhihu\.com\/api\//.test(url) && /POST|PUT/i.test(method)) {
              log({ kind: 'xhr', url, method, body: body ? String(body) : undefined, status: (this as any).status });
            }
          } catch {}
        });
      } catch {}
      return send.call(this, body);
    } as any;

    // Expose a getter to retrieve records later
    (window as any).__SC_GET_REC__ = () => (window as any).__SC_REC__ || [];
  }, [], { closeTab: false, active: true });

  return { success: true };
}

export async function fetchZhihuLearnedTemplate(): Promise<{ success: boolean; records: any[] }>{
  const records = await executeInOrigin('https://zhuanlan.zhihu.com/write', () => {
    try { return (window as any).__SC_GET_REC__?.() || []; } catch { return []; }
  }, [], { closeTab: false, active: false });
  return { success: true, records: Array.isArray(records) ? records : [] };
}
