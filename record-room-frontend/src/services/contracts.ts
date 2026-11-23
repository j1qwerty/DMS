/**
 * Service contracts.
 *
 * These interfaces are the frontend's view of the .NET 10 API in `dotnet-api/`.
 * Two implementations satisfy them: the in-memory adapter under `./impl/` and
 * the HTTP adapter under `./http/`. Which one is live is chosen by
 * `VITE_API_MODE`; see `./index.ts`.
 *
 * Every method is async. The contract used to be synchronous, which an HTTP
 * adapter cannot honestly satisfy: a read has to cross the network, and the API
 * owns paging, filtering and sorting. Returning a cached snapshot instead would
 * mean the UI silently showed stale rows while claiming to be filtered.
 */

import type { FeatureKey, Features } from '../lib/features';
import type { Permission, RolePermissionMatrix } from './permissions-matrix';
import type {
  AppUser,
  Area,
  AuditAction,
  AuditEntry,
  BarcodeJob,
  BarcodePayload,
  BarcodeSubject,
  BulkImportJob,
  CustodyEvent,
  DashboardStats,
  Department,
  DocumentDerivative,
  DocumentOcrStatus,
  DocumentVersionPage,
  Employee,
  FileCreateInput,
  FileScan,
  FileStatus,
  FileType,
  IssueRecord,
  LoginHistoryEntry,
  MapUpload,
  MovementEvent,
  MovementKind,
  RecordFile,
  RecordFileDocument,
  RecordKind,
  ReportDefinition,
  ReportKey,
  Role,
  Room,
  ScanResult,
  Section,
  Shelf,
  StorageStatus,
  StorageUnit,
  TimelineEvent,
} from '../types';
import type {
  InquiryPayload,
  InquiryRecord,
  MediaLinkPayload,
  MediaLinkRecord,
} from './impl/inquiries';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: string, field?: string): Result<T> => ({
  ok: false,
  error,
  field,
});

export interface Page<T> {
  items: T[];
  /** Rows matching the current filter. */
  total: number;
  page: number;
  pageSize: number;
  /**
   * Size of the underlying collection, not just the loaded page.
   *
   * Present when the API reports it. The in-memory adapter has the whole
   * dataset, so it has nothing useful to add and leaves this undefined.
   */
  collectionTotal?: number;
}

export interface FieldIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

// ------------------------------------------------------------------ auth api

export interface OtpChallenge {
  id: string;
  otp: string;
  expiresAt: string;
}

export interface LoginResult {
  user: AppUser;
  /** Demo-only: the generated OTP, surfaced so the mock flow can complete. */
  challenge?: OtpChallenge;
}

export interface AuthApi {
  signIn(userName: string, password: string): Promise<Result<AppUser>>;
  requestOtp(userName: string): Promise<Result<OtpChallenge>>;
  signInWithOtp(userName: string, otp: string): Promise<Result<AppUser>>;
  signInWithPin(userName: string, pin: string): Promise<Result<AppUser>>;
  requestRecovery(userName: string): Promise<Result<{ otp: string }>>;
  recoverPassword(userName: string, otp: string, password: string): Promise<Result<AppUser>>;
  signOut(): Promise<void>;
  /**
   * The signed-in user held by the client session.
   *
   * Synchronous by design: it answers "who am I rendering as", not "what is the
   * server's view". The authoritative answer is `GET /api/auth/me`.
   */
  currentUser(): AppUser | null;
  setCurrentUser(user: AppUser | null): void;
  demoPassword: string;
}

// --------------------------------------------------------------- location api

export interface SectionInput {
  name: string;
  status?: StorageStatus;
}

export interface AlmirahInput {
  code: string;
  name: string;
  type?: StorageUnit['type'];
  barcode?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ShelfInput {
  code: string;
  name: string;
  barcode: string;
  capacity?: number;
  status?: StorageStatus;
}

export interface RoomInput {
  name: string;
  building: string;
  floor: string;
  status?: Room['status'];
  /** Shelf-space the room is planned for; defaults to 100. */
  capacity?: number;
}

export interface LocationsApi {
  listRooms(): Promise<Room[]>;
  addRoom(input: RoomInput): Promise<Result<Room>>;
  updateRoom(roomId: string, input: Partial<RoomInput>): Promise<Result<Room>>;
  /** Refused while the room still holds sections, almirahs or files. */
  deleteRoom(roomId: string): Promise<Result<true>>;
  room(id: string): Promise<Room | null>;
  sectionsOf(roomId: string): Promise<Section[]>;
  unitsOf(sectionId: string): Promise<StorageUnit[]>;
  shelvesOf(almirahId: string): Promise<Shelf[]>;
  findShelf(id: string): Promise<Shelf | null>;
  findShelfByBarcode(barcode: string): Promise<Shelf | null>;
  addSection(roomId: string, input: SectionInput): Promise<Result<Section>>;
  updateSection(sectionId: string, input: Partial<SectionInput>): Promise<Result<Section>>;
  deleteSection(sectionId: string): Promise<Result<true>>;
  addAlmirah(sectionId: string, input: AlmirahInput): Promise<Result<StorageUnit>>;
  updateAlmirah(almirahId: string, input: Partial<AlmirahInput>): Promise<Result<StorageUnit>>;
  deleteAlmirah(almirahId: string): Promise<Result<true>>;
  addShelf(almirahId: string, input: ShelfInput): Promise<Result<Shelf>>;
  updateShelf(shelfId: string, input: Partial<ShelfInput>): Promise<Result<Shelf>>;
  deleteShelf(shelfId: string): Promise<Result<true>>;
  setUnitStatus(almirahId: string, status: StorageStatus): Promise<Result<StorageUnit>>;
  /** Bumps the persisted layout revision for a room and records the change. */
  saveLayout(roomId: string, note: string): Promise<Result<{ revision: number }>>;
  layoutRevisions(
    roomId: string,
  ): Promise<Array<{ revision: number; note: string; at: string; actor: string }>>;
  occupancy(): Promise<
    Array<{
      room: Room;
      sections: Array<{ section: Section; almirahs: number; shelves: number; capacity: number }>;
    }>
  >;
  areas(): Promise<Area[]>;
}

// ------------------------------------------------------------------ files api

export interface FileQuery {
  search?: string;
  department?: string;
  status?: FileStatus | 'All';
  recordKind?: RecordKind | 'All';
  fileType?: FileType | 'All';
  eOfficeStatus?: 'All' | 'Linked' | 'Not linked';
  roomId?: string;
  sectionId?: string;
  shelfId?: string;
  area?: string;
  sort?: keyof RecordFile;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface FilesApi {
  list(query?: FileQuery): Promise<Page<RecordFile>>;
  get(id: string): Promise<RecordFile | null>;
  byBarcode(barcode: string): Promise<RecordFile | null>;
  byShelf(shelfId: string): Promise<RecordFile[]>;
  departments(): Promise<string[]>;
  validateCreate(input: FileCreateInput): Promise<FieldIssue[]>;
  create(input: FileCreateInput): Promise<Result<RecordFile>>;
  relocate(
    fileId: string,
    shelfId: string,
    position: number,
    reason: string,
  ): Promise<Result<RecordFile>>;
  updateEOfficeReference(fileId: string, reference: string): Promise<Result<RecordFile>>;
  listDocuments(fileId: string): Promise<RecordFileDocument[]>;
  uploadDocument(fileId: string, file: File): Promise<Result<RecordFileDocument>>;
  /** Destructive: removes one stored scan version. Admin-only on the API. */
  deleteDocument(fileId: string, documentId: string): Promise<Result<true>>;
  documentBlob(fileId: string, documentId: string): Promise<Blob>;
  /** Every page of one stored document version with its persisted OCR text. */
  documentPages(fileId: string, documentId: string): Promise<DocumentVersionPage[]>;
  /** Coverage of the stored text and whether the background pass still runs. */
  documentOcrStatus(fileId: string, documentId: string): Promise<DocumentOcrStatus | null>;
  /** Re-runs recognition for one page of a stored document version. */
  runDocumentPageOcr(
    fileId: string,
    documentId: string,
    pageNo: number,
  ): Promise<Result<DocumentVersionPage>>;
  /** Saves a hand correction of one stored document page's OCR text. */
  saveDocumentPageOcr(
    fileId: string,
    documentId: string,
    pageNo: number,
    text: string,
  ): Promise<Result<DocumentVersionPage>>;
  remove(fileId: string): Promise<Result<true>>;
}

// --------------------------------------------------------------- issue api

export interface IssueInput {
  borrowerType: 'Employee' | 'Depositor';
  borrowerEmployeeCode: string;
  borrowerName: string;
  department: string;
  purpose: string;
  fileIds: string[];
  dueAt: string;
  remark: string;
}

export interface IssueQuery {
  status?: IssueRecord['status'] | 'All';
  borrower?: string;
  open?: boolean;
  page?: number;
  pageSize?: number;
}

export interface BorrowerRow {
  employeeCode: string;
  name: string;
  department: string;
  openFiles: number;
  oldestDue: string;
  overdue: boolean;
}

export interface IssueApi {
  list(query?: IssueQuery): Promise<Page<IssueRecord>>;
  get(id: string): Promise<IssueRecord | null>;
  borrowers(): Promise<BorrowerRow[]>;
  /** Guards: every file must exist and be Available; no duplicates. */
  issueFiles(input: IssueInput): Promise<Result<IssueRecord>>;
  returnFiles(issueId: string, fileIds: string[], condition: string): Promise<Result<IssueRecord>>;
  overdue(): Promise<IssueRecord[]>;
  nextReceiptNumber(): Promise<string>;
}

// ------------------------------------------------------------ movement api

export interface MovementQuery {
  kind?: MovementKind | 'All';
  fileId?: string;
  search?: string;
  limit?: number;
}

export interface MovementApi {
  list(query?: MovementQuery): Promise<MovementEvent[]>;
  recent(limit?: number): Promise<MovementEvent[]>;
}

// ---------------------------------------------------------------- employee api

export interface EmployeeQuery {
  search?: string;
  department?: string;
  status?: Employee['status'] | 'All';
  page?: number;
  pageSize?: number;
}

export interface EmployeesApi {
  list(query?: EmployeeQuery): Promise<Page<Employee>>;
  get(id: string): Promise<Employee | null>;
  byCode(code: string): Promise<Employee | null>;
  create(
    input: Omit<Employee, 'id' | 'createdAt' | 'modifiedAt' | 'status'>,
  ): Promise<Result<Employee>>;
  update(id: string, input: Partial<Employee>): Promise<Result<Employee>>;
  remove(id: string): Promise<Result<true>>;
  departments(): Promise<string[]>;
}

// ---------------------------------------------------------- digitization api

/**
 * File-centric digitization (2026-10-28 decision): every file carries its own
 * scan pages — upload a full PDF (the documents API) or add page-by-page scans
 * here — and the Digitization section is the pending-review queue across
 * files. There are no employee batches.
 */
export interface ScanApi {
  /** Every scan page of one file, every status. */
  list(fileId: string): Promise<FileScan[]>;
  /** Rejects a repeated file + `pageNo`; bumps `version` on rescan. */
  add(
    fileId: string,
    input: { pageNo: number; filename: string; documentSize: string; note?: string },
  ): Promise<Result<FileScan>>;
  addDocument(scanId: string, file: File): Promise<Result<FileScan>>;
  remove(scanId: string): Promise<Result<true>>;
  review(
    scanId: string,
    decision: 'Approved' | 'Rejected',
    note: string,
  ): Promise<Result<FileScan>>;
  /** Reviews every pending page of one file at once. */
  reviewAll(
    fileId: string,
    decision: 'Approved' | 'Rejected',
    note: string,
  ): Promise<Result<number>>;
  /** The pending-review queue across all files. */
  pending(query?: { search?: string }): Promise<FileScan[]>;
  pendingReviewCount(): Promise<number>;
  /** The pending deliverable PDFs awaiting review across all files. */
  pendingPdfs(query?: { search?: string }): Promise<DocumentDerivative[]>;
  /**
   * The pending-review queue grouped per file (round 5): one row per file in the
   * Review section, with the changed page numbers instead of one row per page.
   */
  pendingByFile(query?: { search?: string }): Promise<ReviewFileGroup[]>;
  /** Approves or rejects a specific set of scan pages in one action. */
  reviewScans(
    scanIds: string[],
    decision: 'Approved' | 'Rejected',
    note?: string,
    /** Known by the review page; lets the HTTP adapter use the batch endpoint. */
    fileId?: string,
  ): Promise<Result<number>>;
  /** Stores a manual correction of one page's OCR text. */
  saveOcrText(scanId: string, text: string): Promise<Result<FileScan>>;
  /** Per-level compression estimates for one stored version (client-side probe). */
  compressionEstimate(target: CompressionTarget): Promise<Result<CompressionEstimate>>;
  /** Writes a compressed copy of a stored version as a new pending deliverable. */
  applyCompression(
    target: CompressionTarget,
    level: CompressionLevelKey,
    remarks?: string,
  ): Promise<Result<DocumentDerivative>>;
  /** Operator worklist: per-file digitization progress across the registry. */
  progress(query?: { search?: string }): Promise<FileDigitizationProgress[]>;

  // -------------------------------------------------- scan studio (§3.4)

  /** Persists the composition order: OrderIndex follows the scan-id sequence. */
  reorder(fileId: string, scanIds: string[]): Promise<Result<FileScan[]>>;
  /** Writes a rotated processed copy (quarter turns); the original is kept. */
  rotate(scanId: string, degrees: 90 | 180 | 270): Promise<Result<FileScan>>;
  /** Applies deskew / despeckle / binarize / crop / contrast as the processed copy. */
  enhance(scanId: string, operation: string): Promise<Result<FileScan>>;
  /** Drops the processed copy and serves the original again. */
  revert(scanId: string): Promise<Result<FileScan>>;
  /** Duplicates a page as its next version (insert-after semantics). */
  duplicate(scanId: string): Promise<Result<FileScan>>;
  /** Re-runs OCR (PDF text layer, else raster + tesseract hin+eng) and stores the text. */
  runOcr(scanId: string): Promise<Result<ScanOcrResult>>;
  /** The stored bytes; `processed` serves the enhanced copy when one exists. */
  scanBlob(scanId: string, variant?: 'original' | 'processed'): Promise<Blob>;
  /** Generated PDF deliverables of one file, newest first. */
  listPdfs(fileId: string): Promise<DocumentDerivative[]>;
  /** Builds the PDF from the file's approved pages, in composition order. */
  buildPdf(
    fileId: string,
    filename?: string,
    remarks?: string,
  ): Promise<Result<DocumentDerivative>>;
  /**
   * Round 4: a freshly built PDF is "Pending approval"; a reviewer signs off
   * the final composition here (approve or reject with a reason). The row —
   * and its bytes — stay in the history either way.
   */
  reviewPdf(
    derivativeId: string,
    decision: 'Approved' | 'Rejected',
    note?: string,
    fileId?: string,
  ): Promise<Result<DocumentDerivative>>;
  /** Removes one deliverable build and its bytes — destructive, confirm first. */
  removePdf(derivativeId: string, fileId?: string): Promise<Result<true>>;
  pdfBlob(derivativeId: string, fileId?: string): Promise<Blob>;
}

/** What one OCR pass produced, and how. */
export interface ScanOcrResult {
  scanId: string;
  barcode: string;
  pageNo: number;
  version: number;
  ocrText: string;
  /** "tesseract hin+eng" or "none" — what produced the text. */
  method: string;
  ranAt: string;
}

// ------------------------------------------------- review grouping (round 5)

/** How one pending page differs from what the file already had. */
export type ReviewChangeKind = 'new' | 'updated';

/** One pending page inside a review group. */
export interface ReviewPageChange {
  scan: FileScan;
  kind: ReviewChangeKind;
}

/**
 * One file's pending changes (round 5): the Review table shows one row per
 * file — the changed page numbers plus any pending deliverable builds — so a
 * five-page rescan is one reviewable unit instead of five rows.
 */
export interface ReviewFileGroup {
  fileId: string;
  fileBarcode: string;
  fileNumber?: string;
  subject: string;
  department?: string;
  pages: ReviewPageChange[];
  /** Pending deliverable PDF builds of this file. */
  pdfs: DocumentDerivative[];
  /** Newest uploadedAt / createdAt across the group. */
  lastActivityAt: string;
}

/** Operator worklist row: how far one file's digitization has progressed. */
export interface FileDigitizationProgress {
  fileId: string;
  fileBarcode: string;
  fileNumber?: string;
  subject: string;
  department?: string;
  status?: string;
  pagesTotal: number;
  pagesApproved: number;
  pagesPending: number;
  pagesRejected: number;
  deliverables: number;
  deliverablesPending: number;
  lastActivityAt: string | null;
}

// ------------------------------------------------------ pdf compression

export type CompressionLevelKey = 'light' | 'balanced' | 'strong';

/** Which stored version to compress: an uploaded document or a built deliverable. */
export interface CompressionTarget {
  fileId: string;
  source: 'document' | 'derivative';
  id: string;
}

/** One level's numbers, as shown in the compression dialog. */
export interface CompressionLevelEstimate {
  level: CompressionLevelKey;
  label: string;
  /** Estimated output size in bytes. */
  estimatedBytes: number;
  /** Fraction saved against the current size; negative when it would grow. */
  savedFraction: number;
  qualityNote: string;
  recommended: boolean;
}

/** What the probe pass reports for one stored version. */
export interface CompressionEstimate {
  currentBytes: number;
  pageCount: number;
  /** Source bytes per page; drives the recommendation. */
  bytesPerPage: number;
  levels: CompressionLevelEstimate[];
  /** True when no level can meaningfully shrink this file. */
  notWorthIt: boolean;
}

// ------------------------------------------------------------- custody chain

/**
 * The digitization custody chain (work plan §3.8): the intake register and the
 * return / handover sign-off. Rows are immutable — corrections are new events,
 * never edits — and every write is audit-logged server-side.
 */
export interface CustodyApi {
  /** The register, newest first. */
  list(query?: {
    direction?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Page<CustodyEvent>>;
  /** Records an intake ("Intake") or a return ("Return") handover. */
  record(input: {
    direction: 'Intake' | 'Return';
    department: string;
    fileCount: number;
    batchRef?: string;
    vendor?: string;
    remarks?: string;
  }): Promise<Result<CustodyEvent>>;
  /** Sets the counted file total on an intake (the reconciliation step). */
  reconcile(id: string, reconciledCount: number, remarks?: string): Promise<Result<CustodyEvent>>;
  /** Closes an event with a sign-off; closed events become read-only. */
  signOff(id: string, signedOffBy?: string): Promise<Result<CustodyEvent>>;
  /**
   * Records a return against a recorded intake — the department's own batch
   * comes back, all at once or partially (6 of 10, then 4 of 10).
   */
  returnAgainst(
    id: string,
    input: { fileCount: number; remarks?: string },
  ): Promise<Result<CustodyEvent>>;
  /** The return events recorded against one intake batch. */
  returnsFor(id: string): Promise<CustodyEvent[]>;
}

// ----------------------------------------------------------------- upload map

export interface UploadsApi {
  maps(query?: { fileBarcode?: string; search?: string }): Promise<MapUpload[]>;
  addMap(input: {
    fileBarcode: string;
    pageNo: number;
    filename: string;
    sizeKb: number;
  }): Promise<Result<MapUpload>>;
  removeMap(id: string): Promise<Result<true>>;
  uploadMapDocument(id: string, file: File): Promise<Result<MapUpload>>;
  mapBlob(id: string): Promise<Blob>;
}

// ----------------------------------------------------------------- bulk api

export interface BulkApi {
  jobs(): Promise<BulkImportJob[]>;
  /** Validates a pasted CSV against the registry without committing it. */
  validateCsv(csv: string, folder: string): Promise<Result<BulkImportJob>>;
  commit(jobId: string): Promise<Result<BulkImportJob>>;
  job(id: string): Promise<BulkImportJob | null>;
}

// ----------------------------------------------------------------- audit api

export interface AuditQuery {
  action?: AuditAction | 'All';
  actor?: string;
  entity?: string;
  /**
   * Round-4 grouping: documents / digitization / logins / issues (the last two
   * were one "logins-issues" tab in round 3 and are separate tabs now).
   */
  group?: 'documents' | 'digitization' | 'logins-issues' | 'logins' | 'issues';
  search?: string;
  limit?: number;
}

export interface AuditApi {
  list(query?: AuditQuery): Promise<AuditEntry[]>;
  loginHistory(query?: {
    outcome?: LoginHistoryEntry['outcome'] | 'All';
    search?: string;
  }): Promise<LoginHistoryEntry[]>;
  actors(): Promise<string[]>;
  /** Who opened which record, when — its own permission (audit.fileViews). */
  fileViews(query?: { search?: string; limit?: number }): Promise<AuditEntry[]>;
}

// ------------------------------------------------------------ departments api

/** The managed department list (round 3): names and codes picked from on forms. */
export interface DepartmentsApi {
  list(): Promise<Department[]>;
  create(input: { name: string; code: string; remarks?: string }): Promise<Result<Department>>;
  update(
    id: string,
    input: { name: string; code: string; remarks?: string },
  ): Promise<Result<Department>>;
  remove(id: string): Promise<Result<true>>;
}

// ---------------------------------------------------------------- report api

export interface ReportResult {
  definition: ReportDefinition;
  columns: string[];
  rows: Array<Array<string | number>>;
  generatedAt: string;
}

export interface ReportsApi {
  definitions(): Promise<ReportDefinition[]>;
  build(key: ReportKey): Promise<ReportResult>;
}

// -------------------------------------------------------------- barcode api

export interface BarcodeApi {
  subjects(): Promise<BarcodeSubject[]>;
  payloadFor(subject: BarcodeSubject, id: string): Promise<BarcodePayload | null>;
  validate(raw: string): Promise<ScanResult>;
  jobs(): Promise<BarcodeJob[]>;
  createJob(input: {
    subject: BarcodeSubject;
    targetId: string;
    quantity: number;
  }): Promise<Result<BarcodeJob>>;
  cancelJob(id: string): Promise<Result<true>>;
}

// ------------------------------------------------------------- dashboard api

export interface DashboardApi {
  stats(): Promise<DashboardStats>;
  activity(limit?: number): Promise<TimelineEvent[]>;
}

// ---------------------------------------------------------------- users api

export interface UsersApi {
  list(): Promise<AppUser[]>;
  /**
   * Creating a login needs an initial password. It is write-only and never
   * returned, so it is not part of `AppUser`.
   */
  create(
    input: Omit<AppUser, 'id' | 'lastLoginAt'> & { password: string },
  ): Promise<Result<AppUser>>;
  update(id: string, input: Partial<AppUser>): Promise<Result<AppUser>>;
  remove(id: string): Promise<Result<true>>;
  roles(): Promise<Role[]>;

  // ------------------------------------------- editable matrix (§3.7)

  /** Full role → permission matrix. Absent permission means "not granted". */
  permissionsMatrix(): Promise<RolePermissionMatrix>;
  /** Single-cell grant/revoke. Admin is fixed; the last users.edit holder is protected. */
  setPermission(
    role: Role,
    permission: Permission,
    granted: boolean,
  ): Promise<Result<RolePermissionMatrix>>;
}

// ------------------------------------------------------ inquiries and media

export interface InquiriesApi {
  save(payload: InquiryPayload): Promise<Result<InquiryRecord>>;
  list(): Promise<InquiryRecord[]>;
  remove(id: string): Promise<Result<true>>;
  submittedBy(): Promise<string>;
}

export interface MediaApi {
  saveLink(payload: MediaLinkPayload): Promise<Result<MediaLinkRecord>>;
  list(): Promise<MediaLinkRecord[]>;
  remove(id: string): Promise<Result<true>>;
}

// ------------------------------------------------------------ feature config

/** OCR engine status as `GET /api/config` reports it — one honest line for the OCR screen. */
export interface OcrStatusInfo {
  enabled: boolean;
  available: boolean;
  engine: string;
  languages: string;
  note: string;
}

/**
 * Deployment facts from `GET /api/config`: what the environment decided, not
 * what the database stores. `settingsEditable: false` means the feature
 * switchboard is locked (Settings shows read-only and the API refuses writes);
 * `demoMode: true` means the registry runs on the seeded demo dataset.
 */
export interface AppConfigInfo {
  appName: string;
  features: Features;
  settingsEditable: boolean;
  demoMode: boolean;
  ocr: OcrStatusInfo;
}

/** The grouped feature switchboard (ZILA_PANCHAYAT_CC §F). */
export interface ConfigApi {
  features(): Promise<Features>;
  updateFeatures(patch: Partial<Record<FeatureKey, boolean>>): Promise<Result<Features>>;
  /** Deployment facts: demo mode, the feature-edit lock and the OCR engine status. */
  info(): Promise<AppConfigInfo>;
}

// --------------------------------------------------------------- root facade

export interface RecordRoomService {
  auth: AuthApi;
  locations: LocationsApi;
  files: FilesApi;
  issues: IssueApi;
  movements: MovementApi;
  employees: EmployeesApi;
  departments: DepartmentsApi;
  digitization: ScanApi;
  custody: CustodyApi;
  uploads: UploadsApi;
  bulk: BulkApi;
  audit: AuditApi;
  reports: ReportsApi;
  barcodes: BarcodeApi;
  dashboard: DashboardApi;
  users: UsersApi;
  inquiries: InquiriesApi;
  media: MediaApi;
  config: ConfigApi;
  /** Drops the local snapshot and reloads the seed dataset. */
  reset(): Promise<void>;
}
