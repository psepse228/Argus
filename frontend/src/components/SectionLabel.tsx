/** Small uppercase group header -- same convention WorkshopPanel already
 * used for "Непривязанные Telegram-чаты"/"В работе" etc. Pulled out here so
 * every panel breaks its content into clearly separated blocks instead of
 * one undifferentiated stack of glass-panels. */
export function SectionLabel({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div
      style={{
        fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em",
        color: accent ? "var(--v-accent)" : "var(--color-text-faint)",
        marginBottom: -6,
      }}
    >
      {children}
    </div>
  );
}
