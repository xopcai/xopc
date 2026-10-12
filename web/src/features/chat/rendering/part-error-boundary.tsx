import { Component, type ReactNode } from 'react';

/** A broken rich part must not take the thread or composer down with it. */
export class PartErrorBoundary extends Component<{
  content: string; children: ReactNode;
}, { error: boolean; content: string }> {
  state = { error: false, content: this.props.content };

  static getDerivedStateFromError() { return { error: true }; }
  static getDerivedStateFromProps(props: { content: string }, state: { content: string }) {
    return props.content === state.content ? null : { error: false, content: props.content };
  }

  render() {
    return this.state.error
      ? <div className="whitespace-pre-wrap break-words" data-chat-render-fallback>{this.props.content}</div>
      : this.props.children;
  }
}
