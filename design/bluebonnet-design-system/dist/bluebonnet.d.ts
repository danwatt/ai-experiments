import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = bluebonnet fill; accent = paintbrush fill (one per view); secondary = outlined; quiet = text only; danger = destructive. Default "primary". */
  variant?: "primary" | "accent" | "secondary" | "quiet" | "danger";
  /** "md" is 40px tall, "sm" is 32px. Default "md". */
  size?: "md" | "sm";
  children: ReactNode;
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label. Required: placeholders never replace it. */
  label: ReactNode;
  /** Helper text under the control, linked with aria-describedby. */
  hint?: ReactNode;
  /** Error message. Marks the field invalid and replaces nothing: the hint stays. */
  error?: ReactNode;
  /** Render a textarea instead of an input. */
  multiline?: boolean;
}

export interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  type?: "checkbox" | "radio";
  label: ReactNode;
  hint?: ReactNode;
}

export interface BadgeProps {
  tone?: "neutral" | "bluebonnet" | "paintbrush" | "firewheel" | "success" | "warning" | "danger";
  /** Leading status dot. */
  dot?: boolean;
  children: ReactNode;
}

export interface AlertProps {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  children?: ReactNode;
}

export interface TabsProps {
  items: { id: string; label: ReactNode; content: ReactNode }[];
  /** Accessible name for the tab list. */
  label?: string;
  defaultId?: string;
  /** Controlled selection. */
  value?: string;
  onChange?: (id: string) => void;
}

export interface TableColumn<Row> {
  key: string;
  label: ReactNode;
  /** Right-aligns the column; tabular figures are on for every cell. */
  numeric?: boolean;
  render?: (row: Row) => ReactNode;
}
export interface TableProps<Row = Record<string, unknown>> {
  columns: TableColumn<Row>[];
  rows: Row[];
  caption?: ReactNode;
}

export declare function Button(p: ButtonProps): JSX.Element;
export declare function Field(p: FieldProps): JSX.Element;
export declare function Choice(p: ChoiceProps): JSX.Element;
export declare function Badge(p: BadgeProps): JSX.Element;
export declare function Alert(p: AlertProps): JSX.Element;
export declare function Tabs(p: TabsProps): JSX.Element;
export declare function Table<Row>(p: TableProps<Row>): JSX.Element;
