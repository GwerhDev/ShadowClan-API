const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema({
  group1: {
    character: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Character' }],
  },
  group2: {
    character: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Character' }],
  },
  result: { type: String },
});

const shadowWarSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  result: { type: String, required: false },
  enemyClan: { type: mongoose.Schema.Types.ObjectId, ref: 'Clan', required: false },
  battle: {
    exalted: [matchSchema],
    eminent: [matchSchema],
    famed: [matchSchema],
    proud: [matchSchema],
  },
  confirmed: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Character' }],
});

module.exports = mongoose.model('ShadowWar', shadowWarSchema);