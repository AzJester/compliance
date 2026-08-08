export function SecurityBanner() {
  return (
    <aside className="security-banner" aria-label="Local security notice">
      <span className="security-banner__icon" aria-hidden="true">◆</span>
      <div>
        <strong>Local processing boundary</strong>
        <span>
          Public prototype only. Do not import CUI, ITAR-controlled, classified,
          source-selection, or proprietary proposal data.
        </span>
      </div>
      <span className="security-banner__mode">NO TELEMETRY</span>
    </aside>
  )
}
