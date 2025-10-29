const { production } = require("../misc/consts");

module.exports = {
  port: process.env.PORT,
  environment: process.env.NODE_ENV,
  apiUrl: process.env.NODE_ENV === production ? process.env.API_URL_PROD : process.env.API_URL,
  clientUrl: process.env.NODE_ENV === production ? process.env.CLIENT_URL_PROD : process.env.CLIENT_URL,

  adminEmailList: process.env.ADMIN_EMAIL_LIST,

  mongodbString: process.env.MONGODB_STRING,

  bnetClient: process.env.BNET_CLIENT,
  bnetSecret: process.env.BNET_SECRET,

  cohereSecret: process.env.COHERE_SECRET,

  privateSecret: process.env.PRIVATE_SECRET,

  timezoneOffset: process.env.TIMEZONE_OFFSET || -3,
}