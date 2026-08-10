import { useEffect, useState } from 'react';

import { fetchProject, type Project } from '@/features/projects/api';
import { getSessionDetail } from '@/features/sessions/session-api';

export function useChatProjectScope(sessionKey?: string | null): Project | null {
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProject(null);
    if (!sessionKey) return () => { cancelled = true; };

    void getSessionDetail(sessionKey)
      .then((session) => session.projectId ? fetchProject(session.projectId) : null)
      .then((nextProject) => {
        if (!cancelled) setProject(nextProject);
      })
      .catch(() => {
        if (!cancelled) setProject(null);
      });

    return () => { cancelled = true; };
  }, [sessionKey]);

  return project;
}
