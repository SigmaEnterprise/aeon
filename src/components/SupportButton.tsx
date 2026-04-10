/**
 * SupportButton — Donation CTA for npub16402t09028ppywh8t4fvrsw47wmqrhav2kwwsga3tsus5dlc4eqqpk2d7v
 * Lightning Address: aeon@rizful.com
 *
 * Displays a tasteful "Support Us" card with:
 *  - Lightning zap button (opens QR / WebLN)
 *  - Copy lightning address
 *  - Link to npub profile
 */
import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/useToast';
import { Zap, Copy, ExternalLink, Heart, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const SUPPORT_PUBKEY_HEX = 'd55ea5bcaf51c2123ae75d52c1c1d5f3b601dfac559ce823b15c390a37f8ae40';
const SUPPORT_LIGHTNING   = 'aeon@rizful.com';
const SUPPORT_NPUB        = nip19.npubEncode(SUPPORT_PUBKEY_HEX);

// Compact inline variant — used in sidebar
export function SupportButtonCompact() {
  const { toast } = useToast();
  const handleCopyLn = () => {
    navigator.clipboard.writeText(SUPPORT_LIGHTNING);
    toast({ title: '⚡ Lightning address copied!' });
  };

  return (
    <div className="flex items-center gap-1">
      <a
        href={`lightning:${SUPPORT_LIGHTNING}`}
        className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium w-full text-left transition-all duration-150 hover:bg-accent text-yellow-600 dark:text-yellow-400 hover:text-yellow-500"
        title="Zap to support Aeon development"
      >
        <Zap className="h-4 w-4 shrink-0 fill-current" />
        Support Aeon ⚡
      </a>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleCopyLn}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">Copy lightning address</TooltipContent>
      </Tooltip>
    </div>
  );
}

// Full card variant — used at bottom of pages
export function SupportButton({ className }: { className?: string }) {
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleCopyLn = () => {
    navigator.clipboard.writeText(SUPPORT_LIGHTNING);
    toast({ title: '⚡ Lightning address copied!', description: SUPPORT_LIGHTNING });
  };

  return (
    <Card className={cn(
      'relative overflow-hidden border-yellow-500/30 bg-gradient-to-br from-yellow-500/5 via-card to-orange-500/5',
      className
    )}>
      {/* Dismiss */}
      <button
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors rounded-full p-1 hover:bg-accent"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-yellow-500/15 shrink-0">
            <Zap className="h-6 w-6 text-yellow-500 fill-yellow-500" />
          </div>

          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <h3 className="font-bold text-sm flex items-center gap-2">
                Support Aeon Development
                <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" />
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Aeon is open-source and built with love. If you find it useful,
                consider zapping the developer to keep the lights on ⚡
              </p>
            </div>

            {/* Lightning address display */}
            <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 font-mono text-xs border">
              <Zap className="h-3 w-3 text-yellow-500 shrink-0" />
              <span className="flex-1 truncate text-muted-foreground">{SUPPORT_LIGHTNING}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={handleCopyLn}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Copy lightning address</TooltipContent>
              </Tooltip>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-8 gap-2 text-xs bg-yellow-500 hover:bg-yellow-400 text-black font-semibold"
                asChild
              >
                <a href={`lightning:${SUPPORT_LIGHTNING}`}>
                  <Zap className="h-3.5 w-3.5 fill-current" />
                  Zap via Lightning
                </a>
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2 text-xs"
                asChild
              >
                <a href={`https://njump.me/${SUPPORT_NPUB}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  View Profile
                </a>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-2 text-xs text-muted-foreground"
                onClick={handleCopyLn}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy Address
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
