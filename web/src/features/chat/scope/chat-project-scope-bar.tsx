import { FolderKanban } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { Project } from '@/features/projects/api';
import { withReturnTo } from '@/lib/navigation-return';

export function ChatProjectScopeBar({
  project,
  workspace,
  projectLabel,
  workspaceLabel,
  returnTo,
}: {
  project: Project;
  workspace?: string | null;
  projectLabel: string;
  workspaceLabel: string;
  returnTo: string;
}) {
  const effectiveWorkspace = project.effectiveWorkspaceRoot || project.workspaceRoot || workspace?.trim();
  return (
    <div className="shrink-0 border-b border-edge-subtle bg-surface-panel/80 px-3 py-1.5 sm:px-5 xl:px-6">
      <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
        <FolderKanban className="size-3.5 shrink-0 text-accent-fg" strokeWidth={1.75} aria-hidden />
        <Link
          to={withReturnTo(`/projects/${encodeURIComponent(project.id)}`, returnTo)}
          className="min-w-0 truncate font-medium text-fg transition-colors hover:text-accent-fg"
        >
          {projectLabel}: {project.name}
        </Link>
        {effectiveWorkspace ? (
          <span className="min-w-0 truncate text-fg-subtle" title={effectiveWorkspace}>
            · {workspaceLabel}: {effectiveWorkspace}
          </span>
        ) : null}
      </div>
    </div>
  );
}
