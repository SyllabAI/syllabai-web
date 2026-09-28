/**
 * Document-focus routes — the paper PDF (or the interactive player) IS the
 * screen there. Global and course chrome stand down on them:
 *   - CourseShell collapses the sidebar to the 44px rail;
 *   - AppShell omits the site footer (it would sit just below the
 *     viewport-filling panes and create a pointless page scroll);
 *   - the viewer route itself renders no breadcrumbs / h1 hero.
 */
export function isDocumentFocusRoute(pathname: string): boolean {
  return (
    /\/past-papers\/view\//.test(pathname) || /\/past-papers\/[^/]+$/.test(pathname)
  );
}

/**
 * Immersive routes — full-height app surfaces that manage their own layout
 * chrome (the tutor workspace is header + conversation rail + stream +
 * composer, sized exactly to the viewport). On these routes AppShell omits
 * the site footer and the centred content column.
 */
export function isImmersiveRoute(pathname: string): boolean {
  return pathname.startsWith("/tutor") || isDocumentFocusRoute(pathname);
}
