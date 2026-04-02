import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LoginArea } from '@/components/auth/LoginArea';
import { WalletModal } from '@/components/WalletModal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import { Menu, X, Radio, Zap, Wallet } from 'lucide-react';

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
  { path: '/feed', label: 'Feed', icon: '📰' },
  { path: '/custom-feed', label: 'Custom Feeds', icon: '⭐' },
  { path: '/profile', label: 'Profile', icon: '👤' },
  { path: '/directory', label: 'Directory', icon: '📇' },
  { path: '/shielded', label: 'Private DMs', icon: '🔒' },
  { path: '/keys', label: 'Keys', icon: '🔑' },
  { path: '/relays', label: 'Relays', icon: '🌐' },
  { path: '/media-hosts', label: 'Media Hosts', icon: '📦' },
];

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Header */}
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <Link to="/" className="flex items-center gap-2 font-bold text-lg">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Radio className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="hidden sm:block">Bitchat</span>
            </Link>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="Theme" />
              </SelectTrigger>
              <SelectContent>
                {THEMES.map(t => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <LoginArea className="max-w-xs" />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex">
        {/* Sidebar */}
        <aside className={cn(
          "w-64 shrink-0 border-r min-h-[calc(100vh-3.5rem)] bg-card/50 sticky top-14 self-start transition-all duration-200",
          "hidden md:block",
          mobileOpen && "fixed inset-0 top-14 z-40 block w-64 bg-card border-r"
        )}>
          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  "hover:bg-accent hover:text-accent-foreground",
                  location.pathname === item.path
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            ))}

            <div className="pt-4 border-t mt-4 space-y-1">
              <div className="px-3 py-1 text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Wallet
              </div>
              <WalletModal>
                <button className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium w-full text-left transition-all duration-150 hover:bg-accent text-muted-foreground hover:text-foreground">
                  <Wallet className="h-4 w-4" />
                  Lightning Wallet
                </button>
              </WalletModal>
              <a
                href="https://shakespeare.diy"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                <Zap className="h-4 w-4" />
                Vibed with Shakespeare
              </a>
            </div>
          </nav>
        </aside>

        {/* Mobile overlay backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 top-14 z-30 bg-black/50 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
