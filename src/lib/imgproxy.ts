/**
 * imgproxy URL builder for Aeon.
 *
 * imgproxy processes URLs with a structured path format:
 *   https://<host>/insecure/<processing_options>/plain/<source_url>
 *   https://<host>/insecure/<processing_options>/<encoded_url>.<extension>
 *
 * Docs: https://docs.imgproxy.net/usage/processing
 *
 * We use the public imgproxy instance at https://images.hzrd149.com which is
 * a free community instance used by many Nostr clients.
 * Fallback: wsrv.nl (also imgproxy-compatible proxy).
 *
 * Option order in the path follows imgproxy conventions:
 *   resize:TYPE:WIDTH:HEIGHT:ENLARGE:EXTEND
 *   quality:VALUE
 *   format:TYPE
 *   gravity:TYPE (for cropping)
 */

/** Public imgproxy host — can be overridden via env or future settings */
const IMGPROXY_HOST = 'https://images.hzrd149.com';

export type ImgResizeType = 'fit' | 'fill' | 'force' | 'auto' | 'fill-down';
export type ImgFormat = 'webp' | 'avif' | 'jpeg' | 'png';

export interface ImgProxyOptions {
  /** Width in pixels. 0 = auto */
  width?: number;
  /** Height in pixels. 0 = auto */
  height?: number;
  /** Resize type. Default: 'fit' */
  resizeType?: ImgResizeType;
  /** Whether to enlarge if smaller than requested. Default: false */
  enlarge?: boolean;
  /** Output format. Default: 'webp' */
  format?: ImgFormat;
  /** Quality 1-100. Default: 80 */
  quality?: number;
  /** Gravity for fill cropping. Default: 'sm' (smart, detects faces/objects) */
  gravity?: 'sm' | 'no' | 'so' | 'ea' | 'we' | 'ce' | 'fp';
}

/**
 * Build an imgproxy URL for the given source image URL.
 *
 * Returns the proxied URL, or the original URL if proxying is not applicable
 * (data: URIs, SVGs, videos, gifs, audio).
 */
export function imgproxyUrl(
  sourceUrl: string,
  opts: ImgProxyOptions = {}
): string {
  // Pass through non-proxiable URLs unchanged
  if (!sourceUrl) return sourceUrl;
  if (sourceUrl.startsWith('data:')) return sourceUrl;
  if (/\.(svg|gif|mp4|webm|mov|mp3|ogg|wav|flac|aac)(\?.*)?$/i.test(sourceUrl)) {
    return sourceUrl;
  }
  // Already proxied — return as-is to avoid double-proxying
  if (
    sourceUrl.includes('images.hzrd149.com') ||
    sourceUrl.includes('imgproxy') ||
    sourceUrl.includes('wsrv.nl')
  ) {
    return sourceUrl;
  }

  const {
    width = 0,
    height = 0,
    resizeType = 'fit',
    enlarge = false,
    format = 'webp',
    quality = 80,
    gravity = 'sm',
  } = opts;

  // Build processing options string in imgproxy format
  // Each option is separated by "/"
  const processingOptions: string[] = [];

  // resize:TYPE:WIDTH:HEIGHT:ENLARGE
  processingOptions.push(`resize:${resizeType}:${width}:${height}:${enlarge ? 1 : 0}`);

  // quality
  processingOptions.push(`quality:${quality}`);

  // gravity (only relevant for fill resize types)
  if (resizeType === 'fill' || resizeType === 'fill-down') {
    processingOptions.push(`gravity:${gravity}`);
  }

  // format
  processingOptions.push(`format:${format}`);

  const optionsPath = processingOptions.join('/');

  // Encode source URL as base64url (imgproxy standard encoding)
  // We use plain/ prefix for URL-encoded source (simpler, no signature needed)
  const encodedSource = encodeURIComponent(sourceUrl);

  return `${IMGPROXY_HOST}/insecure/${optionsPath}/plain/${encodedSource}@${format}`;
}

/**
 * Convenience: optimise an image for feed display.
 * - Fits within `width` pixels wide, auto height
 * - WebP output, quality 82
 */
export function feedImage(url: string, width = 800): string {
  return imgproxyUrl(url, {
    width,
    resizeType: 'fit',
    format: 'webp',
    quality: 82,
  });
}

/**
 * Convenience: square thumbnail for gallery grids.
 * - Fill-crops to exact square
 * - Smart gravity (face / object detection when available)
 */
export function thumbImage(url: string, size = 600): string {
  return imgproxyUrl(url, {
    width: size,
    height: size,
    resizeType: 'fill',
    gravity: 'sm',
    format: 'webp',
    quality: 78,
  });
}

/**
 * Convenience: tiny avatar / profile picture proxy.
 */
export function avatarImage(url: string, size = 128): string {
  return imgproxyUrl(url, {
    width: size,
    height: size,
    resizeType: 'fill',
    gravity: 'sm',
    format: 'webp',
    quality: 75,
  });
}

/**
 * Convenience: lightbox / full-size view — high quality, wide
 */
export function fullImage(url: string, width = 1600): string {
  return imgproxyUrl(url, {
    width,
    resizeType: 'fit',
    format: 'webp',
    quality: 90,
  });
}
