/**
 * Migración: setear createdAt = hoy para todos los usuarios que no tienen esa fecha.
 * Ejecutar una sola vez: node src/migrations/set-user-created-at.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { mongodbString } = require('../config');

async function run() {
  await mongoose.connect(mongodbString, { useNewUrlParser: true });
  console.log('Conectado a MongoDB');

  const today = new Date();

  const result = await mongoose.connection.collection('users').updateMany(
    { createdAt: { $exists: false } },
    { $set: { createdAt: today, updatedAt: today } }
  );

  console.log(`Usuarios actualizados: ${result.modifiedCount}`);
  await mongoose.disconnect();
  console.log('Listo.');
}

run().catch(err => { console.error(err); process.exit(1); });
