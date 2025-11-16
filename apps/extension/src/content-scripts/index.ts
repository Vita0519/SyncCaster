/**
 * Content Script
 * 在平台发布页面注入，执行 DOM 自动化或内容采集
 */

import { Logger } from '@synccaster/utils';

const logger = new Logger('content-script');

logger.info('init', `Content script loaded on ${window.location.href}`);

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.debug('message', `Received message: ${message.type}`);
  
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      logger.error('message', 'Message handling failed', { error });
      sendResponse({ error: error.message });
    });
  
  return true;
});

/**
 * 处理消息
 */
async function handleMessage(message: any) {
  switch (message.type) {
    case 'COLLECT_CONTENT':
      return await collectContent();
    
    case 'FILL_AND_PUBLISH':
      return await fillAndPublish(message.data);
    
    case 'PING':
      return { pong: true };
    
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

/**
 * 采集当前页面内容
 */
async function collectContent() {
  logger.info('collect', 'Collecting content from page');
  
  try {
    // 使用 Readability 提取文章内容
    // TODO: 集成 @mozilla/readability
    
    const title = document.title;
    const url = window.location.href;
    
    // 简单提取（实际应使用 Readability）
    const contentElement = 
      document.querySelector('article') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('.content') ||
      document.body;
    
    const content = contentElement?.textContent || '';
    
    // 提取图片
    const images = Array.from(document.querySelectorAll('img'))
      .map((img) => ({
        src: img.src,
        alt: img.alt,
        width: img.naturalWidth,
        height: img.naturalHeight,
      }))
      .filter((img) => img.width > 100 && img.height > 100); // 过滤小图标
    
    logger.info('collect', `Collected content: ${title}`, {
      contentLength: content.length,
      imageCount: images.length,
    });
    
    return {
      title,
      url,
      content: content.substring(0, 1000), // 限制长度
      images,
    };
  } catch (error: any) {
    logger.error('collect', 'Content collection failed', { error });
    throw error;
  }
}

/**
 * 填充并发布内容
 */
async function fillAndPublish(data: {
  platform: string;
  payload: any;
}) {
  logger.info('publish', `Filling and publishing to ${data.platform}`);
  
  const { platform, payload } = data;
  
  // 根据平台执行不同的 DOM 自动化
  switch (platform) {
    case 'wechat':
      return await publishToWechat(payload);
    
    case 'zhihu':
      return await publishToZhihu(payload);
    
    case 'juejin':
      return await publishToJuejin(payload);
    
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * 微信公众号发布
 */
async function publishToWechat(payload: any) {
  logger.info('wechat', 'Publishing to WeChat');
  
  // TODO: 实现微信 DOM 自动化
  // 1. 等待编辑器加载
  // 2. 填充标题
  // 3. 粘贴 HTML 内容
  // 4. 上传封面
  // 5. 点击发布
  
  return {
    success: true,
    url: window.location.href,
  };
}

/**
 * 知乎发布
 */
async function publishToZhihu(payload: any) {
  logger.info('zhihu', 'Publishing to Zhihu');
  
  // TODO: 实现知乎 DOM 自动化
  
  return {
    success: true,
    url: window.location.href,
  };
}

/**
 * 掘金发布
 */
async function publishToJuejin(payload: any) {
  logger.info('juejin', 'Publishing to Juejin');
  
  // TODO: 实现掘金 DOM 自动化
  
  return {
    success: true,
    url: window.location.href,
  };
}

// 在页面上添加一个浮动按钮（用于快速操作）
function addFloatingButton() {
  const button = document.createElement('button');
  button.textContent = '📤 SyncCaster';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 99999;
    padding: 12px 20px;
    background: #1677ff;
    color: white;
    border: none;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  `;
  
  button.addEventListener('click', async () => {
    logger.info('button', 'Quick action button clicked');
    
    try {
      button.textContent = '⏳ 采集中...';
      button.disabled = true;
      
      const result = await collectContent();
      
      // 发送到 background
      chrome.runtime.sendMessage({
        type: 'CONTENT_COLLECTED',
        data: result,
      });
      
      button.textContent = '✅ 已采集';
      
      setTimeout(() => {
        button.textContent = '📤 SyncCaster';
        button.disabled = false;
      }, 2000);
    } catch (error: any) {
      logger.error('button', 'Quick action failed', { error });
      button.textContent = '❌ 失败';
      button.disabled = false;
    }
  });
  
  document.body.appendChild(button);
}

// 在支持采集的页面添加浮动按钮
if (!window.location.href.includes('mp.weixin.qq.com')) {
  addFloatingButton();
}
