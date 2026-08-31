/**
 * Publishes the on-screen keyboard's height as `--kb`.
 *
 * iOS shrinks the *visual* viewport when the keyboard opens but leaves the
 * layout viewport alone. A field near the bottom of a full-height screen
 * therefore ends up behind the keyboard with nothing underneath it to scroll
 * to, and Safari's scroll-the-focused-field-into-view has nowhere to go.
 * Reserving the inset as padding on the scrolling screen gives it somewhere.
 *
 * The consumers are the `padding-bottom` rules on `.race-screen`,
 * `#home-screen` and `#menu-screen`. `fitCanvas` deliberately does NOT read
 * this: the game has no text inputs, and a board that resized itself when a
 * keyboard appeared would be a bug rather than a feature.
 */
export function trackKeyboardInset(): void {
  const vv = window.visualViewport;
  // Every browser this targets has it; the guard is for headless imports in
  // tools/, which have no window at all.
  if (!vv) return;

  const sync = (): void => {
    // offsetTop matters: when the page is scrolled under the keyboard the
    // visual viewport moves down as well as shrinking, and ignoring it
    // over-reports the inset by exactly that offset.
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(inset)}px`);
  };

  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}
