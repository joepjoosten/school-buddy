import { useEffect } from "react"

/**
 * Atom values are cached, so a page switch would show whatever was fetched
 * earlier — stale after the buddy changed something. Refetch whenever the
 * page becomes visible again: on mount (i.e. when the route is entered),
 * when the tab is shown, and when the window regains focus.
 */
export const useFreshData = (refresh: () => void, active = true): void => {
  useEffect(() => {
    if (!active) return
    refresh()
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", refresh)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", refresh)
    }
    // `refresh` is per atom, so this also refetches after week navigation
  }, [active, refresh])
}
