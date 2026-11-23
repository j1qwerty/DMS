import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Field, SelectInput } from '../components/ui/Field';
import { useFlash, useQuery, useService, useSession } from '../hooks/useService';
import type { AppConfigInfo, OcrEngine } from '../services/contracts';

export function OcrEngineCard() {
  const service = useService();
  const { user } = useSession();
  const { success, danger } = useFlash();
  const { data, loading, error, reload } = useQuery<AppConfigInfo | null>(
    () => service.config.info(),
    [],
    null,
    ['config'],
  );
  const [saving, setSaving] = useState(false);
  const status = data?.ocr;

  const save = async (engine: OcrEngine) => {
    setSaving(true);
    try {
      const result = await service.config.updateOcrEngine(engine);
      if (result.ok) {
        reload();
        success('OCR engine saved.');
      } else {
        danger(result.error);
      }
    } catch {
      danger('Could not save the OCR engine.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="max-w-md">
        <Field
          label="OCR Engine"
          htmlFor="ocr-engine"
          hint={status?.note}
          error={error ? 'Could not load the OCR setting.' : undefined}
        >
          <SelectInput
            id="ocr-engine"
            value={status?.engine ?? 'tesseract'}
            disabled={user?.role !== 'Admin' || loading || saving || !status}
            onChange={(event) =>
              void save(event.target.value === 'paddleocr' ? 'paddleocr' : 'tesseract')
            }
          >
            <option value="tesseract">Tesseract</option>
            <option value="paddleocr">PaddleOCR</option>
          </SelectInput>
        </Field>
      </div>
    </Card>
  );
}
