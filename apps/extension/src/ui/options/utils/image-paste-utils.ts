/**
 * 图片粘贴工具函数
 * 
 * 提供剪贴板图片检测、读取、资源创建等核心功能
 */
import type { AssetRef } from '@synccaster/core';

// ========== 常量定义 ==========

/** 支持的图片 MIME 类型 */
export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

/** 最大图片大小 (MB) */
export const MAX_IMAGE_SIZE_MB = 10;

/** 最大图片大小 (bytes) */
export const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// ========== 错误消息 ==========

export const IMAGE_PASTE_ERRORS = {
  clipboardRead: '无法读取剪贴板，请检查浏览器权限',
  unsupportedFormat: '不支持的图片格式，请使用 PNG、JPEG、GIF 或 WebP',
  fileSizeExceeded: `图片大小超过 ${MAX_IMAGE_SIZE_MB}MB 限制`,
  blobCreation: '图片处理失败，请重试',
  noImage: '剪贴板中没有图片',
} as const;

// ========== 类型定义 ==========

export interface PastedImage {
  id: string;
  blob: Blob;
  blobUrl: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
}

export interface ImagePasteResult {
  success: boolean;
  image?: PastedImage;
  error?: string;
}

// ========== 工具函数 ==========

/**
 * 检测剪贴板是否包含图片
 */
export function hasImageInClipboard(clipboardData: DataTransfer | null): boolean {
  if (!clipboardData) return false;
  
  // 检查 items 中是否有图片类型
  if (clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        return true;
      }
    }
  }
  
  // 检查 files 中是否有图片
  if (clipboardData.files) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i];
      if (file.type.startsWith('image/')) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * 检测是否为支持的图片格式
 */
export function isSupportedImageType(mimeType: string): boolean {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

/**
 * 从剪贴板读取图片
 */
export async function readImageFromClipboard(
  clipboardData: DataTransfer | null
): Promise<Blob | null> {
  if (!clipboardData) return null;
  
  // 优先从 items 中读取
  if (clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  
  // 从 files 中读取
  if (clipboardData.files) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i];
      if (file.type.startsWith('image/')) {
        return file;
      }
    }
  }
  
  return null;
}

/**
 * 检测是否为本地图片 URL (blob:, data:image, 或 local://)
 */
export function isLocalImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('blob:') || url.startsWith('data:image') || url.startsWith('local://');
}

/**
 * 生成本地图片引用 URL
 * 格式: local://img_xxx
 */
export function generateLocalImageUrl(id: string): string {
  return `local://${id}`;
}

/**
 * 从本地图片 URL 中提取图片 ID
 */
export function extractImageIdFromLocalUrl(url: string): string | null {
  if (!url || !url.startsWith('local://')) return null;
  return url.slice('local://'.length);
}

/**
 * 生成唯一 ID
 */
export function generateImageId(): string {
  return crypto.randomUUID?.() || `img_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 获取图片尺寸
 */
export function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
}

/**
 * 创建图片资源对象
 */
export function createImageAsset(blob: Blob, mimeType: string): AssetRef {
  const id = generateImageId();
  const blobUrl = URL.createObjectURL(blob);
  
  return {
    id,
    type: 'image',
    url: blobUrl,
    blobUrl,
    mimeType,
    size: blob.size,
  };
}

/**
 * 将 Blob 转换为 Data URL
 * 使用 Data URL 而非 Blob URL，因为 Blob URL 在发布到平台时不被支持
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to data URL'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * 处理粘贴的图片
 * 返回 Data URL 而非 Blob URL，确保平台兼容性
 */
export async function handleImagePaste(
  event: ClipboardEvent
): Promise<ImagePasteResult> {
  try {
    const clipboardData = event.clipboardData;
    
    // 检查是否有图片
    if (!hasImageInClipboard(clipboardData)) {
      return { success: false, error: IMAGE_PASTE_ERRORS.noImage };
    }
    
    // 读取图片
    const blob = await readImageFromClipboard(clipboardData);
    if (!blob) {
      return { success: false, error: IMAGE_PASTE_ERRORS.clipboardRead };
    }
    
    // 检查格式
    if (!isSupportedImageType(blob.type)) {
      return { success: false, error: IMAGE_PASTE_ERRORS.unsupportedFormat };
    }
    
    // 检查大小
    if (blob.size > MAX_IMAGE_SIZE_BYTES) {
      return { success: false, error: IMAGE_PASTE_ERRORS.fileSizeExceeded };
    }
    
    // 生成资源
    const id = generateImageId();
    
    // 转换为 Data URL（而非 Blob URL），确保平台兼容性
    const dataUrl = await blobToDataUrl(blob);
    
    // 获取尺寸
    let width: number | undefined;
    let height: number | undefined;
    try {
      const dimensions = await getImageDimensions(blob);
      width = dimensions.width;
      height = dimensions.height;
    } catch {
      // 尺寸获取失败不影响主流程
    }
    
    const image: PastedImage = {
      id,
      blob,
      blobUrl: dataUrl, // 使用 Data URL 替代 Blob URL
      mimeType: blob.type,
      size: blob.size,
      width,
      height,
    };
    
    return { success: true, image };
  } catch (error) {
    console.error('[image-paste] Error handling paste:', error);
    return { success: false, error: IMAGE_PASTE_ERRORS.blobCreation };
  }
}

/**
 * 将 PastedImage 转换为 AssetRef
 * 存储 Data URL 在 asset 中，但使用短链接引用
 */
export function pastedImageToAssetRef(image: PastedImage): AssetRef {
  return {
    id: image.id,
    type: 'image',
    url: generateLocalImageUrl(image.id), // 短链接引用
    blobUrl: image.blobUrl, // Data URL 存储在这里
    mimeType: image.mimeType,
    size: image.size,
    width: image.width,
    height: image.height,
  };
}

/**
 * 清理 Blob URL
 * 注意：Data URL 不需要清理，只有 blob: 协议的 URL 需要
 */
export function revokeBlobUrl(url: string): void {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * 批量清理 Blob URLs
 * 注意：Data URL 不需要清理，只有 blob: 协议的 URL 需要
 */
export function revokeBlobUrls(urls: string[]): void {
  urls.forEach(revokeBlobUrl);
}

/**
 * 从 Markdown 内容中提取所有图片 URL
 */
export function extractImageUrlsFromMarkdown(markdown: string): string[] {
  if (!markdown) return [];
  
  const urls: string[] = [];
  // 匹配 ![alt](url) 格式
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  
  while ((match = regex.exec(markdown)) !== null) {
    if (match[1]) {
      urls.push(match[1]);
    }
  }
  
  return urls;
}
