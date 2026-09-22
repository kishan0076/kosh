import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { MotionConfig } from "motion/react";
import "./index.css";
import { initTheme } from "@/lib/theme";
import { AppShell } from "@/components/layout/AppShell";
import { Home } from "@/pages/Home";
import { Library } from "@/pages/Library";
import { Skills } from "@/pages/Skills";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { ItemPage } from "@/pages/ItemPage";
import { PublishRepo } from "@/pages/PublishRepo";
import { Drive } from "@/pages/Drive";
import { DriveV2 } from "@/pages/DriveV2";
import { Vault } from "@/pages/Vault";
import { Prompts } from "@/pages/Prompts";
import { Inbox } from "@/pages/Inbox";
import { Trash } from "@/pages/Trash";
import { Collections, CollectionDetail } from "@/pages/Collections";
import { Settings } from "@/pages/Settings";
import { Share } from "@/pages/Share";
import { Add } from "@/pages/Add";
import { NotFound } from "@/pages/NotFound";

initTheme();

// Register the PWA service worker (share target, installability, light offline shell).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="add" element={<Add />} />
          <Route path="items/:id" element={<ItemPage />} />
          <Route path="publish" element={<PublishRepo />} />
          <Route path="drive" element={<Drive />} />
          {/* Wildcard: Drive V2 owns its sub-routes (my-drive / recent / starred / … / insights / activity). */}
          <Route path="drive-v2/*" element={<DriveV2 />} />
          <Route path="vault" element={<Vault />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="library" element={<Library />} />
          <Route path="skills" element={<Skills />} />
          <Route path="skills/new" element={<SkillEditor />} />
          <Route path="skills/:id/edit" element={<SkillEditor />} />
          <Route path="prompts" element={<Prompts />} />
          <Route path="collections" element={<Collections />} />
          <Route path="collections/:slug" element={<CollectionDetail />} />
          <Route path="trash" element={<Trash />} />
          <Route path="settings" element={<Settings />} />
          <Route path="share" element={<Share />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);
