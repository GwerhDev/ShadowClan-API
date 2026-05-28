const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

const accursedTowerSchema = new Schema({
  clan:        { type: ObjectId, ref: 'Clan', default: null },
  towerNumber: { type: Number, required: true },
  date:        { type: Date,   required: true },
  enemyClan:   { type: ObjectId, ref: 'Clan', default: null },
  roster: {
    group1: [{ type: ObjectId, ref: 'Character' }],
    group2: [{ type: ObjectId, ref: 'Character' }],
    group3: [{ type: ObjectId, ref: 'Character' }],
  },
  confirmed: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Character' }],
  result:    { type: String, enum: ['victory', 'defeat', 'draw', 'pending'], default: 'pending' },
  active:    { type: Boolean, default: true },
  completed: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('AccursedTower', accursedTowerSchema);
