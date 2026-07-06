import { buildGatewayRawFilePath } from './image-source-utils';

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function isHtmlFile(name: string, mimeType: string): boolean {
  const ext = extensionOf(name);
  return ext === 'html' || ext === 'htm' || mimeType === 'text/html';
}

export type HtmlWebViewUriSource = {
  uri: string;
  headers?: Record<string, string>;
};

export type HtmlWebViewInlineSource = {
  html: string;
  baseUrl?: string;
};

export type HtmlWebViewSource = HtmlWebViewUriSource | HtmlWebViewInlineSource;

export function buildHtmlWebViewSource(options: {
  workspaceRelativePath?: string;
  htmlContent?: string | null;
  sessionKey?: string | null;
  agentId?: string | null;
  apiUrl: (path: string) => string;
  token: string;
  gatewayBaseUrl: string;
}): HtmlWebViewSource | null {
  const { workspaceRelativePath, htmlContent, sessionKey, agentId, apiUrl, token, gatewayBaseUrl } = options;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  const rel = workspaceRelativePath?.trim();
  if (rel) {
    return {
      uri: apiUrl(buildGatewayRawFilePath(rel, sessionKey ?? undefined, agentId ?? undefined)),
      headers,
    };
  }

  if (htmlContent != null && htmlContent.length > 0) {
    const base = gatewayBaseUrl.replace(/\/$/, '');
    return {
      html: htmlContent,
      baseUrl: base ? `${base}/` : undefined,
    };
  }

  return null;
}

export function shouldAllowHtmlWebViewNavigation(
  url: string,
  previewUri: string | undefined,
  gatewayBaseUrl: string,
): boolean {
  const normalized = url.trim();
  if (!normalized || normalized === 'about:blank') return true;
  if (normalized.startsWith('data:') || normalized.startsWith('blob:')) return true;

  if (previewUri) {
    const previewRoot = previewUri.split('?')[0];
    if (normalized === previewUri || normalized === previewRoot || normalized.startsWith(`${previewRoot}?`)) {
      return true;
    }
  }

  const base = gatewayBaseUrl.replace(/\/$/, '');
  if (base && (normalized === base || normalized.startsWith(`${base}/`))) {
    return true;
  }

  return false;
}
