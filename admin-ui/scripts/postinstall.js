//=========================================================================
// postinstall.js
//
// author: Pete Lindley
//
// purpose: Generate a token to be used for JWT auth against accessproxy
//
//==========================================================================

const { writeFile } = require('fs');
const cryptojs = require('crypto-js');
const nodeId = require('node-machine-id');

const machineId = nodeId.machineIdSync();

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

// Contents to be written to the .env file
const envFileContent = `
API_KEY =  ${encryptedBearer}
`;

// Write the encrypted Bearer token to a .env file to be read at startup
writeFile(`./.env`, envFileContent, function(err) {
  if (err) {
    console.log(err);
  }
setTimeout(() => {
  console.log(`Successfully wrote randomly generated and encrypted token .env file.`);
}, 5000);
});

// Write the TEMP UNENCRYPTED Bearer token to a file to be added to your conf-wsoneaccess.js file.
const tempfileContent = `${bearer}`;
writeFile(`./ACCESS_PROXY_BEARER.deleteme`, tempfileContent, function(err) {
  if (err) {
    console.log(err);
  }
  console.log(`Wrote TEMPORARY UNENCRYPTED key to be added to the accessproxy config. Please make sure you delete this file after saving the content to your conf-wsoneaccess.js file.`);
});