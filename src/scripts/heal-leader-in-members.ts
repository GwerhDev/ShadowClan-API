import 'dotenv/config';
import mongoose from 'mongoose';
import { mongodbString } from '../config';

// Limpieza única de datos legacy: el líder nunca debe estar duplicado en member[].
// Antes se ejecutaba en cada GET /admin/clans; ahora se corre a mano cuando haga falta:
//   npx ts-node src/scripts/heal-leader-in-members.ts
async function main() {
  await mongoose.connect(mongodbString);
  const result = await mongoose.connection.collection('clans').updateMany(
    { leader: { $exists: true, $ne: null }, $expr: { $in: ['$leader', '$member'] } },
    [{ $set: { member: { $filter: { input: '$member', cond: { $ne: ['$$this', '$leader'] } } } } }],
  );
  console.log(`Clanes corregidos: ${result.modifiedCount}`);
  await mongoose.disconnect();
}
main().catch(err => { console.error(err); process.exit(1); });
