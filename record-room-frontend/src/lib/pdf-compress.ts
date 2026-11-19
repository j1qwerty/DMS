import { pdfjs } from 'react-pdf';
import type { CompressionLevelKey } from '../services/contracts';
import { COMPRESSION_LEVELS, type CompressionLevelDef } from './compression-levels';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * Client-side PDF compression (round 5): render each page with pdf.js at a
 * level-controlled scale, re-encode it as JPEG at a level-controlled quality,
 * and compose a new PDF that embeds the JPEGs directly (DCTDecode). Scanned
 * pages carry their pixels as high-bitmap images, which is exactly what this
 * pipeline shrinks; a text-only PDF can come out larger, which the caller
 * detects through the probe and reports instead of applying.
 *
 * The API runs the same trade-off server-side with QuestPDF when
 * `VITE_API_MODE=http`; this module is what the estimate probe and the local
 * adapter share, so the percentages shown are measured, not guessed.
 */

const levelDef = (level: CompressionLevelKey): CompressionLevelDef =>
  COMPRESSION_LEVELS.find((def) => def.key === level) ?? COMPRESSION_LEVELS[1];

async function loadPdf(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  return pdfjs.getDocument({ data: arrayBuffer }).promise;
}

async function renderPageJpeg(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  pageNo: number,
  def: CompressionLevelDef,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const page = await pdf.getPage(pageNo);
  const viewport = page.getViewport({ scale: def.scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) return null;

  // JPEG has no alpha; fill white so transparent regions do not turn black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/jpeg', def.quality);
  });
  if (!blob) return null;
  return { blob, width: canvas.width, height: canvas.height };
}

export interface ProbeResult {
  /** Average encoded size of the probed pages, in bytes. */
  bytesPerPage: number;
  /** Total pages of the source document. */
  pageCount: number;
}

/**
 * Measures what one level would produce, without building the whole file: the
 * first pages are encoded and their average becomes the per-page estimate. The
 * probe cost is bounded (`maxPages` renders per level) so opening the dialog
 * stays fast even for thick scans.
 */
export async function probeCompression(
  source: Blob,
  level: CompressionLevelKey,
  maxPages = 3,
): Promise<ProbeResult> {
  const def = levelDef(level);
  const pdf = await loadPdf(source);
  const count = Math.min(maxPages, pdf.numPages);
  let total = 0;
  let measured = 0;
  for (let pageNo = 1; pageNo <= count; pageNo += 1) {
    const rendered = await renderPageJpeg(pdf, pageNo, def);
    if (!rendered) continue;
    total += rendered.blob.size;
    measured += 1;
  }
  return {
    bytesPerPage: measured > 0 ? total / measured : 0,
    pageCount: pdf.numPages,
  };
}

export interface CompressedPdf {
  bytes: Uint8Array;
  pageCount: number;
}

/** Runs the full compression pass: every page re-encoded and re-assembled. */
export async function compressPdfBlob(
  source: Blob,
  level: CompressionLevelKey,
  onProgress?: (done: number, total: number) => void,
): Promise<CompressedPdf> {
  const def = levelDef(level);
  const pdf = await loadPdf(source);
  const pages: Array<{ jpeg: Uint8Array; width: number; height: number }> = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const rendered = await renderPageJpeg(pdf, pageNo, def);
    if (rendered) {
      pages.push({
        jpeg: new Uint8Array(await rendered.blob.arrayBuffer()),
        width: rendered.width,
        height: rendered.height,
      });
    }
    onProgress?.(pageNo, pdf.numPages);
  }

  return { bytes: composeJpegPdf(pages), pageCount: pages.length };
}

/**
 * A minimal but valid PDF that embeds the JPEGs as DCTDecode images, one per
 * page, with the page box matching the raster's aspect. Object layout mirrors
 * the local build in `services/impl/scans.ts` (catalog, pages, then per page:
 * image XObject + content stream). Assembly is binary-safe: offsets are
 * measured while the parts are laid out, never from string lengths alone.
 */
type PdfPart = string | Uint8Array;

interface ImageObject {
  dict: string;
  jpeg: Uint8Array;
}

function composeJpegPdf(
  pages: Array<{ jpeg: Uint8Array; width: number; height: number }>,
): Uint8Array {
  // Object 1: catalog. Object 2: page tree. Object 3: unused font kept for
  // numbering parity with the local text-PDF writer. Then 3 objects per page.
  const objects: Array<string | ImageObject> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 3} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((page, index) => {
    const imageObjNo = 4 + index * 3;
    const contentObjNo = 5 + index * 3;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
        `/Resources << /XObject << /Im1 ${imageObjNo} 0 R >> >> /Contents ${contentObjNo} 0 R >>`,
    );
    objects.push({
      dict:
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.byteLength} >>\nstream\n`,
      jpeg: page.jpeg,
    });
    const content = `q ${page.width} 0 0 ${page.height} 0 0 cm /Im1 Do Q`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const parts: PdfPart[] = ['%PDF-1.4\n'];
  const offsets: number[] = [];
  let length = 0;
  objects.forEach((body, index) => {
    offsets.push(length);
    const head = `${index + 1} 0 obj\n`;
    parts.push(head);
    length += head.length;
    if (typeof body === 'string') {
      // Dictionary-only objects and content streams close their own stream.
      parts.push(body, '\nendobj\n');
      length += body.length + '\nendobj\n'.length;
    } else {
      // The dict opens `stream\n`; the JPEG bytes follow, then it closes.
      parts.push(body.dict, body.jpeg, '\nendstream\nendobj\n');
      length += body.dict.length + body.jpeg.byteLength + '\nendstream\nendobj\n'.length;
    }
  });

  const xrefStart = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  parts.push(xref, trailer);

  const total = parts.reduce(
    (sum, part) => sum + (typeof part === 'string' ? part.length : part.byteLength),
    0,
  );
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) cursor = writeTo(out, part, cursor);
  return out;
}

function writeTo(target: Uint8Array, value: string | Uint8Array, cursor: number): number {
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i += 1) target[cursor + i] = value.charCodeAt(i) & 0xff;
    return cursor + value.length;
  }
  target.set(value, cursor);
  return cursor + value.byteLength;
}
