const cryptojs = require('crypto-js');
const nodeId = require('node-machine-id');
require('dotenv').config();

const machineId = nodeId.machineIdSync();
const decryptedkey = cryptojs.AES.decrypt(process.env.API_KEY, machineId.toString()).toString(cryptojs.enc.Utf8);
console.log(decryptedkey);

const PROXY_CONFIG = [
    {
        context: [
            "/access/*"
        ],
        "target": "http://localhost:8888",
        "secure":false,
        "changeOrigin": true,
        "headers": {"Authorization": "Bearer " + decryptedkey},
        "logLevel": "debug"
    }
]
module.exports = PROXY_CONFIG;