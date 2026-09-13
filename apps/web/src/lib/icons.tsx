import type { ComponentType } from "react";
import {
  AppWindow,
  Blocks,
  Bot,
  Box,
  Code2,
  FileText,
  Globe,
  LayoutTemplate,
  ListChecks,
  Package,
  Play,
  Plug,
  Quote,
  TerminalSquare,
  User as UserIcon,
  Wrench,
  Zap,
} from "lucide-react";
import type { Item, LinkType, RepoKind, Tool } from "@kosh/shared";

export type IconType = ComponentType<{ className?: string; size?: number | string; strokeWidth?: number }>;

/** GitHub mark (lucide's brand icon is deprecated, so ship our own). */
export function GitHubMark({ className, size = 16 }: { className?: string; size?: number | string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const REPO_KIND_ICON: Record<RepoKind, IconType> = {
  skills: Blocks,
  "mcp-server": Plug,
  automation: Zap,
  cli: TerminalSquare,
  "agent-framework": Bot,
  library: Package,
  "awesome-list": ListChecks,
  template: LayoutTemplate,
  app: AppWindow,
  other: Box,
};

const LINK_TYPE_ICON: Record<LinkType, IconType> = {
  repo: Box,
  gist: Code2,
  profile: UserIcon,
  release: Package,
  issue: FileText,
  package: Package,
  tool: Wrench,
  article: FileText,
  video: Play,
  other: Globe,
};

export function repoKindIcon(kind?: RepoKind): IconType {
  return kind ? REPO_KIND_ICON[kind] : Box;
}

/** The primary marker icon for any item. */
export function itemIcon(item: Item): IconType {
  if (item.kind === "skill") return Blocks;
  if (item.kind === "prompt") return Quote;
  if (item.kind === "file") return FileText;
  // link
  if (item.linkType === "repo" && item.github?.repoKind) return REPO_KIND_ICON[item.github.repoKind];
  return LINK_TYPE_ICON[item.linkType ?? "other"];
}

export const TOOL_COLOR_VAR: Record<Tool, string> = {
  claude: "var(--tool-claude)",
  codex: "var(--tool-codex)",
  cursor: "var(--tool-cursor)",
  gemini: "var(--tool-gemini)",
  generic: "var(--tool-generic)",
};
