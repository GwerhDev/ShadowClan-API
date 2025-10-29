const mongoose = require("mongoose");

const completedTaskSchema = new mongoose.Schema({
  date: { type: Date, required: true},
  type: { type: String, required: true},

  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  character: { type: mongoose.Schema.Types.ObjectId, ref: 'Character', required: false },
  
  task: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }],
});

module.exports = mongoose.model('CompletedTask', completedTaskSchema);
