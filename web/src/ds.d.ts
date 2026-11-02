// Types for ds.jsx, read from each component's props in the design-system bundle.
import type { CSSProperties, FC, ReactNode, SVGProps } from "react";

type Size = "sm" | "md" | "lg";
type Variant = "primary" | "secondary" | "ink" | "ghost" | "danger";
type Option = string | { value: string; label: ReactNode };

export const Icon: FC<{ name: string; size?: number; strokeWidth?: number; color?: string; style?: CSSProperties } & Omit<SVGProps<SVGSVGElement>, "name">>;
export const Button: FC<{
  variant?: Variant;
  size?: Size;
  icon?: string;
  iconRight?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  style?: CSSProperties;
}>;
export const IconButton: FC<{ icon: string; label: string; size?: Size; variant?: Variant; onClick?: () => void; disabled?: boolean }>;
export const Badge: FC<{ tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "ink"; children?: ReactNode; dot?: boolean }>;
export const Card: FC<{ title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode; padding?: number | string; footer?: ReactNode; style?: CSSProperties }>;
export const Hash: FC<{ value?: string; head?: number; tail?: number; copy?: boolean; muted?: boolean }>;
export const Stat: FC<{ label?: ReactNode; value?: ReactNode; unit?: ReactNode; delta?: ReactNode; sub?: ReactNode }>;
export const StatusBadge: FC<{ status?: "held" | "checking" | "review" | "credited" | "frozen" | "returned" | "settled"; label?: ReactNode }>;
export const Tag: FC<{ children?: ReactNode; onRemove?: () => void; icon?: string }>;
export const Dialog: FC<{ open?: boolean; title?: ReactNode; children?: ReactNode; footer?: ReactNode; onClose?: () => void; width?: number | string; inline?: boolean }>;
export const Toast: FC<{ tone?: "info" | "success" | "warning" | "danger"; title?: ReactNode; children?: ReactNode; action?: ReactNode }>;
export const Tooltip: FC<{ content: ReactNode; children?: ReactNode; placement?: "top" | "bottom" | "left" | "right" }>;
export const FlowSteps: FC<{ steps?: { title: ReactNode; text?: ReactNode }[]; current?: number; compact?: boolean }>;
export const Checkbox: FC<{ label?: ReactNode; description?: ReactNode; checked?: boolean; defaultChecked?: boolean; onChange?: (on: boolean) => void; disabled?: boolean }>;
export const Input: FC<{
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: { target: HTMLInputElement }) => void;
  type?: string;
  mono?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  disabled?: boolean;
  style?: CSSProperties;
}>;
export const Radio: FC<{ name?: string; options?: Option[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; direction?: "column" | "row" }>;
export const Select: FC<{
  label?: ReactNode;
  hint?: ReactNode;
  options?: Option[];
  value?: string;
  defaultValue?: string;
  onChange?: (e: { target: HTMLSelectElement }) => void;
  disabled?: boolean;
  style?: CSSProperties;
}>;
export const Switch: FC<{ label?: ReactNode; checked?: boolean; defaultChecked?: boolean; onChange?: (on: boolean) => void; disabled?: boolean }>;
export const Tabs: FC<{ tabs?: (string | { value: string; label: ReactNode; count?: number })[]; value?: string; defaultValue?: string; onChange?: (value: string) => void }>;
