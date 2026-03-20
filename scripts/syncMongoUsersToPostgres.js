const path = require('path');
const dotenv = require('dotenv');
const { syncMongoUsersToPostgres } = require('../services/userSyncService');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

syncMongoUsersToPostgres()
  .then((stats) => {
    console.log('[SYNC] Completed:', JSON.stringify(stats, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error('[SYNC] Fatal error:', error);
    process.exit(1);
  });
