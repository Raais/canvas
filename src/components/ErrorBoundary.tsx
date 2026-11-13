import { Component, type ReactNode } from 'react';

type BoundaryState = { error: Error | null };

export class CanvasErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="storage-error">
        <h1>canvas hit a problem</h1>
        <p>{this.state.error.message || 'The board is still stored in this browser.'}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
