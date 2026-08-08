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
