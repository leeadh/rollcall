const cryptojs = require('crypto-js');
const decryptedkey = cryptojs.AES.decrypt(process.env.API_KEY, process.env.envmachineid).toString(cryptojs.enc.Utf8);
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