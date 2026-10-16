import 'dotenv/config';
import mongoose from 'mongoose';
import { mongodbString } from '../config';

// Solo lectura: lista nombres de personaje duplicados (sin distinguir mayúsculas/acentos
// de caja), que impedirían crear el índice único de Character.name.
//   npx ts-node src/scripts/check-duplicate-character-names.ts
async function main() {
  await mongoose.connect(mongodbString);
  const dups = await mongoose.connection.collection('characters').aggregate([
    { $group: { _id: { $toLower: { $trim: { input: '$name' } } }, count: { $sum: 1 }, chars: { $push: { id: '$_id', name: '$name', status: '$status', clan: '$clan' } } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ], { collation: { locale: 'en', strength: 2 } }).toArray();
  console.log(`Nombres duplicados: ${dups.length}`);
  for (const d of dups) console.log(JSON.stringify(d));
  await mongoose.disconnect();
}
main().catch(err => { console.error(err); process.exit(1); });
