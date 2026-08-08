import { useMemo, useState, type ChangeEvent } from 'react'
import { api } from '../api/client'
import type { ProjectDocument } from '../types'
import { formatBytes } from './DocumentUpload'
import './product-workflow.css'

interface ProposalWorkspaceProps {
  projectId: string
  documents: ProjectDocument[]
  isAnonymous: boolean
  onDocumentsChanged: () => void
  onContinue?: () => void
}

export function ProposalWorkspace({
  projectId,
  documents,
  isAnonymous,
  onDocumentsChanged,
  onContinue,
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
  }

  const upload = async () => {
    if (!files.length || !volumeName.trim() || (isAnonymous && !acknowledged)) return
    setIsUploading(true)
    setError(null)
    setMessage(null)
    try {
      const uploaded = await api.uploadDocuments(projectId, files, {
        classification: 'PROPOSAL_VOLUME',
        volume_name: volumeName.trim(),
        classification_notes: 'Uploaded through the proposal-response workflow.',
      })
      setFiles([])
      setVolumeName('')
      setAcknowledged(false)
      setMessage(`${uploaded.length} proposal ${uploaded.length === 1 ? 'file is' : 'files are'} ready for crosswalk analysis.`)
      onDocumentsChanged()
      onContinue?.()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload proposal files.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="product-panel" aria-labelledby="proposal-workspace-title">
      <header className="product-panel__header">
        <div>
          <span className="product-eyebrow">Proposal evidence</span>
          <h2 id="proposal-workspace-title">Upload proposal response</h2>
          <p>Keep proposal volumes separate from the solicitation package so response evidence can be cited accurately.</p>
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
            Proposal volume or upload group name <span aria-hidden="true">*</span>
            <input
              value={volumeName}
              onChange={(event) => setVolumeName(event.target.value)}
              placeholder="Example: Volume II - Technical"
              required
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
            disabled={!files.length || !volumeName.trim() || isUploading || (isAnonymous && !acknowledged)}
            onClick={() => void upload()}
          >
            {isUploading ? 'Uploading and classifying…' : 'Upload proposal response'}
          </button>
        </div>

        <section className="proposal-volumes" aria-labelledby="proposal-volumes-title">
          <h3 id="proposal-volumes-title">Proposal volumes</h3>
          {proposalDocuments.length === 0 ? (
            <div className="product-empty">
              <strong>No proposal response uploaded</strong>
              <p>Add synthetic proposal volumes to enable the requirement crosswalk.</p>
            </div>
          ) : (
            <ul>
              {proposalDocuments.map((document) => (
                <li key={document.id}>
                  <div>
                    <strong>{document.volume_name || document.name}</strong>
                    <span>{document.name}</span>
                  </div>
                  <div>
                    <span>{formatBytes(document.size_bytes)}</span>
                    <span className={`document-state document-state--${document.status.toLowerCase()}`}>{document.status.replaceAll('_', ' ')}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}
