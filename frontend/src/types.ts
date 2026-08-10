export type Sensitivity = 'PUBLIC' | 'CUI' | 'ITAR'

export interface Project {
  id: string
  name: string
  solicitation_number?: string | null
  agency?: string | null
  due_at?: string | null
  due_timezone?: string | null
  sensitivity: Sensitivity
  created_at: string
  updated_at: string
}

export interface ProjectCreate {
  name: string
  solicitation_number?: string
  agency?: string
  due_at?: string
  due_timezone?: string
  sensitivity: Sensitivity
}

export interface ProjectUpdate {
  name?: string
  solicitation_number?: string | null
  agency?: string | null
  due_at?: string | null
  due_timezone?: string | null
}

export type SolicitationDetailFieldKey =
  | 'title'
  | 'solicitation_number'
  | 'agency'
  | 'due_at'
  | 'naics_code'
  | 'psc_code'
  | 'set_aside'
  | 'contract_type'
  | 'points_of_contact'

export type SolicitationDetailStatus = 'NOT_FOUND' | 'DETECTED' | 'CONFLICT' | 'NEEDS_INPUT'
export type SolicitationDetailConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface SolicitationDetailCandidate {
  id: string
  field_key: SolicitationDetailFieldKey
  value: string
  normalized_value: Record<string, unknown>
  document_id: string
  document_name: string
  document_classification: DocumentClassification
  is_amendment: boolean
  amendment_number: number | null
  explicit_change: boolean
  source_start: number
  source_end: number
  source_locator: string
  page_number: number | null
  excerpt: string
  confidence: number
  confidence_level: SolicitationDetailConfidence
  detection_rationale: string
  detection_pattern: string
  applicable: boolean
  needs_input: string | null
  document_sha256: string
}

export interface SolicitationDetailField {
  field_key: SolicitationDetailFieldKey
  label: string
  repeatable: boolean
  status: SolicitationDetailStatus
  conflict: boolean
  recommended_candidate_id: string | null
  recommended_candidate_ids: string[]
  candidates: SolicitationDetailCandidate[]
}

export interface SolicitationProfile {
  project_id: string
  issuing_office: string | null
  naics_code: string | null
  psc_code: string | null
  set_aside: string | null
  contract_type: string | null
  points_of_contact: Array<Record<string, unknown>>
  updated_at: string
}

export interface SolicitationDetailDecision {
  id: string
  project_id: string
  run_id: string
  candidate_id: string
  field_key: SolicitationDetailFieldKey
  reviewer: string
  previous_value: unknown
  applied_value: unknown
  applied_at: string
}

export interface SolicitationDetailsAnalysis {
  project_id: string
  run_id: string
  analyzed_at: string
  input_fingerprint: string
  rule_version: string
  stale: boolean
  project_updated_at: string
  profile_updated_at: string
  profile: SolicitationProfile
  fields: SolicitationDetailField[]
  decisions: SolicitationDetailDecision[]
}

export interface SolicitationDetailApproval {
  field_key: SolicitationDetailFieldKey
  candidate_ids: string[]
}

export interface SolicitationDetailsApplyRequest {
  reviewer: string
  expected_project_updated_at: string
  expected_profile_updated_at: string
  run_id: string
  approvals: SolicitationDetailApproval[]
}

export interface SolicitationDetailsApplyResponse {
  project: Project
  profile: SolicitationProfile
  applied_fields: SolicitationDetailFieldKey[]
  decisions: SolicitationDetailDecision[]
  analysis: SolicitationDetailsAnalysis
}

export type WorkflowStage =
  | 'PROJECT_SETUP'
  | 'SOLICITATION_FILES'
  | 'VERIFY_PACKAGE'
  | 'REQUIREMENTS'
  | 'PROPOSAL_RESPONSE'
  | 'CROSSWALK'
  | 'REPORTS'

export type WorkflowStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETE'

export interface ProjectWorkflow {
  project_id: string
  stage: WorkflowStage
  status: WorkflowStatus
  blocker_summary?: string | null
  updated_at: string
}

export type DocumentClassification =
  | 'UNCLASSIFIED'
  | 'BASE_SOLICITATION'
  | 'AMENDMENT'
  | 'ATTACHMENT'
  | 'CDRL'
  | 'Q_AND_A'
  | 'REFERENCE'
  | 'PROPOSAL_VOLUME'

export interface ProjectDocument {
  id: string
  name: string
  relative_path?: string | null
  content_type?: string | null
  size_bytes: number
  sha256: string
  status: string
  extraction_count?: number | null
  source_archive?: string | null
  duplicate_of?: string | null
  error?: string | null
  created_at?: string | null
  classification?: DocumentClassification | null
  volume_name?: string | null
  classification_notes?: string | null
}

export interface DocumentProfileUpdate {
  classification: DocumentClassification
  volume_name?: string | null
  classification_notes?: string | null
}

export interface DocumentText {
  document_id: string
  name: string
  total_characters: number
  start: number
  end: number
  text: string
  truncated: boolean
}

export type HealthState = 'checking' | 'online' | 'offline'
export type AccessMode = 'local' | 'authenticated' | 'anonymous'

export interface HealthResponse {
  status: string
  host?: string
  telemetry?: boolean
  access_mode?: AccessMode
}

export type UploadState = 'idle' | 'uploading' | 'success' | 'error'

export type SolicitationSection =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'UNKNOWN'

export type RequirementCategory =
  | 'GENERAL'
  | 'SUBMISSION_INSTRUCTION'
  | 'EVALUATION_FACTOR'
  | 'CDRL'
  | 'CLAUSE'
  | 'DELIVERABLE'
  | 'SCHEDULE'
  | 'STAFFING'
  | 'SECURITY'
  | 'DATA_RIGHTS'
  | 'PRICING'
  | 'REPRESENTATION'

export type ValidationStatus = 'PENDING' | 'VALIDATED' | 'DISMISSED'
export type ObligationOwner = 'OFFEROR' | 'CONTRACTOR' | 'SUBCONTRACTOR' | 'GOVERNMENT' | 'INFORMATIONAL'
export type Applicability = 'SOLICITATION' | 'PROPOSAL' | 'POST_AWARD' | 'INFORMATIONAL'

export interface Requirement {
  id: string
  document_id: string
  document_name?: string | null
  requirement_text: string
  source_text: string
  source_locator: string
  source_start?: number | null
  source_end?: number | null
  section: SolicitationSection
  category: RequirementCategory
  mandatory_term?: string | null
  obligation_owner: ObligationOwner
  applicability: Applicability
  confidence: number
  extraction_method: string
  rule_version: string
  validation_status: ValidationStatus
  reviewer?: string | null
  review_note?: string | null
  dismissal_reason?: string | null
  created_at: string
  updated_at: string
}

export interface RequirementUpdate {
  requirement_text: string
  section: SolicitationSection
  category: RequirementCategory
  obligation_owner: ObligationOwner
  applicability: Applicability
  validation_status: ValidationStatus
  reviewer: string
  review_note?: string | null
  expected_updated_at: string
}

export interface ReviewDecision {
  id: string
  project_id?: string
  requirement_id: string
  action?: string | null
  previous_state?: Record<string, unknown> | null
  new_state?: Record<string, unknown> | null
  note?: string | null
  validation_status?: ValidationStatus | null
  previous_status?: ValidationStatus | null
  new_status?: ValidationStatus | null
  reviewer?: string | null
  review_note?: string | null
  dismissal_reason?: string | null
  changes?: Record<string, unknown> | null
  created_at: string
}

export interface ExtractionSummary {
  documents_analyzed: number
  requirements_created: number
  requirements_reused: number
  cdrls_created: number
  cdrls_reused: number
  total_requirements: number
  pending_requirements: number
}

export interface CDRL {
  id: string
  document_id: string
  document_name?: string | null
  requirement_id?: string | null
  linked_requirement_id?: string | null
  source_text: string
  source_locator: string
  completeness?: number | boolean | string | null
  incomplete?: boolean | null
  incomplete_fields?: string[] | null
  source_truncated?: boolean | null
  validation_status?: ValidationStatus | null
  reviewer?: string | null
  reviewed_at?: string | null
  extraction_method?: string | null
  rule_version?: string | null
  item_number?: string | null
  data_item_number?: string | null
  title?: string | null
  data_item_title?: string | null
  did_number?: string | null
  data_acquisition_document?: string | null
  frequency?: string | null
  first_submission?: string | null
  first_submission_date?: string | null
  subsequent_submission?: string | null
  subsequent_submission_date?: string | null
  remarks?: string | null
  block_a?: string | null
  block_b?: string | null
  block_c?: string | null
  block_d?: string | null
  block_e?: string | null
  block_f?: string | null
  block_1?: string | null
  block_2?: string | null
  block_3?: string | null
  block_4?: string | null
  block_5?: string | null
  block_6?: string | null
  block_7?: string | null
  block_8?: string | null
  block_9?: string | null
  block_10?: string | null
  block_11?: string | null
  block_12?: string | null
  block_13?: string | null
  block_14?: string | null
  block_15?: string | null
  block_16?: string | null
  block_17?: string | null
  block_18?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type CDRLAdjudicationStatus = 'PENDING' | 'REVIEWED' | 'WAIVED'

export interface CDRLAdjudication {
  cdrl_id: string
  project_id: string
  status: CDRLAdjudicationStatus
  reviewer?: string | null
  waiver_reason?: string | null
  reviewed_at?: string | null
  updated_at?: string | null
  source_fingerprint?: string | null
  fresh: boolean
  context_only: boolean
  incomplete: boolean
  missing_fields: string[]
  effective_ready: boolean
}

export interface CDRLAdjudicationUpdate {
  status: CDRLAdjudicationStatus
  reviewer?: string | null
  waiver_reason?: string | null
  expected_updated_at?: string | null
}

export type IntakeVerificationStatus = 'PENDING' | 'VERIFIED' | 'ISSUE' | 'NOT_APPLICABLE'

export interface IntakeVerification {
  id: string
  project_id: string
  document_id?: string | null
  check_key: string
  label: string
  status: IntakeVerificationStatus
  reviewer?: string | null
  note?: string | null
  created_at: string
  updated_at: string
}

export interface IntakeVerificationCreate {
  document_id?: string | null
  check_key: string
  label: string
  status?: IntakeVerificationStatus
  reviewer?: string | null
  note?: string | null
}

export interface IntakeVerificationUpdate {
  label?: string
  status?: IntakeVerificationStatus
  reviewer?: string | null
  note?: string | null
}

export type ActionStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'

export interface ProjectAction {
  id: string
  project_id: string
  title: string
  description?: string | null
  owner?: string | null
  due_at?: string | null
  status: ActionStatus
  finding_id?: string | null
  requirement_id?: string | null
  created_at: string
  updated_at: string
}

export interface ProjectActionCreate {
  title: string
  description?: string | null
  owner?: string | null
  due_at?: string | null
  status?: ActionStatus
  finding_id?: string | null
  requirement_id?: string | null
}

export interface ProjectActionUpdate {
  title?: string
  description?: string | null
  owner?: string | null
  due_at?: string | null
  status?: ActionStatus
}

export type CrosswalkStatus = 'COVERED' | 'PARTIAL' | 'MISSING' | 'CONFLICT' | 'N_A'

export interface CrosswalkEvidence {
  id: string
  finding_id: string
  document_id: string
  document_name?: string | null
  source_locator: string
  excerpt: string
  source_start?: number | null
  source_end?: number | null
  score?: number | null
  is_manual?: boolean
  created_at?: string | null
}

export interface CrosswalkEvidenceCreate {
  document_id: string
  source_start: number
  source_end: number
}

export interface CrosswalkFinding {
  id: string
  project_id: string
  requirement_id: string
  requirement_text: string
  requirement_section: SolicitationSection
  candidate_status: CrosswalkStatus
  status: CrosswalkStatus
  score: number
  evidence: CrosswalkEvidence[]
  human_verified: boolean
  reviewer?: string | null
  owner?: string | null
  due_at?: string | null
  notes?: string | null
  stale: boolean
  needs_attention?: boolean
  attention_reasons?: string[]
  reviewed_at?: string | null
  generated_at: string
  updated_at: string
}

export interface CrosswalkUpdate {
  status?: CrosswalkStatus
  human_verified?: boolean
  reviewer?: string | null
  owner?: string | null
  due_at?: string | null
  notes?: string | null
  expected_updated_at?: string
}

export interface CrosswalkGenerationSummary {
  requirements_analyzed: number
  proposal_documents_analyzed: number
  findings_created: number
  findings_updated: number
  verified_findings_marked_stale: number
}

export interface ReadinessSummary {
  project_id: string
  ready: boolean
  readiness_percent: number
  workflow_stage: WorkflowStage
  workflow_status: WorkflowStatus
  documents_total: number
  documents_classified: number
  proposal_documents: number
  intake_total: number
  intake_verified: number
  intake_issues: number
  requirements_total: number
  requirements_validated: number
  requirements_pending: number
  cdrls_total: number
  cdrls_ready: number
  cdrls_incomplete: number
  cdrls_unreviewed: number
  cdrls_waived: number
  cdrls_stale: number
  crosswalk_total: number
  crosswalk_verified: number
  covered: number
  partial: number
  missing: number
  conflict: number
  n_a: number
  unverified: number
  actions_open: number
  actions_blocked: number
  blocking_reasons: string[]
  next_action?: string | null
  stages: Array<{
    stage: WorkflowStage
    label: string
    status: WorkflowStatus
    completed_items: number
    total_items: number
    blocking_reasons: string[]
    next_action?: string | null
  }>
}

export type ProjectView =
  | 'setup'
  | 'documents'
  | 'verify-package'
  | 'requirements'
  | 'section-l'
  | 'section-m'
  | 'cdrls'
  | 'proposal-response'
  | 'crosswalk'
  | 'reports'
