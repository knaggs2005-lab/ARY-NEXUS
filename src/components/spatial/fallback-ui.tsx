"use client";
import { Component, type ReactNode } from "react";
export class SpatialBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <>
        <p role="alert">
          Spatial view unavailable. Your original workspace is available below.
        </p>
        {this.props.fallback}
      </>
    ) : (
      this.props.children
    );
  }
}
