# Bluebonnet components

Usage guidelines for the React components in `dist/bluebonnet.js`. Prop types are in `dist/bluebonnet.d.ts`; class names are in `src/components.css`.

## Button

Buttons start an action on the current page; links go somewhere else.

- Use `primary` for the main action of a view, one per form or dialog.
- Use `accent` (paintbrush) at most once per screen, for the action you most want people to notice, such as starting a trip or a sign-up. It never sits next to a `primary` button.
- Use `secondary` beside a primary action, `quiet` for cancel and low-stakes actions, `danger` only for actions that delete or cannot be undone.
- Label with a verb and an object: "Save report", "Delete sighting". Sentence case, no trailing punctuation.
- The consumer provides `children` (the label) and `onClick`. Pass `type="submit"` inside forms; the default is `type="button"`.
- Don't disable a button to explain a problem. Leave it enabled and show the reason with a `Field` error or an `Alert`.

## Field

A labeled text input or textarea with optional hint and error message.

- Always pass `label`. Placeholders are examples, never labels.
- Put format rules in `hint` before someone types ("Use acres, like 2.5"), not only in the error.
- `error` says what is wrong and how to fix it: "Enter a number above 0." It appears in `danger` with an icon, so it does not rely on color.
- The consumer provides `value`/`onChange` (or `defaultValue`) and any native input props; `id` is generated if you don't pass one.
- Set `multiline` for anything longer than a sentence.

## Choice

A checkbox or radio button with its label, styled in bluebonnet when checked.

- Use `type="checkbox"` for independent yes/no options and `type="radio"` for one choice from a short list (2 to 6). Longer lists use a select.
- Wrap a radio set in an element with `role="radiogroup"` and an `aria-label`, and give every radio the same `name`.
- Labels state the positive option: "Email me when peak bloom is reported", not "Don't email me".
- The consumer provides `checked`/`onChange` (or `defaultChecked`), `name` and `value`.

## Badge

A small label for status or category, set in 12px semibold.

- Status tones (`success`, `warning`, `danger`) take `dot` so state is not carried by color alone, and their text names the state ("Peak bloom", "Road closed").
- `bluebonnet`, `paintbrush` and `firewheel` are for categories and "New" markers, not for status.
- Keep badge text to one to three words. Badges are not buttons; don't attach click handlers.

## Alert

A tinted message block with an icon, for page-level feedback.

- `info` for context, `success` after an action completes, `warning` for something to check before continuing, `danger` when something failed.
- `title` is one sentence that makes sense alone. The body explains what to do next.
- `warning` and `danger` render with `role="alert"` and are announced immediately; the others use `role="status"`.
- The whole block is tinted. Don't add a colored side stripe or border.
- The consumer provides `title` and optional `children`; dismissing is the consumer's job.

## Tabs

Switches between sibling views of the same content, with arrow-key navigation.

- Use for 2 to 6 views that share a context (Map, Sightings, Season). For steps in a process, use headings or a stepper instead.
- Labels are one or two words, nouns, sentence case.
- The consumer provides `items` (`id`, `label`, `content`) and a `label` for the tab list. Pass `value` and `onChange` to control it, or `defaultId` to let it manage itself.
- Left/Right arrows move between tabs, Home and End jump to the ends.

## Table

A bordered data table with an uppercase header row and tabular figures.

- Pass `numeric` on columns of numbers so they right-align; all cells already use tabular figures.
- Use `caption` to say what the table shows and for when ("Sightings, week of Mar 30, 2026").
- Put units in the header ("Route miles"), not in every cell.
- The consumer provides `columns` (`key`, `label`, optional `numeric` and `render`) and `rows` (give each an `id`). Wide tables scroll sideways inside their own border.
