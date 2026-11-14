import { Component, type ReactNode } from 'react';

export class AtlasBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onUnavailable();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
