import { MetaWeblogBaseAdapter, type MetaWeblogConfig } from './metaweblog-base';
import type { Account, PlatformId } from '@synccaster/core';
import type { PlatformCapabilities } from './base';

/**
 * OSChina 适配器
 * 使用 MetaWeblog XML-RPC API
 */
export class OschinaAdapter extends MetaWeblogBaseAdapter {
  id: PlatformId = 'oschina' as PlatformId;
  name = 'OSChina';
  icon = 'oschina';
  
  capabilities: PlatformCapabilities = {
    api: true,
    domAutomation: false,
    supportsMarkdown: true,
    supportsHtml: true,
    supportsTags: true,
    supportsCategories: true,
    supportsCover: false,
    supportsSchedule: false,
    imageUpload: 'api',
    rateLimit: {
      rpm: 60,
      concurrent: 2,
    },
  };

  async getConfig(account: Account): Promise<MetaWeblogConfig> {
    // 从账号 meta 中获取配置
    const meta = account.meta || {};
    const username = meta.username;
    
    if (!username) {
      throw new Error('OSChina 账号未配置用户名');
    }

    // OSChina MetaWeblog API 端点
    return {
      endpoint: 'https://www.oschina.net/action/xmlrpc',
      blogId: username,
      username: meta.username || '',
      password: meta.password || '',
    };
  }

  protected async getPostUrl(postId: string | number, account: Account): Promise<string | undefined> {
    // OSChina 文章 URL 格式：https://my.oschina.net/{username}/blog/{postId}
    const meta = account.meta || {};
    const username = meta.username;
    
    if (!username) {
      return undefined;
    }

    return `https://my.oschina.net/${username}/blog/${postId}`;
  }
}

// 导出实例
export const oschinaAdapter = new OschinaAdapter();
