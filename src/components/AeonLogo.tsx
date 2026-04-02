import { cn } from '@/lib/utils';

interface AeonLogoProps {
  /** Size in pixels (default 32) */
  size?: number;
  className?: string;
  /** Show the wordmark "Aeon" beside the star */
  showName?: boolean;
  /** Extra class for the text */
  nameClassName?: string;
}

/**
 * Aeon brand logo — an indigo/violet/sky star on a deep-space background.
 * Used in the app header, splash, and anywhere the brand should appear.
 */
export function AeonLogo({ size = 32, className, showName = false, nameClassName }: AeonLogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 select-none', className)}>
      {/* Star icon */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        {/* Deep-space background */}
        <circle cx="32" cy="32" r="30" fill="url(#aeon-bg)" />

        {/* Ten-point star body */}
        <polygon
          points="32,7 35.8,21.2 50,20.5 39,29.5 43.5,43.5 32,35 20.5,43.5 25,29.5 14,20.5 28.2,21.2"
          fill="url(#aeon-star)"
          filter="url(#aeon-glow)"
        />

        {/* Bright centre dot */}
        <circle cx="32" cy="32" r="3.5" fill="white" opacity="0.95" />

        {/* Fine sparkle rays */}
        <line x1="32" y1="2" x2="32" y2="10" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
        <line x1="32" y1="54" x2="32" y2="62" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
        <line x1="2" y1="32" x2="10" y2="32" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
        <line x1="54" y1="32" x2="62" y2="32" stroke="white" strokeWidth="1" strokeOpacity="0.4" />

        <defs>
          <radialGradient id="aeon-bg" cx="50%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#1e1b4b" />
            <stop offset="100%" stopColor="#0c0a1a" />
          </radialGradient>

          <linearGradient id="aeon-star" x1="14" y1="7" x2="50" y2="43.5" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#c4b5fd" />
            <stop offset="45%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>

          <filter id="aeon-glow" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Optional wordmark */}
      {showName && (
        <span
          className={cn(
            'font-bold tracking-tight bg-gradient-to-r from-violet-400 via-indigo-400 to-sky-400 bg-clip-text text-transparent',
            nameClassName
          )}
        >
          Aeon
        </span>
      )}
    </span>
  );
}
