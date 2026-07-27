/** Shimmering placeholder bar -- panels compose these into a rough outline
 * of their real layout (see globals.css .skeleton for the shimmer keyframe)
 * so the first paint after navigating already looks like "Лиды" or "Юниты"
 * instead of a generic spinner, and there's no layout jump once real data
 * replaces it. */
export function Skeleton({
  width = "100%", height = 14, radius = 8, style,
}: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />;
}
