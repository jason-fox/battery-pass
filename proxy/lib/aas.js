const debug = require('debug')('aas:access');
const got = require('got');
const StatusCodes = require('http-status-codes').StatusCodes;
const getReasonPhrase = require('http-status-codes').getReasonPhrase;
const _ = require('lodash');

const base64 = require('base-64');

const NGSI_LD_URN = 'urn:ngsi-ld:';
const JSON_LD_CONTEXT =
    process.env.CONTEXT_URL || 'http://localhost:3004/ngsi-context.jsonld';
const CONTEXT_BROKER = process.env.BROKER_URL || 'http://localhost:1026';
const AAS_SERVER = process.env.AAS_URL || 'http://localhost:5001';

const template = require('handlebars').compile(
    `{
    "type": "{{type}}",
    "title": "{{title}}",
    "detail": "{{message}}"
  }`
);

const error_content_type = 'application/json';

function treatBody(body) {
    const payload = {};
    _.each(_.keys(body), (key) => {
        if (body[key] !== null) {
            payload[key] = { type: 'Property', value: body[key] };
        }
    });
    return payload;
}

/**
 * Return an "Internal Error" response. These should not occur
 * during standard operation
 *
 * @param res - the response to return
 * @param e - the error that occurred
 * @param component - the component that caused the error
 */
function internalError(res, e, component) {
    const message = e ? e.message : undefined;
    debug(`Error in ${component} communication `, message ? message : e);
    res.setHeader('Content-Type', error_content_type);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).send(
        template({
            type: 'urn:dx:as:InternalServerError',
            title: getReasonPhrase(StatusCodes.INTERNAL_SERVER_ERROR),
            message
        })
    );
}

/**
 *
 * @param req - the incoming request
 * @param res - the response to return
 */
async function postEntity(req, res) {
    const headers = req.headers;
    const contentType = req.get('Accept');
    headers['accept'] = 'application/json';

    options = {
        method: req.method,
        headers,
        throwHttpErrors: false,
        retry: 0
    };

    if (req.query) {
        options.searchParams = req.query;
    }
    res.send(treatBody(req.body));
}

function transformAAS(aas, assetId) {
    const payload = treatBody(aas);

    (payload.type = 'I4AAS'), (payload.id = `urn:ngsi-ld:I4AAS:${assetId.replace(/^https?\:\/\//i, '')}`);

    debug(payload.id);
    return payload;
}

function transformAsset(asset, assetId) {
    if (!asset || !asset.idShort){
        return null;
    }

    const payload = treatBody(asset);
    const id = encodeURI(assetId + ':' + asset.idShort.trim());

    (payload.type = 'I4Asset'), (payload.id = `urn:ngsi-ld:I4Asset:${id.replace(/^https?\:\/\//i, '')}`);

    debug(payload.id);
    return payload;
}

function transformSubmodel(submodel, assetId) {
    const payload = treatBody(submodel);
    const id = encodeURI(assetId + ':' + submodel.idShort.trim());

    (payload.type = 'I4Submodel'), (payload.id = `urn:ngsi-ld:I4Submodel:${id.replace(/^https?\:\/\//i, '')}`);

    debug(payload.id);
    return payload;
}

function transformSubmodelElement(element, submodelId, assetId) {
    const payload = treatBody(element);
    const id = encodeURI(assetId + ':' + submodelId + ':' + element.idShort.trim());

    (payload.type = 'I4SubmodelProperty'),
        (payload.id = `urn:ngsi-ld:I4SubmodelProperty:${id.replace(/^https?\:\/\//i, '')}`);

    return payload;
}

async function upsertNGSI(entities) {
    if (_.isEmpty(entities)) {
        return 0;
    }

    const options = {
        url: `${CONTEXT_BROKER}/ngsi-ld/v1/entityOperations/upsert/`,
        method: 'POST',
        json: entities,
        headers: {
            'Content-Type': 'application/json',
            Link: `<${JSON_LD_CONTEXT}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"`
        }
    };
    response = await got(options);
    return response.statusCode;
}

async function readSubmodel(id, submodelId) {
    const options = {
        method: 'GET',
        throwHttpErrors: false,
        retry: 0
    };
    const idBase64 = base64.encode(id);
    const submodelIdBase64 = base64.encode(submodelId);
    const response = await got(`${AAS_SERVER}/shells/${idBase64}/aas/submodels/${submodelIdBase64}/submodel`, options);
    return JSON.parse(response.body);
}

async function readAsset(id) {
    const options = {
        method: 'GET',
        throwHttpErrors: false,
        retry: 0
    };
    const assetIdBase64 = base64.encode(id);
    const assetResponse = await got(`${AAS_SERVER}/shells/${assetIdBase64}/aas/asset-information`, options);

try{ 
   return JSON.parse(assetResponse.body);
} catch(e) { 
  console.log("Caught: " + e.message)
    console.log(`${AAS_SERVER}/shells/${assetIdBase64}/aas/asset-information`)
  return null;
}

   
}

async function readAAS(id) {
    const idBase64 = base64.encode(id);
    const options = {
        method: 'GET',
        throwHttpErrors: false,
        retry: 0
    };
    const response = await got(`${AAS_SERVER}/shells/${idBase64}/aas`, options);


    try{ 
   return JSON.parse(response.body);
} catch(e) { 
  console.log("Caught: " + e.message)
    console.log(`${AAS_SERVER}/shells/${idBase64}/aas`)
  return null;
}
}

async function assetToNGSIEntity(id) {
    const asset = await readAsset(id);

    const ngsiEntities = [];
    ngsiEntity = transformAsset(asset, id);
    if (ngsiEntity){
        ngsiEntities.push(transformAsset(asset, id));
    }
    return ngsiEntities;
}

async function shellToNGSIEntities(id) {
    const shell = await readAAS(id);

    if (!shell){
        return [];
    }

    const submodelRequests = [];
    shell.submodels.forEach((submodel) => {
        submodelRequests.push(readSubmodel(id, submodel.keys[0].value));
    });
    const submodels = await Promise.all(submodelRequests);

    const ngsiEntities = [];
    ngsiEntities.push(transformAAS(shell, id));
    submodels.forEach((submodel) => {
        ngsiEntities.push(transformSubmodel(submodel, id));
    });
    return ngsiEntities;
}

/**
 *
 * @param req - the incoming request
 * @param res - the response to return
 */
async function readData(req, res) {
    const requests = [];
    const upsertsToCB = [];
    const options = {
        method: 'GET',
        throwHttpErrors: false,
        retry: 0
    };

    const shellsResponse = await got(`${AAS_SERVER}/shells`, options);
    const shells = JSON.parse(shellsResponse.body);

    shells.forEach(async function (shell) {
        requests.push(shellToNGSIEntities(shell.identification.id));
        requests.push(assetToNGSIEntity(shell.identification.id));
    });

    const ngsiEntities = await Promise.all(requests);
    ngsiEntities.forEach((ngsi) => {
        upsertsToCB.push(upsertNGSI(ngsi));
    });

    Promise.all(upsertsToCB)
        .then((results) => {
            console.log(results);
            return res.send('OK');
        })
        .catch((error) => {
            debug(error);
            return res.send(error);
        });
}

exports.response = postEntity;
exports.readData = readData;
