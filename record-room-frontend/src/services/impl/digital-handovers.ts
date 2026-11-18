import { err, type DigitalHandoverApi } from '../contracts';

/**
 * The local sample store contains no signed/approved PDF derivatives from the
 * API, so it deliberately cannot fabricate an official handover receipt.
 */
export const digitalHandoverService: DigitalHandoverApi = {
  async list() {
    return [];
  },
  async prepare() {
    return err('Digital handover requires the SQL Server API and approved Final PDF documents.');
  },
  async markDelivered() {
    return err('Digital handover requires the SQL Server API.');
  },
  async signOff() {
    return err('Digital handover requires the SQL Server API.');
  },
  async packageBlob() {
    throw new Error('Digital handover packages are available from the SQL Server API.');
  },
};
