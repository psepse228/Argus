/** Plain-SVG donut (stroke-dasharray segments around a circle) -- no chart
 * library, matching the codebase's existing no-framer-motion/no-extra-deps
 * convention (see HudPageTransition). Renders the ring plus a legend column;
 * the ring alone reads as decoration, the legend is what makes it usable
 * data. */
export function DonutChart({
  data, size = 132, thickness = 16,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0, transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-05)" strokeWidth={thickness} />
        {total > 0 && data.filter((d) => d.value > 0).map((d) => {
          const frac = d.value / total;
          const dash = frac * c;
          const el = (
            <circle
              key={d.label}
              cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset}
              strokeLinecap={data.filter((x) => x.value > 0).length > 1 ? "butt" : "round"}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: d.color, flexShrink: 0 }} />
            <span style={{ color: "var(--color-text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
            <span style={{ color: "var(--color-text)", fontWeight: 700, marginLeft: "auto", paddingLeft: 10 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
