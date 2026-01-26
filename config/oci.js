const { SimpleAuthenticationDetailsProvider, Region, Realm } = require("oci-common");

let _cachedConfig = null;

/**
 * Get OCI configuration (lazy-loaded, only when needed)
 */
function getOCIConfig() {
  if (_cachedConfig) {
    return _cachedConfig;
  }

  let oracleCredentials;

  try {
    // Parse ORACLE_SECRET - should be base64 encoded JSON
    if (process.env.ORACLE_SECRET) {
      oracleCredentials = JSON.parse(
        Buffer.from(process.env.ORACLE_SECRET, 'base64').toString('utf-8')
      );
    } else {
      // Fallback to individual environment variables
      oracleCredentials = {
        userOcid: process.env.OCI_USER_OCID,
        tenancyOcid: process.env.OCI_TENANCY_OCID,
        fingerprint: process.env.OCI_FINGERPRINT,
        region: process.env.OCI_REGION,
        privateKey: process.env.OCI_PRIVATE_KEY,
        namespace: process.env.OCI_NAMESPACE,
        bucketName: process.env.OCI_BUCKET_NAME,
        passphrase: process.env.OCI_PASS_PHRASE
      };
    }
  } catch (error) {
    console.error('Failed to parse Oracle credentials:', error.message);
    throw new Error('Oracle Cloud credentials not properly configured');
  }

  if (!oracleCredentials.userOcid || !oracleCredentials.tenancyOcid || !oracleCredentials.privateKey) {
    throw new Error('Missing required Oracle credentials: userOcid, tenancyOcid, or privateKey');
  }

  // Fix escaped newlines in private key
  if (oracleCredentials.privateKey.includes("\\n")) {
    oracleCredentials.privateKey = oracleCredentials.privateKey.replace(/\\n/g, "\n");
  }

  console.log('[OCI] Config loaded:', {
    userOcid: oracleCredentials.userOcid?.substring(0, 20) + '...',
    tenancyOcid: oracleCredentials.tenancyOcid?.substring(0, 20) + '...',
    fingerprint: oracleCredentials.fingerprint,
    region: oracleCredentials.region,
    namespace: oracleCredentials.namespace,
    bucketName: oracleCredentials.bucketName,
    hasPassphrase: !!oracleCredentials.passphrase,
    privateKeyLength: oracleCredentials.privateKey?.length,
    privateKeyStart: oracleCredentials.privateKey?.substring(0, 50)
  });

  if (!oracleCredentials.region) {
    throw new Error('Missing required Oracle credentials: region');
  }

  let region;
  try {
    region = Region.fromRegionId(oracleCredentials.region);
  } catch (error) {
    console.log('[OCI] Region not found in registry, registering manually:', oracleCredentials.region);
    const fallbackSecondLevelDomain = process.env.OCI_DEFAULT_REALM;
    if (fallbackSecondLevelDomain) {
      const unknownRealm = Realm.register("unknown", fallbackSecondLevelDomain);
      region = Region.register(oracleCredentials.region, unknownRealm);
    } else {
      region = Region.register(oracleCredentials.region, Realm.OC1);
    }
  }

  // Create authentication provider directly with configuration values
  console.log('[OCI] Creating SimpleAuthenticationDetailsProvider...');
  const provider = new SimpleAuthenticationDetailsProvider(
    oracleCredentials.tenancyOcid,
    oracleCredentials.userOcid,
    oracleCredentials.fingerprint,
    oracleCredentials.privateKey,
    oracleCredentials.passphrase || null,
    region
  );
  console.log('[OCI] Authentication provider created successfully');

  _cachedConfig = {
    provider,
    namespace: oracleCredentials.namespace,
    bucketName: oracleCredentials.bucketName,
    region: oracleCredentials.region
  };

  return _cachedConfig;
}

module.exports = { getOCIConfig };
