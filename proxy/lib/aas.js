const debug = require('debug')('aas:access');
const got = require('got');
const _ = require('lodash');
const constants = require('./constants');
//const subscription = require('./subscription');

const base64 = require('base-64');
const cleanDeep = require('clean-deep');

const JSON_LD_CONTEXT = process.env.CONTEXT_URL || 'http://context/ngsi-context.jsonld';
const CONTEXT_BROKER = process.env.BROKER_URL || 'http://localhost:1026';
const AAS_SERVER = process.env.AAS_URL || 'http://localhost:5001';

const retryTime = constants.DEFAULT_RETRY_TIME;
const retries = constants.DEFAULT_RETRIES;
let isConnecting = false;
let numRetried = 0;

function treatObject(input) {
    _.forEach(input, function (value, key) {
        if (_.isNull(value)) {
            delete input.key;
        }
        if (_.isArray(value)) {
            input[key] = treatArray(value);
        }
    });
    return input;
}

function treatArray(input) {
    const array = [];
    _.each(input, (elem) => {
        array.push(cleanDeep(elem, { emptyArrays: false }));
    });
    return array;
}

function treatBody(body) {
    const payload = {};
    _.each(_.keys(body), (key) => {
        const value = body[key];

        if (_.isNull(value)) {
            // JSON literal null ?
        } else if (!_.isObject(value)) {
            // Primitives
            payload[key] = { type: 'Property', value };
        } else if (_.isArray(value)) {
            const arr = treatArray(value);
            payload[key] = { type: 'Property', value: arr };
        } else {
            const obj = treatObject(value);
            payload[key] = { type: 'Property', value: obj };
        }
    });
    return payload;
}

function asURN(assetId) {
    return assetId.includes(':') ? assetId : 'urn:' + assetId;
}

function transformAAS(aas, assetId) {
    const payload = treatBody(aas);

    payload.type = 'I4AAS';
    payload.id = asURN(assetId);
    debug('AAS: ', payload.id);
    return payload;
}

function transformAsset(asset, assetId) {
    if (!asset || !asset.idShort) {
        return null;
    }

    const payload = treatBody(asset);

    payload.type = 'I4Asset';
    payload.id = asURN(assetId);
    debug('Asset: ', payload.id);
    return payload;
}

function transformSubmodel(submodel, assetId) {
    const payload = treatBody(submodel);
    payload.type = 'I4Submodel';
    payload.id = asURN(assetId);
    debug('Submodel: ', payload.id);
    return payload;
}

async function upsertNGSI(entities) {
    if (_.isEmpty(entities)) {
        return 0;
    }

    const options = {
        url: `${CONTEXT_BROKER}/ngsi-ld/v1/entityOperations/upsert/`,
        method: 'POST',
        throwHttpErrors: false,
        json: entities,
        headers: {
            'Content-Type': 'application/json',
            Link: `<${JSON_LD_CONTEXT}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"`
        }
    };
    const response = await got(options);
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

    try {
        return JSON.parse(assetResponse.body);
    } catch (e) {
        console.log('Caught: ' + e.message);
        console.log(`${AAS_SERVER}/shells/${assetIdBase64}/aas/asset-information`);
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

    try {
        return JSON.parse(response.body);
    } catch (e) {
        console.log('Caught: ' + e.message);
        console.log(`${AAS_SERVER}/shells/${idBase64}/aas`);
        return null;
    }
}

async function assetToNGSIEntity(id) {
    const asset = await readAsset(id);
    const ngsiEntities = [];

    if (asset && asset.identification) {
        const ngsiEntity = transformAsset(asset, asset.identification.id);
        if (ngsiEntity) {
            ngsiEntities.push(ngsiEntity);
        }
    }
    return ngsiEntities;
}

async function shellToNGSIEntities(id) {
    const shell = await readAAS(id);

    if (!shell) {
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
        ngsiEntities.push(transformSubmodel(submodel, submodel.identification.id));
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
    try {
        const options = {
            method: 'GET',
            throwHttpErrors: false,
            retry: 0
        };

        const shellsResponse = await got(`${AAS_SERVER}/shells`, options);
        const shells = JSON.parse(shellsResponse.body);

        shells.forEach(function (shell) {
            requests.push(shellToNGSIEntities(shell.identification.id));
            requests.push(assetToNGSIEntity(shell.identification.id));
        });

        const ngsiEntities = await Promise.all(requests);
        ngsiEntities.forEach((ngsi) => {
            upsertsToCB.push(upsertNGSI(ngsi));
        });

        const results = await Promise.all(upsertsToCB);
        debug(`Upsert returns: ${results}`);
        return res ? res.send('OK') : true;
    } catch (e) {
        debug(`Something went wrong: ${e.message}`);
        return res ? res.send(e) : false;
    }
}

/* eslint-disable consistent-return */
async function connectToAASServer(callback) {
    debug('creating AAS connection');
    if (isConnecting) {
        return;
    }
    isConnecting = true;
    // Ensure clientId is unique when reconnect to avoid loop closing old connection which the same name
    const success = await readData();
    isConnecting = false;
    if (success === false) {
        debug('error AAS data not created');
        if (numRetried <= retries) {
            numRetried++;
            return setTimeout(connectToAASServer, retryTime * 1000, callback);
        }
        debug('failed');
        return callback ? callback() : false;
    }
    debug('AAS data created successfully');
    return callback ? callback() : true;
} // function connectToAASServer

setTimeout(connectToAASServer, retryTime * 1000, function () {
    //setTimeout(subscription.create, retryTime * 1000);
});

exports.readData = readData;
