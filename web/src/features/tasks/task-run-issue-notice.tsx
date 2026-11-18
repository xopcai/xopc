import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import type { TaskRunIssue } from './task-result-presentation';

export function TaskRunIssueNotice({ issue }: { issue: TaskRunIssue }) {
  return (
    <div className="space-y-2 rounded-lg border border-edge bg-surface-inset p-3">
      <p className="text-sm font-semibold text-fg">{issue.title}</p>
      {issue.description ? <p className="text-sm leading-6 text-fg-muted">{issue.description}</p> : null}
      {issue.action ? <Button asChild variant="secondary"><Link to={issue.action.href}>{issue.action.label}</Link></Button> : null}
    </div>
  );
}
