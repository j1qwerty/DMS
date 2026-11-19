import { err, ok } from '../contracts';
import type { RecordFileDocument } from '../../types';
import { validateDocumentFile } from '../../lib/document';
import { newId, timestamp } from '../store';
import { session } from './session';

/**
 * Local/demo-mode document storage.
 *
 * Round 4: rows and bytes now persist in IndexedDB (`rr-documents`), so a page
 * refresh keeps every uploaded scan, map and built PDF. Before this, the lists
 * lived in memory for the session only — the scan rows survived (the store
 * persists) but their files vanished, and full-PDF record documents disappeared
 * entirely. The .NET API remains the durable store for real deployments; this
 * is the honest demo.
 *
 * The in-memory Maps stay the read path (the accessors are synchronous by
 * contract); IndexedDB is a write-through cache hydrated once at boot by
 * `initLocalDocumentStorage()`. Where IndexedDB is unavailable (vitest's node
 * environment, private modes) every operation degrades to the previous
 * session-only behaviour instead of throwing.
 */
const blobs = new Map<string, Blob>();
const recordDocuments = new Map<string, RecordFileDocument[]>();
const derivativeBytes = new Map<string, Blob>();

export interface LocalDocumentInfo {
  contentType: string;
  sizeBytes: number;
  sha256: string;
  /** Pages in a stored PDF; undefined means the count could not be read. */
  pageCount?: number;
}

const mimeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
};

const IDB_NAME = 'rr-documents';
const IDB_STORE = 'docs';
const IDB_VERSION = 1;

interface StoredDoc {
  key: string;
  blob: Blob;
  /** Present for the 'record' scope: the versioned full-PDF row. */
  row?: RecordFileDocument;
}

let idb: IDBDatabase | null | undefined;

function openIdb(): Promise<IDBDatabase | null> {
  if (idb !== undefined) return Promise.resolve(idb);
  if (typeof indexedDB === 'undefined') {
    idb = null;
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      idb = request.result;
      resolve(request.result);
    };
    request.onerror = () => {
      // Unavailable or blocked: fall back to session-only storage.
      idb = null;
      resolve(null);
    };
  });
}

function idbPut(doc: StoredDoc): Promise<void> {
  return openIdb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(doc);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      }),
  );
}

function idbDelete(key: string): Promise<void> {
  return openIdb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      }),
  );
}

function idbClear(): Promise<void> {
  return openIdb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve();
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      }),
  );
}

function idbAll(): Promise<StoredDoc[]> {
  return openIdb().then(
    (db) =>
      new Promise<StoredDoc[]>((resolve) => {
        if (!db) return resolve([]);
        const tx = db.transaction(IDB_STORE, 'readonly');
        const request = tx.objectStore(IDB_STORE).getAll();
        request.onsuccess = () => resolve((request.result ?? []) as StoredDoc[]);
        request.onerror = () => resolve([]);
      }),
  );
}

/**
 * Loads every stored document into the in-memory maps. Called once before the
 * app renders, so the synchronous accessors see the persisted files. Safe to
 * call again; later calls are no-ops.
 */
let hydrated = false;
export async function initLocalDocumentStorage(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const docs = await idbAll();
  for (const doc of docs) {
    blobs.set(doc.key, doc.blob);
    if (doc.row) {
      const fileId = doc.row.fileId;
      recordDocuments.set(fileId, [...(recordDocuments.get(fileId) ?? []), doc.row]);
    }
    if (doc.key.startsWith('derivative:')) {
      derivativeBytes.set(doc.key.slice('derivative:'.length), doc.blob);
    }
  }
}

/**
 * Reads a PDF page count the same way the API does, by scanning the raw bytes for
 * the page tree. This is a demo-mode hint, not a guarantee: anything unreadable
 * returns undefined so the UI omits the page label rather than claiming one page.
 */
async function countPdfPages(file: File): Promise<number | undefined> {
  try {
    const bytes = new Uint8Array(await file.slice(0, 32 * 1024 * 1024).arrayBuffer());
    let text = '';
    for (let at = 0; at < bytes.length; at += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(at, Math.min(at + 0x8000, bytes.length)));
    }
    if (!text.startsWith('%PDF-')) return undefined;

    let total = 0;
    for (const node of text.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g) ?? []) {
      const count = Number(/\/Count\s+(\d+)/.exec(node)?.[1] ?? '0');
      if (count > 0) total += count;
    }
    if (total > 0) return total;

    const leaves = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
    return leaves && leaves.length > 0 ? leaves.length : undefined;
  } catch {
    return undefined;
  }
}

export function localDocumentInfo(file: File): LocalDocumentInfo {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return { contentType: mimeByExtension[extension] ?? file.type, sizeBytes: file.size, sha256: '' };
}

async function documentInfo(file: File): Promise<LocalDocumentInfo> {
  const info = localDocumentInfo(file);
  if (info.contentType !== 'application/pdf') return info;
  return { ...info, pageCount: await countPdfPages(file) };
}

export function listLocalRecordDocuments(fileId: string): RecordFileDocument[] {
  return [...(recordDocuments.get(fileId) ?? [])].sort((a, b) => b.version - a.version);
}

export async function addLocalRecordDocument(fileId: string, barcode: string, file: File) {
  const issue = validateDocumentFile(file);
  if (issue) return err<RecordFileDocument>(issue, 'document');
  const info = await documentInfo(file);
  const rows = recordDocuments.get(fileId) ?? [];
  const row: RecordFileDocument = {
    id: newId('document'),
    fileId,
    fileBarcode: barcode,
    version: rows.reduce((max, item) => Math.max(max, item.version), 0) + 1,
    filename: file.name,
    contentType: info.contentType,
    sizeBytes: info.sizeBytes,
    sha256: info.sha256,
    uploadedAt: timestamp(),
    uploadedBy: session.userName(),
  };
  recordDocuments.set(fileId, [...rows, row]);
  const key = blobKey('record', row.id);
  const blob = new Blob([file], { type: info.contentType });
  blobs.set(key, blob);
  await idbPut({ key, blob, row });
  return ok(row);
}

export async function saveLocalRowDocument(
  scope: 'page' | 'map',
  id: string,
  file: File,
): Promise<LocalDocumentInfo> {
  const issue = validateDocumentFile(file);
  if (issue) throw new Error(issue);
  const info = await documentInfo(file);
  const key = blobKey(scope, id);
  const blob = new Blob([file], { type: info.contentType });
  blobs.set(key, blob);
  await idbPut({ key, blob });
  return info;
}

/** Stores the bytes of a locally built deliverable PDF (write-through). */
export async function saveLocalDerivativeBytes(id: string, bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  derivativeBytes.set(id, blob);
  await idbPut({ key: `derivative:${id}`, blob });
}

/** The stored bytes of a locally built deliverable, or null when they are gone. */
export function localDerivativeBlob(id: string): Blob | null {
  return derivativeBytes.get(id) ?? null;
}

export function localDocumentBlob(scope: 'record' | 'page' | 'map', id: string): Blob {
  const blob = blobs.get(blobKey(scope, id));
  if (!blob) throw new Error('This scan has no stored document bytes in local demo mode.');
  return blob;
}

export function localRecordDocumentBlob(fileId: string, documentId: string): Blob {
  const belongsToRecord = (recordDocuments.get(fileId) ?? []).some(
    (item) => item.id === documentId,
  );
  if (!belongsToRecord) throw new Error('Document not found for this record.');
  return localDocumentBlob('record', documentId);
}

/** Removes one stored scan version and its bytes; mirrors the API's delete. */
export async function deleteLocalRecordDocument(
  fileId: string,
  documentId: string,
): Promise<{ filename: string; version: number } | null> {
  const rows = recordDocuments.get(fileId) ?? [];
  const row = rows.find((item) => item.id === documentId);
  if (!row) return null;
  recordDocuments.set(
    fileId,
    rows.filter((item) => item.id !== documentId),
  );
  blobs.delete(blobKey('record', documentId));
  await idbDelete(blobKey('record', documentId));
  return { filename: row.filename, version: row.version };
}

export async function clearLocalDocumentStorage(): Promise<void> {
  blobs.clear();
  recordDocuments.clear();
  derivativeBytes.clear();
  await idbClear();
}

function blobKey(scope: 'record' | 'page' | 'map', id: string): string {
  return `${scope}:${id}`;
}
