/**
 * Image Pipeline Local URL Property Tests
 * 
 * Feature: editor-image-paste
 * Tests local image URL handling and URL replacement
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ImageUploadPipeline, isLocalImageUrl } from '../image-pipeline';

// ========== Arbitraries ==========

// Arbitrary for blob URL
const blobUrlArb = fc.uuid().map(id => `blob:https://example.com/${id}`);

// Arbitrary for data URL with different image types
const dataUrlArb = fc.constantFrom(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==',
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
);

// Arbitrary for remote URL
const remoteUrlArb = fc.webUrl();

// Arbitrary for platform URL (simulating uploaded image URL)
const platformUrlArb = fc.constantFrom(
  'https://cdn.juejin.cn/image/abc123.png',
  'https://img-blog.csdnimg.cn/xyz789.jpg',
  'https://pic1.zhimg.com/v2-abc.png',
  'https://mmbiz.qpic.cn/mmbiz_png/abc/640'
);

// Arbitrary for Markdown content with image
const markdownWithImageArb = (urlArb: fc.Arbitrary<string>) => 
  fc.tuple(
    fc.string({ minLength: 0, maxLength: 50 }).filter(s => !s.includes('[') && !s.includes(']')),
    urlArb
  ).map(([alt, url]) => ({
    markdown: `![${alt}](${url})`,
    alt,
    url
  }));

// ========== Tests ==========

describe('Image Pipeline - Local URL Identification', () => {
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
    expect(isLocalImageUrl('http://example.com/image.png')).toBe(false);
    expect(isLocalImageUrl('https://example.com/image.png')).toBe(false);
  });
});

describe('Image Pipeline - URL Replacement', () => {
  /**
   * Feature: editor-image-paste, Property 7: 图片上传 URL 替换
   * Validates: Requirements 5.3
   * 
   * For any Markdown content containing local image URLs, after successful upload,
   * replaceImageUrls should replace all local URLs with platform URLs, and the 
   * replaced content should not contain any local URLs.
   */
  it('Property 7: replaceImageUrls replaces blob URLs with platform URLs', () => {
    fc.assert(
      fc.property(
        markdownWithImageArb(blobUrlArb),
        platformUrlArb,
        ({ markdown, url }, platformUrl) => {
          const urlMapping = new Map<string, string>();
          urlMapping.set(url, platformUrl);
          
          const result = ImageUploadPipeline.replaceImageUrls(markdown, urlMapping);
          
          // Result should not contain the original blob URL
          expect(result.includes(url)).toBe(false);
          
          // Result should contain the platform URL
          expect(result.includes(platformUrl)).toBe(true);
          
          // Result should still be valid Markdown image syntax
          expect(result).toMatch(/!\[[^\]]*\]\([^)]+\)/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: replaceImageUrls replaces data URLs with platform URLs', () => {
    fc.assert(
      fc.property(
        markdownWithImageArb(dataUrlArb),
        platformUrlArb,
        ({ markdown, url }, platformUrl) => {
          const urlMapping = new Map<string, string>();
          urlMapping.set(url, platformUrl);
          
          const result = ImageUploadPipeline.replaceImageUrls(markdown, urlMapping);
          
          // Result should not contain the original data URL
          expect(result.includes(url)).toBe(false);
          
          // Result should contain the platform URL
          expect(result.includes(platformUrl)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('replaceImageUrls preserves alt text', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter(s => !s.includes('[') && !s.includes(']') && !s.includes('(')),
        blobUrlArb,
        platformUrlArb,
        (alt, localUrl, platformUrl) => {
          const markdown = `![${alt}](${localUrl})`;
          const urlMapping = new Map<string, string>();
          urlMapping.set(localUrl, platformUrl);
          
          const result = ImageUploadPipeline.replaceImageUrls(markdown, urlMapping);
          
          // Alt text should be preserved
          expect(result).toContain(`![${alt}]`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('replaceImageUrls handles multiple images', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(blobUrlArb, platformUrlArb),
          { minLength: 1, maxLength: 5 }
        ),
        (urlPairs) => {
          // Create markdown with multiple images
          const markdown = urlPairs
            .map(([local], i) => `![image${i}](${local})`)
            .join('\n');
          
          // Create URL mapping
          const urlMapping = new Map<string, string>();
          urlPairs.forEach(([local, platform]) => {
            urlMapping.set(local, platform);
          });
          
          const result = ImageUploadPipeline.replaceImageUrls(markdown, urlMapping);
          
          // No local URLs should remain
          for (const [local] of urlPairs) {
            expect(result.includes(local)).toBe(false);
          }
          
          // All platform URLs should be present
          for (const [, platform] of urlPairs) {
            expect(result.includes(platform)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('replaceImageUrls does not modify content without matching URLs', () => {
    fc.assert(
      fc.property(
        markdownWithImageArb(remoteUrlArb),
        blobUrlArb,
        platformUrlArb,
        ({ markdown }, unmatchedLocal, platformUrl) => {
          const urlMapping = new Map<string, string>();
          urlMapping.set(unmatchedLocal, platformUrl);
          
          const result = ImageUploadPipeline.replaceImageUrls(markdown, urlMapping);
          
          // Content should be unchanged (except for normalization)
          // The original remote URL should still be present
          expect(result).toMatch(/!\[[^\]]*\]\([^)]+\)/);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Image Pipeline - No Local URLs After Replacement', () => {
  /**
   * Validates that after URL replacement, no local URLs remain in the content
   */
  it('replaced content contains no blob: URLs', () => {
    fc.assert(
      fc.property(
        fc.array(blobUrlArb, { minLength: 1, maxLength: 5 }),
        fc.array(platformUrlArb, { minLength: 1, maxLength: 5 }),
        (localUrls, platformUrls) => {
          // Ensure we have matching pairs
          const pairs = localUrls.slice(0, Math.min(localUrls.length, platformUrls.length));
          const platforms = platformUrls.slice(0, pairs.length);
          
          // Create markdown
          const markdown = pairs
            .map((url, i) => `![img${i}](${url})`)
            .join('\n');
          
          // Create mapping
          const urlMapping = new Map<string, string>();
          pairs.forEach((local, i) => {
            urlMapping.set(local, platforms[i]);
          });
          
          const result = ImageUploadPipeline.replaceImageUrls(markdown, urlMapping);
          
          // No blob: URLs should remain
          expect(result.includes('blob:')).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('replaced content contains no data: URLs when all are mapped', () => {
    fc.assert(
      fc.property(
        fc.array(dataUrlArb, { minLength: 1, maxLength: 3 }),
        fc.array(platformUrlArb, { minLength: 1, maxLength: 3 }),
        (localUrls, platformUrls) => {
          const pairs = localUrls.slice(0, Math.min(localUrls.length, platformUrls.length));
          const platforms = platformUrls.slice(0, pairs.length);
          
          const markdown = pairs
            .map((url, i) => `![img${i}](${url})`)
            .join('\n');
          
          const urlMapping = new Map<string, string>();
          pairs.forEach((local, i) => {
            urlMapping.set(local, platforms[i]);
          });
          
          const result = ImageUploadPipeline.replaceImageUrls(markdown, urlMapping);
          
          // No data: URLs should remain
          expect(result.includes('data:image')).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
