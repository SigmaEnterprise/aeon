/**
 * Image proxy / optimization utility for Aeon.
 *
 * Uses wsrv.nl (images.weserv.nl) — a reliable, free, open-source image
 * CDN proxy that supports resizing, format conversion, and quality control.
 * https://images.weserv.nl/docs/
 *
 * URL format:
 *   https://wsrv.nl/?url=<url>&w=<width>&h=<height>&output=<format>&q=<quality>&fit=<fit>&a=<align>
 *
 * This was already working in the codebase before; this module just adds
 * proper structured helpers and consistent configuration.
 */

const PROXY_HOST = 'https://wsrv.nl';

export type ImgFit = 'inside' | 'outside' | 'cover' | 'fill' | 'contain';
export type ImgFormat = 'webp' | 'avif' | 'jpeg' | 'png';

export interface ImgProxyOptions {
  width?: number;
  height?: number;
  /** Fit mode. Default: 'inside' (equivalent to imgproxy 'fit') */
  fit?: ImgFit;
  /** Output format. Default: 'webp' */
  format?: ImgFormat;
  /** Quality 1-100. Default: 80 */
  quality?: number;
}

/** Returns true if the URL points to an animated GIF (by extension or known CDN patterns). */
export function isAnimatedGif(url: string): boolean {
  if (!url) return false;
  // Explicit .gif extension (with or without query string)
  if (/\.gif(\?.*)?$/i.test(url)) return true;
  // Known Nostr image hosts that serve GIFs without extension in path
  if (/image\.nostr\.build\/.*gif/i.test(url)) return true;
  return false;
}

/** URLs that should never be proxied */
function shouldSkip(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('data:')) return true;
  // Skip SVG, GIF (preserve animation), video, audio
  if (/\.(svg|gif|mp4|webm|mov|ogv|m4v|mp3|ogg|wav|flac|aac|opus|m4a)(\?.*)?$/i.test(url)) return true;
  // Already proxied
  if (url.includes('wsrv.nl') || url.includes('images.weserv.nl')) return true;
  return false;
}

/**
 * Build a proxied image URL via wsrv.nl.
 */
export function imgproxyUrl(sourceUrl: string, opts: ImgProxyOptions = {}): string {
  if (shouldSkip(sourceUrl)) return sourceUrl;

  const {
    width,
    height,
    fit = 'inside',
    format = 'webp',
    quality = 80,
  } = opts;

  const params = new URLSearchParams();
  params.set('url', sourceUrl);
  if (width) params.set('w', String(width));
  if (height) params.set('h', String(height));
  params.set('output', format);
  params.set('q', String(quality));
  params.set('fit', fit);
  // n=-1 means no upscaling (don't enlarge)
  params.set('n', '-1');

  return `${PROXY_HOST}/?${params.toString()}`;
}

/**
 * Feed image — fits within `width` px, auto height, WebP q82.
 * Used for single images in posts.
 * GIFs are returned as-is to preserve animation.
 */
export function feedImage(url: string, width = 800): string {
  if (isAnimatedGif(url)) return url;
  return imgproxyUrl(url, { width, fit: 'inside', format: 'webp', quality: 82 });
}

/**
 * Thumbnail — square crop for gallery grids, WebP q78.
 */
export function thumbImage(url: string, size = 600): string {
  return imgproxyUrl(url, { width: size, height: size, fit: 'cover', format: 'webp', quality: 78 });
}

/**
 * Avatar — small square, WebP q75.
 * GIFs are returned as-is to preserve animation.
 */
export function avatarImage(url: string, size = 128): string {
  if (isAnimatedGif(url)) return url;
  return imgproxyUrl(url, { width: size, height: size, fit: 'cover', format: 'webp', quality: 75 });
}

/**
 * Full/lightbox — high quality wide fit.
 */
export function fullImage(url: string, width = 1600): string {
  return imgproxyUrl(url, { width, fit: 'inside', format: 'webp', quality: 90 });
}
