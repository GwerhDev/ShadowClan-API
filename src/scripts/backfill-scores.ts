// One-time script to backfill score for all existing Character documents.
// Run with: npx ts-node -r dotenv/config src/scripts/backfill-scores.ts
import 'dotenv/config';
import mongoose from 'mongoose';
import { mongodbString } from '../config';
import Character from '../models/Character';
import { calcScore } from '../helpers/score';

async function main() {
  await mongoose.connect(mongodbString);
  console.log('Connected to MongoDB');

  const chars = await Character.find({}).lean();
  console.log(`Found ${chars.length} characters`);

  const ops = chars.map(c => ({
    updateOne: {
      filter: { _id: c._id },
      update: { $set: { score: calcScore(c) } },
    },
  }));

  if (ops.length) {
    const result = await Character.bulkWrite(ops);
    console.log(`Updated ${result.modifiedCount} characters`);
  }

  await mongoose.disconnect();
  console.log('Done');
}

main().catch(err => { console.error(err); process.exit(1); });
