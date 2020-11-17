//=========================================================================
// postinstall.js
//
// author: Pete Lindley
//
// purpose: Generate a token to be used for JWT auth against accessproxy
// and generate .env and env.json files to be read as environment vars
//
//==========================================================================

const { writeFile } = require('fs');
const cryptojs = require('crypto-js');
const nodeId = require('node-machine-id');

const machineId = nodeId.machineIdSync();

//Read from pre-configured dotenv file to get Access URLs
require('dotenv').config({ path: '/rollcall/accessproxy/config/.env' })

// Function to generate a "pseudo-random" "pseudo" bearer token at post install for API authentication to accessproxy
function genBearer(length) {
  let result           = '';
  const characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for ( var i = 0; i < length; i++ ) {
     result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

// Generate a 50 character token
const bearer = genBearer(50);

// Encrypt the bearer using the local machine ID
const encryptedBearer = cryptojs.AES.encrypt(bearer, machineId.toString());

// Default accessproxy url and listening port
const accessproxy = 'http://localhost:8888/access'

// Contents to be written to the .env file for accessproxy
const envFileContent = `
BEARER=${bearer}
BASEURL=${process.env.BASEURL}
CLIENTID=${process.env.CLIENTID}
CLIENTSECRET=${process.env.CLIENTSECRET}
DOMAIN=${process.env.DOMAIN}
OAUTHURL=${process.env.OAUTHURL}
ACCESSURL=${process.env.ACCESSURL}
`;

// Contents to be written to the env.json file for Admin UI
const environment = `
{
  "local": {
    "accessproxy": "${accessproxy}",
    "bearer": "${bearer}",
    "encryptedBearer": "${encryptedBearer}",
    "machineId": "${machineId}",
    "accessURL": "${process.env.ACCESSURL}"
  }
}
`;

// Contents to be written to the env.json file for Admin UI
writeFile(`/rollcall/admin-ui/config/env.json`, environment, function (err) {
  if (err) {
    console.log(err);
  }
  console.log(`Successfully wrote environment details to env.json for admin-ui`);
});

// Write the encrypted Bearer token to a .env file to be read at startup
writeFile(`/rollcall/accessproxy/config/.env`, envFileContent, function(err) {
  if (err) {
    console.log(err);
  }
setTimeout(() => {
  console.log(`Successfully wrote randomly generated token and environment information to .env file for accessproxy`);
}, 3000);
});