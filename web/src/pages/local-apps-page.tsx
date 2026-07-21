import { ArrowRight, Box, Plus, Sparkles } from 'lucide-react';
import { useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { listLocalApps } from '@/features/local-apps/api';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

export function LocalAppsPage() {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const { data, isLoading, error } = useSWR('local-apps-list', listLocalApps);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <h1 className="truncate text-base font-semibold tracking-tight text-fg">{zh ? '应用工坊' : 'App Workshop'}</h1>,
      end: (
        <Button asChild variant="primary" className="h-9">
          <Link to="/local-apps/new"><Plus className="size-4" />{zh ? '创建应用' : 'Create app'}</Link>
        </Button>
      ),
    });
    return () => clearPageHeader();
  }, [clearPageHeader, setPageHeader, zh]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-panel px-3 py-8 sm:px-5 xl:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 max-w-2xl">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            <Sparkles className="size-4" />{zh ? '从想法开始' : 'Start with an idea'}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-fg">{zh ? '把自己的工具放进 XOPC' : 'Put your own tools inside XOPC'}</h2>
          <p className="mt-2 text-sm leading-6 text-fg-muted">{zh ? '每个应用都会自动创建一个由 Coder 负责的 Project，可预览、安装到侧栏，并持续迭代。' : 'Every app gets a Coder-owned Project for previewing, installing in the sidebar, and ongoing iteration.'}</p>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-44 rounded-xl" />)}</div>
        ) : error ? (
          <p className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">{error instanceof Error ? error.message : String(error)}</p>
        ) : data?.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((app) => (
              <Link key={app.id} to={`/local-apps/${encodeURIComponent(app.id)}`} className="group flex min-h-44 flex-col rounded-xl border border-edge-subtle bg-surface-base p-4 shadow-surface transition-colors hover:bg-surface-hover/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-fg"><Box className="size-5" /></div>
                  <span className="rounded-full bg-surface-hover px-2 py-1 text-[11px] font-medium text-fg-muted">
                    {app.installationState === 'not_installed'
                      ? (zh ? '草稿' : 'Draft')
                      : app.enabled
                        ? (zh ? '已在侧栏' : 'In sidebar')
                        : (zh ? '已禁用' : 'Disabled')}
                  </span>
                </div>
                <h3 className="mt-4 truncate text-sm font-semibold text-fg">{app.name}</h3>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{app.description || app.idea}</p>
                <div className="mt-auto flex items-center justify-end pt-3 text-xs font-medium text-accent">{zh ? '打开工作台' : 'Open workbench'}<ArrowRight className="ml-1 size-3.5 transition-transform group-hover:translate-x-0.5" /></div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-edge bg-surface-base px-6 py-14 text-center">
            <Box className="mx-auto size-8 text-fg-subtle" />
            <h3 className="mt-4 text-sm font-semibold text-fg">{zh ? '还没有本地应用' : 'No local apps yet'}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">{zh ? '描述你想解决的问题，XOPC 会创建应用骨架和可持续开发的 Project。' : 'Describe the problem and XOPC will create an app scaffold and an ongoing Project.'}</p>
            <Button asChild variant="primary" className="mt-5"><Link to="/local-apps/new"><Plus className="size-4" />{zh ? '创建第一个应用' : 'Create your first app'}</Link></Button>
          </div>
        )}
      </div>
    </div>
  );
}
