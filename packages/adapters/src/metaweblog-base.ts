import type { PlatformAdapter, PlatformPayload, PublishContext, PublishResult, SessionStatus } from './base';
import type { CanonicalPost, Account, AuthSession, PlatformId } from '@synccaster/core';

/**
 * MetaWeblog API 配置
 */
export interface MetaWeblogConfig {
  endpoint: string;
  blogId?: string;
  username?: string;
  password?: string;
}

/**
 * MetaWeblog 文章结构
 */
export interface MetaWeblogPost {
  title: string;
  description: string; // HTML content
  categories?: string[];
  mt_keywords?: string; // tags
  mt_excerpt?: string; // summary
  wp_slug?: string;
  dateCreated?: Date;
}

/**
 * MetaWeblog 基础适配器抽象类
 * 用于博客园、OSChina、51CTO、WordPress 等支持 XML-RPC 的平台
 */
export abstract class MetaWeblogBaseAdapter implements Partial<PlatformAdapter> {
  abstract id: PlatformId;
  abstract name: string;
  kind: 'metaweblog' = 'metaweblog';
  abstract icon?: string;

  /**
   * 获取平台的 MetaWeblog 配置
   */
  abstract getConfig(account: Account): Promise<MetaWeblogConfig>;

  /**
   * XML-RPC 调用
   */
  protected async xmlrpcCall(
    endpoint: string,
    method: string,
    params: any[]
  ): Promise<any> {
    const xml = this.buildXMLRPCRequest(method, params);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
      },
      body: xml,
    });

    if (!response.ok) {
      throw new Error(`XML-RPC failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    return this.parseXMLRPCResponse(text);
  }

  /**
   * 构建 XML-RPC 请求
   */
  protected buildXMLRPCRequest(method: string, params: any[]): string {
    const paramsXML = params.map(p => this.valueToXML(p)).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>${method}</methodName>
  <params>
    ${paramsXML}
  </params>
</methodCall>`;
  }

  /**
   * 将值转换为 XML-RPC 格式
   */
  protected valueToXML(value: any): string {
    if (typeof value === 'string') {
      return `<param><value><string>${this.escapeXML(value)}</string></value></param>`;
    }
    if (typeof value === 'number') {
      return `<param><value><int>${value}</int></value></param>`;
    }
    if (typeof value === 'boolean') {
      return `<param><value><boolean>${value ? 1 : 0}</boolean></value></param>`;
    }
    if (value instanceof Date) {
      return `<param><value><dateTime.iso8601>${value.toISOString()}</dateTime.iso8601></value></param>`;
    }
    if (Array.isArray(value)) {
      const items = value.map(v => this.valueToXML(v).replace(/<\/?param>/g, '')).join('');
      return `<param><value><array><data>${items}</data></array></value></param>`;
    }
    if (typeof value === 'object' && value !== null) {
      const members = Object.entries(value)
        .map(([k, v]) => `<member><name>${k}</name>${this.valueToXML(v).replace(/<\/?param>/g, '')}</member>`)
        .join('');
      return `<param><value><struct>${members}</struct></value></param>`;
    }
    return '<param><value><nil/></value></param>';
  }

  /**
   * 转义 XML 特殊字符
   */
  protected escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * 解析 XML-RPC 响应
   */
  protected parseXMLRPCResponse(xml: string): any {
    // 简化解析：提取 <string>、<int>、<boolean> 等
    // 生产环境建议使用专门的 XML 解析库
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    
    const fault = doc.querySelector('fault');
    if (fault) {
      const faultString = fault.querySelector('member name value string')?.textContent || 'Unknown error';
      throw new Error(`XML-RPC Fault: ${faultString}`);
    }

    const value = doc.querySelector('methodResponse > params > param > value');
    if (!value) {
      throw new Error('Invalid XML-RPC response');
    }

    return this.parseValue(value);
  }

  /**
   * 解析 XML 值节点
   */
  protected parseValue(node: Element): any {
    const stringNode = node.querySelector('string');
    if (stringNode) return stringNode.textContent || '';

    const intNode = node.querySelector('int') || node.querySelector('i4');
    if (intNode) return parseInt(intNode.textContent || '0', 10);

    const booleanNode = node.querySelector('boolean');
    if (booleanNode) return booleanNode.textContent === '1';

    const arrayNode = node.querySelector('array');
    if (arrayNode) {
      const values = Array.from(arrayNode.querySelectorAll('data > value'));
      return values.map(v => this.parseValue(v));
    }

    const structNode = node.querySelector('struct');
    if (structNode) {
      const members = Array.from(structNode.querySelectorAll('member'));
      const obj: Record<string, any> = {};
      members.forEach(m => {
        const name = m.querySelector('name')?.textContent || '';
        const value = m.querySelector('value');
        if (value) obj[name] = this.parseValue(value);
      });
      return obj;
    }

    return null;
  }

  /**
   * 检测会话状态
   */
  async detectSessionForAccount(account: Account): Promise<SessionStatus> {
    try {
      const config = await this.getConfig(account);
      
      // 调用 getUsersBlogs 检测连接
      const blogs = await this.xmlrpcCall(config.endpoint, 'blogger.getUsersBlogs', [
        'appkey',
        config.username || '',
        config.password || '',
      ]);

      return {
        loggedIn: true,
        username: config.username,
        meta: { blogs },
      };
    } catch (error: any) {
      return {
        loggedIn: false,
        needsReauth: true,
        meta: { error: error.message },
      };
    }
  }

  /**
   * 确保认证有效
   */
  async ensureAuth(ctx: { account: Account }): Promise<AuthSession> {
    const config = await this.getConfig(ctx.account);
    
    return {
      type: 'metaweblog',
      valid: !!config.username && !!config.password,
      expiresAt: Date.now() + 86400_000, // 24小时
      meta: { endpoint: config.endpoint },
    };
  }

  /**
   * 内容转换
   */
  async transform(post: CanonicalPost, ctx: { config?: any }): Promise<PlatformPayload> {
    // 大多数 MetaWeblog 平台支持 HTML
    const contentHtml = (post as any)?.meta?.body_html || post.body_md;
    
    return {
      title: post.title,
      contentHtml,
      tags: post.tags,
      categories: post.categories,
      summary: post.summary,
    };
  }

  /**
   * 发布文章
   */
  async publish(payload: PlatformPayload | string, ctx: PublishContext): Promise<PublishResult> {
    if (typeof payload === 'string') {
      throw new Error('MetaWeblog does not support publishing by draft ID');
    }

    const config = await this.getConfig(ctx.account);
    
    ctx.logger({ level: 'info', step: 'metaweblog', message: 'Converting to MetaWeblog format' });

    const post: MetaWeblogPost = {
      title: payload.title,
      description: payload.contentHtml || payload.content || '',
      categories: payload.categories,
      mt_keywords: payload.tags?.join(','),
      mt_excerpt: payload.summary,
    };

    ctx.logger({ level: 'info', step: 'metaweblog', message: 'Publishing via newPost' });

    const postId = await this.xmlrpcCall(config.endpoint, 'metaWeblog.newPost', [
      config.blogId || '0',
      config.username || '',
      config.password || '',
      post,
      true, // publish immediately
    ]);

    ctx.logger({ level: 'info', step: 'metaweblog', message: `Published with ID: ${postId}` });

    // 生成文章 URL（子类可覆盖）
    const url = await this.getPostUrl(postId, ctx.account);

    return {
      remoteId: String(postId),
      url,
    };
  }

  /**
   * 获取文章 URL（子类可覆盖）
   */
  protected async getPostUrl(postId: string | number, account: Account): Promise<string | undefined> {
    // 默认实现：返回空，子类应该实现具体平台的 URL 格式
    return undefined;
  }
}
