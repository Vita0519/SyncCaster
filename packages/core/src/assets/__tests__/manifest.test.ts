import { describe, it, expect } from 'vitest';
import { buildAssetManifestFromPost } from '../manifest';
import type { CanonicalPost } from '../../types';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('buildAssetManifestFromPost', () => {
  it('resolves local:// image dataUrl from post.assets (Markdown image syntax)', () => {
    const post: CanonicalPost = {
      id: 'p1',
      title: 't',
      body_md: '![alt](local://img-1)',
      assets: [
        {
          id: 'img-1',
          type: 'image',
          url: 'local://img-1',
          blobUrl: PNG_DATA_URL,
        },
      ],
    };

    const manifest = buildAssetManifestFromPost(post);
    expect(manifest.images).toHaveLength(1);
    expect(manifest.images[0].originalUrl).toBe('local://img-1');
    expect(manifest.images[0].metadata.dataUrl).toBe(PNG_DATA_URL);
    expect(manifest.images[0].metadata.alt).toBe('alt');
  });

  it('parses angle-bracket URLs and title in Markdown image destinations', () => {
    const post: CanonicalPost = {
      id: 'p2',
      title: 't',
      body_md: '![a](<local://img-2> "hello world")',
      assets: [
        {
          id: 'img-2',
          type: 'image',
          url: 'local://img-2',
          blobUrl: PNG_DATA_URL,
        },
      ],
    };

    const manifest = buildAssetManifestFromPost(post);
    expect(manifest.images).toHaveLength(1);
    expect(manifest.images[0].originalUrl).toBe('local://img-2');
    expect(manifest.images[0].metadata.title).toBe('hello world');
    expect(manifest.images[0].metadata.dataUrl).toBe(PNG_DATA_URL);
  });

  it('extracts images from inline HTML <img> tags', () => {
    const post: CanonicalPost = {
      id: 'p3',
      title: 't',
      body_md: '<p><img src="local://img-3" alt="x" title="y"></p>',
      assets: [
        {
          id: 'img-3',
          type: 'image',
          url: 'local://img-3',
          blobUrl: PNG_DATA_URL,
        },
      ],
    };

    const manifest = buildAssetManifestFromPost(post);
    expect(manifest.images).toHaveLength(1);
    expect(manifest.images[0].originalUrl).toBe('local://img-3');
    expect(manifest.images[0].metadata.alt).toBe('x');
    expect(manifest.images[0].metadata.title).toBe('y');
    expect(manifest.images[0].metadata.dataUrl).toBe(PNG_DATA_URL);
  });

  it('includes asset images not referenced in body', () => {
    const post: CanonicalPost = {
      id: 'p4',
      title: 't',
      body_md: 'hello',
      assets: [
        {
          id: 'img-remote',
          type: 'image',
          url: 'https://example.com/a.png',
        },
      ],
    };

    const manifest = buildAssetManifestFromPost(post);
    expect(manifest.images).toHaveLength(1);
    expect(manifest.images[0].originalUrl).toBe('https://example.com/a.png');
  });
});

