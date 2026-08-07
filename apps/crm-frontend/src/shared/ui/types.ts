import type { ComponentType, ReactNode } from "react";

export type AsyncState =
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "validation"
  | "stale"
  | "denied"
  | "conflict"
  | "archived";

export interface UiIconProps {
  "aria-hidden"?: boolean;
  className?: string;
  size?: number | string;
  stroke?: number | string;
}

export type UiIcon = ComponentType<UiIconProps>;

export interface BreadcrumbItem {
  id: string;
  label: string;
  href?: string;
  onNavigate?: () => void;
}

export interface ActionDescriptor {
  id: string;
  label: string;
  disabled?: boolean;
  pending?: boolean;
  icon?: ReactNode;
}

export interface OperationEvidence {
  operationId: string;
  requestId?: string;
  receiptId?: string;
  completedAt?: string;
}
