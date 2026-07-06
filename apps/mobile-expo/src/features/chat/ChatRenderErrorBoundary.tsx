import { Component, type ErrorInfo, type ReactNode } from 'react';

type ChatRenderErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type ChatRenderErrorBoundaryState = {
  hasError: boolean;
};

/** Catches render errors in chat message subtrees so one bad block does not crash the screen. */
export class ChatRenderErrorBoundary extends Component<
  ChatRenderErrorBoundaryProps,
  ChatRenderErrorBoundaryState
> {
  state: ChatRenderErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ChatRenderErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ChatRenderErrorBoundaryProps): void {
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
