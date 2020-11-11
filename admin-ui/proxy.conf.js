const cryptojs = require('crypto-js')
const nodeId = require('node-machine-id')
const { writeFile } = require('fs');
require('dotenv').config();

const machineId = nodeId.machineIdSync();
const decryptedkey = cryptojs.AES.decrypt(process.env.API_KEY, machineId.toString()).toString(cryptojs.enc.Utf8);

const PROXY_CONFIG = [
    {
        context: [
            "/access/*"
        ],
        "target": "http://localhost:8888",
        "secure": false,
        "changeOrigin": true,
        "headers": {"Authorization": "Bearer " + decryptedkey},
        "logLevel": "debug"
    }
]
module.exports = PROXY_CONFIG;
const jconfig = PROXY_CONFIG[0];
const proxyOutput = `
{
  "local": {
    "path": "${jconfig.context}",
    "target": "${jconfig.target}",
    "secure": ${jconfig.secure},
    "changeOrigin": ${jconfig.changeOrigin},
    "logLevel": "${jconfig.logLevel}"
  }
}
`;

// write the content to the respective file
writeFile(`proxy-config.json`, proxyOutput, function (err) {
  if (err) {
    console.log(err);
  }
  console.log(`Wrote proxy configuration output to .JSON`);
});