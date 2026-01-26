/**
 * Test Oracle Cloud Credentials (Local Test)
 * This test validates your credentials file without connecting to Oracle Cloud
 */

const fs = require('fs');
const path = require('path');

function testCredentialsFile() {
  console.log('🔍 Validating Oracle Cloud credentials file...\n');

  // Read the base64 encoded secret
  const secretPath = path.join(__dirname, '../ORACLE_SECRET.txt');

  if (!fs.existsSync(secretPath)) {
    console.error('❌ ORACLE_SECRET.txt not found!');
    console.error('   Please make sure the file exists in the project root.');
    return false;
  }

  let base64Secret;
  try {
    base64Secret = fs.readFileSync(secretPath, 'utf-8').trim();
    console.log('✅ ORACLE_SECRET.txt found');
  } catch (error) {
    console.error('❌ Failed to read ORACLE_SECRET.txt:', error.message);
    return false;
  }

  // Decode base64
  let jsonStr;
  try {
    jsonStr = Buffer.from(base64Secret, 'base64').toString('utf-8');
    console.log('✅ Base64 decoding successful');
  } catch (error) {
    console.error('❌ Base64 decoding failed:', error.message);
    return false;
  }

  // Parse JSON
  let credentials;
  try {
    credentials = JSON.parse(jsonStr);
    console.log('✅ JSON parsing successful');
  } catch (error) {
    console.error('❌ JSON parsing failed:', error.message);
    console.error('   The file might not be valid JSON');
    return false;
  }

  // Validate required fields
  const required = {
    userOcid: 'User OCID',
    tenancyOcid: 'Tenancy OCID',
    fingerprint: 'API Key Fingerprint',
    region: 'Region (e.g., uk-london-1)',
    namespace: 'Object Storage Namespace',
    bucketName: 'Bucket Name',
    privateKey: 'Private Key'
  };

  let allValid = true;
  for (const [key, label] of Object.entries(required)) {
    if (!credentials[key]) {
      console.error(`❌ Missing: ${label} (${key})`);
      allValid = false;
    } else {
      // Validate format
      if (key === 'userOcid' && !credentials[key].startsWith('ocid1.user.oc1')) {
        console.error(`❌ Invalid format for ${key}`);
        allValid = false;
      } else if (key === 'tenancyOcid' && !credentials[key].startsWith('ocid1.tenancy.oc1')) {
        console.error(`❌ Invalid format for ${key}`);
        allValid = false;
      } else if (key === 'fingerprint' && !credentials[key].match(/^[\d:a-f]{2}(:[\d:a-f]{2}){15}$/)) {
        console.error(`❌ Invalid format for ${key} (should be XX:XX:XX...)`);
        allValid = false;
      } else if (key === 'region' && !credentials[key].match(/^[a-z]+-[a-z]+-\d+$/)) {
        console.error(`❌ Invalid format for ${key} (should be like uk-london-1)`);
        allValid = false;
      } else if (key === 'privateKey' && !credentials[key].includes('BEGIN')) {
        console.error(`❌ Invalid format for ${key} (should be a PEM key)`);
        allValid = false;
      } else {
        console.log(`✅ ${label}: present`);
      }
    }
  }

  if (!allValid) {
    console.log('\n❌ Credentials validation FAILED');
    console.log('   Please fix the issues above and try again.');
    return false;
  }

  // Show summary
  console.log('\n📋 Credentials Summary:');
  console.log(`   User OCID: ${credentials.userOcid.substring(0, 30)}...`);
  console.log(`   Tenancy OCID: ${credentials.tenancyOcid.substring(0, 30)}...`);
  console.log(`   Fingerprint: ${credentials.fingerprint}`);
  console.log(`   Region: ${credentials.region}`);
  console.log(`   Namespace: ${credentials.namespace}`);
  console.log(`   Bucket: ${credentials.bucketName}`);
  console.log(`   Private Key: ${credentials.privateKey.substring(0, 30)}...`);

  console.log('\n✅ Credentials file is VALID!');
  console.log('\n📝 Next Steps:');
  console.log('   1. Make sure ORACLE_SECRET is set in Render dashboard');
  console.log('   2. Deploy the code to Render');
  console.log('   3. Test video upload from the app');

  return true;
}

// Run the test
const success = testCredentialsFile();
process.exit(success ? 0 : 1);
