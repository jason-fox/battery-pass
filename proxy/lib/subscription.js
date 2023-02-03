const _ = require('lodash');
const debug = require('debug')('aas:subscription');
const got = require('got');
const base64 = require('base-64');
const constants = require('./constants');

const AAS_SERVER = process.env.AAS_URL || 'http://localhost:5001';
const PROXY_SERVER = process.env.PROXY_URL || 'http://proxy1:3000';
const JSON_LD_CONTEXT = process.env.CONTEXT_URL || 'http://context/ngsi-context.jsonld';
const CONTEXT_BROKER = process.env.BROKER_URL || 'http://localhost:1026';

const retryTime = constants.DEFAULT_RETRY_TIME;
const retries = constants.DEFAULT_RETRIES;
let isConnecting = false;
let numRetried = 0;

const NGSI_SUBSCRIPTION = {
    description: 'Notify me of Asset Updates',
    type: 'Subscription',
    entities: [
        {
            type: 'I4AAS'
        },
        {
            type: 'I4Asset'
        },
        {
            type: 'I4Submodel'
        }
    ],
    notification: {
        format: 'keyValues',
        endpoint: {
            uri: `${PROXY_SERVER}/aas/subscription/`,
            accept: 'application/json'
        }
    }
};

async function createSubscription(req, res) {
    const options = {
        method: 'POST',
        url: `${CONTEXT_BROKER}/ngsi-ld/v1/subscriptions/`,
        headers: {
            'Content-Type': 'application/json',
            Link: `<${JSON_LD_CONTEXT}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"`
        },
        json: NGSI_SUBSCRIPTION
    };

    try {
        const response = await got(options);
        return res ? res.send('OK') : response.statusCode;
    } catch (e) {
        debug(`Something went wrong: ${e.message}`);
        return res ? res.send(e) : 0;
    }
}

async function overWriteAAS(entity, id, type) {
    let url;

    console.log(id);
    console.log(type);

    const idBase64 = base64.encode(id);
    switch (type) {
        case 'I4Submodel':
            url = `${AAS_SERVER}/submodels/${idBase64}/submodel`;
            break;
        case 'I4Asset':
            url = `${AAS_SERVER}/shells/${idBase64}/aas/asset-information`;
            break;
        case 'I4AAS':
            url = `${AAS_SERVER}/shells/${idBase64}/aas`;
            break;
    }

    delete entity.id;
    delete entity.type;

    const options = {
        url,
        method: 'PUT',
        json: entity,
        throwHttpErrors: false
    };
    const response = await got(options);
    debug(JSON.stringify(options));

    return response.statusCode;
}

/**
 *
 * @param req - the incoming request
 * @param res - the response to return
 */
async function notify(req, res) {
    const requests = [];
    _.forEach(req.body.data, (item) => {
        requests.push(overWriteAAS(item, item.id, item.type));
    });
    const results = await Promise.all(requests);
    debug(results);
    return _.every(results, (code) => code === 200) ? res.status(204).send() : res.status(502).send();
}

/* eslint-disable no-unused-vars, consistent-return */
async function ngsiConnection(callback) {
    debug('creating NGSI subscription');
    if (isConnecting) {
        return;
    }
    isConnecting = true;
    // Ensure clientId is unique when reconnect to avoid loop closing old connection which the same name
    const response = await createSubscription();
    isConnecting = false;
    if (response !== 201) {
        debug('error NGSI subscription not created');
        if (numRetried <= retries) {
            numRetried++;
            return setTimeout(ngsiConnection, retryTime * 1000, callback);
        }
        debug('failed');
        return;
    }
    debug('NGSI subscription created successfully');
    if (callback) {
        callback();
    }
} // function ngsiConnection

exports.notify = notify;
exports.create = createSubscription;
