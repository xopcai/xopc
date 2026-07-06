export type RouteIntakeParams = {
  text?: string | string[];
  url?: string | string[];
  title?: string | string[];
};

export type IntakeRouteParams = {
  text?: string;
  url?: string;
  title?: string;
};

export function buildIntakeRoute(input: IntakeRouteParams): { pathname: '/intake'; params: IntakeRouteParams } {
  const params: IntakeRouteParams = {};
  if (input.text?.trim()) params.text = input.text.trim();
  if (input.url?.trim()) params.url = input.url.trim();
  if (input.title?.trim()) params.title = input.title.trim();
  return { pathname: '/intake', params };
}

export function firstParam(value?: string | string[]): string {
  if (Array.isArray(value)) return value.map((item) => item.trim()).find(Boolean) ?? '';
  return value?.trim() ?? '';
}

export function buildRouteIntakeText(params: RouteIntakeParams): string {
  const text = firstParam(params.text);
  const url = firstParam(params.url);
  const title = firstParam(params.title);
  if (text) {
    if (title && /^https?:\/\//i.test(text)) return `${title}\n${text}`;
    return text;
  }

  if (title && url) return `${title}\n${url}`;
  return url;
}
