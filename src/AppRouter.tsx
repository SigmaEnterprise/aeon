import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";

import Index from "./pages/Index";
import { FeedPage } from "./pages/FeedPage";
import { ArticlesPage } from "./pages/ArticlesPage";
import { ArticleEditorPage } from "./pages/ArticleEditorPage";
import { ArticleViewPage } from "./pages/ArticleViewPage";
import { CustomFeedPage } from "./pages/CustomFeedPage";
import { ProfilePage } from "./pages/ProfilePage";
import { DirectoryPage } from "./pages/DirectoryPage";
import { ShieldedPage } from "./pages/ShieldedPage"; // NIP-17 Private DMs
import { KeysPage } from "./pages/KeysPage";
import { RelaysPage } from "./pages/RelaysPage";
import { MediaHostsPage } from "./pages/MediaHostsPage";
import { RelayExplorerPage } from "./pages/RelayExplorerPage";
import { NIP19Page } from "./pages/NIP19Page";
import NotFound from "./pages/NotFound";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/feed" element={<FeedPage />} />
        {/* NIP-23 Articles suite */}
        <Route path="/articles" element={<ArticlesPage />} />
        <Route path="/articles/new" element={<ArticleEditorPage />} />
        <Route path="/articles/edit/:naddr" element={<ArticleEditorPage />} />
        <Route path="/articles/:naddr" element={<ArticleViewPage />} />
        <Route path="/custom-feed" element={<CustomFeedPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/directory" element={<DirectoryPage />} />
        <Route path="/shielded" element={<ShieldedPage />} />
        <Route path="/keys" element={<KeysPage />} />
        <Route path="/relays" element={<RelaysPage />} />
        <Route path="/media-hosts" element={<MediaHostsPage />} />
        {/* NIP-51 Relay Explorer — browse events from any relay */}
        <Route path="/relay-explorer" element={<RelayExplorerPage />} />
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<NIP19Page />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;
