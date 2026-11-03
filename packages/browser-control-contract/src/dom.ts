export interface BrowserSemanticTarget {
  role: string;
  name?: string;
  nameIncludes?: string;
  testId?: string;
  scope?: { role: string; name: string };
}

/** Runs in the page. Keep all helpers inside this function for serialization. */
export async function browserDom(input: {
  operation: 'resolve';
  target?: BrowserSemanticTarget;
}): Promise<any> {
  const root = globalThis as any;
  const doc = root.document;
  const normalize = (value: string) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 240);
  const sensitive = (element: any) => element.type === 'password' || element.type === 'file'
    || /cc-|one-time-code|transaction-|password|token|secret|otp|cvv|cvc|card.?number|验证码|密码|银行卡|卡号/i.test([
      element.autocomplete, element.name, element.id, element.getAttribute('aria-label'), name(element),
    ].join(' '));
  const role = (element: any): string => element.getAttribute('role') || ({
    A: 'link', BUTTON: 'button', SUMMARY: 'button', SELECT: 'combobox', TEXTAREA: 'textbox',
    FORM: 'form', FIELDSET: 'group', SECTION: 'region',
  } as Record<string, string>)[element.tagName]
    || (element.tagName === 'INPUT' ? element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio'
      : ['submit', 'button', 'reset'].includes(element.type) ? 'button' : 'textbox' : 'text');
  const name = (element: any): string => normalize(
    (element.getAttribute('aria-labelledby') || '').split(/\s+/).map((id: string) => doc.getElementById(id)?.textContent || '').join(' ')
    || element.getAttribute('aria-label') || element.labels?.[0]?.textContent
    || (element.tagName === 'FIELDSET' ? element.querySelector('legend')?.textContent : '')
    || element.getAttribute('alt') || element.getAttribute('placeholder')
    || (['submit', 'button', 'reset'].includes(element.type) ? element.value : '')
    || element.innerText || element.getAttribute('title') || '',
  );
  const describe = (element: any): BrowserSemanticTarget => {
    const container = element.parentElement?.closest('form,fieldset,section,[role="region"],[role="group"],[role="dialog"]');
    return {
      role: role(element), name: name(element),
      ...(element.getAttribute('data-testid') ? { testId: element.getAttribute('data-testid') } : {}),
      ...(container && name(container) ? { scope: { role: role(container), name: name(container) } } : {}),
    };
  };
  const selector = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,[role],[data-testid],label,p,span,h1,h2,h3,td,output';
  if (input.operation === 'resolve') {
    const target = input.target!;
    const matches = Array.from(doc.querySelectorAll(selector)).filter((element: any) => {
      const rect = element.getBoundingClientRect();
      const style = root.getComputedStyle(element);
      if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') return false;
      const descriptor = describe(element);
      return descriptor.role === target.role
        && (!target.name || descriptor.name === target.name)
        && (!target.nameIncludes || descriptor.name?.includes(target.nameIncludes))
        && (!target.testId || descriptor.testId === target.testId)
        && (!target.scope || (descriptor.scope?.role === target.scope.role && descriptor.scope?.name === target.scope.name));
    }) as any[];
    if (matches.length !== 1) return { matches: matches.length };
    const element = matches[0];
    const ref = `xopc-e${++root.__xopcRefCounter || (root.__xopcRefCounter = 1)}`;
    element.setAttribute('data-xopc-ref', ref);
    return { matches: 1, node: {
      ref, role: role(element), name: name(element),
      value: !sensitive(element) && 'value' in element ? String(element.value).slice(0, 4096) : undefined,
      description: !sensitive(element) ? normalize(element.textContent) : undefined,
      href: element.tagName === 'A' ? element.href : undefined,
      states: [sensitive(element) ? 'sensitive' : '', element.disabled ? 'disabled' : '', element.checked ? 'checked' : '', ['BUTTON', 'INPUT'].includes(element.tagName) && element.type === 'submit' ? 'submit' : ''].filter(Boolean),
    } };
  }
}
