export function SecurityBanner() {
  return (
    <aside className="security-banner" aria-label="Local security notice">
      <span className="security-banner__icon" aria-hidden="true">◆</span>
      <div>
        <strong>Local processing boundary</strong>
        <span>
          Documents stay on this workstation. Do not import classified material.
        </span>
      </div>
      <span className="security-banner__mode">NO TELEMETRY</span>
    </aside>
  )
}
