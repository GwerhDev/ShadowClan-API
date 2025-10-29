const mongoose = require("mongoose");
const { mongodbString } = require("../config");

module.exports = class DB {
  static connect() {
    mongoose.Promise = global.Promise;
    return mongoose.connect(
      mongodbString,
      { useNewUrlParser: true }
    )
  }
};
