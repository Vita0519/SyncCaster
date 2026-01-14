import type { AssetRef, CanonicalPost } from '../types';
import type { AssetManifest, ImageAsset } from '../types/ast';

function isProcessableImageUrl(url: string): boolean {
  if (!url) return false;

  // Skip data URLs (too large, and already "embedded")
  if (url.startsWith('data:')) return false;

  // local:// URLs need processing (pasted/uploaded local images)
  if (url.startsWith('local://')) return true;

  // Skip relative paths (cannot be fetched in extension background reliably)
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

  return true;
}

function guessImageFormat(url: string): ImageAsset['metadata']['format'] {
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'gif':
      return 'gif';
    case 'svg':
      return 'svg';
    case 'avif':
      return 'avif';
    default:
      return 'jpeg';
  }
}

function parseMarkdownImageDestination(rawInner: string): { url: string; title?: string } {
  let inner = String(rawInner || '').trim();

  // Split optional title (`![](<url> "title")` / `![](url "title")`)
  let titlePart = '';
  const quoteIdx = inner.search(/["']/);
  if (quoteIdx > 0) {
    titlePart = inner.slice(quoteIdx).trim();
    inner = inner.slice(0, quoteIdx).trimEnd();
  }

  // Strip angle-brackets `![](<url>)`
  if (inner.startsWith('<') && inner.endsWith('>')) {
    inner = inner.slice(1, -1);
  }

  // Remove whitespace/newlines inside URL
  const url = inner.replace(/\s+/g, '');

  let title: string | undefined;
  if (titlePart) {
    const m = /^["']([\s\S]*)["']$/.exec(titlePart);
    title = (m ? m[1] : titlePart).trim() || undefined;
  }

  return { url, title };
}

function extractHtmlAttribute(tag: string, attr: string): string | undefined {
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = re.exec(tag);
  return m?.[1] || undefined;
}

function buildLocalDataUrlLookup(assets?: AssetRef[]) {
  const byUrl = new Map<string, string>();
  const byId = new Map<string, string>();

  for (const asset of assets || []) {
    if (asset.type !== 'image') continue;
    if (!asset.blobUrl || typeof asset.blobUrl !== 'string') continue;
    if (asset.url) byUrl.set(asset.url, asset.blobUrl);
    if (asset.id) {
      byId.set(asset.id, asset.blobUrl);
      byUrl.set(`local://${asset.id}`, asset.blobUrl);
    }
  }

  const resolve = (url: string): string | undefined => {
    if (!url.startsWith('local://')) return undefined;
    const id = url.slice('local://'.length);
    return byUrl.get(url) || (id ? byId.get(id) : undefined);
  };

  return { resolve };
}

/**
 * Build an asset manifest from a canonical post.
 *
 * - Extracts images from Markdown image syntax and HTML `<img>` tags.
 * - Merges `post.assets` (for image metadata and local:// dataUrl resolution).
 */
export function buildAssetManifestFromPost(post: CanonicalPost): AssetManifest {
  const images: AssetManifest['images'] = [];
  const seen = new Set<string>();

  const localLookup = buildLocalDataUrlLookup(post.assets);

  const pushImage = (url: string, meta?: { alt?: string; title?: string; size?: number }) => {
    if (!url || seen.has(url) || !isProcessableImageUrl(url)) return;
    seen.add(url);

    const dataUrl = url.startsWith('local://') ? localLookup.resolve(url) : undefined;

    images.push({
      id: `img-${images.length}`,
      originalUrl: url,
      metadata: {
        format: guessImageFormat(url),
        size: meta?.size || 0,
        alt: meta?.alt,
        title: meta?.title,
        dataUrl,
      },
      status: 'pending',
    });
  };

  // 1) Extract from Markdown body
  if (post.body_md) {
    const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = mdImageRegex.exec(post.body_md)) !== null) {
      const alt = match[1] || undefined;
      const { url, title } = parseMarkdownImageDestination(match[2] || '');
      if (url) pushImage(url, { alt, title });
    }

    // 2) Extract from inline HTML img tags (some editors output HTML in Markdown)
    const htmlImageRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    while ((match = htmlImageRegex.exec(post.body_md)) !== null) {
      const url = String(match[1] || '').trim();
      const tag = match[0] || '';
      const alt = extractHtmlAttribute(tag, 'alt');
      const title = extractHtmlAttribute(tag, 'title');
      if (url) pushImage(url, { alt, title });
    }
  }

  // 3) Merge post.assets (include images not referenced directly in body, and enrich metadata)
  if (post.assets) {
    for (const asset of post.assets) {
      if (asset.type !== 'image') continue;
      if (!asset.url) continue;
      pushImage(asset.url, { alt: asset.alt, title: asset.title, size: asset.size });
    }
  }

  // 4) Ensure local:// entries have dataUrl if available in assets (even if URL was already "seen")
  if (post.assets && images.length > 0) {
    const byOriginalUrl = new Map<string, ImageAsset>();
    for (const img of images) byOriginalUrl.set(img.originalUrl, img);

    for (const asset of post.assets) {
      if (asset.type !== 'image') continue;
      if (!asset.url || !asset.url.startsWith('local://')) continue;
      if (!asset.blobUrl || typeof asset.blobUrl !== 'string') continue;

      const img = byOriginalUrl.get(asset.url) || byOriginalUrl.get(`local://${asset.id}`);
      if (img && !img.metadata.dataUrl) {
        img.metadata.dataUrl = asset.blobUrl;
      }
    }
  }

  return { images, formulas: [] };
}

