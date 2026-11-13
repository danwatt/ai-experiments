// RPR1 / YLK1 Codec Lab — the six components on window.CodecLab.
// Hand-written from the repository's CSS; see each component's README for its source.

import type { ReactNode, CSSProperties } from "react";

export interface PanelProps {
  children?: ReactNode;
  /** Drop the 14px padding: for a table well or a chart that bleeds to the border. */
  flush?: boolean;
  className?: string;
}
/** The surface every demo section sits on: panel ground, hairline border, 2px radius. */
export declare function Panel(props: PanelProps): JSX.Element;

export interface TabBarItem {
  /** The tab's name, set in the pixel face. */
  label: string;
  /** One line under the label, hidden by the page below 620px in the original. */
  note?: string;
  href?: string;
}
export interface TabBarProps {
  items: TabBarItem[];
  /** The current tab, matched on href first, then label. */
  current?: string;
  /** Called instead of navigating, when you supply it. */
  onSelect?: (item: TabBarItem) => void;
  /** aria-label for the nav element. Defaults to "demos". */
  label?: string;
  className?: string;
}
/** The page switcher: tabs sitting on a hairline, the current one lifted onto panel with an accent rule. */
export declare function TabBar(props: TabBarProps): JSX.Element;

export interface StageLabelProps {
  /** The step number, in the accent. */
  num?: ReactNode;
  children?: ReactNode;
  /** A right-aligned aside in the mono face, un-uppercased. */
  hint?: ReactNode;
  className?: string;
}
/** The numbered label above a section: pixel face, 10px, uppercase, tracked. */
export declare function StageLabel(props: StageLabelProps): JSX.Element;

export interface Stat {
  /** The key, uppercased by CSS. */
  k: ReactNode;
  /** The value, in tabular figures. */
  v: ReactNode;
  /** A note under the value. */
  n?: ReactNode;
  /** Colour the value by what it means. Plain ink when absent. */
  tone?: "hot" | "good" | "warn";
}
export interface StatGridProps {
  stats: Stat[];
  className?: string;
}
/** A responsive grid of key / value / note readouts, 150px minimum per column. */
export declare function StatGrid(props: StatGridProps): JSX.Element;

export interface LegendItem {
  label: ReactNode;
  /** A solid swatch. Pass a token reference, e.g. "var(--sym-word)". */
  color?: string;
  /** A 34px gradient swatch: [low, high] ends of a ramp. */
  ramp?: [string, string];
  /** A text-marker swatch: the underline colour drawn inside a panel chip. */
  marker?: string;
  /** Set the label in ink rather than muted. */
  strong?: boolean;
}
export interface LegendProps {
  items: LegendItem[];
  className?: string;
}
/** What each colour in a strip, chart or marked passage means. */
export declare function Legend(props: LegendProps): JSX.Element;

export interface LcdLine {
  text: string;
  /** An unlit or printed line: lcd-dim, 2.1:1 on the glass by design. Never real text. */
  dim?: boolean;
}
export interface LcdScreenProps {
  /** Fixed lines of glass text. Strings are lit; objects may be dim. */
  lines: (string | LcdLine)[];
  /** Cap the glass width, e.g. 420 or "36ch". */
  width?: CSSProperties["maxWidth"];
  /** A printed label under the glass, on the case. */
  label?: string;
  className?: string;
}
/** The emulator's case, bezel and glass around fixed lines of text. The original draws its glyphs on a canvas; this renders text. */
export declare function LcdScreen(props: LcdScreenProps): JSX.Element;
