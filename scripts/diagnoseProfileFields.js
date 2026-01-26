/**
 * Diagnostic script - show raw document structure
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');

async function diagnose() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Get raw documents using lean()
    const rawDocs = await User.find({}).lean();

    console.log(`Found ${rawDocs.length} raw documents\n`);

    rawDocs.forEach((doc) => {
      console.log('────────────────────────────────────');
      console.log(`User: ${doc.username || doc.email}`);
      console.log(`  _id: ${doc._id}`);
      console.log(`  weight key exists: ${'weight' in doc}`);
      console.log(`  weight value: ${doc.weight} (type: ${typeof doc.weight})`);
      console.log(`  height key exists: ${'height' in doc}`);
      console.log(`  height value: ${doc.height} (type: ${typeof doc.height})`);
      console.log(`  age key exists: ${'age' in doc}`);
      console.log(`  age value: ${doc.age} (type: ${typeof doc.age})`);
      console.log('\n  Full document keys:', Object.keys(doc).filter(k => ['weight', 'height', 'age', '_id', 'username', 'email'].includes(k)));
    });

    console.log('\n────────────────────────────────────');
    console.log('Adding missing fields to ALL users...\n');

    for (const doc of rawDocs) {
      const updates = {};

      if (!('weight' in doc)) {
        updates.weight = null;
        console.log(`${doc.username || doc.email}: Missing 'weight' key`);
      }
      if (!('height' in doc)) {
        updates.height = null;
        console.log(`${doc.username || doc.email}: Missing 'height' key`);
      }
      if (!('age' in doc)) {
        updates.age = null;
        console.log(`${doc.username || doc.email}: Missing 'age' key`);
      }

      if (Object.keys(updates).length > 0) {
        console.log(`  Adding: ${Object.keys(updates).join(', ')}\n`);
        await User.updateOne({ _id: doc._id }, { $set: updates });
      }
    }

    console.log('\n────────────────────────────────────');
    console.log('Verification - checking documents again...\n');

    const rawDocs2 = await User.find({}).lean();
    rawDocs2.forEach((doc) => {
      console.log(`User: ${doc.username || doc.email}`);
      console.log(`  weight: ${doc.weight ?? 'MISSING'}`);
      console.log(`  height: ${doc.height ?? 'MISSING'}`);
      console.log(`  age: ${doc.age ?? 'MISSING'}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

diagnose()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
