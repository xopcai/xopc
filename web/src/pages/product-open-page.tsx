import {
  parseProductReferenceDeepLink,
  productReferenceRoute,
} from '@xopcai/gateway-contract';
import { Navigate, Link, useLocation } from 'react-router-dom';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { getLocalApp } from '@/features/local-apps/api';
import { localAppOpenRoute } from '@/features/local-apps/open-route';
import { useLocaleStore } from '@/stores/locale-store';

export function ProductOpenPage() {
  const location = useLocation();
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const reference = parseProductReferenceDeepLink(`xopc://open${location.search}`);
  const localAppId = reference?.kind === 'local_app' ? reference.id : null;
  const { data: localApp, error } = useSWR(
    localAppId ? ['local-app-open', localAppId] : null,
    () => getLocalApp(localAppId!),
  );

  if (!reference) {
    return <OpenError message={zh ? '这个打开链接无效。' : 'This open link is invalid.'} zh={zh} />;
  }

  if (reference.kind !== 'local_app') {
    const route = productReferenceRoute({
      ...reference,
      title: reference.id,
      capabilities: ['open'],
    });
    return route
      ? <Navigate to={route} replace />
      : <OpenError message={zh ? '这个内容无法在应用中打开。' : 'This content cannot be opened in the app.'} zh={zh} />;
  }

  if (error) {
    const notFound = typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
    return (
      <OpenError
        message={notFound
          ? (zh ? '找不到这个本地应用，它可能已被删除。' : 'This local app was not found and may have been deleted.')
          : error instanceof Error ? error.message : (zh ? '无法打开这个本地应用。' : 'Unable to open this local app.')}
        zh={zh}
      />
    );
  }

  if (localApp) return <Navigate to={localAppOpenRoute(localApp)} replace />;

  return (
    <div className="flex w-full flex-col gap-4 px-3 py-6 sm:px-5 xl:px-6" aria-busy>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 rounded-xl" />
    </div>
  );
}

function OpenError({ message, zh }: { message: string; zh: boolean }) {
  return (
    <div className="m-6 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert">
      <p>{message}</p>
      <Link className="mt-3 inline-flex font-medium text-accent hover:underline" to="/local-apps">
        {zh ? '查看本地应用' : 'View local apps'}
      </Link>
    </div>
  );
}
