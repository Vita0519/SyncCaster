/**
 * Tab Group Manager - 发布标签页组管理
 * 
 * 当用户发布文章到多个平台时，将所有打开的发文页面自动归入同一个Chrome标签页组中，
 * 便于用户批量管理这些发文页面。
 * 
 * 参考 cose 项目的实现方式，使用 Chrome 的 tabGroups API。
 * 
 * 关键设计：使用串行队列确保所有标签页都被添加到同一个组中，避免并发创建多个组。
 */

/** 当前同步任务的 Tab Group ID */
let currentSyncGroupId: number | null = null;

/** 当前同步组所在的窗口ID */
let currentSyncWindowId: number | null = null;

/** 串行队列：确保 addTabToSyncGroup 按顺序执行，避免并发问题 */
let addTabQueue: Promise<void> = Promise.resolve();

/**
 * 重置当前同步组（开始新的发布批次时调用）
 */
export function resetSyncGroup(): void {
  console.log('[tab-group-manager] 重置同步组');
  currentSyncGroupId = null;
  currentSyncWindowId = null;
  // 重置队列
  addTabQueue = Promise.resolve();
}

/**
 * 获取当前同步组ID
 */
export function getCurrentSyncGroupId(): number | null {
  return currentSyncGroupId;
}

/**
 * 获取或创建同步标签组
 * @param windowId - 目标窗口ID
 * @returns 标签组ID，如果无法获取则返回null
 */
export async function getOrCreateSyncGroup(windowId: number): Promise<number | null> {
  // 如果已有 group 且仍然有效，直接返回
  if (currentSyncGroupId !== null && currentSyncWindowId === windowId) {
    try {
      const groups = await chrome.tabGroups.query({ windowId });
      const existingGroup = groups.find(g => g.id === currentSyncGroupId);
      if (existingGroup) {
        console.log('[tab-group-manager] 复用现有同步组:', currentSyncGroupId);
        return currentSyncGroupId;
      }
    } catch (e) {
      console.warn('[tab-group-manager] 查询标签组失败:', e);
    }
  }

  // Group 不存在或窗口不匹配，需要创建新的
  // 注意：Chrome 不支持创建空组，需要先有 tab 才能创建组
  // 这里返回 null，等待 addTabToSyncGroup 时再创建
  currentSyncGroupId = null;
  currentSyncWindowId = null;
  return null;
}

/**
 * 将标签添加到同步组（内部实现，不带队列）
 */
async function addTabToSyncGroupInternal(tabId: number, windowId: number): Promise<void> {
  try {
    // 如果已有组，直接添加
    if (currentSyncGroupId !== null) {
      console.log('[tab-group-manager] 添加标签到现有同步组:', { tabId, groupId: currentSyncGroupId });
      await chrome.tabs.group({ tabIds: tabId, groupId: currentSyncGroupId });
      return;
    }

    // 创建新组
    console.log('[tab-group-manager] 创建新同步组，首个标签:', tabId);
    currentSyncGroupId = await chrome.tabs.group({ tabIds: tabId });
    currentSyncWindowId = windowId;
    
    // 设置组的样式，使用时间戳作为标题
    const now = new Date();
    const timestamp = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    await chrome.tabGroups.update(currentSyncGroupId, {
      title: timestamp,
      color: 'blue',
      collapsed: false,
    });
    
    console.log('[tab-group-manager] 同步组创建成功:', { groupId: currentSyncGroupId, title: timestamp });
  } catch (error) {
    console.error('[tab-group-manager] 添加标签到组失败:', error);
    // 不抛出错误，确保发布流程继续
  }
}

/**
 * 将标签添加到同步组
 * 使用串行队列确保所有调用按顺序执行，避免并发创建多个组
 * @param tabId - 要添加的标签ID
 * @param windowId - 标签所在的窗口ID
 */
export async function addTabToSyncGroup(tabId: number, windowId: number): Promise<void> {
  // 将操作加入队列，确保串行执行
  const operation = addTabQueue.then(() => addTabToSyncGroupInternal(tabId, windowId));
  addTabQueue = operation.catch(() => {}); // 防止队列因错误中断
  await operation;
}
