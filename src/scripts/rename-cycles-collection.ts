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
    await db.collection('attendancecycles').rename('cycles');
    console.log('Renamed "attendancecycles" -> "cycles".');
  }

  await mongoose.disconnect();
  console.log('Done');
}

main().catch(err => { console.error(err); process.exit(1); });
