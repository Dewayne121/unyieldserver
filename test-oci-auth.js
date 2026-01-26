/**
 * Test OCI Authentication
 * Run: node test-oci-auth.js
 */

const { SimpleAuthenticationDetailsProvider, Region } = require("oci-common");
const os = require("oci-objectstorage");

// The private key from your NEW PEM file (2026-01-03T07_04_56)
const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDQy7RLdi479Smx
mBJk8/qX+ZeY+yqCSJdJZEcuQkjk73QXdLXv/Zq2LrPl8dGEu8OmMm9MHuA31uSH
haZJWQP1S+l+MiqG5fsb3TYNSw4YOb75DAgjhFDV9QUdnPrC2AuAxFqjOC4DSsaq
Mk9amobKDqQO+N7n+S0LKNehLNF+eUJgzptopeiQOAJYytdI55Kd7t4OWAPfx+Gt
IBx+xYId1Y5WdsJtGjhHY7Cr8ereDqbWLPPBjYjgOjcF8n/S2+vn4aULvNXEYnk5
p/C0a/qHOGvb03aBOzI84N0AWR1R4SrnImRBmoq2gMxspBQ4E9l30rVyhzWscoXR
BDav1YXZAgMBAAECggEAEhlDlhz251dE13JFTz8/fsfxsPQ98ZAlnloqZLighUkP
s5l4IdxGT7oe+Z+ArV7x7SicXClQVJbJ4B4g1WUkF4cOhNQIEAHEcVxh+zyrypl1
fooL9I7bdkhoZUeTtwBaMuhnq5P1l8R2EbpjBYlf215HMKMNqLxWgAv4xlhSX9eD
4WaTa83kTcML35TWM3fqiffRJ8UaUvQ/eZCTstXYMYC79qnbNq01uV9da2h87Lyn
Jj7k8RGn14r8DtFcaN8spzZioJu6011MpOUmBfJ6M+FbiS3bb+SHQr+0dAWhFywQ
RZ+Z5AmZsUBfdvebbRq8/ZJr85hyBrY7E+uPPeuSFwKBgQDwiyLJdSvhU2NtEFJP
A34MzpR9lKmQcP2HOT9JxBjgt0oe5FiioOmrzaVvfE8XN84HhKprJlrW6tMZAPRF
QC1jcvZs7mPk22ER1JHpeq1JHmJAFZ34i56/qnT1sgty6bx9kpjmIKnmCq31C4rA
+wc9ruqaql7XF59Db8Qf+g9jdwKBgQDeNlPXT8LBoxwGlTCkjrXxbXVZeLNw9Y7b
drjv9P//SlaGQK7rdkdod0K6pK2t/QyhnwhfSM1OOx/US+eWyRuIpF6Jhc/QmknU
HCy03fzIwGC7IMrCuwWv6fHJWcp61fyj8OYyITu7UoqvNkzSp4UmYxiwmm4ZqBvE
2QvaOlKVLwKBgAJP9BenrrJN0OjdfU0RJYcN/VNvuGmRDH7eSAN3hR2z5VyCqW92
yIhEQ9Dciw4YFTzxQ4ogJkNmonzdC3wW79jC5CeL6x3qFfbL6lMqQLwxNJSVIJ2h
CfehtdoeygliwdMbM6kSq09wztdKMx1DzIAFTHAMLzk2GuvVCTedecRlAoGBAL/o
HVpK2QDQNAj/WWYUlc8uX/VoR1hbygeBLdCWP2wjsDv7qtVRbfQrYya7x/8GFp2S
MfHQdvaEG0YGU7imcC/+/GI6fTJDvVUBDB8bxA9ADYoulM2+JPg6y4TAFh0lpy2S
g8txZhut+nW9KHWZFWYEmTMT+9gOlgTYCeNrER0jAoGBAKI1DK8ypSMWlC4uz1A0
1OKUtwEe6T21F5Dz93sb2DrSNps8XEc1pMJ+ZHHT3ITbI3LOno3GjCUCcQ1uoIw1
udH3aNE0joEeo5uTzoJwAV2abi6lvRuZ1d6gxzqWmiAogymgi8aC/zj5zbGLni/5
IvHfuK7pJsOCT5iuniwLMN/m
-----END PRIVATE KEY-----`;

// OCI Configuration - Updated with NEW API key
const config = {
  tenancyOcid: 'ocid1.tenancy.oc1..aaaaaaaaiv2zdgizvr3gf52f3ltotpixp3jpbsdqoxnrhodajno5tdgykxaa',
  userOcid: 'ocid1.user.oc1..aaaaaaaaefhghvji52jlpp2kyyhwwvchnivq3npzpwoprcehrq2ulxixhyeq',
  fingerprint: 'eb:35:33:a9:9f:37:de:5d:91:4e:c1:6d:7f:eb:fd:31',
  region: 'uk-london-1',
  namespace: 'lreyonl7mhbg',
  bucketName: 'unyield-videos-prod'
};

async function testOCIConnection() {
  console.log('Testing OCI Authentication...\n');

  console.log('Configuration:');
  console.log('  Tenancy:', config.tenancyOcid.substring(0, 30) + '...');
  console.log('  User:', config.userOcid.substring(0, 30) + '...');
  console.log('  Fingerprint:', config.fingerprint);
  console.log('  Region:', config.region);
  console.log('  Namespace:', config.namespace);
  console.log('  Bucket:', config.bucketName);
  console.log('  Private Key Length:', privateKey.length);
  console.log();

  try {
    // Create authentication provider
    console.log('1. Creating authentication provider...');
    const provider = new SimpleAuthenticationDetailsProvider(
      config.tenancyOcid,
      config.userOcid,
      config.fingerprint,
      privateKey,
      null, // passphrase
      Region.UK_LONDON_1
    );
    console.log('   SUCCESS: Authentication provider created\n');

    // Create Object Storage client
    console.log('2. Creating Object Storage client...');
    const objectStorageClient = new os.ObjectStorageClient({
      authenticationDetailsProvider: provider
    });
    console.log('   SUCCESS: Object Storage client created\n');

    // Test listing objects in bucket
    console.log('3. Testing bucket access (listObjects)...');
    const listRequest = {
      namespaceName: config.namespace,
      bucketName: config.bucketName,
      limit: 1
    };

    const listResponse = await objectStorageClient.listObjects(listRequest);
    console.log('   SUCCESS: Bucket access works!');
    console.log('   Objects found:', listResponse.listObjects.objects?.length || 0);
    console.log();

    console.log('===========================================');
    console.log('ALL TESTS PASSED - OCI Configuration is correct!');
    console.log('===========================================');

  } catch (error) {
    console.error('ERROR:', error.message);
    console.error();
    console.error('Full error:');
    console.error(error);

    if (error.statusCode === 401) {
      console.error('\n--- AUTHENTICATION FAILED ---');
      console.error('Possible causes:');
      console.error('1. The fingerprint does not match the API key in OCI console');
      console.error('2. The private key does not match the public key uploaded to OCI');
      console.error('3. The API key may have been deleted or regenerated');
      console.error('\nTo fix:');
      console.error('1. Go to OCI Console > Identity > Users > Your User > API Keys');
      console.error('2. Check if an API key with fingerprint', config.fingerprint, 'exists');
      console.error('3. If not, create a new API key and update the fingerprint');
    }
  }
}

testOCIConnection();
