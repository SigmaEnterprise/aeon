import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LoginArea } from '@/components/auth/LoginArea';
import { WalletModal } from '@/components/WalletModal';
import { AeonLogo } from '@/components/AeonLogo';
import { NotificationsPanel } from '@/components/NotificationsPanel';
import { SupportButtonCompact } from '@/components/SupportButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import { useLoggedInAccounts } from '@/hooks/useLoggedInAccounts';
import { Menu, X, Zap, Wallet, LogIn } from 'lucide-react';

const THEMES = [
  { value: 'light', label: 'Default Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'solarized-light', label: 'Solarized Light' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'forest', label: 'Forest' },
  { value: 'desert', label: 'Desert' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'neon', label: 'Neon' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'gruvbox-light', label: 'Gruvbox Light' },
  { value: 'gruvbox-dark', label: 'Gruvbox Dark' },
  { value: 'midnight', label: 'Midnight' },
];

const NAV_ITEMS = [
  { path: '/feed',           label: 'Feed',          icon: '📰' },
  { path: '/articles',       label: 'Articles',       icon: '🗞️' },
  { path: '/custom-feed',   label: 'Custom Feeds',   icon: '⭐' },
  { path: '/profile',       label: 'Profile',        icon: '👤' },
  { path: '/directory',     label: 'Directory',      icon: '📇' },
  { path: '/shielded',      label: 'Private DMs',    icon: '🔒' },
  { path: '/marmot',        label: 'Marmot Groups',  icon: '🦫' },
  { path: '/keys',          label: 'Keys',           icon: '🔑' },
  { path: '/relays',        label: 'Relays',         icon: '🌐' },
  { path: '/media-hosts',   label: 'Media Hosts',    icon: '📦' },
  { path: '/relay-explorer', label: 'Relay Explorer', icon: '🔭' },
  { path: '/features',       label: 'Features',        icon: '✨' },
];

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { currentUser } = useLoggedInAccounts();

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Top Header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md shadow-sm" style={{ top: 0 }}>
        <div className="max-w-7xl mx-auto px-2 sm:px-4 h-14 flex items-center gap-1.5">

          {/* Left: hamburger (mobile) + logo — always visible, never pushed out */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Hamburger — mobile only */}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 md:hidden shrink-0"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>

            <Link to="/" className="flex items-center gap-1.5 shrink-0">
              <AeonLogo size={28} />
              {/* Show "Aeon" only on sm+ to save space */}
              <span className="hidden sm:block font-bold text-lg tracking-tight bg-gradient-to-r from-violet-500 via-indigo-500 to-sky-500 bg-clip-text text-transparent">
                Aeon
              </span>
            </Link>
          </div>

          {/* Spacer */}
          <div className="flex-1 min-w-0" />

          {/* Right: theme picker (sm+) + notifications + login/avatar
              On mobile we keep this as compact as possible so hamburger is never blocked */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Theme picker — hidden on mobile */}
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="hidden sm:flex w-[130px] h-8 text-xs">
                <SelectValue placeholder="Theme" />
              </SelectTrigger>
              <SelectContent>
                {THEMES.map(t => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Notifications bell (only when logged in — handled inside component) */}
            <NotificationsPanel />

            {/* Login area: full on sm+, compact on mobile */}
            <div className="hidden sm:block">
              <LoginArea className="max-w-xs" />
            </div>

            {/* Mobile: icon-only login when logged out, compact avatar when logged in */}
            {!currentUser && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 sm:hidden shrink-0"
                onClick={() => setMobileOpen(true)}
                aria-label="Log in"
              >
                <LogIn className="h-4 w-4" />
              </Button>
            )}
            {currentUser && (
              <div className="sm:hidden">
                <LoginArea />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex">

        {/* ── Sidebar ────────────────────────────────────────────────────── */}
        <aside className={cn(
          // Desktop: sticky sidebar
          "w-64 shrink-0 border-r bg-card/50 hidden md:block",
          "sticky top-14 self-start",
          // Sidebar height: fill the visible viewport below the header
          "h-[calc(100vh-3.5rem)] overflow-y-auto",
          // WebKit momentum scrolling for older iOS (iPhone 7+)
          "[overflow-y:scroll] [-webkit-overflow-scrolling:touch]",
          // Mobile: slide-in drawer overlaying content
          mobileOpen && [
            "fixed z-40 flex flex-col border-r",
            "top-14 left-0 bottom-0 w-72",
            "bg-card overflow-y-auto",
            "[-webkit-overflow-scrolling:touch]",
            // Use block to override hidden on small screens when open
            "!block",
          ]
        )}>
          <nav className="p-3 space-y-0.5 pb-safe">

            {NAV_ITEMS.map(item => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  "hover:bg-accent hover:text-accent-foreground",
                  (location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path + '/')))
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="text-base leading-none">{item.icon}</span>
                {item.label}
              </Link>
            ))}

            {/* Mobile login section — shown in sidebar when drawer is open */}
            <div className="pt-4 mt-3 border-t md:hidden">
              <p className="px-3 pb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Account
              </p>
              <div className="px-2">
                <LoginArea className="w-full" />
              </div>
            </div>

            {/* Theme picker — in sidebar, hidden on desktop (already in header) */}
            <div className="pt-4 mt-3 border-t md:hidden">
              <p className="px-3 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Theme
              </p>
              <div className="px-3 pb-2">
                <Select value={theme} onValueChange={v => { setTheme(v); setMobileOpen(false); }}>
                  <SelectTrigger className="w-full h-8 text-xs">
                    <SelectValue placeholder="Theme" />
                  </SelectTrigger>
                  <SelectContent>
                    {THEMES.map(t => (
                      <SelectItem key={t.value} value={t.value} className="text-xs">
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Wallet + footer */}
            <div className="pt-4 mt-3 border-t space-y-0.5">
              <p className="px-3 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Wallet
              </p>

              <WalletModal>
                <button className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full text-left transition-all duration-150 hover:bg-accent text-muted-foreground hover:text-foreground">
                  <Wallet className="h-4 w-4 shrink-0" />
                  Lightning Wallet
                </button>
              </WalletModal>

              {/* Support the developer */}
              <SupportButtonCompact />

              <a
                href="https://shakespeare.diy"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                <Zap className="h-4 w-4 shrink-0" />
                Vibed with Shakespeare
              </a>
            </div>
          </nav>
        </aside>

        {/* Mobile backdrop overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 top-14 z-30 bg-black/50 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* ── Main content ──────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 pb-safe">
          {children}
        </main>
      </div>
    </div>
  );
}
