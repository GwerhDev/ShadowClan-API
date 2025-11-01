require("dotenv").config();
const server = require('./app');
const db = require("./integrations/mongodb");
const { port } = require("./config");

async function main() {
  console.log(process.env.NODE_ENV );
  try {
    await db.connect();
    console.log("Succesfully connected");
    server.listen(port, ()=> console.log(`Server listening on port ${port}`));
  } catch (error) {
    console.error("Unable to connect to database");
    server.listen(port, ()=> console.log(`Server listening on port ${port}`));
  }
};

main();