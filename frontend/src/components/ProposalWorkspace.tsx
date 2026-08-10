import { useMemo, useState, type ChangeEvent } from 'react'
import { api } from '../api/client'
import type { ProjectDocument } from '../types'
import { formatBytes } from './DocumentUpload'
import './product-workflow.css'

const searchableProposalGuidance = 'No searchable text was extracted from the uploaded proposal. Upload a searchable PDF or DOCX, or run OCR on scanned files, then try again.'

function isUsableProposalDocument(document: ProjectDocument) {
  return document.status === 'EXTRACTED' && (document.extraction_count ?? 0) > 0
}

function proposalDocumentIssue(document: ProjectDocument) {
  if (document.error) return document.error
  if (document.status === 'EXTRACTED' && (document.extraction_count ?? 0) <= 0) {
    return 'No searchable text was extracted. Upload a searchable document or run OCR before analysis.'
  }
  return null
}

interface ProposalWorkspaceProps {
  projectId: string
  documents: ProjectDocument[]
  isAnonymous: boolean
  isAnalysisBusy: boolean
  onDocumentsChanged: () => void
  onAnalysisBusyChange: (isBusy: boolean) => void
  onAnalysisComplete?: () => void
}

export function ProposalWorkspace({
  projectId,
  documents,
  isAnonymous,
  isAnalysisBusy,
  onDocumentsChanged,
  onAnalysisBusyChange,
  onAnalysisComplete,
}: ProposalWorkspaceProps) {
  const [files, setFiles] = useState<File[]>([])
  const [volumeName, setVolumeName] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const proposalDocuments = useMemo(
    () => documents.filter((document) => document.classification === 'PROPOSAL_VOLUME'),
    [documents],
  )

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(event.target.files ?? []))
    setAcknowledged(false)
    event.target.value = ''
  }

  const upload = async () => {
    if (!files.length || (isAnonymous && !acknowledged)) return
    setIsUploading(true)
    onAnalysisBusyChange(true)
    setError(null)
    setMessage(null)
    let uploaded: ProjectDocument[]
    try {
      uploaded = await api.uploadDocuments(projectId, files, {
        classification: 'PROPOSAL_VOLUME',
        volume_name: volumeName.trim() || files[0]?.name || 'Proposal response',
        classification_notes: 'Uploaded for automated proposal coverage analysis.',
      })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload the proposal files.')
      onAnalysisBusyChange(false)
      setIsUploading(false)
      return
    }

    setFiles([])
    setVolumeName('')
    setAcknowledged(false)
    onDocumentsChanged()
    const usableUploaded = uploaded.filter(isUsableProposalDocument)
    const hasUsableProposal = [...proposalDocuments, ...uploaded].some(isUsableProposalDocument)
    if (!hasUsableProposal) {
      setError(searchableProposalGuidance)
      onAnalysisComplete?.()
      onAnalysisBusyChange(false)
      setIsUploading(false)
      return
    }
    try {
      const summary = await api.generateCrosswalk(projectId)
      setMessage(`${uploaded.length} proposal ${uploaded.length === 1 ? 'file was' : 'files were'} uploaded and ${summary.requirements_analyzed.toLocaleString()} requirements were analyzed.`)
      const excludedCount = uploaded.length - usableUploaded.length
      if (excludedCount > 0) {
        setError(`${excludedCount} uploaded ${excludedCount === 1 ? 'file contained' : 'files contained'} no searchable text and ${excludedCount === 1 ? 'was' : 'were'} excluded from analysis. Upload searchable documents or run OCR before relying on those volumes.`)
      }
      onAnalysisComplete?.()
    } catch (analysisError) {
      setError(`The proposal was uploaded, but the automated assessment request failed: ${analysisError instanceof Error ? analysisError.message : 'unknown error'}. Existing results were refreshed below; use Reanalyze proposal only if no current findings appear.`)
      onAnalysisComplete?.()
    } finally {
      onAnalysisBusyChange(false)
      setIsUploading(false)
    }
  }

  return (
    <section className="product-panel" aria-labelledby="proposal-workspace-title">
      <header className="product-panel__header">
        <div>
          <span className="product-eyebrow">Proposal input</span>
          <h2 id="proposal-workspace-title">Upload and analyze the proposal</h2>
          <p>The proposal is compared automatically against every active requirement. No requirement-by-requirement approval is needed first.</p>
        </div>
        <span className="document-count-badge">{proposalDocuments.length} volume{proposalDocuments.length === 1 ? '' : 's'}</span>
      </header>

      {isAnonymous && (
        <div className="proposal-boundary" role="note">
          <strong>Synthetic PUBLIC data only.</strong>
          <span>This anonymous site is not suitable for real proposal, proprietary, customer, CUI, ITAR-controlled, or classified content.</span>
        </div>
      )}

      <div className="proposal-layout">
        <div className="proposal-upload">
          <label>
            Proposal volume or upload group name <span>(optional)</span>
            <input
              value={volumeName}
              onChange={(event) => setVolumeName(event.target.value)}
              placeholder="Example: Volume II - Technical"
            />
          </label>
          <label className="native-file-control">
            Choose proposal documents
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.xlsx,.pptx,.zip"
              onChange={chooseFiles}
            />
          </label>
          <p className="upload-limits">Hosted limits: 10 files, 20 MB each, 50 MB per request. Searchable documents work best.</p>

          {files.length > 0 && (
            <ul className="proposal-file-list" aria-live="polite">
              {files.map((file) => (
                <li key={`${file.name}:${file.lastModified}`}>
                  <span>{file.name}</span>
                  <span>{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          )}

          {isAnonymous && files.length > 0 && (
            <label className="proposal-acknowledgement">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              <span>I confirm these proposal files are synthetic PUBLIC material safe for anonymous disclosure.</span>
            </label>
          )}

          {error && <p className="product-error" role="alert">{error}</p>}
          {message && <p className="product-success" role="status">{message}</p>}
          <button
            className="button button--primary product-primary-action"
            type="button"
            disabled={!files.length || isUploading || isAnalysisBusy || (isAnonymous && !acknowledged)}
            onClick={() => void upload()}
          >
            {isUploading
              ? 'Uploading and analyzing…'
              : isAnalysisBusy
                ? 'Proposal analysis in progress…'
                : 'Upload and analyze proposal'}
          </button>
        </div>

        <section className="proposal-volumes" aria-labelledby="proposal-volumes-title">
          <h3 id="proposal-volumes-title">Proposal volumes</h3>
          {proposalDocuments.length === 0 ? (
            <div className="product-empty">
              <strong>No proposal response uploaded</strong>
              <p>Add synthetic proposal volumes to assess coverage against the solicitation requirements.</p>
            </div>
          ) : (
            <ul>
              {proposalDocuments.map((document) => {
                const issue = proposalDocumentIssue(document)
                const hasNoText = document.status === 'EXTRACTED' && (document.extraction_count ?? 0) <= 0
                const state = issue ? 'error' : document.status.toLowerCase()
                const stateLabel = hasNoText ? 'NO SEARCHABLE TEXT' : document.error ? 'ERROR' : document.status.replaceAll('_', ' ')
                return (
                  <li key={document.id}>
                    <div>
                      <strong>{document.volume_name || document.name}</strong>
                      <span>{document.name}</span>
                      {issue && <span className="row-error" role="alert">{issue}</span>}
                    </div>
                    <div>
                      <span>{formatBytes(document.size_bytes)}</span>
                      <span className={`document-state document-state--${state}`}>{stateLabel}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}
