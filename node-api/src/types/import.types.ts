export type BatchStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ImportBatchRecord {
  id: string;
  uploaded_by: string | null;
  file_name: string;
  total_rows: number;
  processed_rows: number;
  successful_rows: number;
  failed_rows: number;
  status: BatchStatus;
  error_summary: {
    totalErrors?: number;
    errors?: BatchRowError[];
    message?: string;
  };
  storage_key: string | null;
  checksum_sha256: string | null;
  file_size_bytes: number;
  created_at: Date;
  completed_at: Date | null;
}

export interface BatchRowError {
  row: number;
  email?: string;
  field?: string;
  errors: string[];
}

export interface CSVRowCandidate {
  full_name: string;
  email: string;
  phone?: string | null;
  location?: string | null;
  current_job_title?: string | null;
}

export interface BatchPreviewResult {
  batchId: string;
  fileName: string;
  fileSizeBytes: number;
  checksumSha256: string;
  detectedHeaders: string[];
  totalRows: number;
  sampleRows: CSVRowCandidate[];
}

export interface BatchExecutionResult {
  batchId: string;
  status: BatchStatus;
  totalRows: number;
  processedRows: number;
  successfulRows: number;
  failedRows: number;
  errors: BatchRowError[];
  completedAt: Date;
}

export type PreviewRowStatus = 'NEW' | 'INVALID' | 'DUPLICATE_IN_DATABASE' | 'DUPLICATE_IN_CSV';

export interface PreviewRowDetail {
  rowNumber: number;
  status: PreviewRowStatus;
  issues: string[];
  data: {
    fullName: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    currentJobTitle: string | null;
  };
  duplicateInfo?: {
    candidateId?: string;
    existingStatus?: string;
    matchedEmail?: string;
    firstSeenRow?: number;
  };
}

export interface CsvPreviewResult {
  importId?: string;
  batchId?: string;
  confirmationToken?: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  newCandidates: number;
  existingDatabaseDuplicates: number;
  duplicateRowsWithinCsv: number;
  skippedRows: number;
  rows: PreviewRowDetail[];
  meta?: {
    fileName?: string;
    fileSizeBytes?: number;
    detectedHeaders?: string[];
  };
}

export interface PreviewCsvOptions {
  file?: Express.Multer.File;
  batchId?: string;
  csvContent?: string;
}

export interface RowImportOutcome {
  rowNumber: number;
  status: 'INSERTED' | 'SKIPPED_INVALID' | 'SKIPPED_DATABASE_DUPLICATE' | 'SKIPPED_CSV_DUPLICATE';
  email?: string | null;
  fullName?: string | null;
  candidateId?: string | null;
  reason?: string;
}

export interface ImportConfirmationResult {
  importId: string;
  status: 'completed';
  totalRows: number;
  insertedCount: number;
  skippedInvalidCount: number;
  skippedDatabaseDuplicateCount: number;
  skippedCsvDuplicateCount: number;
  failedCount: number;
  completedAt: Date | string;
  rowOutcomes: RowImportOutcome[];
}

export interface ConfirmImportDTO {
  confirm: boolean;
}
