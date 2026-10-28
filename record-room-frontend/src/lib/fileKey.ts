import type { RecordFile } from '../types';
import type { RecordRoomService } from '../services';

/**
 * Finds a file from what a person typed.
 *
 * With barcodes on, the text is tried as a barcode first (a scanner types one). With
 * barcodes off, or when no barcode matches, it is matched against the file number
 * exactly. Returns null when nothing matches, so the caller can say so in its own words.
 */
export async function findFileByInput(
  service: RecordRoomService,
  input: string,
  barcodeOn: boolean,
): Promise<RecordFile | null> {
  const value = input.trim();
  if (!value) return null;
  if (barcodeOn) {
    const byBarcode = await service.files.byBarcode(value).catch(() => null);
    if (byBarcode) return byBarcode;
  }
  const result = await service.files.list({ search: value, pageSize: 10 });
  const wanted = value.toLowerCase();
  return result.items.find((file) => file.fileNumber.toLowerCase() === wanted) ?? null;
}
