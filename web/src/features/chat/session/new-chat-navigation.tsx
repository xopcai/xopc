import { flushSync } from 'react-dom';
import { Link, useNavigate, type LinkProps, type NavigateFunction, type NavigateOptions, type To } from 'react-router-dom';

/** Keep focus inside the click gesture so mobile browsers can open the keyboard. */
export function navigateToNewChat(navigate: NavigateFunction, to: To, options?: NavigateOptions, beforeNavigate?: () => void): void {
  flushSync(() => {
    beforeNavigate?.();
    void navigate(to, { ...options, flushSync: true });
  });
  document.querySelector<HTMLElement>('[data-primary-chat-composer] [role="textbox"][contenteditable="true"]')
    ?.focus();
}

export function NewChatLink({ onClick, to, state, replace, relative, preventScrollReset, ...props }: LinkProps) {
  const navigate = useNavigate();
  return <Link {...props} to={to} state={state} replace={replace} relative={relative} preventScrollReset={preventScrollReset} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || (props.target && props.target !== '_self') || props.reloadDocument || props.download) {
      onClick?.(event);
      return;
    }
    // Preserve cancellation and close navigation overlays before focusing the new editor.
    flushSync(() => onClick?.(event));
    if (event.defaultPrevented) return;
    event.preventDefault();
    navigateToNewChat(navigate, to, { state, replace, relative, preventScrollReset });
  }} />;
}
