import { pdfjs } from 'react-pdf';

// Ensure pdfjs worker is ready for rendering
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * Extracts each page of a PDF into a PNG File, suitable for page-by-page editing,
 * drag-and-drop reordering, and OCR in the Scan Studio.
 */
export async function extractPdfPagesToImages(
  source: Blob | File,
  baseFilename: string,
): Promise<File[]> {
  const arrayBuffer = await source.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const files: File[] = [];

  const cleanName = baseFilename.replace(/\.pdf$/i, '');

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    if (!context) continue;

    await page.render({ canvasContext: context, viewport, canvas }).promise;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png');
    });

    if (blob) {
      const pageFile = new File([blob], `${cleanName}-page-${i}.png`, {
        type: 'image/png',
      });
      files.push(pageFile);
    }
  }

  return files;
}
