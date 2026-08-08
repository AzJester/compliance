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
}

export type HealthState = 'checking' | 'online' | 'offline'
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

export type ProjectView = 'documents' | 'requirements' | 'section-l' | 'section-m' | 'cdrls'
