import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPlatformUserInfo } from '../platform-api';

const mockCookiesGetAll = vi.fn();

beforeEach(() => {
  vi.stubGlobal('chrome', {
    cookies: {
      getAll: mockCookiesGetAll,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('tencent-cloud avatar detection', () => {
  it('parses avatarUrl from /developer/creator HTML', async () => {
    mockCookiesGetAll.mockResolvedValue([{ name: 'uin', value: 'o123456' }]);

    const creatorHtml = [
      '<!doctype html>',
      '<html>',
      '<head></head>',
      '<body>',
      '<script>',
      'window.__INITIAL_STATE__={"userInfo":{"nickname":"Alice","avatarUrl":"https:\\/\\/thirdqq.qlogo.cn\\/g?b=oidb&k=abc&s=100","uin":123456}};',
      '</script>',
      '</body>',
      '</html>',
    ].join('');

    const mockFetch = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : (input as any).url;

      if (
        url === 'https://cloud.tencent.com/developer/api/user/info' ||
        url === 'https://cloud.tencent.com/developer/api/user/current'
      ) {
        return new Response('{"code":500}', {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://cloud.tencent.com/developer/creator') {
        return new Response(creatorHtml, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }

      return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } });
    });

    vi.stubGlobal('fetch', mockFetch as any);

    const result = await fetchPlatformUserInfo('tencent-cloud');

    expect(result.loggedIn).toBe(true);
    expect(result.nickname).toBe('Alice');
    expect(result.avatar).toBe('https://thirdqq.qlogo.cn/g?b=oidb&k=abc&s=100');
  });
});

