/**
 * Test Oracle Cloud Object Storage Connection
 * Run with: node test-oci.js
 */

const os = require("oci-objectstorage");
const { ConfigFileAuthenticationDetailsProvider, ConfigFile } = require("oci-common");

async function testOCIConnection() {
  console.log('🔍 Testing Oracle Cloud Object Storage connection...\n');

  // Check for ORACLE_SECRET
  if (!process.env.ORACLE_SECRET) {
    console.error('❌ ORACLE_SECRET environment variable not found!');
    console.error('\nPlease set ORACLE_SECRET in your environment or Render dashboard.');
    process.exit(1);
  }

  // Parse credentials
  let oracleCredentials;
  try {
    oracleCredentials = JSON.parse(
      Buffer.from(process.env.ORACLE_SECRET, 'base64').toString('utf-8')
    );
    console.log('✅ ORACLE_SECRET parsed successfully');
  } catch (error) {
    console.error('❌ Failed to parse ORACLE_SECRET:', error.message);
    process.exit(1);
  }

  // Validate required fields
  const required = ['userOcid', 'tenancyOcid', 'fingerprint', 'region', 'namespace', 'bucketName', 'privateKey'];
  const missing = required.filter(field => !oracleCredentials[field]);

  if (missing.length > 0) {
    console.error('❌ Missing required fields:', missing.join(', '));
    process.exit(1);
  }

  console.log('✅ All required credentials present');
  console.log('   Region:', oracleCredentials.region);
  console.log('   Namespace:', oracleCredentials.namespace);
  console.log('   Bucket:', oracleCredentials.bucketName);

  // Create authentication provider
  let provider;
  try {
    const config = new ConfigFile({
      user: oracleCredentials.userOcid,
      tenancy: oracleCredentials.tenancyOcid,
      fingerprint: oracleCredentials.fingerprint,
      region: oracleCredentials.region,
      keyContent: oracleCredentials.privateKey,
      passphrase: oracleCredentials.passphrase || null
    });

    provider = new ConfigFileAuthenticationDetailsProvider(config);
    console.log('✅ Authentication provider created');
  } catch (error) {
    console.error('❌ Failed to create authentication provider:', error.message);
    process.exit(1);
  }

  // Create Object Storage client
  const client = new os.ObjectStorageClient({
    authenticationDetailsProvider: provider
  });
  console.log('✅ Object Storage client initialized');

  // Test 1: List objects in bucket (verifies read access)
  console.log('\n📦 Testing bucket access...');
  try {
    const listResponse = await client.listObjects({
      namespaceName: oracleCredentials.namespace,
      bucketName: oracleCredentials.bucketName,
      limit: 10
    });
    console.log('✅ Bucket access successful!');
    console.log('   Objects in bucket:', listResponse.listObjects?.objects?.length || 0);
  } catch (error) {
    console.error('❌ Bucket access failed:', error.message);
    console.error('   Make sure the bucket name is correct and you have permissions');
    process.exit(1);
  }

  // Test 2: Try to create a test object (verifies write access)
  console.log('\n📤 Testing write permissions...');
  try {
    const testData = Buffer.from('OCI connection test - ' + new Date().toISOString());
    const testObjectName = 'test-connection-' + Date.now() + '.txt';

    const putResponse = await client.putObject({
      namespaceName: oracleCredentials.namespace,
      bucketName: oracleCredentials.bucketName,
      objectName: testObjectName,
      putObjectBody: testData,
      contentLength: testData.length,
      contentType: 'text/plain'
    });

    if (putResponse.opcRequestId) {
      console.log('✅ Write permissions confirmed!');
      console.log('   Test object created:', testObjectName);

      // Clean up test object
      await client.deleteObject({
        namespaceName: oracleCredentials.namespace,
        bucketName: oracleCredentials.bucketName,
        objectName: testObjectName
      });
      console.log('✅ Test object deleted');
    }
  } catch (error) {
    console.error('❌ Write test failed:', error.message);
    console.error('   Make sure you have write permissions on the bucket');
    process.exit(1);
  }

  // Test 3: Create a pre-authenticated request (verifies PAR creation)
  console.log('\n🔗 Testing pre-authenticated request creation...');
  try {
    const parResponse = await client.createPreauthenticatedRequest({
      namespaceName: oracleCredentials.namespace,
      bucketName: oracleCredentials.bucketName,
      createPreauthenticatedRequestDetails: {
        name: 'test-par-' + Date.now(),
        objectName: 'test-object.txt',
        accessType: os.models.CreatePreauthenticatedRequestDetails.AccessType.ObjectRead,
        timeExpires: new Date(Date.now() + 3600000) // 1 hour
      }
    });

    if (parResponse.preauthenticatedRequest) {
      console.log('✅ Pre-authenticated request created successfully!');
      console.log('   PAR URL:', parResponse.preauthenticatedRequest.fullPath.substring(0, 80) + '...');
    }
  } catch (error) {
    console.error('❌ PAR creation failed:', error.message);
    console.error('   Make sure you have permission to create PARs');
    process.exit(1);
  }

  console.log('\n✅ All tests passed! Oracle Cloud integration is ready.');
  console.log('\n📝 Summary:');
  console.log('   ✅ Credentials valid');
  console.log('   ✅ Bucket accessible');
  console.log('   ✅ Write permissions OK');
  console.log('   ✅ PAR creation works');
}

// Run the test
testOCIConnection().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  console.error(error);
  process.exit(1);
});
