import 'dotenv/config';
import mongoose from 'mongoose';
import { mongodbString } from '../config';

async function main() {
  await mongoose.connect(mongodbString);
  const chars = await mongoose.connection.collection('characters')
    .find({}, { projection: { name: 1, score: 1, resonance: 1, armor: 1, power: 1, resistance: 1, armorPenetration: 1 } })
    .limit(15).toArray();
  console.log(JSON.stringify(chars, null, 2));
  await mongoose.disconnect();
}
main().catch(err => { console.error(err); process.exit(1); });
