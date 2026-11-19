import type { DocumentDerivative, RecordFileDocument } from '../types';

export interface StudioDraftState {
  sourceVersionId?: string;
  sourceFilename: string;
  draftFilename: string;
  pageCount: number;
  updatedAt: string;
}

export function getStudioDraft(fileId: string): StudioDraftState | null {
  try {
    const raw = localStorage.getItem(`rr-draft-${fileId}`);
    return raw ? (JSON.parse(raw) as StudioDraftState) : null;
  } catch {
    return null;
  }
}

export function setStudioDraft(fileId: string, draft: StudioDraftState | null) {
  try {
    if (draft) localStorage.setItem(`rr-draft-${fileId}`, JSON.stringify(draft));
    else localStorage.removeItem(`rr-draft-${fileId}`);
  } catch {
    // ignore
  }
}

export function computeNextVersionName(
  sourceName: string,
  existingDerivatives: DocumentDerivative[],
  existingDocs: RecordFileDocument[],
): string {
  const clean = sourceName.replace(/\.pdf$/i, '').replace(/[_-]v\d+$/i, '');
  let maxV = 1;
  for (const doc of existingDocs) {
    if (doc.version > maxV) maxV = doc.version;
  }
  for (const deriv of existingDerivatives) {
    const match = deriv.filename.match(/[_-]v(\d+)\.pdf$/i);
    if (match) {
      const v = Number.parseInt(match[1], 10);
      if (v > maxV) maxV = v;
    }
  }
  return `${clean}_v${maxV + 1}.pdf`;
}

export interface UnifiedDocumentVersion {
  id: string;
  source: 'document' | 'derivative';
  filename: string;
  versionLabel: string;
  updatedAt: string;
  pageCount?: number;
  sizeBytes?: number;
  status: 'Approved' | 'Pending approval' | 'Rejected';
  reviewNote?: string;
  reviewedBy?: string;
  rawDoc?: RecordFileDocument;
  rawDeriv?: DocumentDerivative;
}
