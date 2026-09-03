import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { SupportReportDialog, type SupportReportSeed } from './support-report-dialog';
import { OPEN_SUPPORT_REPORT_EVENT } from './support-report-events';

function sessionKeyFromPath(pathname: string): string | undefined {
  if (!pathname.startsWith('/chat/') || pathname.startsWith('/chat/task/')) return undefined;
  const encoded = pathname.slice('/chat/'.length);
  if (!encoded || encoded === 'new') return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

export function SupportReportHost() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<SupportReportSeed>();

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<SupportReportSeed>).detail ?? {};
      setSeed({ sessionKey: sessionKeyFromPath(pathname), ...detail });
      setOpen(true);
    };
    window.addEventListener(OPEN_SUPPORT_REPORT_EVENT, listener);
    return () => window.removeEventListener(OPEN_SUPPORT_REPORT_EVENT, listener);
  }, [pathname]);

  return <SupportReportDialog open={open} onOpenChange={setOpen} seed={seed} />;
}
