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

function asURN(assetId) {
    return assetId.includes(':') ? assetId : 'urn:' + assetId;
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

    if (response.statusCode === 207) {
        console.log(response.body);
    }
    return response.statusCode;
}

async function readSubmodel(id, submodelId) {
    let body = { submodelElements: [] };
    const options = {
        method: 'GET',
        throwHttpErrors: false,
        retry: 0
    };
    const idBase64 = base64.encode(id);
    const submodelIdBase64 = base64.encode(submodelId);
    const response = await got(`${AAS_SERVER}/shells/${idBase64}/aas/submodels/${submodelIdBase64}/submodel`, options);

    try {
        body = JSON.parse(response.body);
    } catch (e) {
        console.log(`${AAS_SERVER}/shells/${idBase64}/aas/submodels/${submodelIdBase64}/submodel`);
        console.log(id);
        console.log(submodelId);
    }

    return body;
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

function castToType(valueType, value) {
    let castValue = value;
    if (valueType === undefined || valueType.dataObjectType === undefined) {
        if (_.isArray(value)) {
            castValue = {};
            value.forEach((attr) => {
                castValue[attr.idShort] = attr.value;
            });
        }
    } else {
        switch (valueType.dataObjectType.name) {
            case 'integer':
                castValue = parseInt(value);
                break;
            case 'float':
                castValue = parseFloat(value);
                break;
            case 'long':
                castValue = parseFloat(value);
                break;
        }
    }

    return castValue;
}

/**
 *
 * @param req - the incoming request
 * @param res - the response to return
 */
async function readData(req, res) {
    const ngsiEntities = [];
    const upsertsToCB = [];
    try {
        const options = {
            method: 'GET',
            throwHttpErrors: false,
            retry: 0
        };

        const shellsResponse = await got(`${AAS_SERVER}/shells`, options);
        const shells = JSON.parse(shellsResponse.body);

        shells.forEach(async function (shell) {
            const entity = {};
            const id = shell.identification.id;
            const adminAsset = await readAAS(id);
            const asset = await readAsset(id);
            const submodelRequests = [];
            shell.submodels.forEach((submodel) => {
                submodelRequests.push(readSubmodel(id, submodel.keys[0].value));
            });
            const submodels = await Promise.all(submodelRequests);

            entity.type = 'Asset';
            entity.id = asURN(shell.identification.id);
            entity.idShort = {
                type: 'Property',
                value: shell.idShort
            };

            if (!_.isNull(shell.category)) {
                entity.idShort.category = {
                    type: 'Property',
                    value: shell.category
                };
            }

            submodels.forEach((submodel) => {
                const metadata = {
                    type: 'Property',
                    value: submodel.idShort
                };

                submodel.submodelElements.forEach((elem) => {
                    if (_.isNull(elem.value)) {
                        return;
                    }

                    attrName = encodeURIComponent(elem.idShort);

                    entity[attrName] = {
                        type: 'Property',

                        semanticId: {
                            type: 'Property',
                            value: elem.semanticId
                        },
                        kind: {
                            type: 'Property',
                            value: elem.kind
                        },
                        submodel: metadata
                    };

                    if (!_.isNull(elem.category)) {
                        entity[attrName].category = {
                            type: 'Property',
                            value: elem.category
                        };
                    }

                    if (typeof elem.valueType !== 'undefined' && !_.isEmpty(elem.valueType)) {
                        entity[attrName].valueType = {
                            type: 'Property',
                            value: elem.valueType
                        };
                    }

                    if (elem.modelType.name === 'File') {
                        entity[attrName].value = elem.value;
                        entity[attrName].mimeType = {
                            type: 'Property',
                            value: elem.mimeType
                        };
                    } else if (elem.modelType.name === 'MultiLanguageProperty') {
                        const obj = {};
                        elem.value.langString.forEach((attr) => {
                            obj[attr.language] = attr.text;
                        });

                        entity[attrName].type = 'LanguageProperty';
                        entity[attrName].languageMap = obj;
                        delete entity[attrName].value;
                        delete entity[attrName].valueType;
                    } else if (elem.modelType.name === 'Property') {
                        entity[attrName].value = castToType(elem.valueType, elem.value) || '';
                    } else if (elem.modelType.name === 'SubmodelElementCollection') {
                        const obj = {};
                        elem.value.forEach((attr) => {
                            obj[attr.idShort] = castToType(attr.valueType, attr.value);
                        });

                        entity[attrName].value = castToType({ dataObjectType: { name: 'Object' } }, obj);
                        entity[attrName].valueType = {
                            type: 'Property',
                            value: 'SubmodelElementCollection'
                        };
                    }
                });
            });
            await upsertNGSI([entity]);
        });

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
