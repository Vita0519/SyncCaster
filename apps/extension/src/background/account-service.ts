/**
 * 账号服务 - 处理账号添加和认证
 */
import { db, type Account } from '@synccaster/core';
import { Logger } from '@synccaster/utils';

const logger = new Logger('account-service');

/**
 * 平台用户信息接口
 */
export interface PlatformUserInfo {
  userId: string;
  nickname: string;
  avatar?: string;
  email?: string;
  meta?: Record<string, any>;
}

/**
 * 平台认证检测器
 */
export interface PlatformAuthChecker {
  /**
   * 检查用户是否已登录
   */
  checkAuth(): Promise<boolean>;
  
  /**
   * 获取用户信息
   */
  getUserInfo(): Promise<PlatformUserInfo>;
  
  /**
   * 获取登录 URL
   */
  getLoginUrl(): string;
}

/**
 * 掘金平台认证检测器
 */
class JuejinAuthChecker implements PlatformAuthChecker {
  getLoginUrl(): string {
    return 'https://juejin.cn/login';
  }

  async checkAuth(): Promise<boolean> {
    try {
      const cookies = await chrome.cookies.getAll({
        domain: '.juejin.cn',
      });
      
      logger.info('juejin-auth', `Found ${cookies.length} cookies for .juejin.cn`);
      logger.debug('juejin-auth', 'Cookie names:', cookies.map(c => c.name));
      
      // 掘金的认证 Cookie 可能有多种：sessionid, sessionid_ss, token
      const authCookies = cookies.filter(c => 
        c.name === 'sessionid' || 
        c.name === 'sessionid_ss' || 
        c.name === 'token' ||
        c.name.toLowerCase().includes('session')
      );
      
      if (authCookies.length > 0) {
        const cookieInfo = authCookies.map(c => `${c.name}=${c.value.substring(0, 10)}...`);
        logger.info('juejin-auth', `Found auth cookies: ${authCookies.length}`, { 
          cookies: cookieInfo,
        });
        return true;
      } else {
        logger.warn('juejin-auth', 'No auth cookie found', { 
          availableCookies: cookies.map(c => c.name).join(', '),
        });
        return false;
      }
    } catch (error: any) {
      logger.error('juejin-auth', 'Failed to check auth', { 
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  async getUserInfo(): Promise<PlatformUserInfo> {
    try {
      // 调用掘金 API 获取当前用户信息
      const response = await fetch('https://api.juejin.cn/user_api/v1/user/get', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.error('juejin-api', `HTTP ${response.status}: ${response.statusText}`);
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      logger.debug('juejin-api', 'API response:', data);
      
      if (data.err_no !== 0) {
        logger.error('juejin-api', `API error: ${data.err_msg}`);
        throw new Error(data.err_msg || '接口返回错误');
      }

      if (!data.data) {
        throw new Error('未返回用户数据，可能未登录');
      }

      const user = data.data;
      const userInfo = {
        userId: user.user_id || user.id || 'unknown',
        nickname: user.user_name || user.username || '未知用户',
        avatar: user.avatar_large || user.avatar_url || undefined,
        meta: {
          level: user.level || 0,
          followersCount: user.follower_count || user.followers_count || 0,
          viewsCount: user.got_view_count || user.views_count || 0,
        },
      };
      
      logger.info('juejin-auth', 'User info extracted', {
        userId: userInfo.userId,
        nickname: userInfo.nickname,
        hasAvatar: !!userInfo.avatar,
        level: userInfo.meta.level,
      });
      
      return userInfo;
    } catch (error: any) {
      logger.error('juejin-auth', 'Failed to get user info', { 
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`无法获取掘金用户信息: ${error.message}`);
    }
  }
}

/**
 * CSDN 平台认证检测器
 */
class CSDNAuthChecker implements PlatformAuthChecker {
  getLoginUrl(): string {
    return 'https://passport.csdn.net/login';
  }

  async checkAuth(): Promise<boolean> {
    try {
      const cookies = await chrome.cookies.getAll({
        domain: '.csdn.net',
      });
      
      logger.info('csdn-auth', `Found ${cookies.length} cookies for .csdn.net`);
      logger.debug('csdn-auth', 'Cookie names:', cookies.map(c => c.name));
      
      // CSDN 的认证 Cookie：dp_token（新版本）或 UserName（旧版本）
      const dpToken = cookies.find(c => c.name === 'dp_token');
      const username = cookies.find(c => c.name === 'UserName');
      const authCookie = dpToken || username;
      
      if (authCookie) {
        logger.info('csdn-auth', `Found auth cookie: ${authCookie.name}`, { 
          hasValue: authCookie.value.length > 0,
          domain: authCookie.domain,
        });
        return authCookie.value.length > 0;
      } else {
        logger.warn('csdn-auth', 'No auth cookie found', { 
          availableCookies: cookies.map(c => c.name).join(', '),
        });
        return false;
      }
    } catch (error: any) {
      logger.error('csdn-auth', 'Failed to check auth', { 
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  async getUserInfo(): Promise<PlatformUserInfo> {
    try {
      // CSDN 获取当前用户信息
      // 方案1: 尝试调用 CSDN API
      logger.info('csdn-auth', 'Fetching user info from API...');
      
      try {
        const response = await fetch('https://me.csdn.net/api/user/show', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          logger.info('csdn-auth', 'Got user info from API', data);
          
          if (data.data) {
            const user = data.data;
            const userInfo = {
              userId: user.username || user.userName || user.user_name || user.id,
              nickname: user.nickname || user.nickName || user.nick_name || user.username || user.userName,
              avatar: user.avatar || user.avatarUrl || user.avatar_url || user.avatarurl,
              meta: {
                username: user.username || user.userName,
                level: user.level,
              },
            };
            logger.info('csdn-auth', 'User info extracted from API', {
              userId: userInfo.userId,
              nickname: userInfo.nickname,
              hasAvatar: !!userInfo.avatar,
            });
            return userInfo;
          }
        } else {
          logger.warn('csdn-auth', `API response not ok: ${response.status}`);
        }
      } catch (apiError: any) {
        logger.warn('csdn-auth', 'API method failed, trying cookie method', { 
          error: apiError.message,
        });
      }
      
      // 方案2: 从 Cookie 中获取（旧版本兼容）
      const cookies = await chrome.cookies.getAll({ domain: '.csdn.net' });
      const usernameCookie = cookies.find(c => c.name === 'UserName');
      const userInfoCookie = cookies.find(c => c.name === 'UserInfo');
      
      if (usernameCookie && usernameCookie.value) {
        const username = decodeURIComponent(usernameCookie.value);
        logger.info('csdn-auth', `Got username from cookie: ${username}`);
        
        let userInfo: any = {};
        if (userInfoCookie && userInfoCookie.value) {
          try {
            userInfo = JSON.parse(decodeURIComponent(userInfoCookie.value));
            logger.debug('csdn-auth', 'Parsed UserInfo cookie', userInfo);
          } catch (e: any) {
            logger.warn('csdn-auth', 'Failed to parse UserInfo cookie', { error: e.message });
          }
        }
        
        const result = {
          userId: username,
          nickname: userInfo.UserNick || userInfo.userNick || userInfo.nickname || username,
          avatar: userInfo.Avatar || userInfo.avatar || userInfo.avatarUrl || `https://profile.csdnimg.cn/0/0/0/0_${username}`,
          meta: {
            username: username,
          },
        };
        
        logger.info('csdn-auth', 'User info from cookie', {
          userId: result.userId,
          nickname: result.nickname,
          hasAvatar: !!result.avatar && !result.avatar.includes('0/0/0/0'),
        });
        
        return result;
      }
      
      // 方案3: 通过注入脚本获取页面中的用户信息
      logger.info('csdn-auth', 'Trying to get user info from CSDN page...');
      
      try {
        // 查找或创建 CSDN 标签页
        const tabs = await chrome.tabs.query({ url: 'https://*.csdn.net/*' });
        let tab = tabs.find(t => t.url?.includes('blog.csdn.net') || t.url?.includes('www.csdn.net'));
        
        if (!tab) {
          // 创建新标签页访问 CSDN
          logger.info('csdn-auth', 'Creating CSDN tab...');
          tab = await chrome.tabs.create({ 
            url: 'https://blog.csdn.net/',
            active: false,
          });
          // 等待页面加载
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        if (!tab.id) {
          throw new Error('无法创建或找到 CSDN 标签页');
        }
        
        // 注入脚本获取用户信息
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // 尝试从多个选择器获取昵称
            const nicknameSelectors = [
              '.user-profile-head-name-username',
              '.user-profile-head .username',
              '.user-profile .nickname',
              '.toolbar-container-middle .name',
              '.csdn-profile-nickname',
              '[data-username]',
            ];
            
            let nicknameElement: Element | null = null;
            for (const selector of nicknameSelectors) {
              nicknameElement = document.querySelector(selector);
              if (nicknameElement) break;
            }
            
            // 尝试从多个选择器获取头像
            const avatarSelectors = [
              '.user-profile-head .avatar img',
              '.toolbar-container-left img',
              '.csdn-profile-avatar img',
              '.user-info .avatar img',
              '.user-avatar img',
            ];
            
            let avatarElement: HTMLImageElement | null = null;
            for (const selector of avatarSelectors) {
              const img = document.querySelector(selector) as HTMLImageElement;
              if (img && img.src && !img.src.includes('default')) {
                avatarElement = img;
                break;
              }
            }
            
            // 尝试从全局变量获取
            const globalUsername = (window as any).csdn_username || 
                                   (window as any).userName;
            const globalNickname = (window as any).userNick || 
                                   (window as any).nickname;
            
            const username = globalUsername || 
                           nicknameElement?.textContent?.trim() || 
                           nicknameElement?.getAttribute('data-username');
            
            const nickname = globalNickname || 
                           nicknameElement?.textContent?.trim() || 
                           username;
            
            if (username) {
              return {
                username: username,
                nickname: nickname,
                avatar: avatarElement?.src || undefined,
              };
            }
            
            return null;
          },
        });
        
        if (results && results[0]?.result) {
          const userData = results[0].result;
          logger.info('csdn-auth', 'Got user info from page', userData);
          
          if (userData.username) {
            const result = {
              userId: userData.username,
              nickname: userData.nickname || userData.username,
              avatar: userData.avatar || undefined,
              meta: {
                username: userData.username,
              },
            };
            
            logger.info('csdn-auth', 'User info extracted from page', {
              userId: result.userId,
              nickname: result.nickname,
              hasAvatar: !!result.avatar,
            });
            
            return result;
          }
        }
      } catch (scriptError: any) {
        logger.warn('csdn-auth', 'Script injection failed', { 
          error: scriptError.message,
        });
      }
      
      throw new Error('无法获取用户信息，请先访问 CSDN 网站（如 blog.csdn.net）并确保已登录');
      
    } catch (error: any) {
      logger.error('csdn-auth', 'Failed to get user info', { 
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`无法获取 CSDN 用户信息: ${error.message}`);
    }
  }
}

/**
 * 知乎平台认证检测器
 */
class ZhihuAuthChecker implements PlatformAuthChecker {
  getLoginUrl(): string {
    return 'https://www.zhihu.com/signin';
  }

  async checkAuth(): Promise<boolean> {
    try {
      const cookies = await chrome.cookies.getAll({
        domain: '.zhihu.com',
      });
      
      logger.info('zhihu-auth', `Found ${cookies.length} cookies for .zhihu.com`);
      logger.debug('zhihu-auth', 'Cookie names:', cookies.map(c => c.name));
      
      // 知乎的认证 Cookie：z_c0
      const authCookie = cookies.find(c => c.name === 'z_c0');
      
      if (authCookie) {
        logger.info('zhihu-auth', 'Found z_c0 cookie', { 
          hasValue: authCookie.value.length > 0,
          domain: authCookie.domain,
          secure: authCookie.secure,
        });
        return authCookie.value.length > 0;
      } else {
        logger.warn('zhihu-auth', 'z_c0 cookie not found', { 
          availableCookies: cookies.map(c => c.name).join(', '),
        });
        return false;
      }
    } catch (error: any) {
      logger.error('zhihu-auth', 'Failed to check auth', { 
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  async getUserInfo(): Promise<PlatformUserInfo> {
    try {
      const response = await fetch('https://www.zhihu.com/api/v4/me', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user info');
      }

      const data = await response.json();
      
      const userInfo = {
        userId: data.id,
        nickname: data.name,
        avatar: data.avatar_url || data.avatar_url_template?.replace('{size}', 'xl') || undefined,
        meta: {
          headline: data.headline,
          followersCount: data.follower_count,
        },
      };
      
      logger.info('zhihu-auth', 'User info extracted', {
        userId: userInfo.userId,
        nickname: userInfo.nickname,
        hasAvatar: !!userInfo.avatar,
      });
      
      return userInfo;
    } catch (error: any) {
      logger.error('zhihu-auth', 'Failed to get user info', { error: error.message });
      throw new Error('无法获取知乎用户信息，请确保已登录');
    }
  }
}

/**
 * 微信公众号 - 需要扫码登录
 */
class WeChatAuthChecker implements PlatformAuthChecker {
  getLoginUrl(): string {
    return 'https://mp.weixin.qq.com';
  }

  async checkAuth(): Promise<boolean> {
    try {
      const cookies = await chrome.cookies.getAll({
        domain: '.weixin.qq.com',
      });
      
      logger.info('wechat-auth', `Found ${cookies.length} cookies for .weixin.qq.com`);
      logger.debug('wechat-auth', 'Cookie names:', cookies.map(c => c.name));
      
      // 微信公众号的认证 Cookie 可能有多种：token, data_ticket, slave_sid, etc.
      const authCookies = cookies.filter(c => 
        c.name === 'token' || 
        c.name === 'slave_sid' ||
        c.name === 'data_ticket' ||
        c.name.toLowerCase().includes('ticket') ||
        c.name.toLowerCase().includes('sid')
      );
      
      if (authCookies.length > 0) {
        const cookieInfo = authCookies.map(c => `${c.name}=${c.value.substring(0, 10)}...`);
        logger.info('wechat-auth', `Found auth cookies: ${authCookies.length}`, { 
          cookies: cookieInfo,
        });
        return true;
      } else {
        logger.warn('wechat-auth', 'No auth cookie found', { 
          availableCookies: cookies.map(c => c.name).join(', '),
        });
        return false;
      }
    } catch (error: any) {
      logger.error('wechat-auth', 'Failed to check auth', { 
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }

  async getUserInfo(): Promise<PlatformUserInfo> {
    try {
      logger.info('wechat-auth', 'Getting user info from WeChat MP page...');
      
      // 查找已打开的微信公众号标签页
      const tabs = await chrome.tabs.query({ url: 'https://mp.weixin.qq.com/*' });
      let tab = tabs[0];
      
      if (!tab) {
        // 创建新标签页
        logger.info('wechat-auth', 'Creating WeChat MP tab...');
        tab = await chrome.tabs.create({ 
          url: 'https://mp.weixin.qq.com',
          active: false,
        });
        // 等待页面加载
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      if (!tab.id) {
        throw new Error('无法创建或找到微信公众号标签页');
      }
      
      // 注入脚本获取用户信息
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // 尝试从多个选择器获取昵称
          const nicknameSelectors = [
            '.weui-desktop-account__nickname',
            '.account_nickname',
            '.weui-desktop-account-nickname',
            '.nickname',
            '[class*="nickname"]',
            '[class*="account"]',
          ];
          
          let nicknameElement: Element | null = null;
          for (const selector of nicknameSelectors) {
            nicknameElement = document.querySelector(selector);
            if (nicknameElement && nicknameElement.textContent?.trim()) break;
          }
          
          // 尝试从多个选择器获取头像
          const avatarSelectors = [
            '.weui-desktop-account__avatar img',
            '.account_avatar img',
            '.weui-desktop-account-avatar img',
            '.avatar img',
            '[class*="avatar"] img',
          ];
          
          let avatarElement: HTMLImageElement | null = null;
          for (const selector of avatarSelectors) {
            const img = document.querySelector(selector) as HTMLImageElement;
            if (img && img.src && img.src.startsWith('http')) {
              avatarElement = img;
              break;
            }
          }
          
          // 尝试从全局变量获取
          const globalUserInfo = (window as any).user_name || 
                                (window as any).userName || 
                                (window as any).nickname;
          
          // 尝试从页面标题获取（如 "XXX的公众号"）
          const title = document.title;
          const titleMatch = title.match(/(.+?)的公众号/);
          
          const nickname = globalUserInfo || 
                         nicknameElement?.textContent?.trim() || 
                         titleMatch?.[1] ||
                         '微信公众号用户';
          
          return {
            nickname: nickname,
            avatar: avatarElement?.src || undefined,
            fromPage: true,
          };
        },
      });
      
      if (results && results[0]?.result) {
        const userData = results[0].result;
        logger.info('wechat-auth', 'Got user info from page', userData);
        
        // 生成一个唯一ID（因为微信公众号没有公开的用户ID）
        const userId = `wechat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const userInfo = {
          userId: userId,
          nickname: userData.nickname,
          avatar: userData.avatar || undefined,
          meta: {
            fromPage: true,
            addedAt: Date.now(),
          },
        };
        
        logger.info('wechat-auth', 'User info extracted', {
          userId: userInfo.userId,
          nickname: userInfo.nickname,
          hasAvatar: !!userInfo.avatar,
          avatarUrl: userInfo.avatar?.substring(0, 50) + '...',
        });
        
        return userInfo;
      }
      
      throw new Error('无法获取用户信息，请先访问微信公众号后台并确保已登录');
      
    } catch (error: any) {
      logger.error('wechat-auth', 'Failed to get user info', { 
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`无法获取微信公众号用户信息: ${error.message}`);
    }
  }
}

/**
 * 平台认证检测器工厂
 */
export const AUTH_CHECKERS: Record<string, PlatformAuthChecker> = {
  juejin: new JuejinAuthChecker(),
  csdn: new CSDNAuthChecker(),
  zhihu: new ZhihuAuthChecker(),
  wechat: new WeChatAuthChecker(),
};

/**
 * 平台名称映射
 */
const PLATFORM_NAMES: Record<string, string> = {
  juejin: '掘金',
  csdn: 'CSDN',
  zhihu: '知乎',
  wechat: '微信公众号',
  jianshu: '简书',
  medium: 'Medium',
  toutiao: '今日头条',
};

/**
 * 账号服务
 */
export class AccountService {
  /**
   * 添加账号（引导登录）
   */
  static async addAccount(platform: string): Promise<Account> {
    const platformName = PLATFORM_NAMES[platform] || platform;
    logger.info('add-account', `Adding account for platform: ${platformName}`);
    
    const checker = AUTH_CHECKERS[platform];
    if (!checker) {
      throw new Error(`不支持的平台: ${platformName}`);
    }

    // 先检查是否已经登录
    const alreadyLoggedIn = await checker.checkAuth();
    if (alreadyLoggedIn) {
      logger.info('add-account', `User already logged in to ${platformName}, skip login page`);
      // 已登录，直接获取用户信息
      const userInfo = await checker.getUserInfo();
      const account = await this.saveAccount(platform, userInfo);
      return account;
    }

    // 1. 打开登录页面
    const loginUrl = checker.getLoginUrl();
    logger.info('add-account', `Opening login page: ${loginUrl}`);
    const tab = await chrome.tabs.create({ url: loginUrl });
    
    if (!tab.id) {
      throw new Error('无法打开登录页面');
    }
    
    // 2. 等待用户登录
    logger.info('add-account', 'Waiting for user to login...');
    
    try {
      // 轮询检查登录状态（最多等待 3 分钟，每 2 秒检查一次）
      const maxAttempts = 90; // 90 * 2秒 = 3分钟
      let attempts = 0;
      let isLoggedIn = false;

      while (attempts < maxAttempts && !isLoggedIn) {
        // 等待 2 秒
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 检查标签页是否还存在
        try {
          await chrome.tabs.get(tab.id);
        } catch {
          logger.warn('add-account', 'Login tab was closed by user');
          throw new Error('登录窗口已关闭，请重试');
        }
        
        // 检查是否已登录
        try {
          isLoggedIn = await checker.checkAuth();
          if (isLoggedIn) {
            logger.info('add-account', `User logged in successfully (attempt ${attempts + 1})`);
            break;
          }
        } catch (error: any) {
          logger.error('add-account', 'Error checking auth', { error: error.message });
        }
        
        attempts++;
      }

      if (!isLoggedIn) {
        throw new Error('登录超时（3分钟），请重试');
      }

      // 3. 获取用户信息
      logger.info('add-account', 'Fetching user info...');
      const userInfo = await checker.getUserInfo();

      // 4. 保存账号
      const account = await this.saveAccount(platform, userInfo);
      
      // 5. 关闭登录标签页
      if (tab.id) {
        try {
          await chrome.tabs.remove(tab.id);
          logger.info('add-account', 'Login tab closed');
        } catch (e) {
          logger.warn('add-account', 'Failed to close login tab');
        }
      }

      return account;
      
    } catch (error: any) {
      // 关闭登录标签页（如果还存在）
      if (tab.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {
          // 忽略
        }
      }
      
      logger.error('add-account', 'Failed to add account', { error: error.message });
      throw error;
    }
  }

  /**
   * 保存账号到数据库（辅助方法）
   */
  private static async saveAccount(platform: string, userInfo: PlatformUserInfo): Promise<Account> {
    const now = Date.now();
    const account: Account = {
      id: `${platform}-${userInfo.userId}`,
      platform: platform as any,
      nickname: userInfo.nickname,
      avatar: userInfo.avatar,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      meta: userInfo.meta,
    };

    await db.accounts.put(account);
    logger.info('save-account', 'Account saved', { 
      platform,
      nickname: account.nickname,
      id: account.id,
    });

    return account;
  }

  /**
   * 快速添加账号（用户已登录）
   */
  static async quickAddAccount(platform: string): Promise<Account> {
    const platformName = PLATFORM_NAMES[platform] || platform;
    logger.info('quick-add', `Quick adding account for platform: ${platformName}`);
    
    const checker = AUTH_CHECKERS[platform];
    if (!checker) {
      throw new Error(`不支持的平台: ${platformName}`);
    }

    // 1. 检查是否已登录
    logger.info('quick-add', 'Checking login status...');
    const isLoggedIn = await checker.checkAuth();
    
    if (!isLoggedIn) {
      logger.warn('quick-add', `User not logged in to ${platformName}`);
      throw new Error(`请先在浏览器中登录 ${platformName}，然后重试`);
    }
    
    logger.info('quick-add', `User is logged in to ${platformName}`);

    // 2. 获取用户信息
    logger.info('quick-add', 'Fetching user info...');
    const userInfo = await checker.getUserInfo();

    // 3. 保存账号
    const account = await this.saveAccount(platform, userInfo);

    return account;
  }

  /**
   * 检查账号认证状态
   */
  static async checkAccountAuth(account: Account): Promise<boolean> {
    const checker = AUTH_CHECKERS[account.platform];
    if (!checker) {
      return false;
    }

    return await checker.checkAuth();
  }

  /**
   * 刷新账号信息
   */
  static async refreshAccount(account: Account): Promise<Account> {
    const checker = AUTH_CHECKERS[account.platform];
    if (!checker) {
      throw new Error(`不支持的平台: ${account.platform}`);
    }

    const userInfo = await checker.getUserInfo();
    
    const updated: Account = {
      ...account,
      nickname: userInfo.nickname,
      avatar: userInfo.avatar,
      updatedAt: Date.now(),
      meta: { ...account.meta, ...userInfo.meta },
    };

    await db.accounts.put(updated);
    return updated;
  }
}
