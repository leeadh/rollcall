//
// Copy plugins from original accessproxy package to current installation folder
//
var fs = require('fs')

function fsExistsSync(f) {
  try {
    fs.accessSync(f)
    return true
  } catch (e) {
      return false
  }
}

if (fsExistsSync('./node_modules')) return true // global package - quit - no postinstall

if (!fsExistsSync('../../config')) fs.mkdirSync('../../config')
if (!fsExistsSync('../../config/certs')) fs.mkdirSync('../../config/certs')
if (!fsExistsSync('../../config/schemas')) fs.mkdirSync('../../config/schemas')
if (!fsExistsSync('../../lib')) fs.mkdirSync('../../lib')

if (!fsExistsSync('../../config/plugin-acessproxy.json')) fs.writeFileSync('../../config/plugin-acessproxy.json', fs.readFileSync('./config/plugin-acessproxy.json')) // keep existing

if (!fsExistsSync('../../config/wsdls/GroupService.wsdl'))
  fs.writeFileSync('../../config/wsdls/GroupService.wsdl', fs.readFileSync('./config/wsdls/GroupService.wsdl'))
if (!fsExistsSync('../../config/wsdls/UserService.wsdl'))
  fs.writeFileSync('../../config/wsdls/UserService.wsdl', fs.readFileSync('./config/wsdls/UserService.wsdl'))

fs.writeFileSync('../../LICENSE', fs.readFileSync('./LICENSE'))
if (!fsExistsSync('../../index.js')) fs.writeFileSync('../../index.js', fs.readFileSync('./index.js')) // keep existing
