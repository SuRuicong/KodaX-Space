import { registerChannel } from './register.js';
import { licenseManager } from '../license/manager.js';

export function registerLicenseChannels(): void {
  registerChannel('license.getStatus', async () => licenseManager.getStatus());

  registerChannel('license.importEntitlement', async ({ filePath }) =>
    licenseManager.importEntitlement(filePath),
  );

  registerChannel('license.exportRequest', async (input) => licenseManager.exportRequest(input));

  registerChannel('license.requireEntitlement', async (input) =>
    licenseManager.requireEntitlement(input),
  );

  registerChannel('license.hasFeature', async ({ featureId }) =>
    licenseManager.hasFeature(featureId),
  );
}
