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
  DigitalHandoverBatch,
  DashboardStats,
  Employee,
  FileCreateInput,
  FileStatus,
  FileType,
  RecordKind,
  IssueRecord,
  LoginHistoryEntry,
  MapUpload,
  MovementEvent,
  MovementKind,
  RecordFile,
  RecordFileDocument,
  ReportDefinition,
  ReportKey,
  Role,
  Room,
  ScanResult,
  Section,
  Shelf,
  StorageStatus,
  StorageUnit,
  FileScan,
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
  /** Compose the latest approved scan version of each physical page side into a new immutable PDF. */
  generateFinalPdf(fileId: string): Promise<Result<RecordFileDocument>>;
  /** Destructive: removes one stored scan version. Admin-only on the API. */
  deleteDocument(fileId: string, documentId: string): Promise<Result<true>>;
  documentBlob(fileId: string, documentId: string): Promise<Blob>;
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
    input: { pageNo: number; filename: string; documentSize: string; side?: 'Front' | 'Back' },
  ): Promise<Result<FileScan>>;
  addDocument(scanId: string, file: File): Promise<Result<FileScan>>;
  scanBlob(scanId: string): Promise<Blob>;
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
}

/** API workflow for immutable digital deliverables and Department acceptance. */
export interface DigitalHandoverApi {
  list(): Promise<DigitalHandoverBatch[]>;
  prepare(input: {
    batchRef: string;
    department: string;
    fileIds: number[];
    notes?: string;
  }): Promise<Result<DigitalHandoverBatch>>;
  markDelivered(id: string): Promise<Result<DigitalHandoverBatch>>;
  signOff(
    id: string,
    decision: 'Accepted' | 'Rejected',
    signedOffBy: string,
    notes?: string,
  ): Promise<Result<DigitalHandoverBatch>>;
  packageBlob(id: string): Promise<Blob>;
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

// --------------------------------------------------------------- root facade

export interface RecordRoomService {
  auth: AuthApi;
  locations: LocationsApi;
  files: FilesApi;
  issues: IssueApi;
  movements: MovementApi;
  employees: EmployeesApi;
  digitization: ScanApi;
  custody: CustodyApi;
  digitalHandovers: DigitalHandoverApi;
  uploads: UploadsApi;
  bulk: BulkApi;
  audit: AuditApi;
  reports: ReportsApi;
  barcodes: BarcodeApi;
  dashboard: DashboardApi;
  users: UsersApi;
  inquiries: InquiriesApi;
  media: MediaApi;
  /** Drops the local snapshot and reloads the seed dataset. */
  reset(): Promise<void>;
}
