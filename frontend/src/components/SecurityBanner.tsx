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
        <details>
          <summary>
            <span className="security-banner__icon" aria-hidden="true">!</span>
            <span className="security-banner__summary">
              <strong>Public demo: anyone can view or change data</strong>
              <small>Synthetic PUBLIC data only</small>
            </span>
            <span className="security-banner__mode">ANONYMOUS</span>
            <span className="security-banner__expand">Details <span aria-hidden="true">⌄</span></span>
          </summary>
          <div className="security-banner__details">
            <p>
              Projects and uploads are retained on shared storage. There is no private workspace,
              user identity, authorization, or audit assurance.
            </p>
            <p>
              Never enter real RFPs, proposals, CUI, ITAR-controlled, classified, proprietary,
              source-selection, customer, or credential information.
            </p>
          </div>
        </details>
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
      <details>
        <summary>
          <span className="security-banner__icon" aria-hidden="true">◆</span>
          <span className="security-banner__summary">
            <strong>PUBLIC-data boundary</strong>
            <small>Synthetic or approved non-sensitive data only</small>
          </span>
          <span className="security-banner__mode">{modeLabel}</span>
          <span className="security-banner__expand">Details <span aria-hidden="true">⌄</span></span>
        </summary>
        <div className="security-banner__details">
          <p>
            Do not import CUI, ITAR-controlled, classified, source-selection, proprietary proposal,
            customer, or credential information.
          </p>
        </div>
      </details>
    </aside>
  )
}
