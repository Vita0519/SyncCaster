/**
 * DOM 工具函数
 */

/**
 * 等待元素出现
 */
export function waitForElement(
  selector: string,
  timeout = 5000
): Promise<Element> {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element "${selector}" not found within ${timeout}ms`));
    }, timeout);
  });
}

/**
 * 模拟用户输入
 */
export function simulateInput(element: HTMLElement, value: string) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = value;
  } else if (element.isContentEditable) {
    element.textContent = value;
  }

  // 触发输入事件
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * 模拟点击
 */
export async function simulateClick(element: HTMLElement) {
  // 先 hover
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  
  await sleep(100);
  
  // 点击
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * 延迟
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 随机延迟（模拟人类行为）
 */
export function randomSleep(min = 200, max = 600): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return sleep(ms);
}

/**
 * 滚动到元素
 */
export function scrollToElement(element: HTMLElement) {
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * 粘贴内容
 */
export async function pasteContent(element: HTMLElement, content: string) {
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', content);
  clipboardData.setData('text/html', content);

  const pasteEvent = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData,
  });

  element.dispatchEvent(pasteEvent);
}
