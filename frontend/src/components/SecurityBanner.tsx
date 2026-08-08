import type { AccessMode } from '../types'

interface SecurityBannerProps {
  accessMode: AccessMode | 'unknown'
}

export function SecurityBanner({ accessMode }: SecurityBannerProps) {
  if (accessMode === 'anonymous') {
    return (
      <aside
        className="security-banner security-banner--anonymous"
        aria-label="Shared public demo warning"
      >
        <span className="security-banner__icon" aria-hidden="true">!</span>
        <div>
          <strong>Shared public demo — no private workspace</strong>
          <span>
            Anyone can view or change all projects and uploads. Use synthetic PUBLIC data only.
            Content is retained on shared storage. There is no privacy, identity, or audit assurance.
          </span>
        </div>
        <span className="security-banner__mode">ANONYMOUS ACCESS</span>
      </aside>
    )
  }

  const modeLabel = accessMode === 'local'
    ? 'LOCAL ACCESS'
    : accessMode === 'authenticated'
      ? 'SHARED SIGN-IN'
      : 'CHECKING ACCESS'

  return (
    <aside className="security-banner" aria-label="Data security notice">
      <span className="security-banner__icon" aria-hidden="true">◆</span>
      <div>
        <strong>PUBLIC-data boundary</strong>
        <span>
          Use synthetic PUBLIC data only. Do not import CUI, ITAR-controlled, classified,
          source-selection, or proprietary proposal data.
        </span>
      </div>
      <span className="security-banner__mode">{modeLabel}</span>
    </aside>
  )
}
