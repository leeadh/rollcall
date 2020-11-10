// =================================================================================
// File:    accessproxy.js
//
//
// Purpose: Started by endpoint plugin
//          Listens and replies on incoming SCIM requests
//          Communicates with plugin using event callback
// =================================================================================

'use strict'

const http = require('http')
const https = require('https')
const Koa = require('koa')
const Router = require('koa-router')
const bodyParser = require('koa-bodyparser')
const jwt = require('jsonwebtoken')
const passport = require('passport')
const OIDCBearerStrategy = require('passport-azure-ad').BearerStrategy
const dot = require('dot-object')
const nodemailer = require('nodemailer')
const fs = require('fs')
const path = require('path')
const callsite = require('callsite')
const utils = require('../lib/utils')
let scimDef = null
let isMailLock = false

/**
 * @constructor
 */
const AccessProxy = function () {
  let server = null
  const stack = callsite()
  const requester = stack[1].getFileName()
  const pluginName = path.basename(requester, '.js')
  const configDir = path.join(path.dirname(requester), '..', 'config')
  const configFile = path.join(`${configDir}`, `${pluginName}.json`) // config name prefix same as plugin name prefix
  let config = require(configFile).accessproxy
  let extConfigErr = null
  try {
    config = AccessProxy.prototype.processExtConfig(pluginName, config, true) // external config support process.env and process.file
  } catch (err) { extConfigErr = err }

  const gwName = path.basename(__filename, '.js') // prefix of current file
  const logDir = path.join(path.dirname(requester), '..', 'logs')
  const Log = require('../lib/logger').Log
  var log = new Log(utils.extendObj(utils.copyObj(config.log), { category: pluginName, colorize: process.stdout.isTTY || false, loglevel: { file: 'debug', console: 'debug' } }), path.join(`${logDir}`, `${pluginName}.log`))
  const logger = log.logger
  this.logger = logger // exposed to plugin-code
  this.notValidAttributes = notValidAttributes // exposed to plugin-code
  let pwErrCount = 0
  let requestCounter = 0
  const startTime = utils.timestamp()

  if (extConfigErr) {
    logger.error(`${gwName}[${pluginName}] ${extConfigErr.message}`)
    logger.error(`${gwName}[${pluginName}] stopping...\n`)
    throw (new Error('Using exception to stop further asynchronous code execution (ensure synchronous logger flush to logfile and exit program), please ignore this one...'))
  }

  if (!config.scim) config.scim = {}
  if (!config.log) config.log = {}
  if (!config.log.loglevel) config.log.loglevel = {}
  if (!config.auth) config.auth = {}
  if (!config.auth.basic) config.auth.basic = []
  if (!config.auth.bearerToken) config.auth.bearerToken = []
  if (!config.auth.bearerJwt) config.auth.bearerJwt = []
  if (!config.auth.bearerJwtAzure) config.auth.bearerJwtAzure = []
  if (!config.certificate) config.certificate = {}
  if (!config.certificate.pfx) config.certificate.pfx = {}
  if (!config.emailOnError) config.emailOnError = {}
  if (!config.emailOnError.smtp) config.emailOnError.smtp = {}

  const handler = {}
  handler.Users = handler.users = {
    description: 'User',
    exploreMethod: 'exploreUsers',
    getMethod: 'getUser',
    inclusionMethod: 'getGroupUsers',
    modifyMethod: 'modifyUser',
    createMethod: 'createUser',
    deleteMethod: 'deleteUser'
  }
  handler.Groups = handler.groups = {
    description: 'Group',
    exploreMethod: 'exploreGroups',
    getMethod: 'getGroup',
    inclusionMethod: 'getGroupMembers',
    modifyMethod: 'modifyGroup',
    createMethod: 'createGroup',
    deleteMethod: 'deleteGroup'
  }

  let foundBasic = false
  let foundBearerToken = false
  let foundBearerJwtAzure = false
  let foundBearerJwt = false
  let pwPfxPassword

  // if (config.auth.basic.password) pwBasicPassword = AccessProxy.prototype.getPassword('accessproxy.auth.basic.password', configFile)
  if (Array.isArray(config.auth.basic)) {
    const arr = config.auth.basic
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].password) arr[i].password = AccessProxy.prototype.getPassword(`accessproxy.auth.basic[${i}].password`, configFile)
      if (arr[i].password) foundBasic = true
    }
    if (!foundBasic) config.auth.basic = []
  }

  // if (config.auth.bearer.token) pwBearerToken = AccessProxy.prototype.getPassword('accessproxy.auth.bearer.token', configFile)
  if (Array.isArray(config.auth.bearerToken)) {
    const arr = config.auth.bearerToken
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].token) {
        arr[i].token = AccessProxy.prototype.getPassword(`accessproxy.auth.bearerToken[${i}].token`, configFile)
        if (arr[i].token) foundBearerToken = true
      }
    }
    if (!foundBearerToken) config.auth.bearerToken = []
  }

  if (Array.isArray(config.auth.bearerJwtAzure)) {
    const issuers = []
    const arr = config.auth.bearerJwtAzure
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].tenantIdGUID) {
        issuers.push(`https://sts.windows.net/${arr[i].tenantIdGUID}/`)
      }
    }
    if (issuers.length > 0) {
      foundBearerJwtAzure = true
      const azureOptions = {
        validateIssuer: true,
        passReqToCallback: false,
        loggingLevel: null,
        // identityMetadata: `https://login.microsoftonline.com/${tenantIdGUID}/.well-known/openid-configuration`,
        identityMetadata: 'https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration',
        clientID: '00000014-0000-0000-c000-000000000000', // Well known appid: Microsoft.Azure.SyncFabric
        audience: [
          // Well known appid: Issued for accessing Windows Azure Active Directory Graph Webservice
          '00000002-0000-0000-c000-000000000000',
          // Appid used for SCIM provisioning for non-gallery applications. See changes introduced, in reverse cronological order:
          // - https://github.com/MicrosoftDocs/azure-docs/commit/f6997c0952d2ad4f33ce7f5339eeb83c21b51f1e
          // - https://github.com/MicrosoftDocs/azure-docs/commit/64525fea0675a73b2e6b8fe42fbd03ee568cadfc
          '8adf8e6e-67b2-4cf2-a259-e3dc5476c621'
        ],
        issuer: issuers // array => passport.authenticate supports more than one AAD tenant
      }

      passport.use(new OIDCBearerStrategy(azureOptions, (token, callback) => { // using named strategy = tenantIdGUID, passport.authenticate then using name
        callback(null, token.sub, token) // Azure SyncFabric don't send user info claims, returning claim token.sub as user
      }))
    } else {
      config.auth.bearerJwtAzure = []
    }
  }

  if (Array.isArray(config.auth.bearerJwt)) {
    const arr = config.auth.bearerJwt
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].secret) {
        arr[i].secret = AccessProxy.prototype.getPassword(`accessproxy.auth.bearerJwt[${i}].secret`, configFile)
        if ((arr[i].options && arr[i].options.issuer) && (arr[i].secret || arr[i].publicKey)) {
          foundBearerJwt = true
          if (arr[i].publicKey) { // create publicKeyContent
            try {
              arr[i].publicKeyContent = fs.readFileSync(`${configDir}/certs/${arr[i].publicKey}`)
            } catch (err) {
              arr.splice(i, 1) // delete
              foundBearerJwt = false
              err.message = `failed reading file defined in configuration auth.bearerJwt: ${err.message}`
              logger.error(err.message)
            }
          }
        } else arr.splice(i, 1) // delete
      }
    }
    if (!foundBearerJwt) config.auth.bearerJwt = []
  }

  if (config.certificate.pfx.password) pwPfxPassword = AccessProxy.prototype.getPassword('accessproxy.certificate.pfx.password', configFile)
  if (config.emailOnError.smtp.password) config.emailOnError.smtp.password = AccessProxy.prototype.getPassword('accessproxy.emailOnError.smtp.password', configFile)

  if (!foundBasic && !foundBearerToken && !foundBearerJwtAzure && !foundBearerJwt) {
    logger.error(`${gwName}[${pluginName}] Access Proxy password decryption failed or no password defined`)
    logger.error(`${gwName}[${pluginName}] stopping...\n`)
    throw (new Error('Using exception to stop further asynchronous code execution (ensure synchronous logger flush to logfile and exit program), please ignore this one...'))
  }
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir)
  if (!fs.existsSync(configDir + '/wsdls')) fs.mkdirSync(configDir + '/wsdls')
  if (!fs.existsSync(configDir + '/certs')) fs.mkdirSync(configDir + '/certs')
  if (!fs.existsSync(configDir + '/schemas')) fs.mkdirSync(configDir + '/schemas')

  let isScimv2 = false
  if (config.scim.version === '2.0' || config.scim.version === 2) {
    isScimv2 = true
    scimDef = require('../lib/scimdef-v2')
  } else scimDef = require('../lib/scimdef-v1')

  if (config.scim.customSchema) { // merge plugin custom schema extension into core schemas
    let custom
    try {
      custom = JSON.parse(fs.readFileSync(`${configDir}/schemas/${config.scim.customSchema}`, 'utf8'))
    } catch (err) {
      throw new Error(`failed reading file defined in configuration "scim.customSchema": ${err.message}`)
    }
    if (!Array.isArray(custom)) custom = [custom]
    const schemas = ['User', 'Group']
    let customMerged = false
    for (let i = 0; i < schemas.length; i++) {
      const schema = scimDef.Schemas.Resources.find(el => el.name === schemas[i])
      const customSchema = custom.find(el => el.name === schemas[i])
      if (schema && customSchema && Array.isArray(customSchema.attributes)) {
        const arr1 = schema.attributes // core:1.0/2.0 schema
        const arr2 = customSchema.attributes
        schema.attributes = arr2.filter(arr2Obj => { // only merge attributes (objects) having unique name into core schema
          if (!arr1.some(arr1Obj => arr1Obj.name === arr2Obj.name)) {
            customMerged = true
            if (!isScimv2) arr2Obj.schema = 'urn:scim:schemas:core:1.0'
            return arr2Obj
          }
        }).concat(arr1)
      }
    }
    if (!customMerged) {
      const err = [
        'No custom SCIM schema attributes have been merged. Make sure using correct format e.g. ',
        '[{"name": "User", "attributes" : [...]}]. ',
        'Also make sure attribute names in attributes array do not conflict with core:1.0/2.0 SCIM attribute names'
      ].join()
      throw new Error(err)
    }
  }

  this.testmodeusers = scimDef.TestmodeUsers.Resources // exported and used by plugin-loki
  this.testmodegroups = scimDef.TestmodeGroups.Resources // exported and used by plugin-loki

  const logResult = async (ctx, next) => {
    const started = Date.now()
    await next() // once all middleware below completes, this continues
    const ellapsed = (Date.now() - started) + 'ms' // ctx.set('X-ResponseTime', ellapsed)
    const res = {
      statusCode: ctx.response.status,
      statusMessage: ctx.response.message,
      body: ctx.response.body
    }
    let userName
    const [authType, authToken] = (ctx.request.header.authorization || '').split(' ') // [0] = 'Basic' or 'Bearer'
    if (authType === 'Basic') [userName] = (Buffer.from(authToken, 'base64').toString() || '').split(':')
    if (!userName && authType === 'Bearer') userName = 'token'
    if (ctx.request.url !== '/favicon.ico') {
      if (ctx.response.status < 200 || ctx.response.status > 299) {
        logger.error(`${gwName}[${pluginName}] ${ellapsed} ${ctx.request.ip} ${userName} ${ctx.request.method} ${ctx.request.href} Inbound = ${JSON.stringify(ctx.request.body)} Outbound = ${JSON.stringify(res)}${(config.log.loglevel.file === 'debug' && ctx.request.url !== '/ping') ? '\n' : ''}`)
      } else logger.info(`${gwName}[${pluginName}] ${ellapsed} ${ctx.request.ip} ${userName} ${ctx.request.method} ${ctx.request.href} Inbound = ${JSON.stringify(ctx.request.body)} Outbound = ${JSON.stringify(res)}${(config.log.loglevel.file === 'debug' && ctx.request.url !== '/ping') ? '\n' : ''}`)
      requestCounter += 1 // logged on exit (not win process termination)
    }
  }

  // start auth methods - used by auth
  const unauth = (ctx) => {
    return new Promise((resolve, reject) => {
      if (ctx.url === '/ping') resolve(true) // ping - no auth
      else resolve(false)
    })
  }

  const basic = (method, authType, authToken) => {
    return new Promise((resolve, reject) => { // basic auth
      if (authType !== 'Basic') resolve(false)
      if (!foundBasic) resolve(false) // not configured
      const [userName, userPassword] = (Buffer.from(authToken, 'base64').toString() || '').split(':')
      if (!userName || !userPassword) {
        reject(new Error(`authentication failed for user ${userName}`))
      }
      const arr = config.auth.basic
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].username === userName && arr[i].password === userPassword) {
          if (arr[i].readOnly === true && method !== 'GET') resolve(false)
          resolve(true) // authentication OK
        }
      }
      reject(new Error(`authentication failed for user ${userName}`))
    })
  }

  const bearerToken = (method, authType, authToken) => {
    return new Promise((resolve, reject) => { // bearer token
      if (authType !== 'Bearer' || jwt.decode(authToken)) resolve(false) // bearer token auth not used
      if (!foundBearerToken || !authToken) resolve(false)
      const arr = config.auth.bearerToken
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].token === authToken) {
          if (arr[i].readOnly === true && method !== 'GET') resolve(false)
          resolve(true) // authentication OK
        }
      }
      reject(new Error('bearer token authentication failed'))
    })
  }

  const bearerJwtAzure = (ctx, next, authType, authToken) => { // not supporting readOnly
    return new Promise((resolve, reject) => {
      if (authType !== 'Bearer' || !foundBearerJwtAzure) resolve(false) // no azure bearer token
      const payload = jwt.decode(authToken)
      if (!payload) resolve(false)
      if (!payload.iss) resolve(false)
      if (payload.iss.indexOf('https://sts.windows.net') !== 0) resolve(false)
      passport.authenticate('oauth-bearer', { session: false }, (err, user, info) => {
        if (err) { reject(err) }
        if (user) resolve(true) // authentication OK
        else reject(new Error(`Azure JWT authorization failed: ${info}`))
      })(ctx, next)
    })
  }

  const jwtVerify = (method, el, authToken) => { // used by bearerJwt
    return new Promise((resolve, reject) => {
      jwt.verify(authToken, (el.secret) ? el.secret : el.publicKeyContent, el.options, (err, decoded) => {
        if (err) resolve(false)
        else {
          if (el.readOnly === true && method !== 'GET') resolve(false)
          resolve(true) // authorization OK
        }
      })
    })
  }

  const bearerJwt = async (method, authType, authToken) => {
    if (authType !== 'Bearer' || !foundBearerJwt) return false // no standard jwt bearer token
    const payload = jwt.decode(authToken)
    if (!payload) return false
    if (payload.iss && payload.iss.indexOf('https://sts.windows.net') === 0) return false // azure - handled by bearerJwtAzure
    const promises = []
    const arr = config.auth.bearerJwt
    for (let i = 0; i < arr.length; i++) {
      promises.push(jwtVerify(method, arr[i], authToken))
    }
    const arrResolve = await Promise.all(promises).catch((err) => { throw (err) })
    for (const i in arrResolve) {
      if (arrResolve[i]) return true
    }
    throw new Error('JWT authentication failed')
  }
  // end auth methods - used by auth

  const auth = async (ctx, next) => { // authentication/authorization
    const [authType, authToken] = (ctx.request.header.authorization || '').split(' ') // [0] = 'Basic' or 'Bearer'

    try { // authenticate
      const arrResolve = await Promise.all([unauth(ctx), basic(ctx.request.method, authType, authToken), bearerToken(ctx.request.method, authType, authToken), bearerJwtAzure(ctx, next, authType, authToken), bearerJwt(ctx.request.method, authType, authToken)]).catch((err) => { throw (err) })
      for (const i in arrResolve) {
        if (arrResolve[i]) {
          ctx.set('Content-Type', 'application/scim+json; charset=utf-8') // IE don't support JSON content to be shown in browser, pre IE/Edge versions did not support 'application/scim+json'
          return next() // auth OK - continue with routes
        }
      }
      // all false - invalid auth method or missing pluging config
      let err
      if (authType.length < 1) err = new Error(`${ctx.url} request is missing authentication information`)
      else {
        err = new Error(`${ctx.url} request having unsupported authentication or plugin configuration is missing`)
        logger.debug(`${gwName}[${pluginName}] request authToken = ${authToken}`)
        logger.debug(`${gwName}[${pluginName}] request jwt.decode(authToken) = ${JSON.stringify(jwt.decode(authToken))}`)
      }
      ctx.set('WWW-Authenticate', 'Basic realm=""')
      ctx.status = 401
      ctx.body = 'Access denied'
      if (ctx.url !== '/favicon.ico') logger.error(`${gwName}[${pluginName}] ${err.message}`)
    } catch (err) {
      ctx.set('WWW-Authenticate', 'Basic realm=""')
      if (pwErrCount < 3) {
        pwErrCount += 1
        ctx.status = 401
        ctx.body = 'Access denied'
        logger.error(`${gwName}[${pluginName}] ${ctx.url} ${err.message}`)
      } else { // delay brute force attempts
        logger.error(`${gwName}[${pluginName}] ${ctx.url} ${err.message} => delaying response with 2 minutes to prevent brute force`)
        return new Promise((resolve) => {
          setTimeout(() => {
            ctx.status = 401
            ctx.body = 'Access denied'
            resolve(ctx)
          }, 1000 * 60 * 2)
        })
      }
    }
  } // authentication

  const verifyContentType = (ctx, next) => {
    return new Promise((resolve) => {
      if (ctx.request.length) { // body is included - invalid content-type gives empty body (koa-bodyparser)
        const contentType = ctx.request.type.toLowerCase()
        if (contentType === 'application/json' || contentType === 'application/scim+json') {
          return resolve(next())
        }
        ctx.status = 415
        ctx.body = 'Content-Type header must be \'application/json\' or \'application/scim+json\''
        return resolve(ctx)
      }
      resolve(next())
    })
  }

  const app = new Koa()
  const router = new Router()

  // Middleware run in the order they are defined and communicates through ctx
  // There is no return value, if there were it would be ignored
  app.use(logResult)
  app.use(bodyParser({ // parsed body store in ctx.request.body
    enableTypes: ['json'],
    extendTypes: { json: ['application/scim+json', 'text/plain'] }
  }))
  app.use(auth) // authentication before routes
  app.use(verifyContentType)
  app.use(router.routes())
  app.use(router.allowedMethods())

  app.on('error', (err, ctx) => { // catching none try/catch in app middleware, also bodyparser and body not json
    logger.error(`${gwName}[${pluginName}] Koa method: ${ctx.method} url: ${ctx.origin + ctx.path} body: ${JSON.stringify(ctx.request.body)} error: ${err.message}`)
  })

  router.get('/ping', async (ctx) => { // auth not required
    const tx = 'hello'
    ctx.set('Content-Type', 'text/plain; charset=utf-8')
    ctx.body = tx
  })

  // Initial connection, step #1: GET /ServiceProviderConfigs
  // If not included => Provisioning will always use GET /Users without any paramenters
  // scimv1 = ServiceProviderConfigs, scimv2 ServiceProviderConfig
  router.get(['/(|scim/)(ServiceProviderConfigs|ServiceProviderConfig)',
    '/:baseEntity/(|scim/)(ServiceProviderConfigs|ServiceProviderConfig)'], async (ctx) => {
    const tx = scimDef.ServiceProviderConfigs // obfuscator friendly
    const location = ctx.origin + ctx.path
    if (tx.meta) tx.meta.location = location
    else {
      tx.meta = {}
      tx.meta.location = location
    }
    ctx.body = tx
    logger.debug(`${gwName}[${pluginName}] GET ${ctx.originalUrl} Response = ${JSON.stringify(tx)}`)
  })

  // Initial connection, step #2: GET /Schemas
  router.get(['/(|scim/)Schemas', '/:baseEntity/(|scim/)Schemas'], async (ctx) => {
    let tx = scimDef.Schemas
    tx = addResources(tx)
    tx = addSchemas(tx, null, isScimv2)
    ctx.body = tx
  })

  router.get(['/(|scim/)Schemas/:id', '/:baseEntity/(|scim/)Schemas/:id'], async (ctx) => { // e.g /Schemas/Users | Groups | ServiceProviderConfigs
    let schemaName = ctx.params.id
    if (schemaName.substr(schemaName.length - 1) === 's') schemaName = schemaName.substr(0, schemaName.length - 1)
    const tx = scimDef.Schemas.Resources.find(el => el.name === schemaName)
    if (!tx) {
      let err = new Error(`Schema '${schemaName}' not found`)
      err = jsonErr(config.scim.version, pluginName, ctx.status, err)
ctx.status = 404

        
      ctx.body = err
    } else {
      ctx.body = tx
    }
  })

  router.get(['/(|scim/)(ResourceTypes|ResourceType)',
    '/:baseEntity/(|scim/)(ResourceTypes|ResourceType)'], async (ctx) => { // ResourceTypes according to v2 specification
    const tx = scimDef.ResourceType
    ctx.body = tx
  })

  router.get([`/(|scim/)(!${undefined}|Users|Groups|servicePlans)/:id`,
    `/:baseEntity/(|scim/)(!${undefined}|Users|Groups|servicePlans)/:id`], async (ctx) => {
    let u = ctx.originalUrl.substr(0, ctx.originalUrl.lastIndexOf('/'))
    u = u.substr(u.lastIndexOf('/') + 1) // u = Users, Groups
    const handle = handler[u]
    const id = require('path').basename(ctx.params.id, '.json') // supports <id>.json

    const getObj = {
      filter: 'id',
      identifier: id
    }

    logger.debug(`${gwName}[${pluginName}] [Get ${handle.description}] ${getObj.filter}=${getObj.identifier}`)
    logger.debug(`${gwName}[${pluginName}] calling "${handle.getMethod}" and awaiting result`)

    if (Object.keys(ctx.query).length > 0) { // Users/bjensen?test=test
      if (!ctx.query.excludedAttributes || Object.keys(ctx.query).length > 1) {
        let err = 'incorrect syntax - using query only supports excludedAttributes'
        err = jsonErr(config.scim.version, '', ctx.status, err)
        ctx.status = 400
        ctx.body = err
        return null
      }
    }

    try {
      const data = await this[handle.getMethod](ctx.params.baseEntity, getObj, ctx.query.attributes ? ctx.query.attributes : '')
      if (!data || JSON.stringify(data) === '{}') {
        let err = new Error(`${handle.description} ${getObj.identifier} not found`)
        err = jsonErr(config.scim.version, pluginName, ctx.status, err)
          ctx.status = 404

          
        ctx.body = err
      } else {
        for (const key in data) { // exclude null and empty object/array
          if (data[key] === null) delete data[key]
          else if (JSON.stringify(data[key]) === '{}') delete data[key]
          else if (Array.isArray(data[key]) && data[key].length < 1) delete data[key]
        }
        if (ctx.query.excludedAttributes) { // e.g. Groups?excludedAttributes=members
          const arrEx = ctx.query.excludedAttributes.split(',')
          for (let i = 0; i < arrEx.length; i++) {
            delete data[arrEx[i]]
          }
        }
        delete data.password
        let scimdata = data
        const location = ctx.origin + ctx.path
        scimdata = addSchemas(scimdata, handle.description, isScimv2)
        if (scimdata.meta) scimdata.meta.location = location
        else {
          scimdata.meta = {}
          scimdata.meta.location = location
        }
        ctx.body = scimdata
      }
    } catch (err) {
      const e = jsonErr(config.scim.version, pluginName, ctx.status, err)
        ctx.status = 404

        
      ctx.body = e
    }
  })

  router.get(['/(|scim/)(Users|Groups|servicePlans)',
    '/:baseEntity/(|scim/)(Users|Groups|servicePlans)'], async (ctx) => {
    let u = ctx.originalUrl.substr(ctx.originalUrl.lastIndexOf('/') + 1) // u = Users, Groups, servicePlans, ...
    const ui = u.indexOf('?')
    if (ui > 0) u = u.substr(0, ui)
    const handle = handler[u]

    if (ctx.query.filter) {
      // ==========================================
      //             GET USER  - getUser
      //             GET GROUP - getGroup
      // ==========================================
      //
      // GET /Users?filter=userName eq "bjensen"&attributes=ims,locale,name.givenName,externalId,preferredLanguage,userType,id,title,timezone,name.middleName,name.familyName,nickName,name.formatted,meta.location,userName,name.honorificSuffix,meta.version,meta.lastModified,meta.created,name.honorificPrefix,emails,phoneNumbers,photos,x509Certificates.value,profileUrl,roles,active,addresses,displayName,entitlements
      //
      // Get user request before/after updating a user:
      // GET = /Users?filter=userName eq "jsmith"&attributes=id,userName
      //
      // Get user request for retreving all attributes:
      // GET = /Users?filter=userName eq "jsmith"&attributes=ims,locale,name.givenName,externalId,preferredLanguage,userType,id,title,timezone,name.middleName,name.familyName,nickName,name.formatted,meta.location,userName,name.honorificSuffix,meta.version,meta.lastModified,meta.created,name.honorificPrefix,emails,phoneNumbers,photos,x509Certificates.value,profileUrl,roles,active,addresses,displayName,entitlements
      //
      //  ---- retreive all users for a spesific group ----
      //
      // "user member of group" => CA IM default scim endpoint config - Group having multivalue attribute members containing userName
      // GET = /Users?filter=id eq "jsmith"&attributes=id,userName
      //
      // "group member of user" => User having multivalue attribute groups containing value=GroupName
      // GET = /Users?filter=groups.value eq "UserGroup-1"&attributes=groups.value,userName
      //
      //   ---- Azure AD to SCIM Users ----
      //
      // Default SCIM attribute mapping have:
      //   externalId mapped to mailNickname (matching precedence #1)
      //   userName mapped to userPrincipalName
      //
      // Precedence decides filter attribute sent to AccessProxy
      // GET = /scim/Users?filter=externalId eq "jarle_elshaug"
      //
      // AccessProxy accepts externalId (as matching precedence) instead of userName, but userName and externalId must
      // then be mapped to the same AD attribte e.g:
      //
      //   externalId mapped to mailNickname (matching precedence #1)
      //   userName mapped to mailNickname
      // or:
      //   externalId mapped to userPrincipalName (matching precedence #1)
      //   userName mapped to userPrincipalName
      //
      // ---- GROUP ----
      //
      // Get group:
      // GET /Groups?filter=displayName eq "Employees"&attributes=externalId,id,members.value,displayName
      //
      // Azure AD:
      // GET /scim/Groups?excludedAttributes=members&filter=externalId eq "MyGroup"
      //
      // Get group members:
      // GET = /Groups?filter=members.value eq "<user-id>"&attributes=members.value,displayName&startIndex=1&count=100
      //
      //   ---- Azure AD to SCIM Groups ----
      //
      // Default SCIM attribute for GROUP mapping have:
      //   externalId mapped to displayName (matching precedence #1)
      //   displayName mapped to mailNickname
      //
      // AccessProxy accepts externalId (as matching precedence) instead of displayName, but displayName and externalId must
      // then be mapped to the same AD attribute e.g:
      //
      //   externalId mapped to displayName (matching precedence #1)
      //   displayName mapped to displayName
      //
      // ---- servicePlans ----
      // GET /servicePlans?filter=servicePlanName+eq+%22EXCHANGE_S_FOUNDATION%22&attributes=servicePlanName
      //
      const arrFilter = ctx.query.filter.split(' ') // userName eq "bjensen"
      if (arrFilter.length > 2 && arrFilter[1] === 'eq') {
        const identifier = ctx.query.filter.substring(ctx.query.filter.indexOf('"')).replace(/"/g, '') // bjensen / UserGroup-1
        const getObj = {
          filter: arrFilter[0], // e.g. userName
          identifier: identifier // e.g. bjensen
        }
        if (getObj.filter === 'groups.value' || getObj.filter === 'members.value') {
          // Using inclusionMethod
          // User (groups.value) -  get all users for a spesific group ("group member of user" - using groups attribute on user)
          // Groups (members.value) - get users for a spesific groups
          logger.debug(`${gwName}[${pluginName}] [Get ${handle.description} Inclusion] ${arrFilter[0]}=${identifier}`) // UserGroup-1
          logger.debug(`${gwName}[${pluginName}] calling "${handle.inclusionMethod}" and awaiting result`)
          try {
            const data = await this[handle.inclusionMethod](ctx.params.baseEntity, identifier, ctx.query.attributes)
            let scimdata = data
            scimdata = addResources(scimdata, ctx.query.startIndex)
            scimdata = addSchemas(scimdata, handle.description, isScimv2)
            ctx.body = scimdata
            return null
          } catch (err) {
            const e = jsonErr(config.scim.version, pluginName, ctx.status, err)
            ctx.status = 500
            ctx.body = e
            return null
          }
        } else {
          logger.debug(`${gwName}[${pluginName}] [Get ${handle.description}] ${getObj.filter}=${getObj.identifier}`) // bjensen or bjensen;<filter>
          logger.debug(`${gwName}[${pluginName}] calling "${handle.getMethod}" and awaiting result`)
          try {
            let data = await this[handle.getMethod](ctx.params.baseEntity, getObj, ctx.query.attributes ? ctx.query.attributes : '')
            if (!data) data = {}
            if (!isScimv2 && JSON.stringify(data) === '{}') { // user/group not found, scim1.1 => http 404, scim2.0 http 200 and empty resource
              let err
              if (getObj.filter === 'userName' || getObj.filter === 'externalId' || getObj.filter === 'id') {
                err = new Error(`${handle.description} ${getObj.identifier} not found`)
              } else err = new Error(`${handle.description} having ${getObj.filter}=${getObj.identifier} not found`)
              err = jsonErr(config.scim.version, pluginName, ctx.status, err)
                ctx.status = 404

                
              ctx.body = err
              return null
            } else {
              for (const key in data) { // exclude null and empty object/array
                if (data[key] === null) delete data[key]
                else if (JSON.stringify(data[key]) === '{}') delete data[key]
                else if (Array.isArray(data[key]) && data[key].length < 1) delete data[key]
              }
              if (ctx.query.excludedAttributes) { // e.g. Groups?excludedAttributes=members
                const arrEx = ctx.query.excludedAttributes.split(',')
                for (let i = 0; i < arrEx.length; i++) {
                  delete data[arrEx[i]]
                }
              }
              delete data.password
              let scimdata = data
              scimdata = addResources(scimdata, ctx.query.startIndex)
              scimdata = addSchemas(scimdata, handle.description, isScimv2)
              ctx.body = scimdata
              return null
            }
          } catch (err) {
            const e = jsonErr(config.scim.version, pluginName, ctx.status, err)
              ctx.status = 404

              
            ctx.body = e
            return null
          }
        }
      } else {
        let err = `GET /${handle.description} having incorrect filter query syntax - only supporting eq - example: ?filter=userName eq "bjensen"`
        err = jsonErr(config.scim.version, '', ctx.status, err)
        ctx.status = 400
        ctx.body = err
        return null
      }
    } else {
      // ==========================================
      //             EXPLORE
      // ==========================================
      //
      // GET /Users?attributes=userName&startIndex=1&count=100
      // GET /Groups?attributes=displayName
      // GET /servicePlans?attributes=servicePlanName
      // GET /Users /Groups
      //
      logger.debug(`${gwName}[${pluginName}] [Explore ${handle.description}]`)
      logger.debug(`${gwName}[${pluginName}] calling "${handle.exploreMethod}" and awaiting result`)
      try {
        let count = ctx.query.count
        if (ctx.query.startIndex && !count) count = '200' // having startIndex, but no count => defaults to 200 (plugin may override)
        const data = await this[handle.exploreMethod](ctx.params.baseEntity, ctx.query.attributes ? ctx.query.attributes : '', ctx.query.startIndex ? parseInt(ctx.query.startIndex) : undefined, count ? parseInt(count) : undefined)
        let scimdata = data
        scimdata = addResources(scimdata, ctx.query.startIndex)
        scimdata = addSchemas(scimdata, handle.description, isScimv2)
        ctx.body = scimdata
        return null
      } catch (err) {
        const e = jsonErr(config.scim.version, pluginName, ctx.status, err)
        ctx.status = 500
        ctx.body = e
        return null
      }
    }
  })

  // ==========================================
  //           CREATE USER
  //           CREATE GROUP
  // ==========================================
  //
  // POST = /Users
  // Body contains user attributes including userName (userID)
  // Body example:
  // {"active":true,"name":{"familyName":"Elshaug","givenName":"Jarle"},"schemas":["urn:scim:schemas:core:1.0"],"userName":"jael01"}
  //
  // POST = /Groups
  // Body contains group attributes including displayName (group name)
  // Body example:
  // {"displayName":"MyGroup","externalId":"MyExternal","schemas":["urn:scim:schemas:core:1.0"]}
  //
  router.post([`/(|scim/)(!${undefined}|Users|Groups)(|.json)(|.xml)`,
    `/:baseEntity/(|scim/)(!${undefined}|Users|Groups)(|.json)(|.xml)`], async (ctx) => {
    const u = ctx.originalUrl.substr(ctx.originalUrl.lastIndexOf('/') + 1) // u = Users<.json|.xml>, Groups<.json|.xml>
    const handle = handler[u.split('.')[0]]
    logger.debug(`${gwName}[${pluginName}] [Create ${handle.description}]`)
    let jsonBody = ctx.request.body
    const strBody = JSON.stringify(jsonBody)
    if (strBody === '{}') {
      let err = new Error('Not accepting empty or none JSON formatted POST requests')
      err = jsonErr(config.scim.version, pluginName, ctx.status, err)
      ctx.status = 500
      ctx.body = err
      return null
    } else if (handle.createMethod === 'createUser' && !jsonBody.userName && !jsonBody.externalId) {
      let err = new Error('userName or externalId is mandatory')
      err = jsonErr(config.scim.version, pluginName, ctx.status, err)
      ctx.status = 500
      ctx.body = err
      return null
    } else if (handle.createMethod === 'createGroup' && !jsonBody.displayName && !jsonBody.externalId) {
      let err = new Error('displayName or externalId is mandatory')
      err = jsonErr(config.scim.version, pluginName, ctx.status, err)
      ctx.status = 500
      ctx.body = err
      return null
    }

    logger.debug(`${gwName}[${pluginName}] POST ${ctx.originalUrl} body=${strBody}`)
    jsonBody = JSON.parse(strBody) // using a copy
    const scimdata = AccessProxy.prototype.convertedScim(jsonBody)
    logger.debug(`${gwName}[${pluginName}] convertedBody=${JSON.stringify(scimdata)}`)
    logger.debug(`${gwName}[${pluginName}] calling "${handle.createMethod}" and awaiting result`)
    try {
      const data = await this[handle.createMethod](ctx.params.baseEntity, scimdata)
      const location = `${ctx.origin}${ctx.path}/${jsonBody.userName || jsonBody.displayName || jsonBody.externalId}`
     jsonBody.id = scimdata.id 
      
     if (!jsonBody.meta) jsonBody.meta = {}
      jsonBody.meta.location = location
      
      for (const key in data) { // merge any result e.g: data = {'id': 'xxxx'} when endpoint id different than userName/displayName
        jsonBody[key] = data[key]
      }
      delete jsonBody.password
      ctx.set('Location', location)
      ctx.status = 201
      ctx.body = data
    } catch (err) {
      const e = jsonErr(config.scim.version, pluginName, ctx.status, err)
      if (err.name && err.name === 'DuplicateKeyError') ctx.status = 409
      else ctx.status = 500
      ctx.body = e
    }
  }) // post

  // ==========================================
  //           DELETE USER/GROUP
  // ==========================================
  //
  // DELETE /Users/4aa37ddc-4985-4009-ab24-df42d37e2810
  // DELETE /Groups/4aa37ddc-4985-4009-ab24-df42d37e2810
  // Note user: using id (not userName). getUser should therefore set id = userName (userID) e.g. bjensen
  // => We then have: DELETE /Users/bjensen
  // Note groups: using id (not displayName). getGroup should therefore set id = displayName (groupID) e.g. Employees
  // => We then have: DELETE /Groups/Employees
  //
  router.delete([`/(|scim/)(!${undefined}|Users|Groups)/:id`,
    `/:baseEntity/(|scim/)(!${undefined}|Users|Groups)/:id`], async (ctx) => {
    let u = ctx.originalUrl.substr(0, ctx.originalUrl.lastIndexOf('/'))
    u = u.substr(u.lastIndexOf('/') + 1) // u = Users, Groups
    const handle = handler[u]
    const id = ctx.params.id
    logger.debug(`${gwName}[${pluginName}] [Delete ${handle.description}] id=${id}`)
    logger.debug(`${gwName}[${pluginName}] calling "${handle.deleteMethod}" and awaiting result`)

    try {
      await this[handle.deleteMethod](ctx.params.baseEntity, id)
      ctx.status = 204
    } catch (err) {
      const e = jsonErr(config.scim.version, pluginName, ctx.status, err)
      ctx.status = 500
      ctx.body = e
    }
  }) // delete

  // ==========================================
  //          MODIFY USER
  //          MODIFY GROUP MEMBERS
  // ==========================================
  //
  // PATCH = /Users/<id>
  // PATCH = /Users/4aa37ddc-4985-4009-ab24-df42d37e2810
  // Note, using id (not userName). getUser should therefore set id = userName (userID)
  // => We then have: PATCH /Users/bjensen
  //
  // Body contains user attributes to be updated
  // example: {"active":true}
  //
  // Multi-value attributes excluding user attribute 'groups' are customized from array to object based on type
  // This is done for simplifying plugin-code. For more information please see method convertedScim / convertedScim20
  //
  //          MODIFY GROUP MEMBERS
  //
  // PATCH = /Groups/<id>
  // PATCH = /Groups/4aa37ddc-4985-4009-ab24-df42d37e2810
  // Note, using id (not displayName). getGroup should therefore set id = displayName
  // => We then have: PATCH = /Groups/Employees
  //
  // Body contains user attributes to be updated
  // example: {"members":[{"value":"bjensen"}],"schemas":["urn:scim:schemas:core:1.0"]}
  //
  router.patch([`/(|scim/)(!${undefined}|Users|Groups|servicePlans)/:id`,
    `/:baseEntity/(|scim/)(!${undefined}|Users|Groups|servicePlans)/:id`], async (ctx) => {
    let u = ctx.originalUrl.substr(0, ctx.originalUrl.lastIndexOf('/'))
    u = u.substr(u.lastIndexOf('/') + 1) // u = Users, Groups
    const handle = handler[u]
    const id = ctx.params.id
    let jsonBody = ctx.request.body
    const strBody = JSON.stringify(jsonBody)
    if (strBody === '{}') {
      let err = new Error('Not accepting empty or none JSON formatted POST requests')
      err = jsonErr(config.scim.version, pluginName, ctx.status, err)
        ctx.status = 500

      ctx.body = err
    } else {
      logger.debug(`${gwName}[${pluginName}] [Modify ${handle.description}] id=${id}`)
      logger.debug(`${gwName}[${pluginName}] PATCH ${ctx.originalUrl} body=${strBody}`)
      jsonBody = JSON.parse(strBody) // using a copy
      let scimdata
      if (isScimv2) scimdata = convertedScimAccess(jsonBody) 
      logger.debug(`${gwName}[${pluginName}] convertedBody=${JSON.stringify(scimdata)}`)
      logger.debug(`${gwName}[${pluginName}] calling "${handle.modifyMethod}" and awaiting result`)
      try {
        await this[handle.modifyMethod](ctx.params.baseEntity, id, scimdata)
        const location = ctx.origin + ctx.path
        jsonBody.id = id
        delete jsonBody.password
        ctx.set('Location', location)
        ctx.status = 200
        ctx.body = jsonBody // using original body instead of retrieving actual data
      } catch (err) {
        const e = jsonErr(config.scim.version, pluginName, ctx.status, err)
        ctx.status = 500
        ctx.body = e
      }
    }
  }) // patch

  // ==========================================
  //          REPLACE USER
  //          REPLACE GROUP MEMBERS
  //          => Using same as patch, but no convertedScim20
  // ==========================================
  router.put([`/(|scim/)(!${undefined}|Users|Groups|servicePlans)/:id`,
    `/:baseEntity/(|scim/)(!${undefined}|Users|Groups|servicePlans)/:id`], async (ctx) => {
    let u = ctx.originalUrl.substr(0, ctx.originalUrl.lastIndexOf('/'))
    u = u.substr(u.lastIndexOf('/') + 1) // u = Users, Groups
    const handle = handler[u]
    const id = ctx.params.id
    let jsonBody = ctx.request.body
    const strBody = JSON.stringify(jsonBody)
    if (strBody === '{}') {
      let err = new Error('Not accepting empty or none JSON formatted POST requests')
      err = jsonErr(config.scim.version, pluginName, ctx.status, err)
      ctx.status = 500
      ctx.body = err
    } else {
      logger.debug(`${gwName}[${pluginName}] [Modify ${handle.description}] id=${id}`)
      logger.debug(`${gwName}[${pluginName}] PUT ${ctx.originalUrl} body=${strBody}`)
      jsonBody = JSON.parse(strBody) // using a copy
      const scimdata = AccessProxy.prototype.convertedScim(jsonBody)
      logger.debug(`${gwName}[${pluginName}] convertedBody=${JSON.stringify(scimdata)}`)
      logger.debug(`${gwName}[${pluginName}] calling "${handle.modifyMethod}" and awaiting result`)
      try {
        await this[handle.modifyMethod](ctx.params.baseEntity, id, scimdata.members ? scimdata.members : scimdata)
        const location = ctx.origin + ctx.path
        jsonBody.id = id
        delete jsonBody.password
        ctx.set('Location', location)
        ctx.status = 200
        ctx.body = jsonBody // using original body instead of retrieving actual data
      } catch (err) {
        const e = jsonErr(config.scim.version, pluginName, ctx.status, err)
        ctx.status = 500
        ctx.body = e
      }
    }
  }) // put

  //=========================================================================================================




    // ==========================================
    //          Access API GET (no SCIM)
    // ==========================================
    //
    //
    router.get([`/connectormanagement/directoryconfigs`,
        `/:baseEntity/connectormanagement/directoryconfigs`], async (ctx) => {
            logger.debug(`${gwName}[${pluginName}] [GET Access Direct api]`)
            let apiObj = ctx.request.body
            const strBody = JSON.stringify(apiObj)
            if (strBody === '{}') apiObj = undefined
            
            try {

            let result = await this.getApi(ctx.params.baseEntity, ctx.params.id, ctx.query)
                const location = ctx.origin + ctx.path
            
                

            if (!result.meta) result.meta = {}
            result.meta.result = 'success'
            result.meta.location = location
            ctx.status = 200
            ctx.body = result
        } catch (err) {
            ctx.status = 404


            ctx.body = apiErr(pluginName, err)
        }
    })




    // ==========================================
    //        Access API POST (no SCIM)
    // ==========================================
    //
    // POST = /api + body
    // Send body "as is" to plugin-api
    // Body example:
    // {"eventName":"AsignAccessRoleEvent","subjectName":"RACF_System-B","userID":"peter01"}
    //
    router.post([`/connectormanagement/directoryconfigs`,
        `/:baseEntity/connectormanagement/directoryconfigs`], async (ctx) => {
        logger.debug(`${gwName}[${pluginName}] [POST api]`)
        const apiObj = ctx.request.body
        const strBody = JSON.stringify(apiObj)
        if (strBody === '{}') {
            const err = new Error('Not accepting empty or none JSON formatted POST requests')
            ctx.status = 500
            ctx.body = apiErr(pluginName, err)
        } else {
            logger.debug(`${gwName}[${pluginName}] POST ${ctx.originalUrl} body=${JSON.stringify(apiObj)}`)
            logger.debug(`${gwName}[${pluginName}] calling "postApi" and awaiting result`)

            try {
                let result = await this.postApi(ctx.params.baseEntity, apiObj)
                const location = ctx.origin + ctx.path
                if (!result.meta) result.meta = {}
                result.meta.result = 'success'
                result.meta.location = location
                ctx.status = 201
                ctx.body = result
            } catch (err) {
                ctx.status = 500
                ctx.body = apiErr(pluginName, err)
            }
        }
    }) // post


  // ==========================================
  //           API POST (no SCIM)
  // ==========================================
  //
  // POST = /api + body
  // Send body "as is" to plugin-api
  // Body example:
  // {"eventName":"AsignAccessRoleEvent","subjectName":"RACF_System-B","userID":"peter01"}
  //
  router.post(['/api', '/:baseEntity/api'], async (ctx) => {
    logger.debug(`${gwName}[${pluginName}] [POST api]`)
    const apiObj = ctx.request.body
    const strBody = JSON.stringify(apiObj)
    if (strBody === '{}') {
      const err = new Error('Not accepting empty or none JSON formatted POST requests')
      ctx.status = 500
      ctx.body = apiErr(pluginName, err)
    } else {
      logger.debug(`${gwName}[${pluginName}] POST ${ctx.originalUrl} body=${JSON.stringify(apiObj)}`)
      logger.debug(`${gwName}[${pluginName}] calling "postApi" and awaiting result`)

      try {
        let result = await this.postApi(ctx.params.baseEntity, apiObj)
        const location = ctx.origin + ctx.path
        if (result) {
          if (typeof result === 'object') result = { result: result }
          else {
            try {
              result = { result: JSON.parse(result) }
            } catch (err) {
              result = { result: result }
            }
          }
        } else result = {}
        if (!result.meta) result.meta = {}
        result.meta.result = 'success'
        result.meta.location = location
        ctx.status = 201
        ctx.body = result
      } catch (err) {
        ctx.status = 500
        ctx.body = apiErr(pluginName, err)
      }
    }
  }) // post

  // ==========================================
  //           API PUT (no SCIM)
  // ==========================================
  //
  // PUT = /api/{id} + body
  // Send body "as is" to plugin-api
  // Body example:
  // {"eventName":"AsignAccessRoleEvent","subjectName":"RACF_System-B","userID":"peter01"}
  //
  router.put(['/api/:id', '/:baseEntity/api/:id'], async (ctx) => {
    const id = ctx.params.id
    logger.debug(`${gwName}[${pluginName}] [PUT api ] id=${id}`)
    const apiObj = ctx.request.body
    const strBody = JSON.stringify(apiObj)
    if (strBody === '{}') {
      const err = new Error('Not accepting empty or none JSON formatted PUT requests')
      ctx.status = 500
      ctx.body = apiErr(pluginName, err)
    } else {
      logger.debug(`${gwName}[${pluginName}] PUT ${ctx.originalUrl} body=${JSON.stringify(apiObj)}`)
      logger.debug(`${gwName}[${pluginName}] calling "putApi" and awaiting result`)

      try {
        let result = await this.putApi(ctx.params.baseEntity, id, apiObj)
        const location = ctx.origin + ctx.path
        if (result) {
          if (typeof result === 'object') result = { result: result }
          else {
            try {
              result = { result: JSON.parse(result) }
            } catch (err) {
              result = { result: result }
            }
          }
        } else result = {}
        if (!result.meta) result.meta = {}
        result.meta.result = 'success'
        result.meta.location = location
        ctx.status = 200
        ctx.body = result
      } catch (err) {
        ctx.status = 500
        ctx.body = apiErr(pluginName, err)
      }
    }
  }) // put

  // ==========================================
  //           API PATCH (no SCIM)
  // ==========================================
  //
  // PATCH = /api/{id} + body
  // Send body "as is" to plugin-api
  // Body example:
  // {"eventName":"AsignAccessRoleEvent","subjectName":"RACF_System-B","userID":"peter01"}
  //
  router.patch(['/api/:id', '/:baseEntity/api/:id'], async (ctx) => {
    const id = ctx.params.id
    logger.debug(`${gwName}[${pluginName}] [PATCH api ] id=${id}`)
    const apiObj = ctx.request.body
    const strBody = JSON.stringify(apiObj)
    if (strBody === '{}') {
      const err = new Error('Not accepting empty or none JSON formatted PATCH requests')
      ctx.status = 500
      ctx.body = apiErr(pluginName, err)
    } else {
      logger.debug(`${gwName}[${pluginName}] PATCH ${ctx.originalUrl} body=${JSON.stringify(apiObj)}`)
      logger.debug(`${gwName}[${pluginName}] calling "patchApi" and awaiting result`)

      try {
        let result = await this.patchApi(ctx.params.baseEntity, id, apiObj)
        const location = ctx.origin + ctx.path
        if (result) {
          if (typeof result === 'object') result = { result: result }
          else {
            try {
              result = { result: JSON.parse(result) }
            } catch (err) {
              result = { result: result }
            }
          }
        } else result = {}
        if (!result.meta) result.meta = {}
        result.meta.result = 'success'
        result.meta.location = location
        ctx.status = 200
        ctx.body = result
      } catch (err) {
        ctx.status = 500
        ctx.body = apiErr(pluginName, err)
      }
    }
  }) // patch

  

  // ==========================================
  //           API DELETE (no SCIM)
  // ==========================================
  //
  //  DELETE = /api/{id}
  //
  router.delete(['/api/:id', '/:baseEntity/api/:id'], async (ctx) => {
    const id = ctx.params.id
    logger.debug(`${gwName}[${pluginName}] [DELETE api] id=${id}`)
    logger.debug(`${gwName}[${pluginName}] calling "deleteApi" and awaiting result`)

    try {
      let result = await this.deleteApi(ctx.params.baseEntity, id)
      if (result) {
        if (typeof result === 'object') result = { result: result }
        else {
          try {
            result = { result: JSON.parse(result) }
          } catch (err) {
            result = { result: result }
          }
        }
      } else result = {}
      if (!result.meta) result.meta = {}
      result.meta.result = 'success'
      ctx.status = 200
      ctx.body = result
    } catch (err) {
      ctx.status = 500
      ctx.body = apiErr(pluginName, err)
    }
  }) // delete

  // ==========================================
  // Starting up...
  // ==========================================

  for (let i = 0; i < logger.transports.length; i++) { // loglevel=off => turn off logging
    if (logger.transports[i].name === 'file' && config.log.loglevel.file && config.log.loglevel.file.toLowerCase() === 'off') {
      logger.transports[i].silent = true
    } else if (logger.transports[i].name === 'console' && config.log.loglevel.console && config.log.loglevel.console.toLowerCase() === 'off') {
      logger.transports[i].silent = true
    }
  }

  logger.info('===================================================================')

  if (config.localhostonly === true) {
    logger.info(`${gwName}[${pluginName}] denying other clients than localhost (127.0.0.1)`)
    if (config.certificate && config.certificate.key && config.certificate.cert) {
      // SSL
      server = https.createServer({
        key: fs.readFileSync(configDir + '/certs/' + config.certificate.key),
        cert: fs.readFileSync(configDir + '/certs/' + config.certificate.cert)
      }, app.callback()).listen(config.port, 'localhost')
      logger.info(`${gwName}[${pluginName}] now listening on TLS port ${config.port}...\n`)
    } else if (config.certificate && config.certificate.pfx && config.certificate.pfx.bundle) {
      // SSL using PFX / PKCS#12
      server = https.createServer({
        pfx: fs.readFileSync(configDir + '/certs/' + config.certificate.pfx.bundle),
        passphrase: pwPfxPassword
      }, app.callback()).listen(config.port, 'localhost')
      logger.info(`${gwName}[${pluginName}] now listening on TLS port ${config.port}...\n`)
    } else {
      // none SSL
      server = http.createServer(app.callback()).listen(config.port, 'localhost')
      logger.info(`${gwName}[${pluginName}] now listening on port ${config.port}...\n`)
    }
  } else {
    logger.info(`${gwName}[${pluginName}] accepting requests from all clients`)
    if (config.certificate && config.certificate.key && config.certificate.cert) {
      // SSL self signed cert e.g: openssl req -nodes -newkey rsa:2048 -x509 -sha256 -days 3650 -keyout key.pem -out cert.pem -subj "/O=NodeJS/OU=Testing/CN=<FQDN>"
      // Note, self signed certificate (cert.pem) also needs to be imported at the CA Connector Server
      server = https.createServer({
        key: fs.readFileSync(configDir + '/certs/' + config.certificate.key),
        cert: fs.readFileSync(configDir + '/certs/' + config.certificate.cert),
        ca: (config.certificate.ca) ? fs.readFileSync(configDir + '/certs/' + config.certificate.ca) : null
      }, app.callback()).listen(config.port)
      logger.info(`${gwName}[${pluginName}] now listening on TLS port ${config.port}...\n`)
    } else if (config.certificate && config.certificate.pfx && config.certificate.pfx.bundle) {
      // SSL using PFX / PKCS#12
      server = https.createServer({
        pfx: fs.readFileSync(configDir + '/certs/' + config.certificate.pfx.bundle),
        passphrase: pwPfxPassword
      }, app.callback()).listen(config.port)
      logger.info(`${gwName}[${pluginName}] now listening on TLS port ${config.port}...\n`)
    } else {
      // none SSL
      server = http.createServer(app.callback()).listen(config.port)
      logger.info(`${gwName}[${pluginName}] now listening on port ${config.port}...\n`)
    }
  }

  // set loglevel according to config
  const arrValidLevel = ['silly', 'debug', 'verbose', 'info', 'warn', 'error']
  for (let i = 0; i < logger.transports.length; i++) {
    if (logger.transports[i].name === 'file') config.log.loglevel.file && arrValidLevel.includes(config.log.loglevel.file.toLowerCase()) ? logger.transports[i].level = config.log.loglevel.file : logger.transports[i].level = 'debug'
    else if (logger.transports[i].name === 'console') config.log.loglevel.console && arrValidLevel.includes(config.log.loglevel.console.toLowerCase()) ? logger.transports[i].level = config.log.loglevel.console : logger.transports[i].level = 'debug'
  }

  log.emailOnError = async (msg) => { // sending mail on error
    if (!config.emailOnError || !config.emailOnError.smtp || !(config.emailOnError.smtp.enabled === true) || isMailLock) return null // not sending mail
    isMailLock = true

    setTimeout(function () { // release lock after "sendInterval" minutes
      isMailLock = false
    }, (config.emailOnError.smtp.sendInterval || 15) * 1000 * 60)

    const bodyHtml = `<html><body> 
          <p>${msg}</p> 
          <br> 
          <p><strong>This is an automatically generated email - please do NOT reply to this email or forward to others</strong></p> 
          </body></html>`

    const smtpConfig = {
      host: config.emailOnError.smtp.host, // e.g. smtp.office365.com
      port: config.emailOnError.smtp.port || 587,
      proxy: config.emailOnError.smtp.proxy || null,
      secure: (config.emailOnError.smtp.port === 465), // false on 25/587
      tls: { ciphers: 'TLSv1.2' }
    }
    if (config.emailOnError.smtp.authenticate) {
      smtpConfig.auth = {}
      smtpConfig.auth.user = config.emailOnError.smtp.username
      smtpConfig.auth.pass = config.emailOnError.smtp.password
    }

    const transporter = nodemailer.createTransport(smtpConfig)
    const mailOptions = {
      from: config.emailOnError.smtp.username, // sender address
      to: config.emailOnError.smtp.to, // list of receivers - comma separated
      cc: config.emailOnError.smtp.cc,
      subject: 'AccessProxy error message',
      html: bodyHtml // 'text': bodyText
    }

    transporter.sendMail(mailOptions, function (err, info) {
      if (err) logger.error(`${gwName}[${pluginName}] mailOnError sending failed: ${err.message}`)
      else logger.debug(`${gwName}[${pluginName}] mailOnError sent to: ${config.emailOnError.smtp.to}${(config.emailOnError.smtp.cc) ? ',' + config.emailOnError.smtp.cc : ''}`)
    })
    return null
  } // emailOnError

  const gracefulShutdown = function () {
    logger.debug(`${gwName}[${pluginName}] received terminate/kill signal - closing connections and exit`)
    for (let i = logger.transports.length - 1; i >= 0; i--) { // enable info logging
      try { logger.transports[i].level = 'info' } catch (e) { }
    }
    logger.info(`${gwName}[${pluginName}] pheww... ${requestCounter} requests have been processed in the period ${startTime} - ${utils.timestamp()}\n`)
    logger.close()
    server.close(function () {
      setTimeout(function () { // plugins may also use SIGTERM/SIGINT
        process.exit(1)
      }, 0.5 * 1000)
    })
    setTimeout(function () { // problem closing server connections in time due to keep-alive sessions (active browser connection?), now forcing exit
      process.exit(2)
    }, 2 * 1000)
  }

  process.on('unhandledRejection', (err) => { // older versions of V8, unhandled promise rejections are silently dropped
    logger.error(`${gwName}[${pluginName}] Async function with unhandledRejection: ${err.stack}`)
  })
  process.once('SIGTERM', gracefulShutdown) // kill (windows subsystem lacks signaling support for process.kill)
  process.once('SIGINT', gracefulShutdown) // Ctrl+C
} // accessproxy

// methods

AccessProxy.prototype.getPassword = (pwEntity, configFile) => {
  return utils.getPassword(pwEntity, configFile) // utils.getPassword('accessproxy.password', './config/plugin-testmode.json');
}

AccessProxy.prototype.timestamp = () => {
  return utils.timestamp()
}

AccessProxy.prototype.copyObj = (o) => {
  return utils.copyObj(o)
}

AccessProxy.prototype.extendObj = (obj, src) => {
  return utils.extendObj(obj, src)
}

AccessProxy.prototype.Lock = utils.Lock

AccessProxy.prototype.getArrayObject = (Obj, element, type) => {
  if (Obj[element]) { // element is case sensitive
    return Obj[element].find(function (el) {
      return (el.type && (el.type).toLowerCase() === type.toLowerCase())
    })
  }
  return null
}

AccessProxy.prototype.isMultivalue = function isMultiValue (objName, attr) { // objName = 'User' or 'Group'
  let ret = false
  const obj = scimDef.Schemas.Resources.find(function (el) {
    return (el.name === objName)
  })
  if (obj) {
    ret = obj.attributes.find(function (el) {
      return (el.name === attr && el.multiValued === true)
    })
  }
  if (ret) return true
  else return false
}

// Multi-value attributes excluding user attribute 'groups' are customized from array to object based on type
// e.g "emails":[{"value":"bjensen@example.com","type":"work"}] => {"emails": {"work": {"value":"bjensen@example.com","type":"work"}}}
// Cleared values are set as user attributes with blank value ""
// e.g {meta:{attributes:['name.givenName','title']}} => {"name": {"givenName": ""}), "title": ""}
AccessProxy.prototype.convertedScim = function convertedScim (obj) {
  const scimdata = utils.copyObj(obj)
  if (scimdata.schemas) delete scimdata.schemas
  const newMulti = {}
  for (const key in scimdata) {
    if (Array.isArray(scimdata[key]) && (scimdata[key].length > 0) && scimdata[key][0].type) { // exclude "none type" multivalue attributes (e.g groups and x509Certificates)
      scimdata[key].forEach(function (element, index) {
        if (element.operation && element.operation === 'delete') { // add as deleted if the only type element
          const arr = scimdata[key]
          const arrMap = arr
            .map(arr => arr.type)
          if (arrMap.length === 1) {
            if (!newMulti[key]) newMulti[key] = {}
            newMulti[key][element.type.toLowerCase()] = {}
            for (const i in element) {
              newMulti[key][element.type.toLowerCase()][i] = element[i]
            }
            newMulti[key][element.type.toLowerCase()].value = '' // delete
          }
        } else {
          if (!newMulti[key]) newMulti[key] = {}
          newMulti[key][element.type.toLowerCase()] = {}
          for (const i in element) {
            newMulti[key][element.type.toLowerCase()][i] = element[i]
          }
        }
      })
      delete scimdata[key]
    }
  }
  if (scimdata.meta) { // cleared attributes e.g { meta: { attributes: [ 'name.givenName', 'title' ] } }
    if (Array.isArray(scimdata.meta.attributes)) {
      scimdata.meta.attributes.forEach(function (element, index) {
        dot.str(element, '', scimdata)
      })
    }
    delete scimdata.meta
  }
  for (const key in newMulti) {
    dot.copy(key, key, newMulti, scimdata)
  }
  return scimdata
}

// config can be set based on environment variables
// config can be set based on correspondig json-content in external file (supports also dot notation)
// syntax environment = "process.env.<ENVIRONMENT>" e.g. config.port could have value "process.env.PORT", then using environment variable PORT
// syntax file = "process.file.<PATH>" e.g. config.password could have value "process.file./tmp/myconf.json"
AccessProxy.prototype.processExtConfig = function processExtConfig (pluginName, config, isMain) {
  const processEnv = 'process.env.'
  const processFile = 'process.file.'
  const dotConfig = dot.dot(config)
  let content
  let filePath

  for (const key in dotConfig) {
    let value = dotConfig[key]
    if (value && value.constructor === String && value.includes(processEnv)) {
      const envKey = value.substring(processEnv.length)
      value = process.env[envKey]
      dotConfig[key] = value
      if (!value) {
        const newErr = new Error(`configuration failed - can't use none existing environment: "${envKey}"`)
        newErr.name = 'processExtConfig'
        throw newErr
      }
    } else if (value && value.constructor === String && value.includes(processFile)) {
      const newFilePath = value.substring(processFile.length)
      try {
        if (filePath !== newFilePath) { // avoid reading previous file
          filePath = newFilePath
          content = fs.readFileSync(filePath, 'utf8')
        }
        try {
          const jContent = JSON.parse(content) // json or json-dot-notation formatting is supported
          const dotContent = dot.dot(dot.object(jContent))
          let newKey = null
          if (isMain) newKey = `${pluginName}.accessproxy.${key}`
          else newKey = `${pluginName}.endpoint.${key}`
          value = dotContent[newKey]
          if (value === undefined) {
            if (dotContent[newKey + '.0']) { // check if array
              let i = 0
              do {
                dotConfig[key + '.' + i] = dotContent[newKey + '.' + i]
                i += 1
              } while (dotContent[newKey + '.' + i])
            } else {
              const newErr = new Error(`configuration failed - external JSON file "${filePath}" does not contain key: "${newKey}"`)
              newErr.name = 'processExtConfig'
              throw newErr
            }
          }
        } catch (err) {
          if (err.name && err.name === 'processExtConfig') throw err
          else {
            const newErr = new Error(`configuration failed - can't JSON parse external file: "${filePath}"`)
            newErr.name = 'processExtConfig'
            throw newErr
          }
        }
      } catch (err) {
        value = undefined
        if (err.name && err.name === 'processExtConfig') throw err
        else throw (new Error(`configuration failed - can't read external configuration file: ${err.message}`))
      }
      dotConfig[key] = value
    }
  }
  content = null
  return dot.object(dotConfig)
}



module.exports = AccessProxy // plugins can now use AccessProxy

const addResources = (data, startIndex) => {
  if (!data || JSON.stringify(data) === '{}') data = [] // no user/group found
  const res = { Resources: [] }
  if (Array.isArray(data)) res.Resources = data
  else if (data.Resources) {
    res.Resources = data.Resources
    res.totalResults = data.totalResults
  } else res.Resources.push(data)

  // If plugin not using pagination, setting totalResults = itemsPerPage
  if (!res.totalResults) res.totalResults = res.Resources.length // Specifies the total number of results matching the Consumer query
  res.itemsPerPage = res.Resources.length // Specifies the number of search results returned in a query response page
  res.startIndex = parseInt(startIndex) // The 1-based index of the first result in the current set of search results
  if (!res.startIndex) res.startIndex = 1
  if (res.startIndex > res.totalResults) { // invalid paging request, or scim 2.0 no user/group found
    res.Resources = []
    res.itemsPerPage = 0
  }
  for (let i = 0; i < res.Resources.length; i++) { delete res.Resources[i].password }
  return res
}

const addSchemas = (data, obj, isScimv2) => {
  if (!isScimv2) {
    if (data.Resources) data.schemas = ['urn:scim:schemas:core:1.0', 'urn:scim:schemas:extension:enterprise:1.0']
    else if (obj === 'User') {
      data.schemas = ['urn:scim:schemas:core:1.0', 'urn:scim:schemas:extension:enterprise:1.0']
    } else if (obj === 'Group') {
      data.schemas = ['urn:scim:schemas:core:1.0']
    }
  } else {
    if (data.Resources) data.schemas = ['urn:ietf:params:scim:api:messages:2.0:ListResponse']
    else if (obj === 'User') {
      data.schemas = ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User']
      if (!data.meta) data.meta = {}
      data.meta.resourceType = 'User'
    } else if (obj === 'Group') {
      data.schemas = ['urn:ietf:params:scim:schemas:core:2.0:Group']
      if (!data.meta) data.meta = {}
      data.meta.resourceType = 'Group'
    }
  }
  return data
}

//
// Check and return none supported attributes
//
const notValidAttributes = (obj, validScimAttr) => {
  if (validScimAttr.length < 1) return ''
  const tgt = dot.dot(obj)
  const ret = (Object.keys(tgt).filter(function (key) { // {'name.givenName': 'Jarle', emails.0.type': 'work'}
    const arrKey = key.split('.')
    if (arrKey.length > 2) key = `${arrKey[0]}.${arrKey[1]}` // e.g emails.work.value => emails.work
    if (key.indexOf('meta.attributes') === 0 || key.indexOf('schemas.') === 0) return false // attributes to be cleard or schema not needed in validScimAttr
    else return (validScimAttr.indexOf(key) === -1)
  }))
  if (ret.length > 0) return ret
  else return null
}

//
// Convert SCIM 2.0 patch to SCIM 1.1 standard (with multivalues customized from array to object based on type)
//
// Scim 2.0:
// {"Operations":[{"op":"Replace","path":"displayName","value":[{"$ref":null,"value":"Peter Hansen"}]},{"op":"Replace","path":"name.familyName","value":[{"$ref":null,"value":"Hansen"}]}]}
//
// Scim 1.1
//   {"displayName": "Peter Hansen", "name": {familyName: "Hansen"}}
//   Multivalues should follow same standards as defined in method convertedScim
//
const convertedScim20 = (data) => {
  const scimdata = {}
  const groupMembers = []
  if (!Array.isArray(data.Operations)) return scimdata
  data.Operations.forEach(function (element, index) {
    let type = null
    let typeElement = null
    let path = null
    let pathRoot = null
    let rePattern = new RegExp(/^.*(\[type eq .*\]).*$/)
    let arrMatches = null

    if (element.path) {
      arrMatches = element.path.match(rePattern)
      if (Array.isArray(arrMatches) && arrMatches.length === 2) { // [type eq "work"]
        rePattern = new RegExp(/^\[type eq (.*)\]$/)
        arrMatches = arrMatches[1].match(rePattern)
        if (Array.isArray(arrMatches) && arrMatches.length === 2) { // "work"
          type = arrMatches[1].replace(/"/g, '') // work
        }
      }

      rePattern = new RegExp(/^(.*)\[type eq .*\]\.(.*)$/) // "path":"addresses[type eq \"work\"].streetAddress"
      arrMatches = element.path.match(rePattern)
      if (Array.isArray(arrMatches) && arrMatches.length === 2) {
        if (type) path = `${arrMatches[1]}.${type}`
        else path = arrMatches[1]
        pathRoot = arrMatches[1]
      } else if (Array.isArray(arrMatches) && arrMatches.length === 3) {
        if (type) {
          path = `${arrMatches[1]}.${type}.${arrMatches[2]}`
          typeElement = arrMatches[2] // streetAddress
        } else path = `${arrMatches[1]}.${arrMatches[2]}` // NA
        pathRoot = arrMatches[1]
      }
      if ((element.op).toLowerCase() === 'replace' || (element.op).toLowerCase() === 'add') {
        if (element.path === 'members' || element.path === 'groups') { // members => Group attribute, groups => User attribute
          if (Array.isArray(element.value)) {
            element.value.forEach(function (el) { // {"value": [{ "value": "jsmith" }]}
              const eladd = {}
              for (const key in el) {
                eladd[key] = el[key]
              };
              groupMembers.push(eladd)
            })
          } else groupMembers.push(element.value) // {"value": { "value": "jsmith" }}
        }
        if (AccessProxy.prototype.isMultivalue('User', pathRoot)) {
          if (Array.isArray(element.value) && type) {
            if (!scimdata[pathRoot]) scimdata[pathRoot] = {}
            if (!scimdata[pathRoot][type]) scimdata[pathRoot][type] = {}
            if (!scimdata[pathRoot][type].type) scimdata[pathRoot][type].type = type
            if (!scimdata[pathRoot][type][typeElement] && typeElement !== 'value') scimdata[pathRoot][type][typeElement] = {}
            if (typeElement === 'value') scimdata[pathRoot][type].value = element.value[0].value // { phoneNumbers: { work: '+47 12345678' } }
            else scimdata[pathRoot][type][typeElement] = element.value[0].value // { addresses: { work: { country: 'Norway'} } }
          } else dot.str(path, element.value, scimdata) // entire set and sub attributes
        } else { // handle e.g name.familyName {"op": "Add", "path": "name.familyName", "value": [{"$ref": null,"value": "Jensen"}]}
          if (Array.isArray(element.value)) dot.str(element.path, element.value[0].value, scimdata)
          else dot.str(element.path, element.value, scimdata)
        }
      } else if ((element.op).toLowerCase() === 'remove') {
        if (element.path === 'members' || element.path === 'groups') { // members => Group attribute, groups => User attribute
          if (element.value) {
            if (Array.isArray(element.value)) {
              element.value.forEach(function (el) {
                groupMembers.push({ operation: 'delete', value: el.value })
              })
            } else if (element.value.value) groupMembers.push({ operation: 'delete', value: element.value.value })
          } else groupMembers.push({ operation: 'delete' }) // no value => delete all groups
        } else { // User
          if (AccessProxy.prototype.isMultivalue('User', pathRoot)) dot.str(`${pathRoot}.${type}.value`, '', scimdata)
          else {
            if (path) dot.str(path, '', scimdata)
            else dot.str(element.path, '', scimdata)
          }
        }
      }
    } else { // no path - op=remove using path
      for (const key in element.value) {
        if (Array.isArray(element.value[key])) {
          element.value[key].forEach(function (el, i) {
            dot.str(`${key}.${el.type}`, el, scimdata)
          })
        } else {
          dot.str(key, element.value[key], scimdata)
        }
      }
    }
  })

  if (groupMembers.length > 0) scimdata.members = groupMembers
  return scimdata
}



const convertedScimAccess = (data) => {
    const scimdata = {}
    const groupMembers = []
    if (!Array.isArray(data.Operations)) return scimdata
    data.Operations.forEach(function (element, index) {
        let type = null
        let typeElement = null
        let path = null
        let pathRoot = null
        let rePattern = new RegExp(/^.*(\[type eq .*\]).*$/)
        let arrMatches = null

        if (element.path) {
            arrMatches = element.path.match(rePattern)
            if (Array.isArray(arrMatches) && arrMatches.length === 2) { // [type eq "work"]
                rePattern = new RegExp(/^\[type eq (.*)\]$/)
                arrMatches = arrMatches[1].match(rePattern)
                if (Array.isArray(arrMatches) && arrMatches.length === 2) { // "work"
                    type = arrMatches[1].replace(/"/g, '') // work
                }
            }

            rePattern = new RegExp(/^(.*)\[type eq .*\]\.(.*)$/) // "path":"addresses[type eq \"work\"].streetAddress"
            arrMatches = element.path.match(rePattern)
            if (Array.isArray(arrMatches) && arrMatches.length === 2) {
                if (type) path = `${arrMatches[1]}.${type}`
                else path = arrMatches[1]
                pathRoot = arrMatches[1]
            } else if (Array.isArray(arrMatches) && arrMatches.length === 3) {
                if (type) {
                    path = `${arrMatches[1]}.${type}.${arrMatches[2]}`
                    typeElement = arrMatches[2] // streetAddress
                } else path = `${arrMatches[1]}.${arrMatches[2]}` // NA
                pathRoot = arrMatches[1]
            }
            if ((element.op).toLowerCase() === 'replace' || (element.op).toLowerCase() === 'add') {
                if (element.path === 'members' || element.path === 'groups') { // members => Group attribute, groups => User attribute
                    if (Array.isArray(element.value)) {
                        element.value.forEach(function (el) { // {"value": [{ "value": "jsmith" }]}
                            const eladd = {}
                            for (const key in el) {
                                eladd[key] = el[key]
                            };
                            groupMembers.push(eladd)
                        })
                    } else groupMembers.push(element.value) // {"value": { "value": "jsmith" }}
                }
                if (AccessProxy.prototype.isMultivalue('User', pathRoot)) {
                    if (Array.isArray(element.value) && type) {
                        if (!scimdata[pathRoot]) scimdata[pathRoot] = {}
                        if (!scimdata[pathRoot][type]) scimdata[pathRoot][type] = {}
                        if (!scimdata[pathRoot][type].type) scimdata[pathRoot][type].type = type
                        if (!scimdata[pathRoot][type][typeElement] && typeElement !== 'value') scimdata[pathRoot][type][typeElement] = {}
                        if (typeElement === 'value') scimdata[pathRoot][type].value = element.value[0].value // { phoneNumbers: { work: '+47 12345678' } }
                        else scimdata[pathRoot][type][typeElement] = element.value[0].value // { addresses: { work: { country: 'Norway'} } }
                    } else dot.str(path, element.value, scimdata) // entire set and sub attributes
                } else { // handle e.g name.familyName {"op": "Add", "path": "name.familyName", "value": [{"$ref": null,"value": "Jensen"}]}
                    if (Array.isArray(element.value)) dot.str(element.path, element.value[0].value, scimdata)
                    else dot.str(element.path, element.value, scimdata)
                }
            } else if ((element.op).toLowerCase() === 'remove') {
                if (element.path === 'members' || element.path === 'groups') { // members => Group attribute, groups => User attribute
                    if (element.value) {
                        if (Array.isArray(element.value)) {
                            element.value.forEach(function (el) {
                                groupMembers.push({ operation: 'delete', value: el.value })
                            })
                        } else if (element.value.value) groupMembers.push({ operation: 'delete', value: element.value.value })
                    } else groupMembers.push({ operation: 'delete' }) // no value => delete all groups
                } else { // User
                    if (AccessProxy.prototype.isMultivalue('User', pathRoot)) dot.str(`${pathRoot}.${type}.value`, '', scimdata)
                    else {
                        if (path) dot.str(path, '', scimdata)
                        else dot.str(element.path, '', scimdata)
                    }
                }
            }
        } else { // no path - op=remove using path
            for (const key in element.value) {
                if (Array.isArray(element.value[key])) {
                    element.value[key].forEach(function (el, i) {
                        dot.str(`${key}.${el.type}`, el, scimdata)
                    })
                } else {
                    dot.str(key, element.value[key], scimdata)
                }
            }
        }
    })

    if (groupMembers.length > 0) scimdata.members = groupMembers
    return scimdata
}

//
// SCIM error formatting
//
const jsonErr = (scimVersion, pluginName, htmlErrCode, err) => {
  let errJson = {}
  let msg = `AccessProxy[${pluginName}] `
  err.constructor === Error ? msg += err.message : msg += err

  if (scimVersion !== '2.0' && scimVersion !== 2) { // v1.1
    errJson =
    {
      Errors: [
        {
          description: msg,
          code: htmlErrCode
        }
      ]
    }
  } else { // v2.0
    errJson =
    {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      detail: msg,
      status: htmlErrCode
    }
  }
  return errJson
}

//
// api plugin formatted error
//
const apiErr = (pluginName, err) => {
  let msg
  if (err.constructor !== Error) err = { message: err }
  try {
    msg = JSON.parse(err.message)
    msg.originator = `AccessProxy[${pluginName}]`
  } catch (e) { msg = `AccessProxy[${pluginName}] ${err.message}` }
  const errObj = {
    meta: {
      result: 'error',
      description: msg
    }
  }
  return errObj
}
