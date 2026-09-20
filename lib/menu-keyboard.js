// Return the item that an ARIA menu navigation key should focus. Keeping the
// index calculation independent of the DOM makes the wraparound rules easy to
// verify without adding a browser test dependency for one small widget.
export function menuFocusTarget(items, current, key) {
  const options = Array.from(items);
  if (options.length === 0) return null;

  if (key === 'Home') return options[0];
  if (key === 'End') return options.at(-1);

  const index = options.indexOf(current);
  if (key === 'ArrowDown') return options[index < 0 ? 0 : (index + 1) % options.length];
  if (key === 'ArrowUp') return options[index < 0 ? options.length - 1 : (index - 1 + options.length) % options.length];
  return null;
}
