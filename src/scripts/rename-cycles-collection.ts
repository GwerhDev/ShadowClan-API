// One-time script to migrate the "attendancecycles" collection to "cycles",
// following the rename of the AttendanceCycle model to Cycle.
// Run with: npx ts-node -r dotenv/config src/scripts/rename-cycles-collection.ts
import 'dotenv/config';
import mongoose from 'mongoose';
import { mongodbString } from '../config';

async function main() {
  await mongoose.connect(mongodbString);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;
  const existing = await db.listCollections({ name: 'attendancecycles' }).toArray();

  if (!existing.length) {
    console.log('No "attendancecycles" collection found — nothing to migrate.');
  } else {
    const targetExists = (await db.listCollections({ name: 'cycles' }).toArray()).length > 0;
    if (targetExists) {
      const targetCount = await db.collection('cycles').countDocuments();
      if (targetCount > 0) {
        throw new Error(
          `"cycles" already exists AND has ${targetCount} document(s) — refusing to overwrite. Inspect manually.`
        );
      }
      // Empty collection, likely auto-created by Mongoose registering the new "Cycle" model. Safe to drop.
      await db.collection('cycles').drop();
      console.log('Dropped pre-existing empty "cycles" collection.');
    }
    await db.collection('attendancecycles').rename('cycles');
    console.log('Renamed "attendancecycles" -> "cycles".');
  }

  await mongoose.disconnect();
  console.log('Done');
}

main().catch(err => { console.error(err); process.exit(1); });
