/** Presentational chip for one inlined text/PDF draft attachment: filename,
 * media type, and human-readable size, with an optional owner-driven remove
 * control. Pure props — the owner resolves every string. */

import { IconCloseFill14, IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './TextFileChip.module.css'

/** Strings the owner resolves from its own locale namespace. */
export interface TextFileChipLabels {
  /** Accessible remove-control label, interpolated with the file name. */
  remove: (name: string) => string
}

/**
 * One text/PDF draft file chip. The file's own data (`name`, `mediaType`,
 * `size`) rides plain props and every user-facing string is already resolved:
 * the atom reads no application state and no locale.
 *
 * @param props.name - display file name.
 * @param props.mediaType - browser-declared media type, shown as-is.
 * @param props.size - human-readable byte-size text the owner formatted.
 * @param props.removeLabel - accessible label of the remove control; rendered only when present.
 * @param props.onRemove - remove callback; rendered as the × control when present.
 * @returns the chip.
 */
export function TextFileChip({ name, mediaType, size, removeLabel, onRemove }: {
  name: string
  mediaType: string
  size: string
  removeLabel?: string
  onRemove?: () => void
}) {
  return (
    <div className={css.chip} title={name}>
      <span className={css.icon} aria-hidden="true">
        <IconPaperclipOutline16 size={14} />
      </span>
      <span className={css.body}>
        <span className={css.name}>{name}</span>
        <span className={css.meta}>{mediaType}{size === '' ? '' : ` · ${size}`}</span>
      </span>
      {onRemove !== undefined && (
        <button
          type="button"
          className={css.remove}
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <IconCloseFill14 size={12} />
        </button>
      )}
    </div>
  )
}
