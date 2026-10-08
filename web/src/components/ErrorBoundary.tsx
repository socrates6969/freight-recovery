import { Component, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

/** Renders a fixed message on any render error (never the error text). */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="p-8">
          Something went wrong. Reload the page to continue.
        </div>
      );
    }
    return this.props.children;
  }
}
