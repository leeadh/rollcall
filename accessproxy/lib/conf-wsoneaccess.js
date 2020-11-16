// ==============================================================================================================
// File:    conf-wsoneaccess.js
//
// Author:  Pete Lindley
//
// Purpose: Rollcall Access Proxy config to facilitate outbound SCIM 2.0 Provisioning from Azure Active Directory
//          to Workspace ONE Access SCIM 1.1 Endpoint.
//
// Prereq:  1. A User Directory of type "OTHER_DIRECTORY" created in Workspace ONE Access.
//              -- this can be created using the Rollcall UI interface or via API.
//          2. An OAuth ClientID and ClientSecret generated from your Workspace ONE Access Tenant.
//          3. An Azure Active Directory (P1 or P2) Tenant.
//          4. Ability to enable inbound web access to your specified port to allow Azure to call this service
//          inbound via API calls. This service does not run HTTPS so it is recommended to use a Reverse Proxy
//          with a valid SSL certificate to proxy the connection to this service.
//          5. You also need to configure the conf-wsoneaccess.json configuration file with your tenant details
//          and OAuth credentials.
//          6. You must also manually specify a string value that serves as a permanent JWT Bearer Token for 
//          inbound authentication to THIS gateway. This token is not used to authenticate to Workspace ONE Access 
//          however should still be treated just as sensitive as it allows access via gateway proxy.
//          7. To use the Rollcall UI component (not mandatory) you also add this same JWT token to the 
//          Rollcall UI proxy configuration as it uses this service to communicate with Access. 
//
// Currently Supported attributes:
//
// Detail         Attribute in Azure        Attribute in Access    
// -------------------------------------------------------------------------------------------------------------
// Username       userPrincipalName         userName
// Disabled       isSoftDeleted             active
// First Name     givenName                 name.givenName
// Last Name      surname                   name.familyName
// Email          userPrincipalName         emails
// Domain         -                         domain
// ExternalID     userPrincipalName         externalId
//
// Groups and Memberships are also supported.
// =============================================================================================================

'use strict'

const http = require('http')
const https = require('https')
const HttpsProxyAgent = require('https-proxy-agent')
const URL = require('url').URL
const querystring = require('querystring')
// add support for .env file and read it
require('dotenv').config({ path: '/rollcall/accessproxy/config/.env' })

// mandatory plugin initialization - start
const path = require('path')
let AccessProxy = null
try {
  AccessProxy = require('accessproxy')
} catch (err) {
  AccessProxy = require('./accessproxy')
}
const accessproxy = new AccessProxy()
const pluginName = path.basename(__filename, '.js')
const configDir = path.join(__dirname, '..', 'config')
const configFile = path.join(`${configDir}`, `${pluginName}.json`)
const validScimAttr = [ // array containing scim attributes supported by our plugin code. Empty array - all attrbutes are supported by endpoint
  'userName', // userName or externalId is mandatory
  'active', // active is mandatory for IM
  'password',
  'name.givenName',
  'name.familyName',
  'emails',
  'emails.work',
  'userPrincipalName',
  'externalId',
  'domain',
  'internalUserType'
]
let config = require(configFile).endpoint
config = accessproxy.processExtConfig(pluginName, config) // add any external config process.env and process.file
// mandatory plugin initialization - end

const _serviceClient = {}

// =================================================
// exploreUsers
// =================================================
accessproxy.exploreUsers = async (baseEntity, attributes, startIndex, count) => {
  const action = 'exploreUsers'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" attributes=${attributes} startIndex=${startIndex} count=${count}`)
  const ret = { // itemsPerPage will be set by accessproxy
    Resources: [],
    totalResults: null
  }

  const method = 'GET'
  const path = `/Users${(attributes ? '?attributes=' + attributes : '')}`
  const body = null

  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      const err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw (err)
    } else if (!response.body.Resources) {
      const err = new Error(`${action}: Got empty response on REST request`)
      throw (err)
    }
    if (!startIndex && !count) { // client request without paging
      startIndex = 1
      count = response.body.Resources.length
    }

    const arrAttr = attributes.split(',')
    for (let index = startIndex - 1; index < response.body.Resources.length && (index + 1 - startIndex) < count; ++index) {
      const retObj = response.body.Resources[index]
      if (!attributes) ret.Resources.push(retObj)
      else { // return according to attributes (userName or externalId should normally be included and id=userName/externalId)
        let found = false
        const obj = {}
        for (let i = 0; i < arrAttr.length; i++) {
          const key = arrAttr[i].split('.')[0] // title => title, name.familyName => name
          if (retObj[key]) {
            obj[key] = retObj[key]
            found = true
          }
        }
        if (found) ret.Resources.push(obj)
      }
    }
    // not needed if client or endpoint does not support paging
    ret.totalResults = response.body.Resources.length
    ret.startIndex = startIndex
    return ret // all explored users
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// exploreGroups
// =================================================
accessproxy.exploreGroups = async (baseEntity, attributes, startIndex, count) => {
  const action = 'exploreGroups'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" attributes=${attributes} startIndex=${startIndex} count=${count}`)
  const ret = { // itemsPerPage will be set by accessproxy
    Resources: [],
    totalResults: null
  }

  const method = 'GET'
  const path = '/Groups?attributes=displayName'
  const body = null

  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      const err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    } else if (!response.body.Resources) {
      const err = new Error(`${action}: Got empty response on REST request`)
      throw err
    }
    if (!startIndex && !count) { // client request without paging
      startIndex = 1
      count = response.body.Resources.length
    }
    for (let index = startIndex - 1; index < response.body.Resources.length && (index + 1 - startIndex) < count; ++index) {
      if (response.body.Resources[index].id && response.body.Resources[index].displayName) {
        const scimGroup = { 
          displayName: response.body.Resources[index].displayName,
          id: response.body.Resources[index].id,
          externalId: response.body.Resources[index].displayName
        }
        ret.Resources.push(scimGroup)
      }
    }
    // not needed if client or endpoint does not support paging
    ret.totalResults = response.body.Resources.length
    ret.startIndex = startIndex
    return ret // all explored users
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// getUser
// =================================================
accessproxy.getUser = async (baseEntity, getObj, attributes) => {
  // getObj = { filter: <filterAttribute>, identifier: <identifier> }
  // e.g: getObj = { filter: 'userName', identifier: 'bjensen'}
  // Note, the value of id attribute returned will be used by modifyUser and deleteUser
  const action = 'getUser'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" ${getObj.filter}=${getObj.identifier} attributes=${attributes}`)

  const method = 'GET'
  const path = `/Users?filter=${getObj.filter} eq "${getObj.identifier}"${(attributes) ? '&attributes=' + attributes : ''}` // GET /Users?filter=userName eq "bjensen"&attributes=userName,active,name.givenName,name.familyName,name.formatted,title,emails,phoneNumbers,entitlements
  const body = null

  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      const err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    } else if (!response.body.Resources) {
      const err = new Error(`${action}: Got empty response on REST request`)
      throw err
    }

    let userObj
    if (Array.isArray(response.body.Resources) && response.body.Resources.length === 1) userObj = response.body.Resources[0]
    if (!userObj) return null // user not found

    if (!userObj.name) userObj.name = {}
    if (!userObj.emails) userObj.emails = [{}]
  

    const retObj = {
      userName: userObj.userName,
      id: userObj.id,
      active: userObj.active,
      name: {
        givenName: userObj.name.givenName || '',
        familyName: userObj.name.familyName || '',
      },
        emails: {
            value: userObj.emailaddress || null,
        }
    }

    if (!attributes) return retObj // user with all attributes
    // return according to attributes
    const ret = {}
    const arrAttr = attributes.split(',')
    for (let i = 0; i < arrAttr.length; i++) {
      const attr = arrAttr[i].split('.') // title / name.familyName / emails.value
      if (retObj[attr[0]]) {
        if (attr.length === 1) ret[attr[0]] = retObj[attr[0]]
        else if (retObj[attr[0]][attr[1]]) { // name.familyName
          if (!ret[attr[0]]) ret[attr[0]] = {}
          ret[attr[0]][attr[1]] = retObj[attr[0]][attr[1]]
        } else if (Array.isArray(retObj[attr[0]])) { // emails.value 
          if (!ret[attr[0]]) ret[attr[0]] = []
          const arr = retObj[attr[0]]
          for (let j = 0; j < arr.length; j++) {
            if (arr[j][attr[1]]) {
              const index = ret[attr[0]].findIndex(el => (el.value && arr[j].value && el.value === arr[j].value))
              let o
              if (index < 0) {
                o = {}
                if (arr[j].value) o.value = arr[j].value // new, always include value
              } else o = ret[attr[0]][index] // existing
              o[attr[1]] = arr[j][attr[1]]
              if (index < 0) ret[attr[0]].push(o)
              else ret[attr[0]][index] = o
            }
          }
        }
      }
      }
    if (JSON.stringify(ret) === '{}') return retObj // user with all attributes when specified attributes not found
    return ret
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// createUser
// =================================================
accessproxy.createUser = async (baseEntity, userObj) => {
  const action = 'createUser'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" userObj=${JSON.stringify(userObj)}`)

  const notValid = accessproxy.notValidAttributes(userObj, validScimAttr)
  if (notValid) {
    const err = new Error(`unsupported scim attributes: ${notValid} ` +
      `(supporting only these attributes: ${validScimAttr.toString()})`
    )
    throw err
  }

  // allSchemas is to ensure that Azure thinks its talking to a SCIM 2.0 endpoint, and Access thinks its only getting SCIM 1.0 schemas.
  const allSchemas = ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User", "urn:scim:schemas:core:1.0", "urn:scim:schemas:extension:workspace:tenant:sva:1.0", "urn:scim:schemas:extension:workspace:1.0", "urn:scim:schemas:extension:enterprise:1.0"]
  const method = 'POST'
  const path = '/Users'
    const body = {
        schemas: allSchemas,
        userName: userObj.userName,
        active: userObj.active || true,
        externalId: userObj.externalId || null,
        name: {
            givenName: userObj.name.givenName || null,
            familyName: userObj.name.familyName || null
        },
        emails: userObj.emails,
        //Custom Workspace ONE Access Schema required for the attributes sent below. Hard code internalUserType to 'Provisioned' as this is what Access expects for SCIM.
        'urn:scim:schemas:extension:workspace:1.0': {
            internalUserType: 'PROVISIONED' || null,
            domain: config.entity[baseEntity].domain || null,
            userPrincipalName: userObj.userName || null
        }
    }

  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      const err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
      }
    //To keep Azure and Access happy at the same time, letting Azure send right ID, but then Access sends the real ID back for correlation.
    userObj.id = response.body.id
    accessproxy.logger.debug(`CUSTOM CREATE USER ADDITION userObj.ID"${userObj.id} created user response=${JSON.stringify(response)}`)    
    return response.body
    //return null
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// deleteUser
// =================================================
accessproxy.deleteUser = async (baseEntity, id) => {
  const action = 'deleteUser'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id}`)

  const method = 'DELETE'
  const path = `/Users/${id}`
  const body = null

  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      const err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    }
    return null
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// modifyUser
// =================================================
accessproxy.modifyUser = async (baseEntity, id, attrObj) => {
  const action = 'modifyUser'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id} attrObj=${JSON.stringify(attrObj)}`)

  const notValid = accessproxy.notValidAttributes(attrObj, validScimAttr)
  if (notValid) {
    const err = new Error(`unsupported scim attributes: ${notValid} ` +
      `(supporting only these attributes: ${validScimAttr.toString()})`
    )
    throw err
  }

  const method = 'PATCH'
  const path = `/Users/${id}`
  const body = { userName: id }
  if (attrObj.active === true) body.active = true
  else if (attrObj.active === false) body.active = false

  if (attrObj.name.givenName || attrObj.name.givenName === '') {
    if (!body.name) body.name = {}
    body.name.givenName = attrObj.name.givenName
  }
  if (attrObj.name.familyName || attrObj.name.familyName === '') {
    if (!body.name) body.name = {}
    body.name.familyName = attrObj.name.familyName
  }
  if (attrObj.emails || attrObj.name.emails === '') {
     body.emails = attrObj.emails
  }
  
  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      const err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    }
    return null
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// getGroup
// =================================================
accessproxy.getGroup = async (baseEntity, getObj, attributes) => {
  // getObj = { filter: <filterAttribute>, identifier: <identifier> }
  // e.g: getObj = { filter: 'displayName', identifier: 'GroupA' }
  // filter: displayName and id must be supported
  // Note, the value of id attribute returned will be used by deleteGroup, getGroupMembers and modifyGroup
  const action = 'getGroup'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" ${getObj.filter}=${getObj.indentifier} attributes=${attributes}`)

  const method = 'GET'
  const path = `/Groups?filter=${getObj.filter} eq "${getObj.identifier}"${(attributes) ? '&attributes=' + attributes : ''}` // GET = /Groups?filter=displayName eq "Admins"&attributes=externalId,id,members.value,displayName
  const body = null

  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (!response.body.Resources) {
      const err = new Error(`${action}: Got empty response on REST request`)
      throw err
    }
    const retObj = {}
    if (response.body.Resources.length === 1) {
      const groupObj = response.body.Resources[0]
      if (!groupObj) return null // no group found
      retObj[getObj.filter] = groupObj[getObj.filter] // incase none of below (e.g. externalId)
      retObj.displayName = groupObj.displayName // mandatory
      retObj.id = groupObj.id // Changed code here to change returned id of group to be the real ID as Access does not use Display Name.
      if (Array.isArray(groupObj.members)) { // comment out this line if using "users are member of group"
        retObj.members = []
        groupObj.members.forEach((el) => {
          if (el.value) retObj.members.push({ value: el.value })
       })
      }
    }
    return retObj
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// getGroupMembers
// =================================================
accessproxy.getGroupMembers = async (baseEntity, id, attributes) => {
  const action = 'getGroupMembers'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" user id=${id} attributes=${attributes}`)
  const arrRet = []

  const method = 'GET'
  const path = `/Groups?filter=members.value eq "${id}"&attributes=${attributes}` // GET = /Groups?filter=members.value eq "bjensen"&attributes=members.value,displayName
  const body = null

  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (!response.body.Resources) {
      const err = new Error(`${action}: Got empty response on REST request`)
      throw err
    }
    response.body.Resources.forEach(function (element) {
      if (Array.isArray(element.members)) {
        element.members.forEach(function (el) {
          if (el.value === id) { // user is member of group
            const userGroup = {
              displayName: element.displayName, // displayName is mandatory
              members: [{ value: el.value }] // only includes current user
            }
            arrRet.push(userGroup)
          }
        })
      }
    })
    return arrRet
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// getGroupUsers
// =================================================
accessproxy.getGroupUsers = async (baseEntity, groupName, attributes) => {
  const action = 'getGroupUsers'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" groupName=${groupName} attributes=${attributes}`)
  const arrRet = []
  return arrRet
}

// =================================================
// createGroup
// =================================================
accessproxy.createGroup = async (baseEntity, groupObj) => {
  const action = 'createGroup'
  //added to ensure Azure and Access both think they're talking the same language (schema)
  const allGroupSchemas = ["urn:ietf:params:scim:schemas:core:2.0:Group", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:Group", "urn:scim:schemas:core:1.0", "urn:scim:schemas:extension:workspace:tenant:sva:1.0", "urn:scim:schemas:extension:workspace:1.0", "urn:scim:schemas:extension:enterprise:1.0"]

  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" groupObj=${JSON.stringify(groupObj)}`)

  const method = 'POST'
  const path = '/Groups'
    const body = {
        schemas: allGroupSchemas,
        displayName: groupObj.displayName,
        'urn:scim:schemas:extension:workspace:1.0': {
            internalGroupType: 'INTERNAL',
            domain: config.entity[baseEntity].domain
        }
    }
  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      const err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
      }
    //added code to change the id returned after creation for correct correlation
      groupObj.id = response.body.id
    return response.body
      //return null
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// deleteGroup
// =================================================
accessproxy.deleteGroup = async (baseEntity, id) => {
  const action = 'deleteGroup'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id}`)

  const method = 'DELETE'
  const path = `/Groups/${id}`
  const body = null

  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      const err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    }
    return null
  } catch (err) {
    const newErr = err
    throw newErr
  }
}

// =================================================
// modifyGroup
// =================================================
accessproxy.modifyGroup = async (baseEntity, id, attrObj) => {
  const action = 'modifyGroup'
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}" id=${id} attrObj=${JSON.stringify(attrObj)}`)
  accessproxy.logger.debug(`attrObj.members.value =${JSON.stringify(attrObj.members.value)}`)

  if (!attrObj.members) {
    throw new Error(`plugin handling "${action}" only supports modification of members`)
  }
  if (!Array.isArray(attrObj.members)) {
    throw new Error(`plugin handling "${action}" error: ${JSON.stringify(attrObj)} - correct syntax is { "members": [...] }`)
  }
  const body = { members: [] }
  attrObj.members.forEach(function (el) {
    if (el.operation && el.operation === 'delete') { // delete member from group
      // PATCH = /Groups/Admins Body = {"members":[{"operation":"delete","value":"bjensen"}]}
      body.members.push({ operation: 'delete', value: el.value })
    } else { // add member to group/
      // PATCH = /Groups/Admins Body = {"members":[{"value":"bjensen"}]
      body.members.push({ value: el.value })
    }
  })
  const method = 'PATCH'
  const path = `/Groups/${id}`

  try {
    const response = await doRequest(baseEntity, method, path, body)
    if (response.statusCode < 200 || response.statusCode > 299) {
      const err = new Error(`Error message: ${response.statusMessage} - ${JSON.stringify(response.body)}`)
      throw err
    }
    return null
  } catch (err) {
    const newErr = err
    throw newErr
  }
}


// =================================================
// getDomains
// 
// Custom function to allow Rollcall UI to get directory list
// =================================================
accessproxy.getApi = async (baseEntity) => {
    const action = 'getApi'
    accessproxy.logger.debug(`${pluginName}[${baseEntity}] handling "${action}"`)
    const method = 'GET'
    const newPath = '/SAAS/jersey/manager/api/connectormanagement/directoryconfigs'
    const body = null
    try {
        const path = newPath
        const response = await doDirRequest(baseEntity, method, path, body)
        accessproxy.logger.debug(`response in plugin "${JSON.stringify(response)}"`)
        return response
    } catch (err) {
        const newErr = err
        throw newErr
    }
}
// =================================================
// createDomain
//
// Custom function to allow Rollcall UI to create new Directory for SCIM
// =================================================
//
//
accessproxy.postApi = async (baseEntity, apiObj) => {
    const action = 'postApi'
    accessproxy.logger.debug(`${pluginName} handling "${action}" apiObj=${JSON.stringify(apiObj)}`)

    const method = 'POST'
    const path = '/SAAS/jersey/manager/api/connectormanagement/directoryconfigs'
    const body = {
               
        type: "OTHER_DIRECTORY",
        domains: [apiObj.domains],
        name: apiObj.name
    }
    try {
        const response = await doDirRequest(baseEntity, method, path, body)
        return response.body
    } catch (err) {
        const newErr = err
        throw newErr
    }
}


const getAccessToken = async (baseEntity) => {
    const d = new Date() / 1000 // seconds (unix time)
    if (_serviceClient[baseEntity] && _serviceClient[baseEntity].accessToken &&
        (_serviceClient[baseEntity].accessToken.validTo >= d + 30)) { // avoid simultaneously token requests

        return _serviceClient[baseEntity].accessToken
    }

    const action = 'getAccessToken'
    accessproxy.logger.debug(`${pluginName}[${baseEntity}] ${action}: Retrieving accesstoken`)

    const req = config.entity[baseEntity].oauthUrl
    // + `/auth/oauthtoken`
    const method = 'POST'

    const form = { // to be query string formatted
        grant_type: 'client_credentials',
        client_id: config.entity[baseEntity].clientId,
        client_secret: accessproxy.getPassword(`endpoint.entity.${baseEntity}.clientSecret`, configFile),

    }

    const options = {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded' // body must be query string formatted (no JSON)
        }
    }

    try {
        const response = await doRequest(baseEntity, method, req, form, options)
        if (!response.body) {
            const err = new Error(`[${action}] No data retrieved from: ${method} ${req}`)
            throw (err)
        }
        const jbody = response.body
        if (jbody.error) {
            const err = new Error(`[${action}] Error message: ${jbody.error_description}`)
            throw (err)
        } else if (!jbody.access_token || !jbody.expires_in) {
            const err = new Error(`[${action}] Error message: Retrieved invalid token response`)
            throw (err)
        }

        const d = new Date() / 1000 // seconds (unix time)
        jbody.validTo = d + parseInt(jbody.expires_in) // instead of using expires_on (clock may not be in sync with NTP, AAD default expires_in = 3600 seconds)
        accessproxy.logger.silly(`${pluginName}[${baseEntity}] ${action}: AccessToken =  ${jbody.access_token}`)


        return jbody
    } catch (err) {

        throw (err)
    }
}

//
// getServiceClient - returns options needed for connection parameters
//
//   path = e.g. "/xxx/yyy", then using host/port/protocol based on config baseUrls[0]
//          auth automatically added and failover according to baseUrls array
//
//   path = url e.g. "http(s)://<host>:<port>/xxx/yyy", then using the url host/port/protocol
//          opt (options) may be needed e.g {auth: {username: "username", password: "password"} }
//
const getServiceClient = async (baseEntity, method, path, opt) => {
  const action = 'getServiceClient'

  let urlObj
  if (!path) path = ''
  try {
    urlObj = new URL(path)
  } catch (err) {
    //
    // path (no url) - default approach and client will be cached based on config
    //
    if (_serviceClient[baseEntity]) { // serviceClient already exist
      accessproxy.logger.debug(`${pluginName}[${baseEntity}] ${action}: Using existing client`)
    } else {
      accessproxy.logger.debug(`${pluginName}[${baseEntity}] ${action}: Client have to be created`)
      let client = null
      if (config.entity && config.entity[baseEntity]) client = config.entity[baseEntity]
      if (!client) {
        const err = new Error(`Base URL have baseEntity=${baseEntity}, and configuration file ${pluginName}.json is missing required baseEntity configuration for ${baseEntity}`)
        throw err
      }
      const accessToken = await getAccessToken(baseEntity)
      urlObj = new URL(config.entity[baseEntity].baseUrls[0])
        const param = {
            baseUrl: config.entity[baseEntity].baseUrls[0],
            options: {
                json: true, // json-object response instead of string
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: ` Bearer ${accessToken.access_token}`
                },
                host: urlObj.hostname,
                port: urlObj.port, // null if https and 443 defined in url
                protocol: urlObj.protocol, // http: or https:
                // 'method' and 'path' added at the end
            }
        }

      // proxy
      if (config.entity[baseEntity].proxy && config.entity[baseEntity].proxy.host) {
        const agent = new HttpsProxyAgent(config.entity[baseEntity].proxy.host)
        param.options.agent = agent // proxy
        if (config.entity[baseEntity].proxy.username && config.entity[baseEntity].proxy.password) {
          param.options.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${config.entity[baseEntity].proxy.username}:${accessproxy.getPassword(`endpoint.entity.${baseEntity}.proxy.password`, configFile)}`).toString('base64') // using proxy with auth
        }
      }

      if (!_serviceClient[baseEntity]) _serviceClient[baseEntity] = {}
      _serviceClient[baseEntity] = param // serviceClient created
    }

    const cli = accessproxy.copyObj(_serviceClient[baseEntity]) // client ready

    // failover support
    path = _serviceClient[baseEntity].baseUrl + path
    urlObj = new URL(path)
    cli.options.host = urlObj.hostname
    cli.options.port = urlObj.port
    cli.options.protocol = urlObj.protocol

    // adding none static
    cli.options.method = method
    cli.options.path = `${urlObj.pathname}${urlObj.search}`
    if (opt) cli.options = accessproxy.extendObj(cli.options, opt) // merge with argument options

    return cli // final client
  }
  //
  // url path - none config based and used as is (no cache)
  //
  accessproxy.logger.debug(`${pluginName}[${baseEntity}] ${action}: Using none config based client`)
    let options = {
    json: true,
    headers: {
      'Content-Type': 'application/json'
    },
    host: urlObj.hostname,
    port: urlObj.port,
    protocol: urlObj.protocol,
    method: method,
    path: urlObj.pathname
  }

  // proxy
  if (config.entity[baseEntity].proxy && config.entity[baseEntity].proxy.host) {
    const agent = new HttpsProxyAgent(config.entity[baseEntity].proxy.host)
    options.agent = agent // proxy
    if (config.entity[baseEntity].proxy.username && config.entity[baseEntity].proxy.password) {
      options.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${config.entity[baseEntity].proxy.username}:${accessproxy.getPassword(`endpoint.entity.${baseEntity}.proxy.password`, configFile)}`).toString('base64') // using proxy with auth
    }
  }

  // merge any argument options - support basic auth using {auth: {username: "username", password: "password"} }
  if (opt) {
    const o = accessproxy.copyObj(opt)
    if (o.auth) {
      options.headers.Authorization = 'Basic ' + Buffer.from(`${o.auth.username}:${o.auth.password}`).toString('base64')
      delete o.auth
    }
    options = accessproxy.extendObj(options, o)
  }

  const cli = {}
  cli.options = options
  return cli // final client
}

const updateServiceClient = (baseEntity, obj) => {
  if (_serviceClient[baseEntity]) _serviceClient[baseEntity] = accessproxy.extendObj(_serviceClient[baseEntity], obj) // merge with argument options
}

//
// doRequest - execute REST service
//
const doRequest = async (baseEntity, method, path, body, opt, retryCount) => {
  try {
    const cli = await getServiceClient(baseEntity, method, path, opt)
    const options = cli.options
      
    const result = await new Promise((resolve, reject) => {
      let dataString = ''
      if (body) {
        if (options.headers['Content-Type'].toLowerCase() === 'application/x-www-form-urlencoded') {
          if (typeof data === 'string') dataString = body
          else dataString = querystring.stringify(body) // JSON to query string syntax + URL encoded
        } else dataString = JSON.stringify(body)
        options.headers['Content-Length'] = Buffer.byteLength(dataString, 'utf8')
      }
        accessproxy.logger.debug(`options = ${JSON.stringify(options)} path = ${path}`)
      const reqType = (options.protocol.toLowerCase() === 'https:') ? https.request : http.request
      const req = reqType(options, (res) => {
        const { statusCode, statusMessage } = res // solving parallel problem (const + don't use res.statusCode)

        let responseString = ''
        res.setEncoding('utf-8')

        res.on('data', (chunk) => {
          responseString += chunk
        })

        res.on('end', () => {
          const response = {
            statusCode: statusCode,
            statusMessage: statusMessage,
            body: null
          }
          try {
            if (responseString) response.body = JSON.parse(responseString)
          } catch (err) { response.body = responseString }
          if (statusCode < 200 || statusCode > 299) reject(new Error(JSON.stringify(response)))
          resolve(response)
        })
      }) // req

      req.on('socket', (socket) => {
        socket.setTimeout(60000) // connect and wait timeout => socket hang up
        socket.on('timeout', function () { req.abort() })
      })

      req.on('error', (error) => { // also catching req.abort
        req.end()
        reject(error)
      })

      if (dataString) req.write(dataString)
      req.end()
    }) // Promise

    accessproxy.logger.debug(`${pluginName}[${baseEntity}] doRequest ${method} ${options.protocol}//${options.host}${(options.port ? `:${options.port}` : '')}${path} Body = ${JSON.stringify(body)} Response = ${JSON.stringify(result)}`)
    return result
  } catch (err) { // includes failover/retry logic based on config baseUrls array
    accessproxy.logger.error(`${pluginName}[${baseEntity}] doRequest ${method} ${path} Body = ${JSON.stringify(body)} Error Response = ${err.message}`)
    if (!retryCount) retryCount = 0
    let urlObj
    try { urlObj = new URL(path) } catch (err) {}
    if (!urlObj && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
      if (retryCount < config.entity[baseEntity].baseUrls.length) {
        retryCount++
        updateServiceClient(baseEntity, { baseUrl: config.entity[baseEntity].baseUrls[retryCount - 1] })
        accessproxy.logger.debug(`${pluginName}[${baseEntity}] ${(config.entity[baseEntity].baseUrls.length > 1) ? 'failover ' : ''}retry[${retryCount}] using baseUrl = ${_serviceClient[baseEntity].baseUrl}`)
        const ret = await doRequest(baseEntity, method, path, body, opt, retryCount) // retry
        return ret // problem fixed
      } else {
        const newerr = new Error(err.message)
        newerr.message = newerr.message.replace('ECONNREFUSED', 'UnableConnectingService') // avoid returning ECONNREFUSED error
        newerr.message = newerr.message.replace('ENOTFOUND', 'UnableConnectingHost') // avoid returning ENOTFOUND error
        throw newerr
      }
    } else throw err 
  }
} // doRequest

//=====================================
//
//Altered version of doRequest for querying and creating Access Directories 
//
//=====================================
const doDirRequest = async (baseEntity, method, path, body, opt, retryCount) => {
    try {
        const cli = await getServiceClient(baseEntity, method, path, opt)
        const newPath = '/SAAS/jersey/manager/api/connectormanagement/directoryconfigs'
        const postHeaders = 'application/vnd.vmware.horizon.manager.connector.management.directory.other+json'
        cli.options.path = newPath
        if (method == 'POST') cli.options.headers['Content-Type'] = postHeaders
        const options = cli.options
        const result = await new Promise((resolve, reject) => {
            let dataString = ''
            if (body) {
                if (options.headers['Content-Type'].toLowerCase() === 'application/x-www-form-urlencoded') {
                    if (typeof data === 'string') dataString = body
                    else dataString = querystring.stringify(body) // JSON to query string syntax + URL encoded
                } else dataString = JSON.stringify(body)
                options.headers['Content-Length'] = Buffer.byteLength(dataString, 'utf8')
            }
            accessproxy.logger.debug(`options = ${JSON.stringify(options)} path = ${path}`)
            const reqType = (options.protocol.toLowerCase() === 'https:') ? https.request : http.request
            const req = reqType(options, (res) => {
                const { statusCode, statusMessage } = res // solving parallel problem (const + don't use res.statusCode)

                let responseString = ''
                res.setEncoding('utf-8')

                res.on('data', (chunk) => {
                    responseString += chunk
                })

                res.on('end', () => {
                    const response = {
                        statusCode: statusCode,
                        statusMessage: statusMessage,
                        body: req.body
                    }
                    try {
                        if (responseString) response.body = JSON.parse(responseString)
                    } catch (err) { response.body = responseString }
                    if (statusCode < 200 || statusCode > 299) reject(new Error(JSON.stringify(response)))
                    resolve(response)
                })
            }) // req

            req.on('socket', (socket) => {
                socket.setTimeout(60000) // connect and wait timeout => socket hang up
                socket.on('timeout', function () { req.abort() })
            })

            req.on('error', (error) => { // also catching req.abort
                req.end()
                reject(error)
            })

            if (dataString) req.write(dataString)
            req.end()
            
        }) // Promise

        
        this.body = result
        return result
    } catch (err) { 
        const newErr = err
        throw newErr
    }
    return result
} // doRequest
//
// Cleanup on exit
//
process.on('SIGTERM', () => { // kill
})
process.on('SIGINT', () => { // Ctrl+C
})
