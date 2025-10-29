const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema({
  role: { type: String, required: true },
  character: { type: String, required: true },
});

module.exports = mongoose.model('Member', memberSchema);