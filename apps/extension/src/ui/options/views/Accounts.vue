<template>
  <div class="accounts-page">
    <h2 class="page-title" :class="isDark ? 'text-gray-100' : 'text-gray-800'">账号管理</h2>

    <!-- 开发测试工具栏 -->
    <section class="section dev-toolbar">
      <div class="section-header">
        <span class="section-title">🔧 开发测试工具</span>
      </div>
      <div class="dev-buttons">
        <n-button 
          type="error"
          size="small"
          :loading="deletingAll"
          @click="deleteAllAccounts"
        >
          一键删除所有账号
        </n-button>
        <n-button 
          type="primary"
          size="small"
          :loading="addingAll"
          @click="addAllAccounts"
        >
          一键检测并添加账号
        </n-button>
      </div>
    </section>

    <!-- 已绑定账号模块 -->
    <section class="section">
      <div class="section-header">
        <div class="section-header-left">
          <span class="section-title">已绑定账号</span>
          <span class="section-count">{{ accounts.length }}</span>
        </div>
        <n-button 
          v-if="accounts.length > 0"
          size="small" 
          quaternary
          :loading="refreshingAll"
          @click="refreshAllAccounts"
        >
          刷新
        </n-button>
      </div>
      
      <div v-if="accounts.length === 0" class="empty-state">
        暂无绑定账号，请在下方选择平台登录
      </div>
      
      <div v-else class="account-grid">
        <div 
          v-for="account in accounts" 
          :key="account.id"
          class="account-row"
        >
          <div class="account-left">
            <n-avatar
              :size="32"
              :src="account.avatar || getPlatformIconUrl(account.platform)"
              :fallback-src="getDefaultIconUrl()"
            />
            <span 
              class="account-name"
              @click="goToUserProfile(account)"
              :title="`访问 ${account.nickname} 的主页`"
            >
              {{ account.nickname }}
            </span>
            <n-tag size="small" :bordered="false">
              {{ getPlatformName(account.platform) }}
            </n-tag>
          </div>
          
          <div class="account-right">
            <n-tooltip v-if="account.status === 'expired'" trigger="hover">
              <template #trigger>
                <span class="status-dot status-error"></span>
              </template>
              {{ account.lastError || '登录已失效，请重新登录' }}
            </n-tooltip>
            <n-tooltip v-else-if="isAccountExpiringSoon(account)" trigger="hover">
              <template #trigger>
                <span class="status-dot status-warning"></span>
              </template>
              登录将在 {{ formatExpiresIn(account.cookieExpiresAt) }} 后过期
            </n-tooltip>
            <span v-else class="status-dot status-success"></span>
            
            <n-button 
              v-if="account.status === 'expired' || isAccountExpiringSoon(account)" 
              size="small"
              :loading="reloginLoadingMap[account.id]"
              @click="reloginAccount(account)"
            >
              重新登录
            </n-button>
          </div>
        </div>
      </div>
    </section>

    <!-- 未绑定账号模块 -->
    <section class="section">
      <div class="section-header">
        <span class="section-title">未绑定账号</span>
        <span class="section-count">{{ unboundPlatforms.length }}</span>
      </div>
      
      <div v-if="unboundPlatforms.length === 0" class="empty-state">
        所有平台均已绑定账号
      </div>
      
      <div v-else class="platform-grid">
        <div 
          v-for="platform in unboundPlatforms" 
          :key="platform.id"
          class="platform-row"
        >
          <div class="platform-left">
            <n-avatar
              :size="20"
              :src="getPlatformIconUrl(platform.id)"
              :fallback-src="getDefaultIconUrl()"
              class="platform-icon-avatar"
            />
            <span class="platform-name">{{ platform.name }}</span>
          </div>
          <n-button 
            size="small"
            :loading="loginLoadingMap[platform.id]"
            @click="loginPlatform(platform.id)"
          >
            登录
          </n-button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { db, type Account } from '@synccaster/core';
import { useMessage } from 'naive-ui';

const ACCOUNTS_AUTO_REFRESH_THROTTLE_MS = 5 * 1000;
const ACCOUNTS_AUTO_REFRESH_STORAGE_KEY = 'lastAccountsAutoRefreshAt';
const AUTO_DETECT_UNBOUND_THROTTLE_MS = 30 * 1000;
const AUTO_DETECT_UNBOUND_STORAGE_KEY = 'lastAutoDetectUnboundAt';

defineProps<{ isDark?: boolean }>();
const message = useMessage();
const accounts = ref<Account[]>([]);
const reloginLoadingMap = reactive<Record<string, boolean>>({});
const loginLoadingMap = reactive<Record<string, boolean>>({});
const refreshingAll = ref(false);
const deletingAll = ref(false);
const addingAll = ref(false);

const platforms = [
  { id: 'juejin', name: '掘金' },
  { id: 'csdn', name: 'CSDN' },
  { id: 'zhihu', name: '知乎' },
  { id: 'wechat', name: '微信公众号' },
  { id: 'jianshu', name: '简书' },
  { id: 'cnblogs', name: '博客园' },
  { id: '51cto', name: '51CTO' },
  { id: 'tencent-cloud', name: '腾讯云开发者社区' },
  { id: 'aliyun', name: '阿里云开发者社区' },
  { id: 'segmentfault', name: '思否' },
  { id: 'bilibili', name: 'B站专栏' },
  { id: 'oschina', name: '开源中国' },
  { id: 'toutiao', name: '今日头条' },
  { id: 'infoq', name: 'InfoQ' },
  { id: 'baijiahao', name: '百家号' },
  { id: 'wangyihao', name: '网易号' },
  { id: 'medium', name: 'Medium' },
] as const;

const unboundPlatforms = computed(() => {
  const boundPlatformIds = new Set(accounts.value.map(a => a.platform));
  return platforms.filter(p => !boundPlatformIds.has(p.id));
});

const platformUserUrls: Record<string, (userId?: string) => string> = {
  'juejin': (userId) => userId ? `https://juejin.cn/user/${userId}` : 'https://juejin.cn/user/settings/profile',
  'csdn': (userId) => userId ? `https://blog.csdn.net/${userId}?type=blog` : 'https://i.csdn.net/#/user-center/profile',
  'zhihu': (userId) => userId ? `https://www.zhihu.com/people/${userId}` : 'https://www.zhihu.com/settings/profile',
  'wechat': () => 'https://mp.weixin.qq.com/',
  'jianshu': (userId) => {
    if (userId && !userId.startsWith('jianshu_') && userId.length > 5) {
      return `https://www.jianshu.com/u/${userId}`;
    }
    return 'https://www.jianshu.com/settings/basic';
  },
  'cnblogs': (userId) => {
    if (userId && userId.length > 2 && !userId.startsWith('cnblogs_') && !/^\d{10,}$/.test(userId)) {
      return `https://home.cnblogs.com/u/${userId}`;
    }
    return 'https://account.cnblogs.com/settings/account';
  },
  '51cto': (userId) => {
    if (userId && /^\d+$/.test(userId)) {
      return `https://home.51cto.com/space?uid=${userId}`;
    }
    return 'https://home.51cto.com/space';
  },
  'tencent-cloud': (userId) => {
    if (userId && /^\d+$/.test(userId)) {
      return `https://cloud.tencent.com/developer/user/${userId}`;
    }
    return 'https://cloud.tencent.com/developer/user';
  },
  'aliyun': (userId) => {
    if (userId && /^\d+$/.test(userId)) {
      return `https://developer.aliyun.com/profile/${userId}`;
    }
    return 'https://developer.aliyun.com/my';
  },
  'segmentfault': (userId) => userId ? `https://segmentfault.com/u/${userId}` : 'https://segmentfault.com/user/settings',
  'bilibili': (userId) => userId ? `https://space.bilibili.com/${userId}` : 'https://member.bilibili.com/platform/home',
  'oschina': (userId) => userId ? `https://my.oschina.net/u/${userId}` : 'https://my.oschina.net/',
  'toutiao': () => 'https://www.toutiao.com/',
  'infoq': (userId) => userId ? `https://www.infoq.cn/u/${userId}/` : 'https://www.infoq.cn/profile/',
  'baijiahao': (userId) => userId ? `https://author.baidu.com/home/${userId}` : 'https://baijiahao.baidu.com/',
  'wangyihao': () => 'https://www.163.com/',
  'medium': (userId) => userId ? `https://medium.com/@${userId}` : 'https://medium.com/me/stories/drafts',
};

onMounted(async () => {
  try {
    // 先做一次去重（后台修复 DB + 引用），避免 UI/自动绑定出现重复平台条目
    await chrome.runtime.sendMessage({ type: 'DEDUP_ACCOUNTS' });
  } catch (e) {
    // 忽略去重失败，不影响主流程
  }

  await loadAccounts();
  await quickStatusCheckOnStartup();
  await autoRefreshAccountsOnEnter();
  await autoDetectAndBindUnboundPlatforms();
});

async function autoRefreshAccountsOnEnter() {
  if (accounts.value.length === 0) return;

  try {
    const stored = await chrome.storage.local.get([ACCOUNTS_AUTO_REFRESH_STORAGE_KEY]);
    const last = stored?.[ACCOUNTS_AUTO_REFRESH_STORAGE_KEY];
    const lastAt = typeof last === 'number' ? last : 0;
    const now = Date.now();

    if (lastAt > 0 && now - lastAt < ACCOUNTS_AUTO_REFRESH_THROTTLE_MS) {
      return;
    }

    // 先写入节流时间戳，避免用户快速切换导致重复触发
    await chrome.storage.local.set({ [ACCOUNTS_AUTO_REFRESH_STORAGE_KEY]: now });

    // 关键：从 DB 取最新账号列表再发给 background（避免使用旧的 accounts.value 导致 background 不刷新）
    const latestAccounts = await db.accounts.toArray();
    if (latestAccounts.length === 0) return;


    await chrome.runtime.sendMessage({
      type: 'REFRESH_ALL_ACCOUNTS_FAST',
      data: { accounts: latestAccounts },
    });

    await loadAccounts();
  } catch (error) {
    console.error('Auto refresh accounts failed:', error);
  }
}

async function autoDetectAndBindUnboundPlatforms() {
  try {
    // 节流检查
    const stored = await chrome.storage.local.get([AUTO_DETECT_UNBOUND_STORAGE_KEY]);
    const last = stored?.[AUTO_DETECT_UNBOUND_STORAGE_KEY];
    const lastAt = typeof last === 'number' ? last : 0;
    const now = Date.now();

    if (lastAt > 0 && now - lastAt < AUTO_DETECT_UNBOUND_THROTTLE_MS) {
      return;
    }

    // 获取未绑定平台列表
    const unbound = unboundPlatforms.value;
    if (unbound.length === 0) return;

    // 写入节流时间戳
    await chrome.storage.local.set({ [AUTO_DETECT_UNBOUND_STORAGE_KEY]: now });

    // 并行检测所有未绑定平台的登录状态
    const results = await Promise.all(
      unbound.map(async (platform) => {
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'FETCH_PLATFORM_USER_INFO',
            data: { platform: platform.id },
          });
          return { platform: platform.id, name: platform.name, result };
        } catch (e) {
          return { platform: platform.id, name: platform.name, result: { success: false } };
        }
      })
    );

    // 对已登录的平台自动绑定
    const boundPlatforms: string[] = [];
    for (const { platform, name, result } of results) {
      if (result.success && result.info?.loggedIn) {
        try {
          await chrome.runtime.sendMessage({
            type: 'QUICK_ADD_ACCOUNT',
            data: { platform },
          });
          boundPlatforms.push(name);
        } catch (e) {
          console.error(`Auto bind ${platform} failed:`, e);
        }
      }
    }

    // 如果有自动绑定的账号，显示提示并重新加载
    if (boundPlatforms.length > 0) {
      message.success(`已自动绑定 ${boundPlatforms.length} 个账号：${boundPlatforms.join('、')}`);
      await loadAccounts();
    }
  } catch (error) {
    console.error('Auto detect and bind unbound platforms failed:', error);
  }
}

async function quickStatusCheckOnStartup() {
  if (accounts.value.length === 0) return;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'QUICK_STATUS_CHECK_ALL',
      data: { accounts: accounts.value },
    });
    if (result.success && result.results) {
      const updatedAccounts = accounts.value.map(account => {
        const checkResult = result.results[account.id];
        if (checkResult) {
          if (!checkResult.hasValidCookies && account.status === 'active') {
            return { ...account, cookieExpiresAt: undefined, needsLazyCheck: true };
          }
          if (checkResult.cookieExpiresAt) {
            return { ...account, cookieExpiresAt: checkResult.cookieExpiresAt };
          }
        }
        return account;
      });
      accounts.value = updatedAccounts;
    }
  } catch (error) {
    console.error('Quick status check failed:', error);
  }
}

async function loadAccounts() {
  try {
    const all = await db.accounts.toArray();

    // UI 层防御性去重：确保同一平台仅展示一个账号
    const map = new Map<string, Account>();
    for (const account of all) {
      const key = String(account.platform);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, account);
        continue;
      }

      const isActive = (a: Account) => (a.status || 'active') === 'active';
      const score = (a: Account) => (isActive(a) ? 100 : 0) + Math.floor((a.updatedAt || 0) / 1000);

      if (score(account) > score(existing)) {
        map.set(key, account);
      }
    }

    accounts.value = Array.from(map.values());
  } catch (error) {
    console.error('Failed to load accounts:', error);
    message.error('加载账号失败');
  }
}

function getPlatformName(platform: string) {
  const found = platforms.find(p => p.id === platform);
  return found?.name || platform;
}

function getDefaultIconUrl(): string {
  return chrome.runtime.getURL('assets/icon-32.png');
}

function getPlatformIconUrl(platform: string): string {
  // 使用本地图标，避免每次动态加载
  return chrome.runtime.getURL(`assets/platforms/${platform}.png`);
}

function isAccountExpiringSoon(account: Account): boolean {
  if (!account.cookieExpiresAt) return false;
  const EXPIRING_SOON_THRESHOLD = 24 * 60 * 60 * 1000;
  return (account.cookieExpiresAt - Date.now()) < EXPIRING_SOON_THRESHOLD && (account.cookieExpiresAt - Date.now()) > 0;
}

function formatExpiresIn(expiresAt?: number): string {
  if (!expiresAt) return '未知';
  const diff = expiresAt - Date.now();
  if (diff <= 0) return '已过期';
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
}

function goToUserProfile(account: Account) {
  if ((account as any).profileUrl) {
    window.open((account as any).profileUrl, '_blank');
    return;
  }
  const urlFn = platformUserUrls[account.platform];
  if (!urlFn) return;
  let userId: string | undefined;
  const underscoreIndex = account.id.indexOf('_');
  if (underscoreIndex > 0) {
    const prefix = account.id.substring(0, underscoreIndex);
    if (prefix === account.platform || prefix.replace('-', '') === account.platform.replace('-', '')) {
      userId = account.id.substring(underscoreIndex + 1);
    }
  }
  if (!userId) {
    const idParts = account.id.split('-');
    if (idParts.length > 1) {
      userId = account.platform === 'tencent-cloud' && idParts.length > 2
        ? idParts.slice(2).join('-')
        : idParts.slice(1).join('-');
    }
  }
  if (userId === 'undefined' || userId === '' || /^\d{10,}$/.test(userId || '')) {
    userId = undefined;
  }
  if (account.platform === 'segmentfault' && userId && /^segmentfault_\d{10,}$/.test(userId)) {
    userId = undefined;
  }
  if (!userId) {
    const profileId = (account.meta as any)?.profileId;
    if (typeof profileId === 'string' && profileId.trim()) {
      const trimmed = profileId.trim();
      if (!(account.platform === 'jianshu' && /^\d+$/.test(trimmed))) {
        userId = trimmed;
      }
    }
  }
  if (account.platform === 'csdn') {
    const profileId = (account.meta as any)?.profileId;
    if (typeof profileId === 'string' && profileId.trim()) {
      const trimmed = profileId.trim();
      if (trimmed !== 'undefined' && (!userId || userId.startsWith('csdn_'))) {
        userId = trimmed;
      }
    }
    if (userId && userId.startsWith('csdn_')) {
      const nickname = account.nickname?.trim();
      if (nickname && /^[a-zA-Z_][a-zA-Z0-9_]{2,}$/.test(nickname) && nickname !== 'CSDN用户') {
        userId = nickname;
      }
    }
  }
  if (account.platform === 'segmentfault' && userId) {
    const isSlug =
      /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/.test(userId) &&
      !/^\d+$/.test(userId) &&
      !/^segmentfault_\d{10,}$/.test(userId);
    if (!isSlug) userId = undefined;
  }
  if (!userId && account.platform === 'segmentfault') {
    const nickname = account.nickname?.trim();
    if (nickname && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/.test(nickname) && !/^\d+$/.test(nickname)) {
      userId = nickname;
    }
  }
  if (!userId && account.platform === 'cnblogs') {
    const nickname = account.nickname?.trim();
    if (nickname && /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,}$/.test(nickname)) {
      userId = nickname;
    }
  }
  window.open(urlFn(userId), '_blank');
}

async function reloginAccount(account: Account) {
  const platformName = getPlatformName(account.platform);
  reloginLoadingMap[account.id] = true;
  const loadingMsg = message.loading(`正在打开 ${platformName} 登录页面...`, { duration: 0 });
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'RELOGIN_ACCOUNT',
      data: { account },
    });
    loadingMsg.destroy();
    if (result.success) {
      message.success(`${platformName} 重新登录成功！`);
      await loadAccounts();
    } else {
      message.warning(result.error || '登录未完成，请重试');
    }
  } catch (error: any) {
    loadingMsg.destroy();
    message.error('重新登录失败: ' + (error.message || '未知错误'));
  } finally {
    reloginLoadingMap[account.id] = false;
  }
}

async function loginPlatform(platformId: string) {
  const platform = platforms.find(p => p.id === platformId);
  if (!platform) return;
  loginLoadingMap[platformId] = true;
  const loadingMsg = message.loading(`正在打开 ${platform.name} 登录页面...`, { duration: 0 });
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ADD_ACCOUNT',
      data: { platform: platformId },
    });
    loadingMsg.destroy();
    if (result?.success) {
      message.success(`${platform.name} 账号绑定成功！`);
      await loadAccounts();
    } else {
      message.warning(result?.error || '登录未完成，请重试');
    }
  } catch (error: any) {
    loadingMsg.destroy();
    message.error('登录失败: ' + (error.message || '未知错误'));
  } finally {
    loginLoadingMap[platformId] = false;
  }
}

/**
 * 一键删除所有账号（开发测试用）
 */
async function deleteAllAccounts() {
  deletingAll.value = true;
  const loadingMsg = message.loading('正在删除所有账号...', { duration: 0 });
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'DELETE_ALL_ACCOUNTS',
    });
    
    loadingMsg.destroy();
    
    if (result.success) {
      message.success(`已删除 ${result.deletedCount || 0} 个账号`);
      await loadAccounts();
    } else {
      message.error(result.error || '删除失败');
    }
  } catch (error: any) {
    loadingMsg.destroy();
    message.error('删除失败: ' + error.message);
  } finally {
    deletingAll.value = false;
  }
}

/**
 * 一键检测并添加所有已登录平台的账号（开发测试用）
 */
async function addAllAccounts() {
  addingAll.value = true;
  const loadingMsg = message.loading('正在检测所有平台登录状态...', { duration: 0 });
  
  try {
    // 并行检测所有平台的登录状态
    const results = await Promise.all(
      platforms.map(async (platform) => {
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'FETCH_PLATFORM_USER_INFO',
            data: { platform: platform.id },
          });
          return { platform: platform.id, name: platform.name, result };
        } catch (e) {
          return { platform: platform.id, name: platform.name, result: { success: false } };
        }
      })
    );

    // 对已登录的平台添加账号
    const boundPlatforms: string[] = [];
    const failedPlatforms: string[] = [];
    
    for (const { platform, name, result } of results) {
      if (result.success && result.info?.loggedIn) {
        try {
          await chrome.runtime.sendMessage({
            type: 'QUICK_ADD_ACCOUNT',
            data: { platform },
          });
          boundPlatforms.push(name);
        } catch (e) {
          failedPlatforms.push(name);
        }
      }
    }

    loadingMsg.destroy();

    if (boundPlatforms.length > 0) {
      message.success(`已添加 ${boundPlatforms.length} 个账号：${boundPlatforms.join('、')}`);
    } else {
      message.info('未检测到已登录的平台');
    }
    
    if (failedPlatforms.length > 0) {
      message.warning(`以下平台添加失败：${failedPlatforms.join('、')}`);
    }

    await loadAccounts();
  } catch (error: any) {
    loadingMsg.destroy();
    message.error('检测失败: ' + error.message);
  } finally {
    addingAll.value = false;
  }
}

async function refreshAllAccounts() {
  if (accounts.value.length === 0) return;
  
  refreshingAll.value = true;
  const loadingMsg = message.loading(`正在刷新 ${accounts.value.length} 个账号...`, { duration: 0 });
  
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'REFRESH_ALL_ACCOUNTS_FAST',
      data: { accounts: accounts.value },
    });
    
    loadingMsg.destroy();
    
    if (result.success) {
      const { successCount, failedCount, failedAccounts } = result;
      
      if (failedCount === 0) {
        message.success(`全部 ${successCount} 个账号状态正常`);
      } else if (successCount === 0) {
        message.error(`全部 ${failedCount} 个账号登录已失效`);
      } else {
        message.warning(`${successCount} 个正常，${failedCount} 个已失效`);
      }
      
      if (failedAccounts && failedAccounts.length > 0) {
        // 显示所有失败的平台名称，不仅仅是 expired 状态
        const failedNames = failedAccounts
          .map((f: any) => getPlatformName(f.account.platform))
          .join('、');
        if (failedNames) {
          // 区分真正失效和检测异常
          const expiredList = failedAccounts.filter((f: any) => 
            f.account.status === 'expired' || f.errorType === 'logged_out'
          );
          const errorList = failedAccounts.filter((f: any) => 
            f.account.status !== 'expired' && f.errorType !== 'logged_out'
          );
          
          if (expiredList.length > 0) {
            const expiredNames = expiredList.map((f: any) => getPlatformName(f.account.platform)).join('、');
            message.error(`以下账号需重新登录：${expiredNames}`, { duration: 5000 });
          }
          if (errorList.length > 0) {
            const errorNames = errorList.map((f: any) => getPlatformName(f.account.platform)).join('、');
            message.warning(`以下账号检测异常：${errorNames}`, { duration: 5000 });
          }
        }
      }
      
      await loadAccounts();
    } else {
      message.error(result.error || '刷新失败');
    }
  } catch (error: any) {
    loadingMsg.destroy();
    message.error('刷新失败: ' + error.message);
  } finally {
    refreshingAll.value = false;
  }
}
</script>

<style scoped>
.accounts-page {
  width: 100%;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 24px;
}

.section {
  margin-bottom: 32px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--n-border-color);
}

.section-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--n-text-color-2);
}

.section-count {
  font-size: 12px;
  color: var(--n-text-color-3);
  background: var(--n-color-embedded);
  padding: 2px 8px;
  border-radius: 10px;
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--n-text-color-3);
  font-size: 14px;
}

/* 已绑定账号 - 两列网格 */
.account-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

@media (max-width: 720px) {
  .account-grid {
    grid-template-columns: 1fr;
  }
}

.account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--n-color-embedded);
  transition: background-color 0.15s;
}

.account-row:hover {
  background: var(--n-color-embedded-popover);
}

.account-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.account-name {
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s;
}

.account-name:hover {
  color: var(--n-primary-color);
}

.account-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

/* 状态指示点 */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-success {
  background-color: #22c55e;
}

.status-warning {
  background-color: #f59e0b;
}

.status-error {
  background-color: #ef4444;
}

/* 未绑定平台 - 三列网格 */
.platform-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

@media (max-width: 900px) {
  .platform-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .platform-grid {
    grid-template-columns: 1fr;
  }
}

.platform-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--n-color-embedded);
  transition: background-color 0.15s;
}

.platform-row:hover {
  background: var(--n-color-embedded-popover);
}

.platform-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.platform-icon-avatar {
  flex-shrink: 0;
}

.platform-icon-avatar :deep(.n-avatar) {
  background-color: transparent;
}

/* 已绑定账号区域的平台图标也需要透明背景 */
.account-left :deep(.n-avatar) {
  background-color: transparent;
}

.platform-name {
  font-size: 14px;
  font-weight: 500;
}

/* 开发测试工具栏 */
.dev-toolbar {
  background: linear-gradient(135deg, rgba(255, 193, 7, 0.1), rgba(255, 152, 0, 0.1));
  border: 1px dashed rgba(255, 152, 0, 0.4);
  border-radius: 8px;
  padding: 12px 16px;
}

.dev-toolbar .section-header {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 8px;
}

.dev-toolbar .section-title {
  color: #f59e0b;
}

.dev-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
