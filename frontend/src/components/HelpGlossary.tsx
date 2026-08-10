import { useEffect, useId, useRef } from 'react'

interface HelpGlossaryProps {
  isOpen: boolean
  onClose: () => void
}

export function HelpGlossary({ isOpen, onClose }: HelpGlossaryProps) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0)
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="help-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="help-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div>
            <div className="section-kicker">Workspace guide</div>
            <h2 id={titleId}>Help and glossary</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" aria-label="Close help" onClick={onClose}>×</button>
        </header>
        <section>
          <h3>How the analysis works</h3>
          <ol className="help-steps">
            <li>Upload the solicitation documents. The app processes them and extracts the requirements.</li>
            <li>Review the complete requirements inventory. Correct or exclude only the exceptions.</li>
            <li>Upload the proposal. The app assesses every active requirement and highlights partial, missing, or conflicting coverage.</li>
          </ol>
        </section>
        <section>
          <h3>Plain-language glossary</h3>
          <dl className="glossary-list">
            <div><dt>Extracted requirement</dt><dd>An obligation detected in the solicitation and included in proposal analysis unless explicitly excluded.</dd></div>
            <div><dt>Source excerpt</dt><dd>The exact solicitation text used to support a requirement.</dd></div>
            <div><dt>Section L</dt><dd>Instructions that tell the offeror what to submit and how to format it.</dd></div>
            <div><dt>Section M</dt><dd>The factors the government says it will use to evaluate proposals.</dd></div>
            <div><dt>CDRL</dt><dd>A Contract Data Requirements List item, usually represented on DD Form 1423.</dd></div>
            <div><dt>Coverage finding</dt><dd>An automated comparison between a requirement and cited proposal evidence. Review is optional unless you override the result.</dd></div>
          </dl>
        </section>
        <section className="help-boundary">
          <strong>Public demonstration boundary</strong>
          <p>Anyone can view or change this workspace. Never enter real RFPs, proposals, CUI, ITAR-controlled, classified, proprietary, or source-selection information.</p>
        </section>
      </aside>
    </div>
  )
}
