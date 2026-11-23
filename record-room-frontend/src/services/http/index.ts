/**
 * HTTP adapters: one object per domain, each satisfying the same contract
 * interface as the in-memory implementation under `../impl/`.
 *
 * Every method is a thin translation of a frontend call into an endpoint. No
 * business rule lives here: the guards, versioning and part-return handling all
 * belong to the API, and duplicating them in the client would let the two
 * disagree.
 */

import type {
  AuthApi,
  BarcodeApi,
  BulkApi,
  CustodyApi,
  DepartmentsApi,
  DashboardApi,
  ConfigApi,
  ScanApi,
  EmployeesApi,
  FilesApi,
  InquiriesApi,
  IssueApi,
  LocationsApi,
  MediaApi,
  MovementApi,
  ReportsApi,
  UploadsApi,
  UsersApi,
  AuditApi,
} from '../contracts';
import type { RolePermissionMatrix } from '../permissions-matrix';
import type { Features } from '../../lib/features';
import { err, ok } from '../contracts';
import { groupPendingByFile } from '../../lib/reviewGroup';
import { buildLevelEstimates, COMPRESSION_LEVELS } from '../../lib/compression-levels';
import {
  attempt,
  attemptForm,
  get,
  getBlob,
  getPlain,
  getToken,
  post,
  qs,
  send,
  setToken,
  toApiId,
  toFieldIssues,
  toId,
} from './client';
import {
  toAppUser,
  toArea,
  num,
  toCustodyEvent,
  toDepartment,
  toAuditEntry,
  toBarcodeJob,
  toBulkJob,
  toEmployee,
  toFile,
  toFileScan,
  toDerivative,
  toIssue,
  toLoginHistory,
  toMapUpload,
  toMovement,
  toPayload,
  toReportDefinition,
  toRecordFileDocument,
  toRoom,
  toScanResult,
  toStats,
  toTimeline,
} from './map';
import type {
  Area,
  BarcodeSubject,
  FileCreateInput,
  RecordFile,
  ReportDefinition,
  ReportKey,
  Room,
  Section,
  StorageUnit,
} from '../../types';
import type {
  InquiryPayload,
  InquiryRecord,
  MediaLinkPayload,
  MediaLinkRecord,
} from '../impl/inquiries';
import { session } from '../impl/session';
import { permissionsStore } from '../permissionsStore';

type Dto = Record<string, unknown>;

const list = <T>(value: unknown, map: (dto: Dto) => T): T[] =>
  Array.isArray(value) ? (value as Dto[]).map(map) : [];

// ------------------------------------------------------------------- auth

// `session` is the single source of truth for who is signed in: the route guard,
// the shell and the permission checks all read it. The adapter writes to it
// rather than keeping a second cache of its own, which is what previously let a
// sign-out clear the token while the guard still believed it was signed in.
export const httpAuthService: AuthApi = {
  async signIn(userName, password) {
    const result = await attempt<Dto>('POST', '/api/auth/login', { userName, password });
    if (!result.ok) return result;

    const data = result.value;
    setToken(str(data.token));
    const user = toAppUser(data.user as Dto);
    session.set(user);
    void httpUsersService.permissionsMatrix().catch(() => undefined);
    return ok(user);
  },

  async requestOtp(userName) {
    const result = await attempt<{ challengeId: string; expiresAt: string }>(
      'POST',
      '/api/auth/otp/request',
      { userName },
    );
    if (!result.ok) return result;

    // The API deliberately never returns the code over HTTP: it is delivered by
    // SMS. The OTP sign-in box therefore has to be completed by the user, and
    // the challenge carries no `otp`.
    return ok({ id: result.value.challengeId, otp: '', expiresAt: result.value.expiresAt });
  },

  async signInWithOtp(userName, otp) {
    const result = await attempt<Dto>('POST', '/api/auth/otp/verify', { userName, otp });
    if (!result.ok) return result;
    setToken(str(result.value.token));
    const user = toAppUser(result.value.user as Dto);
    session.set(user);
    return ok(user);
  },

  async signInWithPin(userName, pin) {
    const result = await attempt<Dto>('POST', '/api/auth/pin', { userName, pin });
    if (!result.ok) return result;
    setToken(str(result.value.token));
    const user = toAppUser(result.value.user as Dto);
    session.set(user);
    return ok(user);
  },

  async requestRecovery(userName) {
    // The API answers with the issued code's existence only; the code itself is
    // logged server-side and sent out of band.
    const result = await attempt<string>('POST', '/api/auth/recovery/request', { userName });
    if (!result.ok) return result;
    return ok({ otp: '' });
  },

  async recoverPassword(userName, otp, password) {
    const result = await attempt<Dto>('POST', '/api/auth/recovery/complete', {
      userName,
      otp,
      password,
    });
    if (!result.ok) return result;
    // Recovery only rotates the password; it does not sign the user in, so the
    // session and its caches are left untouched (matches the local adapter).
    const user = toAppUser(result.value);
    return ok(user);
  },

  async signOut() {
    // The token is read synchronously by raw() before it awaits, so the server
    // still records the logout even though the token is cleared next.
    const notified = getToken()
      ? send('POST', '/api/auth/logout').catch(() => undefined)
      : Promise.resolve();

    // Local state is cleared without waiting on the network. Signing out must
    // never be gated on a round trip: the route guard redirects as soon as the
    // session becomes null.
    setToken(null);
    session.set(null);

    await notified;
  },

  currentUser: () => session.get(),
  setCurrentUser: (user) => session.set(user),

  demoPassword: 'Demo@12345',
};

const str = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

// -------------------------------------------------------------- locations

export const httpLocationsService: LocationsApi = {
  async listRooms() {
    return list(await get<Dto[]>('/api/locations/rooms'), toRoom);
  },

  async room(id) {
    const rooms = await httpLocationsService.listRooms();
    return rooms.find((room) => room.id === id) ?? null;
  },

  async sectionsOf(roomId) {
    const room = await httpLocationsService.room(roomId);
    return room?.sections ?? [];
  },

  async unitsOf(sectionId) {
    const rooms = await httpLocationsService.listRooms();
    for (const room of rooms) {
      const unit = room.storageUnits.find((item) => item.sectionId === sectionId);
      if (unit) return [unit];
    }
    return [];
  },

  async shelvesOf(almirahId) {
    const rooms = await httpLocationsService.listRooms();
    for (const room of rooms) {
      const unit = room.storageUnits.find((item) => item.id === almirahId);
      if (unit) return unit.shelves;
    }
    return [];
  },

  async findShelf(id) {
    const rooms = await httpLocationsService.listRooms();
    for (const room of rooms) {
      for (const unit of room.storageUnits) {
        const shelf = unit.shelves.find((row) => row.id === id);
        if (shelf) return shelf;
      }
    }
    return null;
  },

  async findShelfByBarcode(barcode) {
    const needle = barcode.trim().toUpperCase();
    if (!needle) return null;
    const rooms = await httpLocationsService.listRooms();
    for (const room of rooms) {
      for (const unit of room.storageUnits) {
        const shelf = unit.shelves.find((row) => row.barcode.toUpperCase() === needle);
        if (shelf) return shelf;
      }
    }
    return null;
  },

  // Room endpoints: POST /api/locations/rooms, PUT and DELETE /api/locations/rooms/{id}.
  async addRoom(input) {
    const result = await attempt<Dto>('POST', '/api/locations/rooms', input);
    return result.ok ? ok(toRoom(result.value)) : err<Room>(result.error, result.field);
  },
  async updateRoom(roomId, input) {
    const result = await attempt<Dto>('PUT', `/api/locations/rooms/${roomId}`, input);
    return result.ok ? ok(toRoom(result.value)) : err<Room>(result.error, result.field);
  },
  async deleteRoom(roomId) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/locations/rooms/${roomId}`));
  },
  async addSection(roomId, input) {
    return wrap(await attempt<Dto>('POST', `/api/locations/rooms/${roomId}/sections`, input));
  },
  async updateSection(sectionId, input) {
    return wrap(await attempt<Dto>('PUT', `/api/locations/sections/${sectionId}`, input));
  },
  async deleteSection(sectionId) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/locations/sections/${sectionId}`));
  },
  async addAlmirah(sectionId, input) {
    return wrap(await attempt<Dto>('POST', `/api/locations/sections/${sectionId}/almirahs`, input));
  },
  async updateAlmirah(almirahId, input) {
    return wrap(await attempt<Dto>('PUT', `/api/locations/almirahs/${almirahId}`, input));
  },
  async deleteAlmirah(almirahId) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/locations/almirahs/${almirahId}`));
  },
  async addShelf(almirahId, input) {
    return wrap(await attempt<Dto>('POST', `/api/locations/almirahs/${almirahId}/shelves`, input));
  },
  async updateShelf(shelfId, input) {
    return wrap(await attempt<Dto>('PUT', `/api/locations/shelves/${shelfId}`, input));
  },
  async deleteShelf(shelfId) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/locations/shelves/${shelfId}`));
  },

  async setUnitStatus(almirahId, status) {
    // Status lives on the almirah, so re-read the row the update just changed.
    const result = await attempt<Dto>('PUT', `/api/locations/almirahs/${almirahId}`, {
      code: '',
      name: '',
      status,
    });
    if (!result.ok) return result;
    return ok(result.value as unknown as StorageUnit);
  },

  async saveLayout(roomId, note) {
    const result = await attempt<Dto>('POST', `/api/locations/rooms/${roomId}/layout`, { note });
    if (!result.ok) return result;
    return ok({ revision: Number(result.value.revision) });
  },

  async layoutRevisions(roomId) {
    const rows = await get<Dto[]>(`/api/locations/rooms/${roomId}/layout/revisions`);
    return list(rows, (dto) => ({
      revision: Number(dto.revision),
      note: str(dto.note),
      at: str(dto.at),
      actor: str(dto.actor),
    }));
  },

  async occupancy() {
    const rooms = await httpLocationsService.listRooms();
    return rooms.map((room) => ({
      room,
      sections: room.sections.map((section: Section) => {
        const units = room.storageUnits.filter((unit) => unit.sectionId === section.id);
        const shelves = units.flatMap((unit) => unit.shelves);
        return {
          section,
          almirahs: units.length,
          shelves: shelves.length,
          capacity: shelves.reduce((sum, shelf) => sum + shelf.capacity, 0),
        };
      }),
    }));
  },

  async areas() {
    return list(await get<Dto[]>('/api/locations/areas'), toArea) as Area[];
  },
};

// ------------------------------------------------------------------ files

function fileBody(input: FileCreateInput): Record<string, unknown> {
  return {
    fileBarcode: input.fileBarcode,
    subject: input.subject,
    department: input.department,
    year: input.year,
    fileType: input.fileType,
    recordKind:
      input.recordKind ??
      (input.documentSize === 'A0' ? 'Map' : input.fileType === 'Map' ? 'Map' : 'File'),
    documentSize: input.documentSize ?? 'Other',
    eOfficeReference: input.eOfficeReference?.trim() || null,
    // Placement is optional: an empty selection registers the file unplaced.
    shelfId: input.shelfId ? toApiId(input.shelfId, 'shelf') : null,
    position: input.position,
    pincode: input.pincode,
    area: input.area,
    propertyNo: input.propertyNo,
    propertyArea: input.propertyArea,
    dealer: input.dealer,
    codalLife: input.codalLife,
    description: input.description,
  };
}

export const httpFilesService: FilesApi = {
  async list(query = {}) {
    const page = await get<Dto>(
      `/api/files${qs({
        search: query.search,
        department: query.department,
        status: query.status,
        recordKind: query.recordKind,
        fileType: query.fileType,
        eOfficeStatus: query.eOfficeStatus,
        roomId: query.roomId,
        sectionId: query.sectionId,
        shelfId: query.shelfId,
        area: query.area,
        sort: query.sort,
        direction: query.direction,
        page: query.page,
        pageSize: query.pageSize,
      })}`,
    );
    return {
      items: list(page.items, toFile) as RecordFile[],
      total: Number(page.total),
      page: Number(page.page),
      pageSize: Number(page.pageSize),
      collectionTotal: Number(page.collectionTotal),
    };
  },

  async get(id) {
    try {
      return toFile(await get<Dto>(`/api/files/${id}`));
    } catch {
      return null;
    }
  },

  async byBarcode(barcode) {
    try {
      return toFile(await get<Dto>(`/api/files/by-barcode/${encodeURIComponent(barcode)}`));
    } catch {
      return null;
    }
  },

  async byShelf(shelfId) {
    const page = await get<Dto>(`/api/files${qs({ shelfId, pageSize: 200 })}`);
    return list(page.items, toFile);
  },

  async departments() {
    return list(await get<string[]>('/api/files/departments'), str);
  },

  async validateCreate(input) {
    // A dry run: the API applies the same guards it would on create, so the
    // form cannot drift from what the server will accept.
    const envelope = await post<{ errors?: unknown }>('/api/files/validate', fileBody(input)).catch(
      () => null,
    );
    const errors = (envelope?.errors ?? []) as Array<{ message: string; field?: string }>;
    return toFieldIssues(errors);
  },

  async create(input) {
    return wrapFile(await attempt<Dto>('POST', '/api/files', fileBody(input)));
  },

  async relocate(fileId, shelfId, position, reason) {
    const result = await attempt<Dto>('POST', `/api/files/${fileId}/relocate`, {
      shelfId: toApiId(shelfId, 'shelf'),
      position,
      reason,
    });
    return result.ok ? ok(toFile(result.value)) : result;
  },

  async updateEOfficeReference(fileId, reference) {
    const result = await attempt<Dto>('PUT', `/api/files/${fileId}/e-office-reference`, {
      eOfficeReference: reference.trim() || null,
    });
    return result.ok ? ok(toFile(result.value)) : result;
  },

  async listDocuments(fileId) {
    return list(await get<Dto[]>(`/api/files/${fileId}/documents`), toRecordFileDocument);
  },

  async uploadDocument(fileId, file, importToStudio) {
    const body = new FormData();
    body.append('document', file, file.name);
    const suffix = importToStudio ? '?importToStudio=true' : '';
    const result = await attemptForm<Dto>(`/api/files/${fileId}/documents${suffix}`, body);
    return result.ok ? ok(toRecordFileDocument(result.value)) : result;
  },

  async deleteDocument(fileId, documentId) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/files/${fileId}/documents/${documentId}`));
  },

  async documentBlob(fileId, documentId) {
    return getBlob(`/api/files/${fileId}/documents/${documentId}/content`);
  },

  async documentOcr(fileId, documentId) {
    const raw = await get<Record<string, string>>(
      `/api/files/${fileId}/documents/${documentId}/ocr`,
    );
    if (!raw) return {};
    const map: Record<number, string> = {};
    for (const [key, val] of Object.entries(raw)) {
      const pageNo = Number(key);
      if (!Number.isNaN(pageNo)) map[pageNo] = val;
    }
    return map;
  },

  async rerunDocumentOcr(fileId, documentId) {
    return wrapTrue(
      await attempt<boolean>('POST', `/api/files/${fileId}/documents/${documentId}/ocr`),
    );
  },

  async saveDocumentOcr(fileId, documentId, pageNo, text) {
    const result = await attempt<boolean>(
      'PUT',
      `/api/files/${fileId}/documents/${documentId}/ocr/${pageNo}`,
      { text },
    );
    return result.ok ? ok(true) : err(result.error);
  },

  async remove(fileId) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/files/${fileId}`));
  },
};

function wrap<T>(
  result:
    { ok: true; value: Record<string, unknown> } | { ok: false; error: string; field?: string },
) {
  return result.ok ? ok(result.value as unknown as T) : err<T>(result.error, result.field);
}

function wrapFile(result: Awaited<ReturnType<typeof attempt<Dto>>>) {
  return result.ok ? ok(toFile(result.value)) : result;
}

function wrapTrue(
  result: { ok: true; value: unknown } | { ok: false; error: string; field?: string },
) {
  return result.ok ? ok(true as const) : err<true>(result.error, result.field);
}

// ----------------------------------------------------------------- issues

export const httpIssuesService: IssueApi = {
  async list(query = {}) {
    const page = await get<Dto>(
      `/api/issues${qs({
        status: query.status,
        borrower: query.borrower,
        open: query.open,
        page: query.page,
        pageSize: query.pageSize,
      })}`,
    );
    return {
      items: list(page.items, toIssue),
      total: Number(page.total),
      page: Number(page.page),
      pageSize: Number(page.pageSize),
    };
  },

  async get(id) {
    try {
      return toIssue(await get<Dto>(`/api/issues/${id}`));
    } catch {
      return null;
    }
  },

  async borrowers() {
    return list(await get<Dto[]>('/api/issues/borrowers'), (dto) => ({
      employeeCode: str(dto.employeeCode),
      name: str(dto.name),
      department: str(dto.department),
      openFiles: Number(dto.openFiles),
      oldestDue: str(dto.oldestDue),
      overdue: dto.overdue === true,
    }));
  },

  async issueFiles(input) {
    const result = await attempt<Dto>('POST', '/api/issues', {
      borrowerType: input.borrowerType,
      borrowerEmployeeCode: input.borrowerEmployeeCode,
      borrowerName: input.borrowerName,
      department: input.department,
      purpose: input.purpose,
      fileIds: input.fileIds.map((id) => toApiId(id, 'file')),
      dueAt: input.dueAt,
      remark: input.remark,
    });
    return result.ok ? ok(toIssue(result.value)) : result;
  },

  async returnFiles(issueId, fileIds, condition) {
    const result = await attempt<Dto>('POST', `/api/issues/${issueId}/return`, {
      fileIds: fileIds.map((id) => toApiId(id, 'file')),
      condition,
    });
    return result.ok ? ok(toIssue(result.value)) : result;
  },

  async overdue() {
    return list(await get<Dto[]>('/api/issues/overdue'), toIssue);
  },

  async nextReceiptNumber() {
    return get<string>('/api/issues/next-receipt-number');
  },
};

// --------------------------------------------------------------- movement

export const httpMovementsService: MovementApi = {
  async list(query = {}) {
    // fileId is a separate endpoint, since it is a filter the list does not take.
    if (query.fileId) {
      return list(await get<Dto[]>(`/api/movements/file/${query.fileId}`), toMovement);
    }
    return list(
      await get<Dto[]>(
        `/api/movements${qs({ kind: query.kind, search: query.search, limit: query.limit })}`,
      ),
      toMovement,
    );
  },

  async recent(limit = 10) {
    return httpMovementsService.list({ limit });
  },
};

// --------------------------------------------------------------- employees

function employeeBody(input: Record<string, unknown>): Record<string, unknown> {
  return {
    employeeCode: str(input.employeeCode),
    prefix: str(input.prefix) || 'LK',
    name: str(input.name),
    fatherName: str(input.fatherName),
    gender: str(input.gender),
    dateOfBirth: str(input.dateOfBirth) || null,
    department: str(input.department),
    designation: str(input.designation),
    email: str(input.email),
    mobile: str(input.mobile),
    pan: str(input.pan),
    aadhaar: str(input.aadhaar),
    role: str(input.role),
    gradePay: str(input.gradePay),
    payScale: str(input.payScale),
    status: str(input.status),
  };
}

export const httpEmployeesService: EmployeesApi = {
  async list(query = {}) {
    const page = await get<Dto>(
      `/api/employees${qs({
        search: query.search,
        department: query.department,
        status: query.status,
        page: query.page,
        pageSize: query.pageSize,
      })}`,
    );
    return {
      items: list(page.items, toEmployee),
      total: Number(page.total),
      page: Number(page.page),
      pageSize: Number(page.pageSize),
    };
  },

  async get(id) {
    try {
      return toEmployee(await get<Dto>(`/api/employees/${id}`));
    } catch {
      return null;
    }
  },

  async byCode(code) {
    const page = await get<Dto>(`/api/employees${qs({ search: code, pageSize: 50 })}`);
    const found = list(page.items, toEmployee).find((item) => item.employeeCode === code);
    return found ?? null;
  },

  async create(input) {
    const result = await attempt<Dto>('POST', '/api/employees', employeeBody(input));
    return result.ok ? ok(toEmployee(result.value)) : result;
  },

  async update(id, input) {
    const current = await httpEmployeesService.get(id);
    if (!current) return err('Employee not found.', 'id');
    const result = await attempt<Dto>(
      'PUT',
      `/api/employees/${id}`,
      employeeBody({ ...current, ...input }),
    );
    return result.ok ? ok(toEmployee(result.value)) : result;
  },

  async remove(id) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/employees/${id}`));
  },

  async departments() {
    return list(await get<string[]>('/api/employees/departments'), str);
  },
};

// ----------------------------------------------------------- digitization

export const httpDigitizationService: ScanApi = {
  async list(fileId) {
    return (await get<Dto[]>(`/api/files/${toApiId(fileId, 'file')}/scans`)).map(toFileScan);
  },

  async add(fileId, input) {
    const result = await attempt<Dto>('POST', `/api/files/${toApiId(fileId, 'file')}/scans`, {
      fileName: input.filename,
      pageNo: input.pageNo,
      documentSize: input.documentSize,
      note: input.note ?? '',
    });
    return result.ok ? ok(toFileScan(result.value)) : result;
  },

  async addDocument(scanId, file) {
    const body = new FormData();
    body.append('document', file, file.name);
    const result = await attemptForm<Dto>(`/api/scans/${toApiId(scanId, 'scan')}/document`, body);
    return result.ok ? ok(toFileScan(result.value)) : result;
  },

  async remove(scanId) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/scans/${toApiId(scanId, 'scan')}`));
  },

  async review(scanId, decision, note) {
    const result = await attempt<Dto>('POST', `/api/scans/${toApiId(scanId, 'scan')}/review`, {
      decision,
      note,
    });
    return result.ok ? ok(toFileScan(result.value)) : result;
  },

  async reviewAll(fileId, decision, note) {
    // The API answers with the number of pages that moved, not a row.
    const result = await attempt<number>(
      'POST',
      `/api/files/${toApiId(fileId, 'file')}/scans/review-all`,
      {
        decision,
        note,
      },
    );
    return result.ok ? ok(result.value) : result;
  },

  async pending(query = {}) {
    return (await get<Dto[]>(`/api/digitization/pending${qs({ search: query.search })}`)).map(
      toFileScan,
    );
  },

  async pendingReviewCount() {
    return get<number>('/api/digitization/pending-review-count');
  },

  async pendingPdfs(query = {}) {
    const dtos = await get<Dto[]>(`/api/digitization/pending-pdfs${qs({ search: query.search })}`);
    return dtos.map(toDerivative);
  },

  // ------------------------------------------------ review grouping (round 5)
  //
  // The grouping is client-side over the two existing pending endpoints; the
  // file rows are fetched per file because the queue only carries ids.

  async pendingByFile(query = {}) {
    const [pages, pdfs] = await Promise.all([this.pending(query), this.pendingPdfs(query)]);
    const fileIds = [...new Set([...pages.map((p) => p.fileId), ...pdfs.map((p) => p.fileId)])];
    const files = (await Promise.all(fileIds.map((id) => httpFilesService.get(id)))).filter(
      (file): file is NonNullable<typeof file> => file !== null,
    );
    return groupPendingByFile(pages, pdfs, files);
  },

  async reviewScans(scanIds, decision, note, fileId) {
    if (scanIds.length === 0) return err('Select at least one page.', 'scanIds');
    if (decision === 'Rejected' && !note?.trim()) {
      return err('A rejection reason is required.', 'note');
    }
    // One batch call for the whole selection when the caller knows the file
    // (the review page does); the per-page endpoint covers callers that do not.
    if (fileId) {
      const result = await attempt<number>(
        'POST',
        `/api/files/${toApiId(fileId, 'file')}/scans/review-set`,
        {
          scanIds: scanIds.map((id) => toApiId(id, 'scan')),
          decision,
          note: note ?? '',
        },
      );
      return result.ok ? ok(result.value) : result;
    }
    let done = 0;
    for (const scanId of scanIds) {
      const result = await this.review(scanId, decision, note ?? '');
      if (!result.ok) return result;
      done += 1;
    }
    return ok(done);
  },

  async saveOcrText(scanId, text) {
    const result = await attempt<Dto>('PUT', `/api/scans/${toApiId(scanId, 'scan')}/ocr/text`, {
      text,
    });
    return result.ok ? ok(toFileScan(result.value)) : result;
  },

  async compressionEstimate(target) {
    const { probeCompression } = await import('../../lib/pdf-compress');
    const blob =
      target.source === 'document'
        ? await httpFilesService.documentBlob(target.fileId, target.id)
        : await this.pdfBlob(target.id, target.fileId);
    const currentBytes = blob.size;
    const perLevel = { light: 0, balanced: 0, strong: 0 } as Record<
      'light' | 'balanced' | 'strong',
      number
    >;
    let pageCount = 0;
    for (const def of COMPRESSION_LEVELS) {
      try {
        const probe = await probeCompression(blob, def.key);
        pageCount = probe.pageCount;
        perLevel[def.key] = Math.round(probe.bytesPerPage * probe.pageCount + 1024);
      } catch {
        perLevel[def.key] = 0;
      }
    }
    if (pageCount === 0) return err('The PDF could not be read for compression.', 'id');
    const levels = buildLevelEstimates(currentBytes, pageCount, perLevel);
    const best = Math.min(...levels.map((level) => level.estimatedBytes));
    return ok({
      currentBytes,
      pageCount,
      bytesPerPage: currentBytes / pageCount,
      levels,
      notWorthIt: best >= currentBytes * 0.95,
    });
  },

  async applyCompression(target, level, remarks) {
    // Server-side pipeline (QuestPDF); the endpoint ships with the API update.
    const dId = toApiId(target.id, 'derivative');
    const path =
      target.source === 'document'
        ? `/api/files/${toApiId(target.fileId, 'file')}/documents/${toApiId(target.id, 'document')}/compress`
        : `/api/derivatives/${dId}/compress`;
    const result = await attempt<Dto>('POST', path, { level, remarks: remarks ?? '' });
    return result.ok ? ok(toDerivative(result.value)) : result;
  },

  async progress(query = {}) {
    return get<Dto[]>(`/api/digitization/progress${qs({ search: query.search })}`).then((dtos) =>
      dtos.map((dto) => ({
        fileId: toId(dto.fileId as number),
        fileBarcode: str(dto.fileBarcode),
        fileNumber: str(dto.fileNumber) || undefined,
        subject: str(dto.subject),
        department: str(dto.department) || undefined,
        status: str(dto.status) || undefined,
        pagesTotal: num(dto.pagesTotal),
        pagesApproved: num(dto.pagesApproved),
        pagesPending: num(dto.pagesPending),
        pagesRejected: num(dto.pagesRejected),
        deliverables: num(dto.deliverables),
        deliverablesPending: num(dto.deliverablesPending),
        lastActivityAt: str(dto.lastActivityAt) || null,
      })),
    );
  },
  // -------------------------------------------------- scan studio (§3.4)
  async reorder(fileId, scanIds) {
    const result = await attempt<Dto[]>(
      'PUT',
      `/api/files/${toApiId(fileId, 'file')}/scans/order`,
      {
        scanIds: scanIds.map((id) => toApiId(id, 'scan')),
      },
    );
    return result.ok ? ok(result.value.map((dto) => toFileScan({ ...dto, fileId }))) : result;
  },

  async rotate(scanId, degrees) {
    const result = await attempt<Dto>('POST', `/api/scans/${toApiId(scanId, 'scan')}/rotate`, {
      degrees,
    });
    return result.ok ? ok(toFileScan(result.value)) : result;
  },

  async enhance(scanId, operation) {
    const result = await attempt<Dto>('POST', `/api/scans/${toApiId(scanId, 'scan')}/enhance`, {
      operation,
    });
    return result.ok ? ok(toFileScan(result.value)) : result;
  },

  async revert(scanId) {
    const result = await attempt<Dto>(
      'DELETE',
      `/api/scans/${toApiId(scanId, 'scan')}/enhancement`,
    );
    return result.ok ? ok(toFileScan(result.value)) : result;
  },

  async duplicate(scanId) {
    const result = await attempt<Dto>('POST', `/api/scans/${toApiId(scanId, 'scan')}/duplicate`);
    return result.ok ? ok(toFileScan(result.value)) : result;
  },

  async runOcr(scanId) {
    const result = await attempt<Dto>('POST', `/api/scans/${toApiId(scanId, 'scan')}/ocr`);
    return result.ok
      ? ok({
          scanId: toId(result.value.scanId as number),
          barcode: str(result.value.barcode),
          pageNo: num(result.value.pageNo),
          version: num(result.value.version),
          ocrText: str(result.value.ocrText),
          method: str(result.value.method),
          ranAt: str(result.value.ranAt),
        })
      : result;
  },

  async scanBlob(scanId, variant) {
    return getBlob(
      `/api/scans/${toApiId(scanId, 'scan')}/content${variant === 'processed' ? '?variant=processed' : ''}`,
    );
  },

  async listPdfs(fileId) {
    const dtos = await get<Dto[]>(`/api/files/${toApiId(fileId, 'file')}/pdf`);
    return dtos.map((dto) => toDerivative(dto));
  },

  async buildPdf(fileId, filename, remarks) {
    const result = await attempt<Dto>('POST', `/api/files/${toApiId(fileId, 'file')}/pdf`, {
      fileName: filename ?? '',
      remarks: remarks ?? '',
    });
    return result.ok ? ok(toDerivative(result.value)) : result;
  },

  async reviewPdf(derivativeId, decision, note, fileId) {
    const fId = fileId ? toApiId(fileId, 'file') : 0;
    const dId = toApiId(derivativeId, 'derivative');
    const path = fId > 0 ? `/api/files/${fId}/pdf/${dId}/review` : `/api/derivatives/${dId}/review`;
    const result = await attempt<Dto>('POST', path, { decision, note: note ?? '' });
    return result.ok ? ok(toDerivative(result.value)) : result;
  },

  async removePdf(derivativeId, fileId) {
    const fId = fileId ? toApiId(fileId, 'file') : 0;
    const dId = toApiId(derivativeId, 'derivative');
    const path = fId > 0 ? `/api/files/${fId}/pdf/${dId}` : `/api/derivatives/${dId}`;
    return wrapTrue(await attempt<Dto>('DELETE', path));
  },

  async pdfBlob(derivativeId, fileId) {
    const fId = fileId ? toApiId(fileId, 'file') : 0;
    const dId = toApiId(derivativeId, 'derivative');
    const path =
      fId > 0 ? `/api/files/${fId}/pdf/${dId}/content` : `/api/derivatives/${dId}/content`;
    return getBlob(path);
  },
};

// ---------------------------------------------------------------- uploads

export const httpUploadsService: UploadsApi = {
  async maps(query = {}) {
    return list(
      await get<Dto[]>(
        `/api/uploads/maps${qs({ fileBarcode: query.fileBarcode, search: query.search })}`,
      ),
      toMapUpload,
    );
  },

  async addMap(input) {
    const result = await attempt<Dto>('POST', '/api/uploads/maps', {
      fileBarcode: input.fileBarcode,
      pageNo: input.pageNo,
      fileName: input.filename,
      sizeKb: input.sizeKb,
    });
    return result.ok ? ok(toMapUpload(result.value)) : result;
  },

  async uploadMapDocument(id, file) {
    const body = new FormData();
    body.append('document', file, file.name);
    const result = await attemptForm<Dto>(`/api/uploads/maps/${id}/document`, body);
    return result.ok ? ok(toMapUpload(result.value)) : result;
  },

  async mapBlob(id) {
    return getBlob(`/api/uploads/maps/${id}/content`);
  },

  async removeMap(id) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/uploads/maps/${id}`));
  },
};

// ------------------------------------------------------------------- bulk

export const httpBulkService: BulkApi = {
  async jobs() {
    return list(await get<Dto[]>('/api/bulk/jobs'), toBulkJob);
  },

  async job(id) {
    try {
      return toBulkJob(await get<Dto>(`/api/bulk/jobs/${id}`));
    } catch {
      return null;
    }
  },

  async validateCsv(csv, folder) {
    const result = await attempt<Dto>('POST', '/api/bulk/validate', { csv, folder });
    return result.ok ? ok(toBulkJob(result.value)) : result;
  },

  async commit(jobId) {
    const result = await attempt<Dto>('POST', `/api/bulk/jobs/${jobId}/commit`);
    return result.ok ? ok(toBulkJob(result.value)) : result;
  },
};

// ------------------------------------------------------------------ audit

export const httpAuditService: AuditApi = {
  async list(query = {}) {
    const payload = await get<{ entries: Dto[] }>(
      `/api/audit${qs({
        action: query.action,
        actor: query.actor,
        entity: query.entity,
        group: query.group,
        search: query.search,
        limit: query.limit,
      })}`,
    );
    return list(payload.entries, toAuditEntry);
  },

  async fileViews(query = {}) {
    const payload = await get<{ entries: Dto[] }>(
      `/api/audit/file-views${qs({ search: query.search, limit: query.limit })}`,
    );
    return list(payload.entries, toAuditEntry);
  },

  async loginHistory(query = {}) {
    const payload = await get<{ entries: Dto[] }>(
      `/api/audit/login-history${qs({ outcome: query.outcome, search: query.search })}`,
    );
    return list(payload.entries, toLoginHistory);
  },

  async actors() {
    return list(await get<string[]>('/api/audit/actors'), str);
  },
};

// ---------------------------------------------------------------- reports

export const httpReportsService: ReportsApi = {
  async definitions() {
    return list(await get<Dto[]>('/api/reports'), toReportDefinition) as ReportDefinition[];
  },

  async build(key: ReportKey) {
    const dto = await get<Dto>(`/api/reports/${key}`);
    return {
      definition: toReportDefinition({
        key: dto.key,
        title: dto.title,
        description: '',
        legacySource: '',
      }),
      columns: (Array.isArray(dto.columns) ? (dto.columns as unknown[]) : []).map(str),
      rows: (Array.isArray(dto.rows) ? (dto.rows as unknown[][]) : []).map((row) => row.map(str)),
      generatedAt: str(dto.generatedAt),
    };
  },
};

// --------------------------------------------------------------- barcodes

export const httpBarcodesService: BarcodeApi = {
  async subjects() {
    // The API validates against this fixed set; keep the two in step.
    return ['File', 'Shelf', 'Almirah', 'Section', 'Room', 'Area'] as BarcodeSubject[];
  },

  async payloadFor(subject, id) {
    try {
      return toPayload(await get<Dto>(`/api/barcodes/payload/${subject}/${id}`));
    } catch {
      return null;
    }
  },

  async validate(raw) {
    return toScanResult(await post<Dto>('/api/barcodes/validate', { value: raw }));
  },

  async jobs() {
    return list(await get<Dto[]>('/api/barcodes/jobs'), toBarcodeJob);
  },

  async createJob(input) {
    const result = await attempt<Dto>('POST', '/api/barcodes/jobs', {
      subject: input.subject,
      targetId: input.targetId,
      quantity: input.quantity,
    });
    return result.ok ? ok(toBarcodeJob(result.value)) : result;
  },

  async cancelJob(id) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/barcodes/jobs/${id}`));
  },
};

// -------------------------------------------------------------- dashboard

export const httpDashboardService: DashboardApi = {
  async stats() {
    return toStats(await get<Dto>('/api/dashboard/stats'));
  },

  async activity(limit = 6) {
    return list(await get<Dto[]>(`/api/dashboard/activity${qs({ limit })}`), toTimeline);
  },
};

// ------------------------------------------------------------------ users

export const httpUsersService: UsersApi = {
  async list() {
    const payload = await get<{ users: Dto[] }>('/api/users');
    return list(payload.users, toAppUser);
  },

  async create(input) {
    const result = await attempt<Dto>('POST', '/api/users', {
      userName: input.userName,
      displayName: input.displayName,
      role: input.role,
      employeeCode: input.employeeCode ?? null,
      active: input.active,
      password: input.password,
    });
    return result.ok ? ok(toAppUser(result.value)) : result;
  },

  async update(id, input) {
    const result = await attempt<Dto>('PUT', `/api/users/${id}`, {
      userName: str(input.userName),
      displayName: str(input.displayName),
      role: str(input.role),
      employeeCode: input.employeeCode ?? null,
      active: input.active === true,
    });
    return result.ok ? ok(toAppUser(result.value)) : result;
  },

  async remove(id) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/users/${id}`));
  },

  async roles() {
    const payload = await get<{ roles: string[] }>('/api/users');
    return payload.roles as UsersApi extends never ? never : Awaited<ReturnType<UsersApi['roles']>>;
  },

  // ------------------------------------------- editable matrix (§3.7)
  async permissionsMatrix() {
    const body = await get<{ roles: Array<{ role: string; permissions: string[] }> }>(
      '/api/permissions/matrix',
    );
    const matrix: Record<string, string[]> = {};
    for (const row of body.roles) matrix[row.role] = row.permissions;
    const typed = matrix as unknown as RolePermissionMatrix;
    permissionsStore.replace(typed, true);
    return typed;
  },

  async setPermission(role, permission, granted) {
    const result = await attempt<unknown>('PUT', `/api/permissions/${role}/${permission}`, {
      granted,
    });
    if (!result.ok) return result;
    const matrix = await this.permissionsMatrix();
    return ok(matrix);
  },
};

// -------------------------------------------------- inquiries and media

export const httpInquiriesService: InquiriesApi = {
  async save(payload: InquiryPayload) {
    const result = await attempt<Dto>('POST', '/api/inquiries', {
      name: payload.name,
      email: payload.email,
      department: payload.department,
      message: payload.message,
    });
    if (!result.ok) return result;
    const dto = result.value;
    return ok({
      id: str(dto.id),
      name: str(dto.name),
      email: str(dto.email),
      department: str(dto.department),
      message: str(dto.message),
      createdAt: str(dto.createdAt),
    } as InquiryRecord);
  },

  async list() {
    const rows = await get<Dto[]>('/api/inquiries');
    return list(rows, (dto) => ({
      id: str(dto.id),
      name: str(dto.name),
      email: str(dto.email),
      department: str(dto.department),
      message: str(dto.message),
      createdAt: str(dto.createdAt),
    })) as InquiryRecord[];
  },

  async remove(id) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/inquiries/${id}`));
  },

  async submittedBy() {
    // The API records who submitted; there is no per-caller filter, so the
    // shell shows the total instead of inventing a personal figure.
    const rows = await get<Dto[]>('/api/inquiries');
    return String(rows.length);
  },
};

export const httpMediaService: MediaApi = {
  async saveLink(payload: MediaLinkPayload) {
    const result = await attempt<Dto>('POST', '/api/media-links', {
      title: payload.title,
      url: payload.url,
      alt: payload.alt,
    });
    if (!result.ok) return result;
    const dto = result.value;
    return ok({
      id: str(dto.id),
      title: str(dto.title),
      url: str(dto.url),
      alt: str(dto.alt),
      createdAt: str(dto.createdAt),
    } as MediaLinkRecord);
  },

  async list() {
    const rows = await get<Dto[]>('/api/media-links');
    return list(rows, (dto) => ({
      id: str(dto.id),
      title: str(dto.title),
      url: str(dto.url),
      alt: str(dto.alt),
      createdAt: str(dto.createdAt),
    })) as MediaLinkRecord[];
  },

  async remove(id) {
    return wrapTrue(await attempt<Dto>('DELETE', `/api/media-links/${id}`));
  },
};

// ------------------------------------------------------------- custody chain

type CustodyDto = Record<string, unknown>;

export const httpCustodyService: CustodyApi = {
  async list(query = {}) {
    const page = await get<Dto>(
      `/api/custody${qs({
        direction: query.direction,
        search: query.search,
        page: query.page,
        pageSize: query.pageSize,
      })}`,
    );
    return {
      items: (page.items as CustodyDto[]).map(toCustodyEvent),
      total: Number(page.total),
      page: Number(page.page),
      pageSize: Number(page.pageSize),
      collectionTotal: Number(page.collectionTotal),
    };
  },

  async record(input) {
    const result = await attempt<CustodyDto>('POST', '/api/custody', {
      direction: input.direction,
      department: input.department,
      fileCount: input.fileCount,
      batchRef: input.batchRef ?? '',
      vendor: input.vendor ?? '',
      remarks: input.remarks ?? '',
    });
    return result.ok ? ok(toCustodyEvent(result.value)) : result;
  },

  async reconcile(id, reconciledCount, remarks) {
    const result = await attempt<CustodyDto>(
      'POST',
      `/api/custody/${toApiId(id, 'custody')}/reconcile`,
      {
        reconciledCount,
        remarks: remarks ?? '',
      },
    );
    return result.ok ? ok(toCustodyEvent(result.value)) : result;
  },

  async signOff(id, signedOffBy) {
    const result = await attempt<CustodyDto>(
      'POST',
      `/api/custody/${toApiId(id, 'custody')}/sign-off`,
      {
        signedOffBy: signedOffBy ?? '',
      },
    );
    return result.ok ? ok(toCustodyEvent(result.value)) : result;
  },

  async returnAgainst(id, input) {
    const result = await attempt<CustodyDto>(
      'POST',
      `/api/custody/${toApiId(id, 'custody')}/return`,
      {
        fileCount: input.fileCount,
        remarks: input.remarks ?? '',
      },
    );
    return result.ok ? ok(toCustodyEvent(result.value)) : result;
  },

  async returnsFor(id) {
    const payload = await get<{ entries: CustodyDto[] } | CustodyDto[]>(
      `/api/custody/${toApiId(id, 'custody')}/returns`,
    );
    const rows = Array.isArray(payload) ? payload : payload.entries;
    return rows.map((row) => toCustodyEvent(row as Record<string, unknown>));
  },
};

// -------------------------------------------------------------- departments

export const httpDepartmentsService: DepartmentsApi = {
  async list() {
    return list(await get<Dto[]>('/api/departments'), toDepartment);
  },

  async create(input) {
    const result = await attempt<Dto>('POST', '/api/departments', {
      name: input.name,
      code: input.code,
      remarks: input.remarks ?? '',
    });
    return result.ok ? ok(toDepartment(result.value)) : result;
  },

  async update(id, input) {
    const result = await attempt<Dto>('PUT', `/api/departments/${toApiId(id, 'department')}`, {
      name: input.name,
      code: input.code,
      remarks: input.remarks ?? '',
    });
    return result.ok ? ok(toDepartment(result.value)) : result;
  },

  async remove(id) {
    const result = await attempt<boolean>(
      'DELETE',
      `/api/departments/${toApiId(id, 'department')}`,
    );
    return result.ok ? ok(true) : result;
  },
};

// ------------------------------------------------------------ feature config

/** One `FeatureSettings` row as `GET`/`PUT /api/config/features` returns it. */
interface FeatureRow {
  key: string;
  enabled: boolean;
}

/**
 * Rows to the contract's fixed four-group shape. The PUT answer already carries
 * every row, so the switchboard reads its result from the write itself instead
 * of re-asking `/api/config` — a second round trip made the optimistic switch
 * flip back whenever that read raced or failed.
 */
function fromFeatureRows(rows: FeatureRow[] | null): Features {
  const enabled = new Map((rows ?? []).map((row) => [row.key, row.enabled]));
  return {
    barcode: enabled.get('barcode') === true,
    recordRoom: enabled.get('recordRoom') === true,
    maps: enabled.get('maps') === true,
    support: enabled.get('support') === true,
  };
}

export const httpConfigService: ConfigApi = {
  async features() {
    const body = await getPlain<{ features?: Record<string, unknown> }>('/api/config');
    return {
      barcode: body.features?.barcode === true,
      recordRoom: body.features?.recordRoom === true,
      maps: body.features?.maps === true,
      support: body.features?.support === true,
    };
  },

  async info() {
    const body = await getPlain<{
      appName?: string;
      features?: Record<string, unknown>;
      settingsEditable?: boolean;
      demoMode?: boolean;
      ocr?: {
        enabled?: boolean;
        available?: boolean;
        engine?: string;
        languages?: string;
        note?: string;
      };
    }>('/api/config');
    return {
      appName: body.appName ?? 'Document Management System',
      features: {
        barcode: body.features?.barcode === true,
        recordRoom: body.features?.recordRoom === true,
        maps: body.features?.maps === true,
        support: body.features?.support === true,
      },
      settingsEditable: body.settingsEditable !== false,
      demoMode: body.demoMode === true,
      ocr: {
        enabled: body.ocr?.enabled !== false,
        available: body.ocr?.available === true,
        engine: body.ocr?.engine === 'paddleocr' ? 'paddleocr' : 'tesseract',
        languages: body.ocr?.languages ?? 'hin+eng',
        note: body.ocr?.note ?? '',
      },
    };
  },

  async updateFeatures(patch) {
    const result = await attempt<FeatureRow[] | null>('PUT', '/api/config/features', {
      features: patch,
    });
    return result.ok ? ok(fromFeatureRows(result.value)) : result;
  },

  async updateOcrEngine(engine) {
    return attempt<typeof engine>('PUT', '/api/config/ocr-engine', { engine });
  },
};
