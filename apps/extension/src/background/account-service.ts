/**
 * 账号服务 - 重构版
 * 
 * 核心改进：
 * 1. 登录检测在 content script 中执行（目标网站页面上下文）
 * 2. background 只负责协调流程，不直接检测登录
 * 3. 通过消息机制获取登录状态
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
  platform: string;
}

/**
 * 登录状态接口（来自 content script）
 */
export interface LoginState {
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  avatar?: string;
  platform?: string;
  error?: string;
}

/**
 * 平台配置
 */
interface PlatformConfig {
  id: string;
  name: string;
  loginUrl: string;
  homeUrl: string;  // 登录后的主页，用于检测登录状态
  urlPattern: RegExp;
}

/**
 * 平台配置表
 */
const PLATFORMS: Record<string, PlatformConfig> = {
  juejin: {
    id: 'juejin',
    name: '掘金',
    loginUrl: 'https://juejin.cn/login',
    homeUrl: 'https://juejin.cn/',
    urlPattern: /juejin\.cn/,
  },
  csdn: {
    id: 'csdn',
    name: 'CSDN',
    loginUrl: 'https://passport.csdn.net/login',
    homeUrl: 'https://www.csdn.net/',
    urlPattern: /csdn\.net/,
  },
  zhihu: {
    id: 'zhihu',
    name: '知乎',
    loginUrl: 'https://www.zhihu.com/signin',
    homeUrl: 'https://www.zhihu.com/',
    urlPattern: /zhihu\.com/,
  },
  wechat: {
    id: 'wechat',
    name: '微信公众号',
    loginUrl: 'https://mp.weixin.qq.com/',
    homeUrl: 'https://mp.weixin.qq.com/',
    urlPattern: /mp\.weixin\.qq\.com/,
  },
  jianshu: {
    id: 'jianshu',
    name: '简书',
    loginUrl: 'https://www.jianshu.com/sign_in',
    homeUrl: 'https://www.jianshu.com/',
    urlPattern: /jianshu\.com/,
  },
  cnblogs: {
    id: 'cnblogs',
    name: '博客园',
    loginUrl: 'https://account.cnblogs.com/signin',
    homeUrl: 'https://www.cnblogs.com/',
    urlPattern: /cnblogs\.com/,
  },
  '51cto': {
    id: '51cto',
    name: '51CTO',
    loginUrl: 'https://home.51cto.com/index',
    homeUrl: 'https://home.51cto.com/',
    urlPattern: /51cto\.com/,
  },
  'tencent-cloud': {
    id: 'tencent-cloud',
    name: '腾讯云开发者社区',
    loginUrl: 'https://cloud.tencent.com/login',
    homeUrl: 'https://cloud.tencent.com/developer',
    urlPattern: /cloud\.tencent\.com/,
  },
  aliyun: {
    id: 'aliyun',
    name: '阿里云开发者社区',
    loginUrl: 'https://account.aliyun.com/login/login.htm',
    homeUrl: 'https://developer.aliyun.com/',
    urlPattern: /aliyun\.com/,
  },
  segmentfault: {
    id: 'segmentfault',
    name: '思否',
    loginUrl: 'https://segmentfault.com/user/login',
    homeUrl: 'https://segmentfault.com/',
    urlPattern: /segmentfault\.com/,
  },
  bilibili: {
    id: 'bilibili',
    name: 'B站专栏',
    loginUrl: 'https://passport.bilibili.com/login',
    homeUrl: 'https://www.bilibili.com/',
    urlPattern: /bilibili\.com/,
  },
  oschina: {
    id: 'oschina',
    name: '开源中国',
    loginUrl: 'https://www.oschina.net/home/login',
    homeUrl: 'https://www.oschina.net/',
    urlPattern: /oschina\.net/,
  },
};

/**
 * 平台名称映射
 */
const PLATFORM_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(PLATFORMS).map(p => [p.id, p.name])
);


/**
 * 确保 content script 已注入到标签页
 */
async function ensureContentScriptInjected(tabId: number): Promise<void> {
  try {
    // 先尝试发送 PING 消息检查 content script 是否已存在
    await new Promise<void>((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error('Content script not ready'));
        } else if (response?.pong) {
          resolve();
        } else {
          reject(new Error('Invalid response'));
        }
      });
    });
    logger.info('inject', 'Content script already exists');
  } catch {
    // Content script 不存在，需要注入
    logger.info('inject', 'Injecting content script...');
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts.js'],
      });
      // 等待 content script 初始化
      await new Promise(resolve => setTimeout(resolve, 1000));
      logger.info('inject', 'Content script injected successfully');
    } catch (e: any) {
      logger.error('inject', 'Failed to inject content script', { error: e.message });
      throw new Error(`无法注入脚本: ${e.message}`);
    }
  }
}

/**
 * 向指定标签页发送消息并等待响应
 */
async function sendMessageToTab(tabId: number, message: any, timeout = 10000): Promise<any> {
  // 先确保 content script 已注入
  await ensureContentScriptInjected(tabId);
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('消息响应超时'));
    }, timeout);
    
    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * 等待标签页加载完成
 */
async function waitForTabLoad(tabId: number, timeout = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('页面加载超时'));
    }, timeout);
    
    const checkStatus = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          clearTimeout(timer);
          // 额外等待一下让页面渲染
          setTimeout(resolve, 500);
        } else {
          setTimeout(checkStatus, 500);
        }
      } catch (e) {
        clearTimeout(timer);
        reject(new Error('标签页已关闭'));
      }
    };
    
    checkStatus();
  });
}

/**
 * 在指定标签页检测登录状态
 */
async function checkLoginInTab(tabId: number): Promise<LoginState> {
  try {
    // 等待页面加载
    await waitForTabLoad(tabId);
    
    // 发送检测请求到 content script
    const result = await sendMessageToTab(tabId, { type: 'CHECK_LOGIN' });
    logger.info('check-login', '收到登录检测结果', result);
    return result;
  } catch (error: any) {
    logger.error('check-login', '登录检测失败', { error: error.message });
    return { loggedIn: false, error: error.message };
  }
}

/**
 * 查找指定平台的已打开标签页
 */
async function findPlatformTab(platform: string): Promise<chrome.tabs.Tab | null> {
  const config = PLATFORMS[platform];
  if (!config) return null;
  
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && config.urlPattern.test(tab.url)) {
      return tab;
    }
  }
  return null;
}


/**
 * 账号服务
 */
export class AccountService {
  // 存储登录成功的回调
  private static loginCallbacks: Map<string, (state: LoginState) => void> = new Map();
  
  /**
   * 初始化：监听来自 content script 的登录成功消息
   */
  static init() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'LOGIN_SUCCESS') {
        logger.info('login-success', '收到登录成功通知', message.data);
        const state = message.data as LoginState;
        
        // 触发回调
        if (state.platform) {
          const callback = this.loginCallbacks.get(state.platform);
          if (callback) {
            callback(state);
            this.loginCallbacks.delete(state.platform);
          }
        }
        
        sendResponse({ received: true });
      }
      
      if (message.type === 'LOGIN_STATE_REPORT') {
        logger.info('login-report', '收到登录状态报告', message.data);
        // 可以用于更新 UI 或缓存登录状态
        sendResponse({ received: true });
      }
    });
    
    logger.info('init', '账号服务已初始化');
  }
  
  /**
   * 快速添加账号（用户已登录）
   * 
   * 流程：
   * 1. 查找当前是否有该平台的标签页
   * 2. 如果有，向该标签页发送检测请求
   * 3. 如果没有，打开平台主页并检测
   * 4. 检测成功则保存账号
   */
  static async quickAddAccount(platform: string): Promise<Account> {
    const platformName = PLATFORM_NAMES[platform] || platform;
    const config = PLATFORMS[platform];
    
    if (!config) {
      throw new Error(`不支持的平台: ${platformName}`);
    }
    
    logger.info('quick-add', `快速添加账号: ${platformName}`);
    
    // 1. 查找已打开的平台标签页
    let tab = await findPlatformTab(platform);
    let needCloseTab = false;
    
    // 2. 如果没有，打开平台主页
    if (!tab) {
      logger.info('quick-add', `未找到 ${platformName} 标签页，打开主页`);
      tab = await chrome.tabs.create({ url: config.homeUrl, active: false });
      needCloseTab = true;
      
      // 等待页面加载
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    if (!tab.id) {
      throw new Error('无法创建标签页');
    }
    
    try {
      // 3. 在标签页中检测登录状态
      logger.info('quick-add', `在标签页 ${tab.id} 中检测登录状态`);
      const state = await checkLoginInTab(tab.id);
      
      if (!state.loggedIn) {
        throw new Error(`请先在浏览器中登录 ${platformName}，然后重试`);
      }
      
      // 4. 保存账号
      const account = await this.saveAccount(platform, {
        userId: state.userId || `${platform}_${Date.now()}`,
        nickname: state.nickname || platformName + '用户',
        avatar: state.avatar,
        platform,
      });
      
      logger.info('quick-add', '账号添加成功', { nickname: account.nickname });
      
      return account;
    } finally {
      // 如果是我们创建的标签页，关闭它
      if (needCloseTab && tab.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {}
      }
    }
  }
  
  /**
   * 引导登录添加账号
   * 
   * 流程：
   * 1. 打开平台登录页面
   * 2. 在该页面启动登录状态轮询
   * 3. 登录成功后，content script 通知 background
   * 4. 保存账号并关闭登录页面
   */
  static async addAccount(platform: string): Promise<Account> {
    const platformName = PLATFORM_NAMES[platform] || platform;
    const config = PLATFORMS[platform];
    
    if (!config) {
      throw new Error(`不支持的平台: ${platformName}`);
    }
    
    logger.info('add-account', `引导登录: ${platformName}`);
    
    // 先检查是否已经登录
    const existingTab = await findPlatformTab(platform);
    if (existingTab?.id) {
      const state = await checkLoginInTab(existingTab.id);
      if (state.loggedIn) {
        logger.info('add-account', '检测到已登录，直接保存账号');
        return await this.saveAccount(platform, {
          userId: state.userId || `${platform}_${Date.now()}`,
          nickname: state.nickname || platformName + '用户',
          avatar: state.avatar,
          platform,
        });
      }
    }
    
    // 打开登录页面
    logger.info('add-account', `打开登录页面: ${config.loginUrl}`);
    const tab = await chrome.tabs.create({ url: config.loginUrl });
    
    if (!tab.id) {
      throw new Error('无法打开登录页面');
    }
    
    // 等待页面加载
    await waitForTabLoad(tab.id);
    
    // 创建 Promise 等待登录成功
    return new Promise<Account>((resolve, reject) => {
      const tabId = tab.id!;
      let pollingStopped = false;
      let attempts = 0;
      const maxAttempts = 180; // 3分钟
      
      // 设置登录成功回调
      this.loginCallbacks.set(platform, async (state) => {
        pollingStopped = true;
        logger.info('add-account', '登录成功回调触发', state);
        
        try {
          const account = await this.saveAccount(platform, {
            userId: state.userId || `${platform}_${Date.now()}`,
            nickname: state.nickname || platformName + '用户',
            avatar: state.avatar,
            platform,
          });
          
          // 关闭登录标签页
          try {
            await chrome.tabs.remove(tabId);
          } catch {}
          
          resolve(account);
        } catch (e: any) {
          reject(e);
        }
      });
      
      // 启动轮询检测
      const poll = async () => {
        if (pollingStopped) return;
        
        attempts++;
        logger.info('add-account', `轮询检测 ${attempts}/${maxAttempts}`);
        
        // 检查标签页是否还存在
        try {
          await chrome.tabs.get(tabId);
        } catch {
          pollingStopped = true;
          this.loginCallbacks.delete(platform);
          reject(new Error('登录窗口已关闭，请重试'));
          return;
        }
        
        // 检测登录状态
        try {
          const state = await checkLoginInTab(tabId);
          
          if (state.loggedIn) {
            pollingStopped = true;
            this.loginCallbacks.delete(platform);
            
            const account = await this.saveAccount(platform, {
              userId: state.userId || `${platform}_${Date.now()}`,
              nickname: state.nickname || platformName + '用户',
              avatar: state.avatar,
              platform,
            });
            
            // 关闭登录标签页
            try {
              await chrome.tabs.remove(tabId);
            } catch {}
            
            resolve(account);
            return;
          }
        } catch (e: any) {
          logger.warn('add-account', '检测失败', { error: e.message });
        }
        
        // 继续轮询
        if (attempts < maxAttempts && !pollingStopped) {
          setTimeout(poll, 2000);
        } else if (!pollingStopped) {
          pollingStopped = true;
          this.loginCallbacks.delete(platform);
          
          // 关闭登录标签页
          try {
            await chrome.tabs.remove(tabId);
          } catch {}
          
          reject(new Error('登录超时（3分钟），请重试'));
        }
      };
      
      // 开始轮询
      setTimeout(poll, 3000); // 等待页面加载后开始
    });
  }
  
  /**
   * 保存账号到数据库
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
      meta: {},
    };

    await db.accounts.put(account);
    logger.info('save-account', '账号已保存', { platform, nickname: account.nickname });
    return account;
  }
  
  /**
   * 检查账号认证状态
   */
  static async checkAccountAuth(account: Account): Promise<boolean> {
    const tab = await findPlatformTab(account.platform);
    if (!tab?.id) {
      return false;
    }
    
    const state = await checkLoginInTab(tab.id);
    return state.loggedIn;
  }
  
  /**
   * 刷新账号信息
   */
  static async refreshAccount(account: Account): Promise<Account> {
    const config = PLATFORMS[account.platform];
    if (!config) {
      throw new Error(`不支持的平台: ${account.platform}`);
    }
    
    // 查找或创建标签页
    let tab = await findPlatformTab(account.platform);
    let needCloseTab = false;
    
    if (!tab) {
      tab = await chrome.tabs.create({ url: config.homeUrl, active: false });
      needCloseTab = true;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    if (!tab.id) {
      throw new Error('无法创建标签页');
    }
    
    try {
      const state = await checkLoginInTab(tab.id);
      
      if (!state.loggedIn) {
        throw new Error('账号已登出，请重新登录');
      }
      
      const updated: Account = {
        ...account,
        nickname: state.nickname || account.nickname,
        avatar: state.avatar || account.avatar,
        updatedAt: Date.now(),
      };
      
      await db.accounts.put(updated);
      return updated;
    } finally {
      if (needCloseTab && tab.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {}
      }
    }
  }
}

// 导出用于兼容旧代码
export const AUTH_CHECKERS = {};
