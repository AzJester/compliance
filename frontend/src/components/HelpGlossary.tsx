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
          <h3>How the review works</h3>
          <ol className="help-steps">
            <li>Register and verify the complete solicitation package.</li>
            <li>Extract requirement candidates and verify each one against its source.</li>
            <li>Add a synthetic proposal response and inspect suggested evidence.</li>
            <li>Resolve every crosswalk finding before generating reports.</li>
          </ol>
        </section>
        <section>
          <h3>Plain-language glossary</h3>
          <dl className="glossary-list">
            <div><dt>Requirement candidate</dt><dd>A possible obligation detected in the solicitation that still needs human review.</dd></div>
            <div><dt>Source excerpt</dt><dd>The exact solicitation text used to support a requirement.</dd></div>
            <div><dt>Section L</dt><dd>Instructions that tell the offeror what to submit and how to format it.</dd></div>
            <div><dt>Section M</dt><dd>The factors the government says it will use to evaluate proposals.</dd></div>
            <div><dt>CDRL</dt><dd>A Contract Data Requirements List item, usually represented on DD Form 1423.</dd></div>
            <div><dt>Crosswalk finding</dt><dd>A human-reviewable comparison between a requirement and proposal evidence.</dd></div>
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
