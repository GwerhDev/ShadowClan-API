// One-time script:
// 1. Moves every Cycle with activityType 'accursed_tower' into the new Season
//    collection (Season has no activityType — it's exclusively for Torre Maldita).
// 2. Renames the remaining Cycle activityType value 'shadow_war' -> 'shadow'.
// Run with: npx ts-node -r dotenv/config src/scripts/migrate-cycle-to-season.ts
import 'dotenv/config';
import mongoose from 'mongoose';
import { mongodbString } from '../config';
import Cycle from '../models/Cycle';
import Season from '../models/Season';

async function main() {
  await mongoose.connect(mongodbString);
  console.log('Connected to MongoDB');

  const towerCycles = await Cycle.find({ activityType: 'accursed_tower' });
  console.log(`Found ${towerCycles.length} accursed_tower cycle(s) to migrate to Season.`);

  for (const cycle of towerCycles) {
    await new Season({
      clan: cycle.clan,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      createdBy: cycle.createdBy,
    }).save();
    await Cycle.findByIdAndDelete(cycle._id);
  }
  console.log(`Migrated ${towerCycles.length} document(s) to Season.`);

  const renameResult = await Cycle.updateMany(
    { activityType: 'shadow_war' },
    { $set: { activityType: 'shadow' } },
  );
  console.log(`Renamed ${renameResult.modifiedCount} cycle(s) from 'shadow_war' to 'shadow'.`);

  await mongoose.disconnect();
  console.log('Done');
}

main().catch(err => { console.error(err); process.exit(1); });
