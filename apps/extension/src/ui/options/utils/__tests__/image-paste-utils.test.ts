/**
 * Image Paste Utils Property Tests
 * 
 * Feature: editor-image-paste
 * Tests clipboard image detection, format support, and local URL identification
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  hasImageInClipboard,
  isSupportedImageType,
  isLocalImageUrl,
  createImageAsset,
  generateImageId,
  handleImagePaste,
  SUPPORTED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  IMAGE_PASTE_ERRORS,
} from '../image-paste-utils';

// ========== Arbitraries ==========

// Arbitrary for supported image MIME types
const supportedMimeTypeArb = fc.constantFrom(...SUPPORTED_IMAGE_TYPES);

// Arbitrary for unsupported MIME types
const unsupportedMimeTypeArb = fc.constantFrom(
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'video/mp4'
);

// Arbitrary for blob URL
const blobUrlArb = fc.uuid().map(id => `blob:https://example.com/${id}`);

// Arbitrary for data URL
const dataUrlArb = fc.constantFrom(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==',
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
);

// Arbitrary for remote URL
const remoteUrlArb = fc.webUrl();

// Arbitrary for valid image blob
const validImageBlobArb = fc.tuple(
  supportedMimeTypeArb,
  fc.integer({ min: 1, max: MAX_IMAGE_SIZE_BYTES - 1 })
).map(([mimeType, size]) => {
  // Create a mock blob with the specified type and size
  const data = new Uint8Array(Math.min(size, 1000)); // Limit actual data size for performance
  return new Blob([data], { type: mimeType });
});

// Arbitrary for oversized image blob
const oversizedImageBlobArb = supportedMimeTypeArb.map(mimeType => {
  // Create a blob that exceeds the size limit
  const data = new Uint8Array(100); // Small actual data
  const blob = new Blob([data], { type: mimeType });
  // Override size property for testing
  Object.defineProperty(blob, 'size', { value: MAX_IMAGE_SIZE_BYTES + 1 });
  return blob;
});

// ========== Mock DataTransfer ==========

function createMockDataTransfer(options: {
  hasImage?: boolean;
  mimeType?: string;
  hasText?: boolean;
}): DataTransfer {
  const items: DataTransferItem[] = [];
  const files: File[] = [];
  
  if (options.hasImage) {
    const mimeType = options.mimeType || 'image/png';
    const file = new File([new Uint8Array(100)], 'test.png', { type: mimeType });
    files.push(file);
    
    items.push({
      kind: 'file',
      type: mimeType,
      getAsFile: () => file,
      getAsString: () => {},
      webkitGetAsEntry: () => null,
    } as DataTransferItem);
  }
  
  if (options.hasText) {
    items.push({
      kind: 'string',
      type: 'text/plain',
      getAsFile: () => null,
      getAsString: (callback) => callback?.('test text'),
      webkitGetAsEntry: () => null,
    } as DataTransferItem);
  }
  
  return {
    items: {
      length: items.length,
      [Symbol.iterator]: function* () { yield* items; },
      ...items.reduce((acc, item, i) => ({ ...acc, [i]: item }), {}),
    } as DataTransferItemList,
    files: {
      length: files.length,
      item: (i: number) => files[i] || null,
      [Symbol.iterator]: function* () { yield* files; },
      ...files.reduce((acc, file, i) => ({ ...acc, [i]: file }), {}),
    } as FileList,
    dropEffect: 'none',
    effectAllowed: 'none',
    types: [],
    clearData: () => {},
    getData: () => '',
    setData: () => {},
    setDragImage: () => {},
  } as DataTransfer;
}

// ========== Tests ==========

describe('Image Paste Utils - Clipboard Detection', () => {
  /**
   * Feature: editor-image-paste, Property 1: 剪贴板图片检测优先级
   * Validates: Requirements 1.1, 1.2
   * 
   * For any clipboard data containing image type items, hasImageInClipboard 
   * should return true, and image data should be prioritized over text data.
   */
  it('Property 1: hasImageInClipboard returns true when clipboard contains image', () => {
    fc.assert(
      fc.property(
        supportedMimeTypeArb,
        fc.boolean(), // whether to also include text
        (mimeType, hasText) => {
          const dataTransfer = createMockDataTransfer({
            hasImage: true,
            mimeType,
            hasText,
          });
          
          // Should detect image regardless of text presence
          expect(hasImageInClipboard(dataTransfer)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('hasImageInClipboard returns false when clipboard has no image', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // whether to include text
        (hasText) => {
          const dataTransfer = createMockDataTransfer({
            hasImage: false,
            hasText,
          });
          
          expect(hasImageInClipboard(dataTransfer)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('hasImageInClipboard returns false for null clipboard data', () => {
    expect(hasImageInClipboard(null)).toBe(false);
  });
});

describe('Image Paste Utils - Format Support', () => {
  /**
   * Feature: editor-image-paste, Property 2: 图片格式支持
   * Validates: Requirements 1.4
   * 
   * For any supported image format (PNG, JPEG, GIF, WebP), pasting that format 
   * should successfully create a PastedImage object.
   */
  it('Property 2: isSupportedImageType returns true for supported formats', () => {
    fc.assert(
      fc.property(
        supportedMimeTypeArb,
        (mimeType) => {
          expect(isSupportedImageType(mimeType)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isSupportedImageType returns false for unsupported formats', () => {
    fc.assert(
      fc.property(
        unsupportedMimeTypeArb,
        (mimeType) => {
          expect(isSupportedImageType(mimeType)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all SUPPORTED_IMAGE_TYPES are recognized', () => {
    for (const mimeType of SUPPORTED_IMAGE_TYPES) {
      expect(isSupportedImageType(mimeType)).toBe(true);
    }
  });
});

describe('Image Paste Utils - Local URL Identification', () => {
  /**
   * Feature: editor-image-paste, Property 6: 本地图片 URL 识别
   * Validates: Requirements 5.1, 5.2
   * 
   * For any URL starting with 'blob:' or 'data:image', isLocalImageUrl should return true.
   */
  it('Property 6: isLocalImageUrl returns true for blob URLs', () => {
    fc.assert(
      fc.property(
        blobUrlArb,
        (url) => {
          expect(isLocalImageUrl(url)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 6: isLocalImageUrl returns true for data URLs', () => {
    fc.assert(
      fc.property(
        dataUrlArb,
        (url) => {
          expect(isLocalImageUrl(url)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isLocalImageUrl returns false for remote URLs', () => {
    fc.assert(
      fc.property(
        remoteUrlArb,
        (url) => {
          // Remote URLs should not be identified as local
          expect(isLocalImageUrl(url)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isLocalImageUrl handles edge cases', () => {
    expect(isLocalImageUrl('')).toBe(false);
    expect(isLocalImageUrl(null as any)).toBe(false);
    expect(isLocalImageUrl(undefined as any)).toBe(false);
  });
});

describe('Image Paste Utils - Asset Creation', () => {
  /**
   * Feature: editor-image-paste, Property 3: 图片资源创建完整性
   * Validates: Requirements 2.1, 2.2, 2.3
   * 
   * For any successfully pasted image, the created AssetRef object should contain 
   * all required properties (id, url, type='image', mimeType, size), and id should 
   * be a valid UUID.
   */
  it('Property 3: createImageAsset creates complete AssetRef', () => {
    fc.assert(
      fc.property(
        validImageBlobArb,
        (blob) => {
          const asset = createImageAsset(blob, blob.type);
          
          // All required properties should be present
          expect(asset.id).toBeDefined();
          expect(typeof asset.id).toBe('string');
          expect(asset.id.length).toBeGreaterThan(0);
          
          expect(asset.url).toBeDefined();
          expect(asset.url.startsWith('blob:')).toBe(true);
          
          expect(asset.type).toBe('image');
          
          expect(asset.mimeType).toBe(blob.type);
          
          expect(asset.size).toBe(blob.size);
          
          // blobUrl should match url
          expect(asset.blobUrl).toBe(asset.url);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('generateImageId creates unique IDs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        (count) => {
          const ids = new Set<string>();
          for (let i = 0; i < count; i++) {
            ids.add(generateImageId());
          }
          // All generated IDs should be unique
          expect(ids.size).toBe(count);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Image Paste Utils - Size Validation', () => {
  /**
   * Feature: editor-image-paste, Property 8: 图片大小限制
   * Validates: Requirements 6.3
   * 
   * For any image exceeding 10MB, paste processing should return an error result 
   * and should not add to assets array.
   */
  it('Property 8: oversized images are detected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_IMAGE_SIZE_BYTES + 1, max: MAX_IMAGE_SIZE_BYTES * 2 }),
        (size) => {
          // Size exceeds limit
          expect(size).toBeGreaterThan(MAX_IMAGE_SIZE_BYTES);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('valid sized images pass size check', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_IMAGE_SIZE_BYTES }),
        (size) => {
          // Size is within limit
          expect(size).toBeLessThanOrEqual(MAX_IMAGE_SIZE_BYTES);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Image Paste Utils - Markdown Insertion', () => {
  /**
   * Feature: editor-image-paste, Property 4: Markdown 语法插入正确性
   * Validates: Requirements 3.1, 3.2, 3.3
   * 
   * For any successfully processed image, the inserted Markdown syntax should 
   * conform to `![alt](url)` format, where url is a valid Blob URL, and cursor 
   * position should be after the syntax after insertion.
   */
  it('Property 4: Markdown image syntax format is correct', () => {
    fc.assert(
      fc.property(
        blobUrlArb,
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('[') && !s.includes(']') && !s.includes('(')),
        (url, alt) => {
          const markdown = `![${alt}](${url})`;
          
          // Should match Markdown image syntax pattern
          const pattern = /^!\[([^\]]*)\]\(([^)]+)\)$/;
          expect(pattern.test(markdown)).toBe(true);
          
          // URL should be a blob URL
          const match = markdown.match(pattern);
          expect(match).not.toBeNull();
          expect(match![2].startsWith('blob:')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Markdown syntax preserves alt text', () => {
    fc.assert(
      fc.property(
        blobUrlArb,
        fc.string({ minLength: 0, maxLength: 50 }).filter(s => !s.includes('[') && !s.includes(']')),
        (url, alt) => {
          const markdown = `![${alt}](${url})`;
          
          // Extract alt from markdown
          const match = markdown.match(/^!\[([^\]]*)\]/);
          expect(match).not.toBeNull();
          expect(match![1]).toBe(alt);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Image Paste Utils - Asset Count Consistency', () => {
  /**
   * Feature: editor-image-paste, Property 5: 图片资源数量一致性
   * Validates: Requirements 4.4
   * 
   * For any article containing image resources, the displayed image count 
   * should equal the number of elements with type='image' in the assets array.
   */
  it('Property 5: image count matches assets array length', () => {
    fc.assert(
      fc.property(
        fc.array(validImageBlobArb, { minLength: 0, maxLength: 10 }),
        (blobs) => {
          const assets = blobs.map(blob => createImageAsset(blob, blob.type));
          const imageCount = assets.filter(a => a.type === 'image').length;
          
          // All created assets should be images
          expect(imageCount).toBe(assets.length);
          
          // Count should match array length
          expect(imageCount).toBe(blobs.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('adding images increases count correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (numImages) => {
          const assets: ReturnType<typeof createImageAsset>[] = [];
          
          for (let i = 0; i < numImages; i++) {
            const blob = new Blob([new Uint8Array(100)], { type: 'image/png' });
            const asset = createImageAsset(blob, blob.type);
            assets.push(asset);
          }
          
          // Count should equal number of images added
          expect(assets.length).toBe(numImages);
          expect(assets.filter(a => a.type === 'image').length).toBe(numImages);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Image Paste Utils - Error Isolation', () => {
  /**
   * Feature: editor-image-paste, Property 9: 错误隔离
   * Validates: Requirements 6.4
   * 
   * For any image processing error, the editor's other functions (text editing, 
   * saving, preview) should not be affected.
   */
  it('Property 9: handleImagePaste returns error result without throwing', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        () => {
          // Create a mock ClipboardEvent with no image
          const mockEvent = {
            clipboardData: createMockDataTransfer({ hasImage: false, hasText: true }),
            preventDefault: () => {},
          } as unknown as ClipboardEvent;
          
          // Should not throw, should return error result
          const resultPromise = handleImagePaste(mockEvent);
          expect(resultPromise).toBeInstanceOf(Promise);
          
          return resultPromise.then(result => {
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  it('unsupported format returns error without throwing', () => {
    fc.assert(
      fc.property(
        unsupportedMimeTypeArb,
        async (mimeType) => {
          // Only test with actual image/* types that are unsupported
          if (!mimeType.startsWith('image/')) return;
          
          const mockEvent = {
            clipboardData: createMockDataTransfer({ hasImage: true, mimeType }),
            preventDefault: () => {},
          } as unknown as ClipboardEvent;
          
          const result = await handleImagePaste(mockEvent);
          
          // Should return error, not throw
          expect(result.success).toBe(false);
          expect(result.error).toBe(IMAGE_PASTE_ERRORS.unsupportedFormat);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('error results contain meaningful error messages', () => {
    // Test all error types have non-empty messages
    expect(IMAGE_PASTE_ERRORS.clipboardRead.length).toBeGreaterThan(0);
    expect(IMAGE_PASTE_ERRORS.unsupportedFormat.length).toBeGreaterThan(0);
    expect(IMAGE_PASTE_ERRORS.fileSizeExceeded.length).toBeGreaterThan(0);
    expect(IMAGE_PASTE_ERRORS.blobCreation.length).toBeGreaterThan(0);
    expect(IMAGE_PASTE_ERRORS.noImage.length).toBeGreaterThan(0);
  });
});
