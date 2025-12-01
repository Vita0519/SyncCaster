/**
 * 登录检测器 - 在目标网站页面上下文中运行
 * 
 * 核心思路：
 * 1. 在目标网站的页面中执行登录检测（content script）
 * 2. 通过 DOM、站内 JS 变量、站内 API 判断登录状态
 * 3. 将结果通过消息机制告诉 background
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
 * 平台登录检测器接口
 */
interface PlatformAuthDetector {
  /** 平台 ID */
  id: string;
  /** 匹配的 URL 模式 */
  urlPatterns: RegExp[];
  /** 在页面中检测登录状态 */
  checkLogin(): Promise<LoginState>;
}

/**
 * 日志函数
 */
function log(scope: string, msg: string, data?: any) {
  console.log(`[auth-detector:${scope}] ${msg}`, data ?? '');
}

// ============================================================
// 各平台登录检测器实现
// ============================================================


/**
 * 掘金登录检测器
 */
const juejinDetector: PlatformAuthDetector = {
  id: 'juejin',
  urlPatterns: [/juejin\.cn/],
  async checkLogin(): Promise<LoginState> {
    log('juejin', '检测登录状态...');
    
    // 方法1: 检查 DOM 中的用户信息
    const avatarEl = document.querySelector('.avatar-wrapper img, .user-dropdown-list .avatar') as HTMLImageElement;
    const usernameEl = document.querySelector('.username, .user-dropdown-list .name');
    
    if (avatarEl && usernameEl?.textContent?.trim()) {
      log('juejin', '从 DOM 检测到登录状态');
      return {
        loggedIn: true,
        platform: 'juejin',
        nickname: usernameEl.textContent.trim(),
        avatar: avatarEl.src,
      };
    }
    
    // 方法2: 检查全局变量
    const win = window as any;
    if (win.__NUXT__?.state?.user?.id) {
      const user = win.__NUXT__.state.user;
      log('juejin', '从 __NUXT__ 检测到登录状态');
      return {
        loggedIn: true,
        platform: 'juejin',
        userId: user.id,
        nickname: user.username || user.user_name,
        avatar: user.avatar_large || user.avatar,
      };
    }
    
    // 方法3: 调用站内 API（在页面上下文中，Cookie 会自动带上）
    try {
      const res = await fetch('https://api.juejin.cn/user_api/v1/user/get', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.err_no === 0 && data.data) {
          log('juejin', '从 API 检测到登录状态');
          return {
            loggedIn: true,
            platform: 'juejin',
            userId: data.data.user_id,
            nickname: data.data.user_name,
            avatar: data.data.avatar_large,
          };
        }
      }
    } catch (e) {
      log('juejin', 'API 调用失败', e);
    }
    
    // 方法4: 检查登录按钮是否存在
    const loginBtn = document.querySelector('.login-button, [class*="login"]');
    if (loginBtn) {
      log('juejin', '检测到登录按钮，未登录');
      return { loggedIn: false, platform: 'juejin' };
    }
    
    return { loggedIn: false, platform: 'juejin' };
  },
};

/**
 * CSDN 登录检测器
 */
const csdnDetector: PlatformAuthDetector = {
  id: 'csdn',
  urlPatterns: [/csdn\.net/],
  async checkLogin(): Promise<LoginState> {
    log('csdn', '检测登录状态...');
    log('csdn', '当前 URL: ' + window.location.href);
    
    // 打印页面中所有可能的用户相关元素，帮助调试
    const debugInfo: string[] = [];
    
    // 检查常见的用户头像/用户名容器
    const possibleContainers = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="login"], [class*="profile"], [id*="user"], [id*="avatar"]');
    debugInfo.push(`找到 ${possibleContainers.length} 个可能的用户相关元素`);
    
    // 检查是否有图片元素
    const allImages = document.querySelectorAll('img');
    const avatarImages = Array.from(allImages).filter(img => 
      img.src && (img.src.includes('avatar') || img.src.includes('profile') || img.className.includes('avatar'))
    );
    debugInfo.push(`找到 ${avatarImages.length} 个可能的头像图片`);
    if (avatarImages.length > 0) {
      debugInfo.push(`头像图片: ${avatarImages.map(img => img.src.substring(0, 50)).join(', ')}`);
    }
    
    log('csdn', '调试信息: ' + debugInfo.join(' | '));
    
    // 方法1: 检查多种 DOM 选择器
    const avatarSelectors = [
      '.toolbar-container-left img',
      '.user-avatar img',
      '.avatar-pic img',
      '.hasmark img',
      '#csdn-toolbar img.avatar',
      '.csdn-profile-avatar img',
      '.user-info img',
      'img.avatar',
    ];
    
    const usernameSelectors = [
      '.toolbar-container-middle .name',
      '.user-name',
      '.username',
      '.nick-name',
      '.hasmark .name',
      '#csdn-toolbar .name',
      '.csdn-profile-name',
      '.user-info .name',
    ];
    
    let avatarEl: HTMLImageElement | null = null;
    let usernameEl: Element | null = null;
    
    for (const selector of avatarSelectors) {
      const el = document.querySelector(selector) as HTMLImageElement;
      if (el?.src && !el.src.includes('default') && !el.src.includes('noavatar')) {
        avatarEl = el;
        log('csdn', '找到头像元素:', selector);
        break;
      }
    }
    
    for (const selector of usernameSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim() && el.textContent.trim() !== '登录') {
        usernameEl = el;
        log('csdn', '找到用户名元素: ' + selector + ' -> ' + el.textContent.trim());
        break;
      }
    }
    
    if (usernameEl?.textContent?.trim()) {
      log('csdn', '从 DOM 检测到登录状态');
      return {
        loggedIn: true,
        platform: 'csdn',
        nickname: usernameEl.textContent.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    // 方法2: 检查全局变量（CSDN 可能在多个地方存储用户信息）
    const win = window as any;
    const possibleUserObjects = [
      win.csdn?.currentUser,
      win.currentUser,
      win.userInfo,
      win.__INITIAL_STATE__?.user,
      win.loginUserInfo,
    ];
    
    for (const user of possibleUserObjects) {
      if (user && (user.userName || user.username || user.nickName || user.nickname)) {
        log('csdn', '从全局变量检测到登录状态', user);
        return {
          loggedIn: true,
          platform: 'csdn',
          userId: user.userName || user.username || user.userId,
          nickname: user.nickName || user.nickname || user.userName || user.username,
          avatar: user.avatar || user.avatarUrl,
        };
      }
    }
    
    // 方法3: 检查页面中的脚本内容（CSDN 经常在 script 标签中嵌入用户信息）
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent || '';
      // 查找类似 "userName":"xxx" 或 userName = "xxx" 的模式
      const userNameMatch = content.match(/"userName"\s*:\s*"([^"]+)"/) || 
                           content.match(/userName\s*=\s*["']([^"']+)["']/);
      const nickNameMatch = content.match(/"nickName"\s*:\s*"([^"]+)"/) ||
                           content.match(/nickName\s*=\s*["']([^"']+)["']/);
      
      if (userNameMatch || nickNameMatch) {
        log('csdn', '从 script 标签检测到登录状态');
        return {
          loggedIn: true,
          platform: 'csdn',
          userId: userNameMatch?.[1],
          nickname: nickNameMatch?.[1] || userNameMatch?.[1],
        };
      }
    }
    
    // 方法4: 检查登录按钮是否存在
    const loginBtnSelectors = [
      '.toolbar-btn-login',
      '.login-mark',
      'a[href*="passport.csdn.net/login"]',
      '.login-btn',
      'a.login',
    ];
    
    for (const selector of loginBtnSelectors) {
      const btn = document.querySelector(selector);
      if (btn) {
        const text = btn.textContent?.trim() || '';
        if (text.includes('登录') || text.includes('Login')) {
          log('csdn', '检测到登录按钮，未登录:', selector);
          return { loggedIn: false, platform: 'csdn' };
        }
      }
    }
    
    // 方法5: 检查是否在登录页面
    if (window.location.href.includes('passport.csdn.net')) {
      // 在登录页面，检查是否已经登录成功（可能会跳转）
      const successEl = document.querySelector('.success, .login-success');
      if (successEl) {
        log('csdn', '登录页面显示成功');
        return { loggedIn: true, platform: 'csdn', nickname: 'CSDN用户' };
      }
      log('csdn', '在登录页面，未登录');
      return { loggedIn: false, platform: 'csdn' };
    }
    
    // 方法6: 检查是否有退出按钮（有退出按钮说明已登录）
    const logoutSelectors = [
      'a[href*="logout"]',
      '.logout',
      '.sign-out',
    ];
    
    for (const selector of logoutSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          log('csdn', '检测到退出按钮，已登录');
          return { loggedIn: true, platform: 'csdn', nickname: 'CSDN用户' };
        }
      } catch {}
    }
    
    // 方法7: 调用 CSDN API 检测登录状态
    try {
      log('csdn', '尝试调用 CSDN API...');
      const res = await fetch('https://me.csdn.net/api/user/show', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        log('csdn', 'API 响应: ' + JSON.stringify(data).substring(0, 200));
        
        if (data.code === 200 && data.data) {
          const user = data.data;
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: user.username || user.userName,
            nickname: user.nickname || user.nickName || user.username,
            avatar: user.avatar || user.avatarUrl,
          };
        }
      } else {
        log('csdn', 'API 响应状态: ' + res.status);
      }
    } catch (e: any) {
      log('csdn', 'API 调用失败: ' + e.message);
    }
    
    // 方法8: 检查 localStorage 中的用户信息
    try {
      const userInfo = localStorage.getItem('UserInfo') || localStorage.getItem('userInfo');
      if (userInfo) {
        const user = JSON.parse(userInfo);
        if (user && (user.userName || user.username || user.nickName)) {
          log('csdn', '从 localStorage 检测到登录状态');
          return {
            loggedIn: true,
            platform: 'csdn',
            userId: user.userName || user.username,
            nickname: user.nickName || user.nickname || user.userName,
            avatar: user.avatar,
          };
        }
      }
    } catch (e) {
      log('csdn', 'localStorage 检查失败');
    }
    
    // 方法9: 检查 Cookie 中是否有用户名
    try {
      const cookies = document.cookie;
      const userNameMatch = cookies.match(/UserName=([^;]+)/);
      if (userNameMatch) {
        const userName = decodeURIComponent(userNameMatch[1]);
        log('csdn', '从 Cookie 检测到用户名: ' + userName);
        return {
          loggedIn: true,
          platform: 'csdn',
          userId: userName,
          nickname: userName,
        };
      }
    } catch (e) {
      log('csdn', 'Cookie 检查失败');
    }
    
    log('csdn', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: 'csdn' };
  },
};

/**
 * 知乎登录检测器
 */
const zhihuDetector: PlatformAuthDetector = {
  id: 'zhihu',
  urlPatterns: [/zhihu\.com/],
  async checkLogin(): Promise<LoginState> {
    log('zhihu', '检测登录状态...');
    
    // 方法1: 检查 DOM
    const avatarEl = document.querySelector('.AppHeader-profile img, .Avatar') as HTMLImageElement;
    const usernameEl = document.querySelector('.AppHeader-profile .Popover, .ProfileHeader-name');
    
    if (avatarEl?.src && !avatarEl.src.includes('default')) {
      log('zhihu', '从 DOM 检测到登录状态');
      return {
        loggedIn: true,
        platform: 'zhihu',
        avatar: avatarEl.src,
        nickname: usernameEl?.textContent?.trim(),
      };
    }
    
    // 方法2: 检查全局变量
    const win = window as any;
    if (win.__INITIAL_STATE__?.entities?.users) {
      const users = win.__INITIAL_STATE__.entities.users;
      const currentUserId = win.__INITIAL_STATE__.currentUser;
      if (currentUserId && users[currentUserId]) {
        const user = users[currentUserId];
        log('zhihu', '从 __INITIAL_STATE__ 检测到登录状态');
        return {
          loggedIn: true,
          platform: 'zhihu',
          userId: user.id || user.urlToken,
          nickname: user.name,
          avatar: user.avatarUrl,
        };
      }
    }
    
    // 方法3: 调用 API
    try {
      const res = await fetch('https://www.zhihu.com/api/v4/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.id) {
          log('zhihu', '从 API 检测到登录状态');
          return {
            loggedIn: true,
            platform: 'zhihu',
            userId: data.id,
            nickname: data.name,
            avatar: data.avatar_url,
          };
        }
      }
    } catch (e) {
      log('zhihu', 'API 调用失败', e);
    }
    
    // 方法4: 检查登录按钮
    const loginBtn = document.querySelector('.AppHeader-login, button[aria-label="登录"]');
    if (loginBtn) {
      return { loggedIn: false, platform: 'zhihu' };
    }
    
    return { loggedIn: false, platform: 'zhihu' };
  },
};


/**
 * 微信公众号登录检测器
 */
const wechatDetector: PlatformAuthDetector = {
  id: 'wechat',
  urlPatterns: [/mp\.weixin\.qq\.com/],
  async checkLogin(): Promise<LoginState> {
    log('wechat', '检测登录状态...');
    const url = window.location.href;
    log('wechat', '当前 URL: ' + url);
    log('wechat', '页面标题: ' + document.title);
    
    // 检查是否在登录页面（优先判断）
    if (url.includes('/cgi-bin/loginpage') || url.includes('action=scanlogin') || 
        url.includes('/cgi-bin/bizlogin') || url === 'https://mp.weixin.qq.com/' ||
        url === 'https://mp.weixin.qq.com') {
      // 但如果 URL 中有 token 参数，说明已登录
      if (!url.includes('token=')) {
        log('wechat', '当前在登录页面（无 token）');
        return { loggedIn: false, platform: 'wechat' };
      }
    }
    
    // 方法1（最可靠）: 检查 URL 中是否有 token 参数
    // 微信公众号后台的所有页面都会带 token 参数
    const tokenMatch = url.match(/token=(\d+)/);
    if (tokenMatch && tokenMatch[1]) {
      log('wechat', '从 URL token 参数判断已登录: token=' + tokenMatch[1]);
      // 尝试获取昵称
      let nickname = '微信公众号';
      
      // 尝试从 DOM 获取昵称
      const nicknameSelectors = [
        '.weui-desktop-account__nickname',
        '.account_nickname', 
        '.nickname',
        '.user-name',
        '.mp-account-name',
        '.account-name',
        '[class*="account"] [class*="name"]',
      ];
      
      for (const selector of nicknameSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el?.textContent?.trim() && !el.textContent.includes('登录')) {
            nickname = el.textContent.trim();
            log('wechat', '从 DOM 获取到昵称: ' + nickname);
            break;
          }
        } catch {}
      }
      
      // 尝试从页面标题获取昵称
      if (nickname === '微信公众号') {
        const title = document.title;
        if (title && !title.includes('登录')) {
          const match = title.match(/^(.+?)\s*[-–—]\s*微信公众平台/);
          if (match && match[1].trim().length > 0) {
            nickname = match[1].trim();
            log('wechat', '从页面标题获取到昵称: ' + nickname);
          }
        }
      }
      
      const avatarEl = document.querySelector('.weui-desktop-account__avatar img, .account_avatar img, [class*="avatar"] img') as HTMLImageElement;
      return {
        loggedIn: true,
        platform: 'wechat',
        nickname: nickname,
        avatar: avatarEl?.src,
      };
    }
    
    // 方法2: 检查 URL 路径判断是否在后台（即使没有 token 参数）
    if (url.includes('/cgi-bin/home') || url.includes('/cgi-bin/frame') || 
        url.includes('/cgi-bin/message') || url.includes('/cgi-bin/appmsg') ||
        url.includes('/cgi-bin/operate_appmsg') || url.includes('/cgi-bin/settingpage')) {
      log('wechat', '从 URL 路径判断已登录');
      return {
        loggedIn: true,
        platform: 'wechat',
        nickname: '微信公众号',
      };
    }
    
    // 方法3: 检查 Cookie 中是否有登录标记
    try {
      const cookies = document.cookie;
      log('wechat', 'Cookie 内容: ' + cookies.substring(0, 200));
      // 微信公众号登录后会有 slave_sid 或 data_ticket
      if (cookies.includes('slave_sid=') || cookies.includes('data_ticket=') || cookies.includes('bizuin=')) {
        log('wechat', '从 Cookie 检测到登录状态');
        return {
          loggedIn: true,
          platform: 'wechat',
          nickname: '微信公众号',
        };
      }
    } catch (e) {
      log('wechat', 'Cookie 检查失败: ' + e);
    }
    
    // 方法4: 检查是否有后台管理菜单（登录后才有）
    const menuSelectors = [
      '.weui-desktop-sidebar',
      '.menu_list',
      '.main_bd',
      '.new-home__container',
      '.home-container',
      '#app .weui-desktop-layout',
      '.weui-desktop-layout__body',
      '.weui-desktop-panel',
      '.new-creation__menu',
    ];
    
    for (const selector of menuSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('wechat', '检测到后台菜单，已登录: ' + selector);
        const nameEl = document.querySelector('[class*="name"], [class*="nickname"]');
        return {
          loggedIn: true,
          platform: 'wechat',
          nickname: nameEl?.textContent?.trim() || '微信公众号',
        };
      }
    }
    
    // 方法5: 检查全局变量
    const win = window as any;
    log('wechat', '检查全局变量...');
    const possibleUserVars = [
      { name: 'wx.data.user_name', value: win.wx?.data?.user_name },
      { name: 'cgiData.nick_name', value: win.cgiData?.nick_name },
      { name: 'cgiData.nickname', value: win.cgiData?.nickname },
      { name: '__INITIAL_DATA__.nickName', value: win.__INITIAL_DATA__?.nickName },
      { name: 'pageData.nickName', value: win.pageData?.nickName },
    ];
    
    for (const { name, value } of possibleUserVars) {
      if (value && typeof value === 'string' && value.length > 0) {
        log('wechat', '从全局变量检测到登录状态: ' + name + ' = ' + value);
        return {
          loggedIn: true,
          platform: 'wechat',
          nickname: value,
        };
      }
    }
    
    // 方法6: 检查登录表单是否存在（如果存在则未登录）
    const loginFormSelectors = [
      '.login__type__container',
      '.login_frame',
      '.weui-desktop-login',
      '.login-box',
      '#login_container',
      '.qrcode-login',
      '.login__type__container__scan',
    ];
    
    for (const selector of loginFormSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('wechat', '检测到登录表单，未登录: ' + selector);
        return { loggedIn: false, platform: 'wechat' };
      }
    }
    
    // 打印调试信息
    const allElements = document.querySelectorAll('[class*="account"], [class*="nickname"], [class*="user"], [class*="avatar"]');
    log('wechat', '找到 ' + allElements.length + ' 个可能的用户相关元素');
    if (allElements.length > 0) {
      const classNames = Array.from(allElements).slice(0, 5).map(el => el.className);
      log('wechat', '元素类名: ' + classNames.join(', '));
    }
    
    log('wechat', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: 'wechat' };
  },
};

/**
 * 简书登录检测器
 */
const jianshuDetector: PlatformAuthDetector = {
  id: 'jianshu',
  urlPatterns: [/jianshu\.com/],
  async checkLogin(): Promise<LoginState> {
    log('jianshu', '检测登录状态...');
    
    // 检查 DOM
    const avatarEl = document.querySelector('.user .avatar img, .avatar-wrapper img') as HTMLImageElement;
    const usernameEl = document.querySelector('.user .name, .nickname');
    
    if (avatarEl?.src || usernameEl?.textContent?.trim()) {
      return {
        loggedIn: true,
        platform: 'jianshu',
        nickname: usernameEl?.textContent?.trim(),
        avatar: avatarEl?.src,
      };
    }
    
    // 检查登录按钮
    const loginBtn = document.querySelector('.sign-in, .login-btn');
    if (loginBtn) {
      return { loggedIn: false, platform: 'jianshu' };
    }
    
    return { loggedIn: false, platform: 'jianshu' };
  },
};

/**
 * 博客园登录检测器
 */
const cnblogsDetector: PlatformAuthDetector = {
  id: 'cnblogs',
  urlPatterns: [/cnblogs\.com/],
  async checkLogin(): Promise<LoginState> {
    log('cnblogs', '检测登录状态...');
    const url = window.location.href;
    log('cnblogs', '当前 URL: ' + url);
    
    // 方法1: 检查是否在"您已登录"页面
    // URL 包含 continue-sign-out 说明已经登录
    if (url.includes('continue-sign-out') || url.includes('already-signed-in')) {
      log('cnblogs', '检测到"您已登录"页面');
      // 尝试从页面获取用户名
      const pageText = document.body?.textContent || '';
      let nickname = '博客园用户';
      // 页面可能显示用户名
      const userMatch = pageText.match(/您已经登录|already signed in/i);
      if (userMatch) {
        log('cnblogs', '确认已登录状态');
      }
      return {
        loggedIn: true,
        platform: 'cnblogs',
        nickname: nickname,
      };
    }
    
    // 方法2: 检查 Cookie 中是否有登录标记
    try {
      const cookies = document.cookie;
      log('cnblogs', 'Cookie: ' + cookies.substring(0, 200));
      // 博客园登录后会有 .CNBlogsCookie 或 .Cnblogs.AspNetCore.Cookies
      if (cookies.includes('.CNBlogsCookie') || cookies.includes('.Cnblogs.AspNetCore.Cookies') || 
          cookies.includes('_ga') && cookies.includes('.cnblogs.com')) {
        log('cnblogs', '从 Cookie 检测到可能已登录');
      }
    } catch {}
    
    // 方法3: 检查 DOM - 博客园登录后会显示用户名
    const userSelectors = [
      '#blog_nav_admin',
      '.user-info .name',
      '#navList a[href*="/u/"]',
      '.navbar-user-info',
      '#header .user-info',
      '.header-user-info',
      '#user_info',
      '.dropdown-menu a[href*="/u/"]',
    ];
    
    for (const selector of userSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim()) {
        log('cnblogs', '从 DOM 检测到登录状态: ' + selector);
        const avatarEl = document.querySelector('.user-avatar img, .avatar img') as HTMLImageElement;
        return {
          loggedIn: true,
          platform: 'cnblogs',
          nickname: el.textContent.trim(),
          avatar: avatarEl?.src,
        };
      }
    }
    
    // 方法4: 检查是否有退出按钮
    const logoutSelectors = [
      'a[href*="signout"]',
      'a[href*="logout"]',
      '.logout',
      '#sign_out',
    ];
    
    for (const selector of logoutSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('cnblogs', '检测到退出按钮，已登录: ' + selector);
        return {
          loggedIn: true,
          platform: 'cnblogs',
          nickname: '博客园用户',
        };
      }
    }
    
    // 方法5: 检查全局变量
    const win = window as any;
    if (win.currentBlogApp || win.cb_blogUserGuid) {
      log('cnblogs', '从全局变量检测到登录状态');
      return {
        loggedIn: true,
        platform: 'cnblogs',
        nickname: win.currentBlogApp || '博客园用户',
      };
    }
    
    // 方法6: 检查是否在博客后台
    if (url.includes('/admin/') || url.includes('/posts/edit') || url.includes('/posts/new')) {
      log('cnblogs', '在博客后台，已登录');
      return {
        loggedIn: true,
        platform: 'cnblogs',
        nickname: '博客园用户',
      };
    }
    
    // 方法7: 检查登录链接（如果有登录链接且文字是"登录"，则未登录）
    const loginLink = document.querySelector('a[href*="signin"], a[href*="login"]');
    if (loginLink && loginLink.textContent?.includes('登录')) {
      log('cnblogs', '检测到登录链接，未登录');
      return { loggedIn: false, platform: 'cnblogs' };
    }
    
    // 方法8: 检查页面内容是否包含"您已经登录"
    const bodyText = document.body?.textContent || '';
    if (bodyText.includes('您已经登录') || bodyText.includes('已登录') || 
        bodyText.includes('already signed in') || bodyText.includes('Already logged in')) {
      log('cnblogs', '从页面内容检测到已登录');
      return {
        loggedIn: true,
        platform: 'cnblogs',
        nickname: '博客园用户',
      };
    }
    
    log('cnblogs', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: 'cnblogs' };
  },
};

/**
 * 51CTO 登录检测器
 */
const cto51Detector: PlatformAuthDetector = {
  id: '51cto',
  urlPatterns: [/51cto\.com/],
  async checkLogin(): Promise<LoginState> {
    log('51cto', '检测登录状态...');
    const url = window.location.href;
    log('51cto', '当前 URL: ' + url);
    
    // 打印调试信息
    const allElements = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="login"], [class*="name"]');
    log('51cto', '找到 ' + allElements.length + ' 个可能的用户相关元素');
    
    // 方法1: 检查是否在个人中心页面（home.51cto.com）
    if (url.includes('home.51cto.com')) {
      log('51cto', '在个人中心页面');
      // 个人中心页面如果能访问，说明已登录
      // 检查页面是否有用户信息
      const homeUserSelectors = [
        '.user-info',
        '.user-name',
        '.user-avatar',
        '.home-user',
        '.profile-info',
        '.account-info',
        '[class*="userinfo"]',
        '[class*="user-info"]',
      ];
      
      for (const selector of homeUserSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          log('51cto', '在个人中心检测到用户元素: ' + selector);
          const nameEl = el.querySelector('[class*="name"]') || el;
          const avatarEl = document.querySelector('img[class*="avatar"], .avatar img') as HTMLImageElement;
          return {
            loggedIn: true,
            platform: '51cto',
            nickname: nameEl?.textContent?.trim() || '51CTO用户',
            avatar: avatarEl?.src,
          };
        }
      }
    }
    
    // 方法2: 检查多种 DOM 选择器
    const userSelectors = [
      '.user-name',
      '.nickname',
      '.user-info .name',
      '.header-user-name',
      '.nav-user-name',
      '.top-user-name',
      '[class*="username"]',
      '[class*="user-name"]',
      '[class*="nick"]',
      '.home-header .name',
      '.user-center .name',
    ];
    
    for (const selector of userSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim() && !el.textContent.includes('登录') && !el.textContent.includes('注册')) {
        log('51cto', '从 DOM 检测到登录状态: ' + selector + ' -> ' + el.textContent.trim());
        const avatarEl = document.querySelector('.user-avatar img, .avatar img, img[class*="avatar"]') as HTMLImageElement;
        return {
          loggedIn: true,
          platform: '51cto',
          nickname: el.textContent.trim(),
          avatar: avatarEl?.src,
        };
      }
    }
    
    // 方法3: 检查头像图片（登录后通常会显示用户头像）
    const avatarSelectors = [
      '.user-avatar img',
      '.avatar img',
      'img[class*="avatar"]',
      '.header-avatar img',
      '.nav-avatar img',
    ];
    
    for (const selector of avatarSelectors) {
      const el = document.querySelector(selector) as HTMLImageElement;
      if (el?.src && !el.src.includes('default') && !el.src.includes('noavatar') && el.src.length > 10) {
        log('51cto', '从头像检测到登录状态: ' + selector);
        return {
          loggedIn: true,
          platform: '51cto',
          nickname: '51CTO用户',
          avatar: el.src,
        };
      }
    }
    
    // 方法4: 检查 Cookie
    try {
      const cookies = document.cookie;
      log('51cto', 'Cookie: ' + cookies.substring(0, 300));
      // 51CTO 登录后可能有的 Cookie
      if (cookies.includes('user_id=') || cookies.includes('uid=') || 
          cookies.includes('token=') || cookies.includes('session')) {
        // 有用户相关 Cookie，可能已登录，但需要进一步确认
        log('51cto', '发现可能的登录 Cookie');
      }
    } catch {}
    
    // 方法5: 检查全局变量
    const win = window as any;
    const possibleUserVars = [
      win.userInfo,
      win.USER_INFO,
      win.currentUser,
      win.__USER__,
      win.user,
    ];
    
    for (const user of possibleUserVars) {
      if (user && (user.id || user.uid || user.userId || user.name || user.nickname)) {
        log('51cto', '从全局变量检测到登录状态');
        return {
          loggedIn: true,
          platform: '51cto',
          userId: user.id || user.uid || user.userId,
          nickname: user.name || user.nickname || user.userName || '51CTO用户',
          avatar: user.avatar || user.avatarUrl,
        };
      }
    }
    
    // 方法6: 检查是否有退出/注销按钮
    const logoutSelectors = [
      'a[href*="logout"]',
      'a[href*="signout"]',
      '.logout',
      '.sign-out',
      '[class*="logout"]',
    ];
    
    for (const selector of logoutSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('51cto', '检测到退出按钮，已登录: ' + selector);
        return {
          loggedIn: true,
          platform: '51cto',
          nickname: '51CTO用户',
        };
      }
    }
    
    // 方法7: 调用 51CTO API 检测登录状态
    try {
      log('51cto', '尝试调用 API...');
      const res = await fetch('https://home.51cto.com/api/user/info', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        log('51cto', 'API 响应: ' + JSON.stringify(data).substring(0, 200));
        
        if (data.code === 0 || data.status === 'success' || data.data) {
          const user = data.data || data.user || data;
          if (user.id || user.uid || user.name || user.nickname) {
            return {
              loggedIn: true,
              platform: '51cto',
              userId: user.id || user.uid,
              nickname: user.name || user.nickname || '51CTO用户',
              avatar: user.avatar || user.avatarUrl,
            };
          }
        }
      }
    } catch (e: any) {
      log('51cto', 'API 调用失败: ' + e.message);
    }
    
    // 方法8: 检查登录按钮（如果有明显的登录按钮，则未登录）
    const loginBtnSelectors = [
      '.login-btn',
      'a[href*="login"]',
      '.sign-in',
      '[class*="login-btn"]',
    ];
    
    for (const selector of loginBtnSelectors) {
      const el = document.querySelector(selector);
      if (el && (el.textContent?.includes('登录') || el.textContent?.includes('Login'))) {
        log('51cto', '检测到登录按钮，未登录: ' + selector);
        return { loggedIn: false, platform: '51cto' };
      }
    }
    
    log('51cto', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: '51cto' };
  },
};


/**
 * 腾讯云开发者社区登录检测器
 */
const tencentCloudDetector: PlatformAuthDetector = {
  id: 'tencent-cloud',
  urlPatterns: [/cloud\.tencent\.com/],
  async checkLogin(): Promise<LoginState> {
    log('tencent-cloud', '检测登录状态...');
    const url = window.location.href;
    log('tencent-cloud', '当前 URL: ' + url);
    
    // 打印调试信息
    const allElements = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="login"], [class*="header"]');
    log('tencent-cloud', '找到 ' + allElements.length + ' 个可能的用户相关元素');
    
    // 方法1: 检查多种 DOM 选择器
    const userSelectors = [
      '.user-name',
      '.com-header-user-name',
      '.c-header-user-name',
      '.header-user-name',
      '.nav-user-name',
      '.com-header-user-info .name',
      '.user-info .name',
      '[class*="header"] [class*="user"] [class*="name"]',
      '[class*="user-info"] [class*="name"]',
      '.com-2-header-user-name',
      '.tea-header-user-name',
    ];
    
    for (const selector of userSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim() && !el.textContent.includes('登录') && !el.textContent.includes('注册')) {
        log('tencent-cloud', '从 DOM 检测到登录状态: ' + selector + ' -> ' + el.textContent.trim());
        const avatarEl = document.querySelector('.user-avatar img, .com-header-user-avatar img, [class*="avatar"] img') as HTMLImageElement;
        return {
          loggedIn: true,
          platform: 'tencent-cloud',
          nickname: el.textContent.trim(),
          avatar: avatarEl?.src,
        };
      }
    }
    
    // 方法2: 检查头像图片
    const avatarSelectors = [
      '.user-avatar img',
      '.com-header-user-avatar img',
      '.c-header-user-avatar img',
      '[class*="header"] [class*="avatar"] img',
      'img[class*="avatar"]',
    ];
    
    for (const selector of avatarSelectors) {
      const el = document.querySelector(selector) as HTMLImageElement;
      if (el?.src && !el.src.includes('default') && !el.src.includes('noavatar') && el.src.length > 20) {
        log('tencent-cloud', '从头像检测到登录状态: ' + selector);
        return {
          loggedIn: true,
          platform: 'tencent-cloud',
          nickname: '腾讯云用户',
          avatar: el.src,
        };
      }
    }
    
    // 方法3: 检查全局变量
    const win = window as any;
    const possibleUserVars = [
      win.userInfo,
      win.USER_INFO,
      win.__USER__,
      win.currentUser,
      win.QCLOUD_USER,
      win.__INITIAL_STATE__?.user,
    ];
    
    for (const user of possibleUserVars) {
      if (user && (user.uin || user.uid || user.id || user.name || user.nickname)) {
        log('tencent-cloud', '从全局变量检测到登录状态');
        return {
          loggedIn: true,
          platform: 'tencent-cloud',
          userId: user.uin || user.uid || user.id,
          nickname: user.name || user.nickname || user.nick || '腾讯云用户',
          avatar: user.avatar || user.avatarUrl,
        };
      }
    }
    
    // 方法4: 检查 Cookie
    try {
      const cookies = document.cookie;
      log('tencent-cloud', 'Cookie: ' + cookies.substring(0, 300));
      // 腾讯云登录后会有 uin、skey 等 Cookie
      if (cookies.includes('uin=') || cookies.includes('skey=') || 
          cookies.includes('p_uin=') || cookies.includes('pt4_token=')) {
        log('tencent-cloud', '从 Cookie 检测到可能已登录');
        // 有腾讯系 Cookie，很可能已登录
        return {
          loggedIn: true,
          platform: 'tencent-cloud',
          nickname: '腾讯云用户',
        };
      }
    } catch {}
    
    // 方法5: 检查是否有退出按钮
    const logoutSelectors = [
      'a[href*="logout"]',
      'a[href*="signout"]',
      '.logout',
      '.sign-out',
      '[class*="logout"]',
      'a[href*="cloud.tencent.com/logout"]',
    ];
    
    for (const selector of logoutSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('tencent-cloud', '检测到退出按钮，已登录: ' + selector);
        return {
          loggedIn: true,
          platform: 'tencent-cloud',
          nickname: '腾讯云用户',
        };
      }
    }
    
    // 方法6: 检查是否在个人中心或控制台
    if (url.includes('/developer/user') || url.includes('/console') || 
        url.includes('/account') || url.includes('/profile')) {
      log('tencent-cloud', '在个人中心/控制台，已登录');
      return {
        loggedIn: true,
        platform: 'tencent-cloud',
        nickname: '腾讯云用户',
      };
    }
    
    // 方法7: 调用腾讯云 API
    try {
      log('tencent-cloud', '尝试调用 API...');
      const res = await fetch('https://cloud.tencent.com/developer/api/user/info', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        log('tencent-cloud', 'API 响应: ' + JSON.stringify(data).substring(0, 200));
        
        if (data.code === 0 || data.ret === 0 || data.data) {
          const user = data.data || data.user || data;
          if (user.uin || user.uid || user.id || user.name || user.nickname) {
            return {
              loggedIn: true,
              platform: 'tencent-cloud',
              userId: user.uin || user.uid || user.id,
              nickname: user.name || user.nickname || '腾讯云用户',
              avatar: user.avatar || user.avatarUrl,
            };
          }
        }
      }
    } catch (e: any) {
      log('tencent-cloud', 'API 调用失败: ' + e.message);
    }
    
    // 方法8: 检查登录按钮（如果有明显的登录按钮，则未登录）
    const loginBtnSelectors = [
      '.login-btn',
      'a[href*="login"]',
      '.sign-in',
      '[class*="login"]',
    ];
    
    for (const selector of loginBtnSelectors) {
      const el = document.querySelector(selector);
      if (el && (el.textContent?.includes('登录') || el.textContent?.includes('Login'))) {
        log('tencent-cloud', '检测到登录按钮，未登录: ' + selector);
        return { loggedIn: false, platform: 'tencent-cloud' };
      }
    }
    
    log('tencent-cloud', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: 'tencent-cloud' };
  },
};

/**
 * 阿里云开发者社区登录检测器
 */
const aliyunDetector: PlatformAuthDetector = {
  id: 'aliyun',
  urlPatterns: [/developer\.aliyun\.com/, /aliyun\.com/],
  async checkLogin(): Promise<LoginState> {
    log('aliyun', '检测登录状态...');
    const url = window.location.href;
    log('aliyun', '当前 URL: ' + url);
    
    // 打印调试信息
    const allElements = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="login"], [class*="header"]');
    log('aliyun', '找到 ' + allElements.length + ' 个可能的用户相关元素');
    
    // 方法1: 检查多种 DOM 选择器
    const userSelectors = [
      '.aliyun-user-name',
      '.user-name',
      '.aliyun-console-user-name',
      '.aliyun-header-user-name',
      '.aliyun-topbar-user-name',
      '.aliyun-nav-user-name',
      '.aliyun-header-user-info .name',
      '[class*="aliyun"] [class*="user"] [class*="name"]',
      '[class*="header"] [class*="user"] [class*="name"]',
      '.aliyun-com-header-user-name',
      '.aliyun-com-header-user-info .name',
      '.aliyun-topbar-user-info .name',
      '.aliyun-header-user-nick',
      '.aliyun-header-nick',
    ];
    
    for (const selector of userSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim() && !el.textContent.includes('登录') && !el.textContent.includes('注册') && !el.textContent.includes('免费注册')) {
        log('aliyun', '从 DOM 检测到登录状态: ' + selector + ' -> ' + el.textContent.trim());
        const avatarEl = document.querySelector('.aliyun-user-avatar img, .user-avatar img, [class*="avatar"] img') as HTMLImageElement;
        return {
          loggedIn: true,
          platform: 'aliyun',
          nickname: el.textContent.trim(),
          avatar: avatarEl?.src,
        };
      }
    }
    
    // 方法2: 检查头像图片
    const avatarSelectors = [
      '.aliyun-user-avatar img',
      '.user-avatar img',
      '.aliyun-header-user-avatar img',
      '[class*="aliyun"] [class*="avatar"] img',
      'img[class*="avatar"]',
    ];
    
    for (const selector of avatarSelectors) {
      const el = document.querySelector(selector) as HTMLImageElement;
      if (el?.src && !el.src.includes('default') && !el.src.includes('noavatar') && el.src.length > 20) {
        log('aliyun', '从头像检测到登录状态: ' + selector);
        return {
          loggedIn: true,
          platform: 'aliyun',
          nickname: '阿里云用户',
          avatar: el.src,
        };
      }
    }
    
    // 方法3: 检查 Cookie
    try {
      const cookies = document.cookie;
      log('aliyun', 'Cookie: ' + cookies.substring(0, 300));
      // 阿里云登录后会有 login_aliyunid_pk、aliyun_choice 等 Cookie
      if (cookies.includes('login_aliyunid_pk=') || cookies.includes('aliyun_choice=') || 
          cookies.includes('login_aliyunid=') || cookies.includes('aliyun_lang=') ||
          cookies.includes('login_aliyunid_csrf=') || cookies.includes('aui_') ||
          cookies.includes('XSRF-TOKEN=')) {
        log('aliyun', '从 Cookie 检测到可能已登录');
        // 有阿里云 Cookie，很可能已登录
        return {
          loggedIn: true,
          platform: 'aliyun',
          nickname: '阿里云用户',
        };
      }
    } catch {}
    
    // 方法4: 检查全局变量
    const win = window as any;
    const possibleUserVars = [
      win.userInfo,
      win.USER_INFO,
      win.__USER__,
      win.currentUser,
      win.ALIYUN_USER,
      win.__INITIAL_STATE__?.user,
      win.globalData?.user,
    ];
    
    for (const user of possibleUserVars) {
      if (user && (user.uid || user.id || user.name || user.nickname || user.loginId)) {
        log('aliyun', '从全局变量检测到登录状态');
        return {
          loggedIn: true,
          platform: 'aliyun',
          userId: user.uid || user.id || user.loginId,
          nickname: user.name || user.nickname || user.loginId || '阿里云用户',
          avatar: user.avatar || user.avatarUrl,
        };
      }
    }
    
    // 方法5: 检查是否有退出按钮
    const logoutSelectors = [
      'a[href*="logout"]',
      'a[href*="signout"]',
      '.logout',
      '.sign-out',
      '[class*="logout"]',
      'a[href*="aliyun.com/logout"]',
    ];
    
    for (const selector of logoutSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('aliyun', '检测到退出按钮，已登录: ' + selector);
        return {
          loggedIn: true,
          platform: 'aliyun',
          nickname: '阿里云用户',
        };
      }
    }
    
    // 方法6: 检查是否在控制台或个人中心
    if (url.includes('/console') || url.includes('/account') || 
        url.includes('/profile') || url.includes('/home.htm') ||
        url.includes('/developer/my')) {
      log('aliyun', '在控制台/个人中心，已登录');
      return {
        loggedIn: true,
        platform: 'aliyun',
        nickname: '阿里云用户',
      };
    }
    
    // 方法7: 检查是否在登录页面但已登录（页面显示"您已登录"）
    const bodyText = document.body?.textContent || '';
    if (bodyText.includes('您已登录') || bodyText.includes('已登录') || 
        bodyText.includes('欢迎回来') || bodyText.includes('Welcome back')) {
      log('aliyun', '从页面内容检测到已登录');
      return {
        loggedIn: true,
        platform: 'aliyun',
        nickname: '阿里云用户',
      };
    }
    
    // 方法8: 检查登录按钮（如果有明显的登录按钮，则未登录）
    const loginBtnSelectors = [
      '.aliyun-login-btn',
      'a[href*="login"]',
      '.sign-in',
      '[class*="login"]',
    ];
    
    let hasLoginBtn = false;
    for (const selector of loginBtnSelectors) {
      const el = document.querySelector(selector);
      if (el && (el.textContent?.includes('登录') || el.textContent?.includes('Login') || el.textContent?.includes('免费注册'))) {
        hasLoginBtn = true;
        log('aliyun', '检测到登录按钮: ' + selector);
        break;
      }
    }
    
    // 如果在登录页面，检查是否有登录成功的标志
    if (url.includes('login.htm') || url.includes('signin')) {
      // 检查是否有跳转提示或成功提示
      if (bodyText.includes('登录成功') || bodyText.includes('正在跳转')) {
        log('aliyun', '登录页面显示成功');
        return {
          loggedIn: true,
          platform: 'aliyun',
          nickname: '阿里云用户',
        };
      }
    }
    
    if (hasLoginBtn) {
      log('aliyun', '检测到登录按钮，未登录');
      return { loggedIn: false, platform: 'aliyun' };
    }
    
    log('aliyun', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: 'aliyun' };
  },
};

/**
 * 思否登录检测器
 */
const segmentfaultDetector: PlatformAuthDetector = {
  id: 'segmentfault',
  urlPatterns: [/segmentfault\.com/],
  async checkLogin(): Promise<LoginState> {
    log('segmentfault', '检测登录状态...');
    const url = window.location.href;
    log('segmentfault', '当前 URL: ' + url);
    
    // 打印调试信息
    const allElements = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="login"], [class*="header"]');
    log('segmentfault', '找到 ' + allElements.length + ' 个可能的用户相关元素');
    
    // 方法1: 检查多种 DOM 选择器
    const userSelectors = [
      '.user-name',
      '.nav-user-name',
      '.dropdown-toggle .name',
      '.header-user-name',
      '.nav-user .name',
      '.user-dropdown .name',
      '.header-nav .user-name',
      '[class*="user"] [class*="name"]',
      '.navbar-user .name',
      '.top-nav .user-name',
      '.sf-header .user-name',
      '.header-right .user-name',
    ];
    
    for (const selector of userSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim() && !el.textContent.includes('登录') && !el.textContent.includes('注册')) {
        log('segmentfault', '从 DOM 检测到登录状态: ' + selector + ' -> ' + el.textContent.trim());
        const avatarEl = document.querySelector('.user-avatar img, .nav-user-avatar img, [class*="avatar"] img') as HTMLImageElement;
        return {
          loggedIn: true,
          platform: 'segmentfault',
          nickname: el.textContent.trim(),
          avatar: avatarEl?.src,
        };
      }
    }
    
    // 方法2: 检查头像图片
    const avatarSelectors = [
      '.user-avatar img',
      '.nav-user-avatar img',
      '.header-user-avatar img',
      '[class*="avatar"] img',
      'img[class*="avatar"]',
      '.navbar-user img',
      '.header-right img[class*="avatar"]',
    ];
    
    for (const selector of avatarSelectors) {
      const el = document.querySelector(selector) as HTMLImageElement;
      if (el?.src && !el.src.includes('default') && !el.src.includes('noavatar') && el.src.length > 20) {
        log('segmentfault', '从头像检测到登录状态: ' + selector + ' -> ' + el.src.substring(0, 50));
        return {
          loggedIn: true,
          platform: 'segmentfault',
          nickname: '思否用户',
          avatar: el.src,
        };
      }
    }
    
    // 方法3: 检查全局变量
    const win = window as any;
    log('segmentfault', '检查全局变量...');
    
    if (win.SF?.user?.id) {
      log('segmentfault', '从 SF.user 检测到登录状态');
      return {
        loggedIn: true,
        platform: 'segmentfault',
        userId: win.SF.user.id,
        nickname: win.SF.user.name || '思否用户',
        avatar: win.SF.user.avatar,
      };
    }
    
    const possibleUserVars = [
      { name: 'userInfo', value: win.userInfo },
      { name: '__USER__', value: win.__USER__ },
      { name: 'currentUser', value: win.currentUser },
      { name: '__INITIAL_STATE__.user', value: win.__INITIAL_STATE__?.user },
      { name: '__NUXT__.state.user', value: win.__NUXT__?.state?.user },
    ];
    
    for (const { name, value } of possibleUserVars) {
      if (value && (value.id || value.uid || value.name || value.nickname)) {
        log('segmentfault', '从全局变量检测到登录状态: ' + name);
        return {
          loggedIn: true,
          platform: 'segmentfault',
          userId: String(value.id || value.uid),
          nickname: value.name || value.nickname || '思否用户',
          avatar: value.avatar || value.avatarUrl,
        };
      }
    }
    
    // 方法4: 检查 Cookie
    try {
      const cookies = document.cookie;
      log('segmentfault', 'Cookie: ' + cookies.substring(0, 300));
      // 思否登录后会有 PHPSESSID、sf_remember 等 Cookie
      if (cookies.includes('sf_remember=') || cookies.includes('SFUID=') || 
          cookies.includes('sf_token=') || cookies.includes('Hm_lvt_')) {
        log('segmentfault', '从 Cookie 检测到可能已登录');
        // 有思否 Cookie，可能已登录，但需要进一步确认
      }
    } catch {}
    
    // 方法5: 检查是否有退出按钮
    const logoutSelectors = [
      'a[href*="logout"]',
      'a[href*="signout"]',
      '.logout',
      '.sign-out',
      '[class*="logout"]',
      'a[href*="/user/logout"]',
    ];
    
    for (const selector of logoutSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('segmentfault', '检测到退出按钮，已登录: ' + selector);
        return {
          loggedIn: true,
          platform: 'segmentfault',
          nickname: '思否用户',
        };
      }
    }
    
    // 方法6: 检查是否在个人中心
    if (url.includes('/u/') || url.includes('/user/') || url.includes('/setting')) {
      const pageUserEl = document.querySelector('.user-info, .profile-info, .user-center');
      if (pageUserEl) {
        log('segmentfault', '在个人中心，已登录');
        return {
          loggedIn: true,
          platform: 'segmentfault',
          nickname: '思否用户',
        };
      }
    }
    
    // 方法7: 调用思否 API
    try {
      log('segmentfault', '尝试调用 API...');
      const res = await fetch('https://segmentfault.com/api/user/current', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        log('segmentfault', 'API 响应: ' + JSON.stringify(data).substring(0, 200));
        
        if (data.status === 0 || data.data?.id || data.user?.id || data.id) {
          const user = data.data || data.user || data;
          if (user.id || user.name || user.nickname) {
            return {
              loggedIn: true,
              platform: 'segmentfault',
              userId: String(user.id),
              nickname: user.name || user.nickname || '思否用户',
              avatar: user.avatar || user.avatarUrl,
            };
          }
        }
      }
    } catch (e: any) {
      log('segmentfault', 'API 调用失败: ' + e.message);
    }
    
    // 方法8: 检查登录按钮（如果有明显的登录按钮，则未登录）
    const loginBtnSelectors = [
      '.login-btn',
      'a[href*="login"]',
      '.sign-in',
      '[class*="login"]',
      '.header-login-btn',
    ];
    
    for (const selector of loginBtnSelectors) {
      const el = document.querySelector(selector);
      if (el && (el.textContent?.includes('登录') || el.textContent?.includes('Login'))) {
        log('segmentfault', '检测到登录按钮，未登录: ' + selector);
        return { loggedIn: false, platform: 'segmentfault' };
      }
    }
    
    log('segmentfault', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: 'segmentfault' };
  },
};

/**
 * B站专栏登录检测器
 */
const bilibiliDetector: PlatformAuthDetector = {
  id: 'bilibili',
  urlPatterns: [/bilibili\.com/],
  async checkLogin(): Promise<LoginState> {
    log('bilibili', '检测登录状态...');
    
    // 方法1: 检查 DOM
    const avatarEl = document.querySelector('.header-avatar-wrap img, .bili-avatar img') as HTMLImageElement;
    const usernameEl = document.querySelector('.header-entry-mini .nickname, .user-name');
    
    if (avatarEl?.src && !avatarEl.src.includes('noface')) {
      return {
        loggedIn: true,
        platform: 'bilibili',
        nickname: usernameEl?.textContent?.trim(),
        avatar: avatarEl.src,
      };
    }
    
    // 方法2: 调用 API
    try {
      const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.code === 0 && data.data?.isLogin) {
          log('bilibili', '从 API 检测到登录状态');
          return {
            loggedIn: true,
            platform: 'bilibili',
            userId: String(data.data.mid),
            nickname: data.data.uname,
            avatar: data.data.face,
          };
        }
      }
    } catch (e) {
      log('bilibili', 'API 调用失败', e);
    }
    
    return { loggedIn: false, platform: 'bilibili' };
  },
};

/**
 * 开源中国登录检测器
 */
const oschinaDetector: PlatformAuthDetector = {
  id: 'oschina',
  urlPatterns: [/oschina\.net/],
  async checkLogin(): Promise<LoginState> {
    log('oschina', '检测登录状态...');
    const url = window.location.href;
    log('oschina', '当前 URL: ' + url);
    
    // 打印调试信息
    const allElements = document.querySelectorAll('[class*="user"], [class*="avatar"], [class*="login"], [class*="header"]');
    log('oschina', '找到 ' + allElements.length + ' 个可能的用户相关元素');
    
    // 方法1: 检查多种 DOM 选择器
    const userSelectors = [
      '.user-name',
      '.current-user-name',
      '.user-info .name',
      '.header-user-name',
      '.nav-user-name',
      '.user-dropdown .name',
      '.user-dropdown-toggle .name',
      '.header-login-wrap .name',
      '.header-user-info .name',
      '[class*="user"] [class*="name"]',
      '.current-user .name',
      '.logged-user .name',
      '.header-nav .user-name',
      '.top-nav .user-name',
      '.main-nav .user-name',
    ];
    
    for (const selector of userSelectors) {
      const el = document.querySelector(selector);
      if (el?.textContent?.trim() && !el.textContent.includes('登录') && !el.textContent.includes('注册')) {
        log('oschina', '从 DOM 检测到登录状态: ' + selector + ' -> ' + el.textContent.trim());
        const avatarEl = document.querySelector('.user-avatar img, .current-user-avatar img, [class*="avatar"] img') as HTMLImageElement;
        return {
          loggedIn: true,
          platform: 'oschina',
          nickname: el.textContent.trim(),
          avatar: avatarEl?.src,
        };
      }
    }
    
    // 方法2: 检查头像图片
    const avatarSelectors = [
      '.user-avatar img',
      '.current-user-avatar img',
      '.header-user-avatar img',
      '[class*="avatar"] img',
      'img[class*="avatar"]',
      '.header-login-wrap img',
      '.user-dropdown img',
    ];
    
    for (const selector of avatarSelectors) {
      const el = document.querySelector(selector) as HTMLImageElement;
      if (el?.src && !el.src.includes('default') && !el.src.includes('noavatar') && 
          !el.src.includes('no_portrait') && el.src.length > 20) {
        log('oschina', '从头像检测到登录状态: ' + selector + ' -> ' + el.src.substring(0, 50));
        return {
          loggedIn: true,
          platform: 'oschina',
          nickname: '开源中国用户',
          avatar: el.src,
        };
      }
    }
    
    // 方法3: 检查全局变量
    const win = window as any;
    log('oschina', '检查全局变量...');
    const possibleUserVars = [
      { name: 'G_USER', value: win.G_USER },
      { name: 'currentUser', value: win.currentUser },
      { name: 'userInfo', value: win.userInfo },
      { name: '__USER__', value: win.__USER__ },
      { name: 'OSC_USER', value: win.OSC_USER },
    ];
    
    for (const { name, value } of possibleUserVars) {
      if (value && (value.id || value.uid || value.name || value.nickname)) {
        log('oschina', '从全局变量检测到登录状态: ' + name);
        return {
          loggedIn: true,
          platform: 'oschina',
          userId: String(value.id || value.uid),
          nickname: value.name || value.nickname || '开源中国用户',
          avatar: value.portrait || value.avatar,
        };
      }
    }
    
    // 方法4: 检查 Cookie
    try {
      const cookies = document.cookie;
      log('oschina', 'Cookie: ' + cookies.substring(0, 300));
      // 开源中国登录后会有 oscid、user 等 Cookie
      if (cookies.includes('oscid=') || cookies.includes('user=') || 
          cookies.includes('_user_') || cookies.includes('oschina_')) {
        log('oschina', '从 Cookie 检测到可能已登录');
        return {
          loggedIn: true,
          platform: 'oschina',
          nickname: '开源中国用户',
        };
      }
    } catch {}
    
    // 方法5: 检查是否有退出按钮
    const logoutSelectors = [
      'a[href*="logout"]',
      'a[href*="signout"]',
      '.logout',
      '.sign-out',
      '[class*="logout"]',
      'a[href*="/action/user/logout"]',
    ];
    
    for (const selector of logoutSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        log('oschina', '检测到退出按钮，已登录: ' + selector);
        return {
          loggedIn: true,
          platform: 'oschina',
          nickname: '开源中国用户',
        };
      }
    }
    
    // 方法6: 检查是否在个人中心
    if (url.includes('/my') || url.includes('/u/') || url.includes('/home/')) {
      // 检查页面是否有用户信息
      const pageUserEl = document.querySelector('.user-info, .profile-info, .user-center');
      if (pageUserEl) {
        log('oschina', '在个人中心，已登录');
        return {
          loggedIn: true,
          platform: 'oschina',
          nickname: '开源中国用户',
        };
      }
    }
    
    // 方法7: 调用开源中国 API
    try {
      log('oschina', '尝试调用 API...');
      const res = await fetch('https://www.oschina.net/action/user/info', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        log('oschina', 'API 响应: ' + JSON.stringify(data).substring(0, 200));
        
        if (data.code === 0 || data.result?.id || data.user?.id || data.id) {
          const user = data.result || data.user || data;
          return {
            loggedIn: true,
            platform: 'oschina',
            userId: String(user.id),
            nickname: user.name || user.nickname || '开源中国用户',
            avatar: user.portrait || user.avatar,
          };
        }
      }
    } catch (e: any) {
      log('oschina', 'API 调用失败: ' + e.message);
    }
    
    // 方法8: 检查登录按钮（如果有明显的登录按钮，则未登录）
    const loginBtnSelectors = [
      '.login-btn',
      'a[href*="login"]',
      '.sign-in',
      '[class*="login"]',
      '.header-login-btn',
    ];
    
    for (const selector of loginBtnSelectors) {
      const el = document.querySelector(selector);
      if (el && (el.textContent?.includes('登录') || el.textContent?.includes('Login'))) {
        log('oschina', '检测到登录按钮，未登录: ' + selector);
        return { loggedIn: false, platform: 'oschina' };
      }
    }
    
    log('oschina', '未能确定登录状态，默认未登录');
    return { loggedIn: false, platform: 'oschina' };
  },
};


// ============================================================
// 检测器注册表
// ============================================================

const detectors: PlatformAuthDetector[] = [
  juejinDetector,
  csdnDetector,
  zhihuDetector,
  wechatDetector,
  jianshuDetector,
  cnblogsDetector,
  cto51Detector,
  tencentCloudDetector,
  aliyunDetector,
  segmentfaultDetector,
  bilibiliDetector,
  oschinaDetector,
];

/**
 * 根据当前 URL 获取匹配的检测器
 */
function getDetectorForUrl(url: string): PlatformAuthDetector | null {
  for (const detector of detectors) {
    for (const pattern of detector.urlPatterns) {
      if (pattern.test(url)) {
        return detector;
      }
    }
  }
  return null;
}

/**
 * 检测当前页面的登录状态
 */
export async function detectLoginState(): Promise<LoginState> {
  const url = window.location.href;
  log('detect', `检测 URL: ${url}`);
  
  const detector = getDetectorForUrl(url);
  if (!detector) {
    log('detect', '未找到匹配的检测器');
    return { loggedIn: false, error: '不支持的平台' };
  }
  
  log('detect', `使用检测器: ${detector.id}`);
  
  try {
    const state = await detector.checkLogin();
    log('detect', '检测结果', state);
    return state;
  } catch (error: any) {
    log('detect', '检测失败', error);
    return { loggedIn: false, platform: detector.id, error: error.message };
  }
}

/**
 * 启动登录状态轮询
 * 用于引导登录场景：持续检测直到登录成功
 */
export function startLoginPolling(
  onLoginSuccess: (state: LoginState) => void,
  interval = 1000,
  maxAttempts = 180 // 3分钟
): () => void {
  let attempts = 0;
  let stopped = false;
  
  log('polling', `开始轮询，间隔 ${interval}ms，最大尝试 ${maxAttempts} 次`);
  
  const poll = async () => {
    if (stopped) return;
    
    attempts++;
    const state = await detectLoginState();
    
    log('polling', `第 ${attempts} 次检测`, { loggedIn: state.loggedIn });
    
    if (state.loggedIn) {
      log('polling', '检测到登录成功！', state);
      onLoginSuccess(state);
      return;
    }
    
    if (attempts < maxAttempts && !stopped) {
      setTimeout(poll, interval);
    } else {
      log('polling', '轮询超时');
    }
  };
  
  // 立即开始第一次检测
  poll();
  
  // 返回停止函数
  return () => {
    stopped = true;
    log('polling', '轮询已停止');
  };
}

/**
 * 初始化登录检测消息监听
 */
export function initAuthDetector() {
  log('init', '初始化登录检测器');
  
  // 监听来自 background 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CHECK_LOGIN') {
      log('message', '收到登录检测请求');
      detectLoginState().then(sendResponse);
      return true; // 异步响应
    }
    
    if (message.type === 'START_LOGIN_POLLING') {
      log('message', '收到启动轮询请求');
      startLoginPolling((state) => {
        // 登录成功，通知 background
        chrome.runtime.sendMessage({
          type: 'LOGIN_SUCCESS',
          data: state,
        });
      });
      sendResponse({ started: true });
      return false;
    }
  });
  
  // 页面加载完成后，自动检测一次并报告
  if (document.readyState === 'complete') {
    reportLoginState();
  } else {
    window.addEventListener('load', reportLoginState);
  }
}

/**
 * 主动报告当前登录状态给 background
 */
async function reportLoginState() {
  const state = await detectLoginState();
  if (state.platform) {
    log('report', '报告登录状态', state);
    chrome.runtime.sendMessage({
      type: 'LOGIN_STATE_REPORT',
      data: state,
    });
  }
}
