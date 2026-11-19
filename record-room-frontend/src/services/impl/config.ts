/**
 * Local-mode adapter for the feature switchboard (ZILA_PANCHAYAT_CC §F).
 *
 * The grouped switches persist in localStorage through `lib/features.ts`, so
 * Settings → Feature visibility works with no backend. In http mode the same
 * card talks to `PUT /api/config/features` and the API's rows win.
 */

import { applyFeatures, getFeatures, type FeatureKey, type Features } from '../../lib/features';
import { err, ok, type AppConfigInfo, type ConfigApi, type Result } from '../contracts';
import { session } from './session';

export const configService: ConfigApi = {
  async features(): Promise<Features> {
    return { ...getFeatures() };
  },

  /**
   * Local demo mode: the whole adapter is the demo, so demoMode is always on
   * and the (simulated) OCR engine is always "available". Feature editing is
   * open — there is no server environment to lock it with.
   */
  async info(): Promise<AppConfigInfo> {
    return {
      appName: 'Document Management System',
      features: { ...getFeatures() },
      settingsEditable: true,
      demoMode: true,
      ocr: {
        enabled: true,
        available: true,
        engine: 'demo',
        languages: 'hin+eng',
        note: 'Demo mode simulates OCR; connect the API for real recognition.',
      },
    };
  },

  async updateFeatures(patch: Partial<Record<FeatureKey, boolean>>): Promise<Result<Features>> {
    if (session.role() !== 'Admin') {
      return err('Only an admin can change feature visibility.', 'role');
    }
    const keys = Object.keys(patch);
    if (keys.length === 0) return err('Name at least one feature group.', 'features');
    const unknown = keys.filter((key) => !(key in getFeatures()));
    if (unknown.length > 0) {
      return err(`Unknown feature group(s): ${unknown.join(', ')}.`, 'features');
    }
    applyFeatures(patch as Partial<Features>);
    return ok({ ...getFeatures() });
  },
};
