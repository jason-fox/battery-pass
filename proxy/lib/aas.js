const debug = require('debug')('aas:access');
const got = require('got');
const StatusCodes = require('http-status-codes').StatusCodes;
const getReasonPhrase = require('http-status-codes').getReasonPhrase;
const _ = require('lodash');


const NGSI_LD_URN = 'urn:ngsi-ld:'; 
const JSON_LD_CONTEXT = process.env.CONTEXT_URL || 'https://fiware.github.io/tutorials.Step-by-Step/tutorials-context.jsonld';
const CONTEXT_BROKER = process.env.BROKER_URL || 'http://localhost:1026';
const AAS_SERVER = process.env.AAS_URL || 'http://localhost:51310'

const template = require('handlebars').compile(
    `{
    "type": "{{type}}",
    "title": "{{title}}",
    "detail": "{{message}}"
  }`
);

const error_content_type = 'application/json';

function treatBody(body){
	const payload = {}
	_.each(_.keys(body), (key) => {
		if(payload[key] !== null){
			payload[key] = { type: "Property", value:  body[key]  }
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

  options =  {
    method: req.method,
    headers,
    throwHttpErrors: false,
    retry: 0
  };

  if (req.query){
    options.searchParams = req.query
  }
  res.send(treatBody(req.body));
}

function transformAAS(aas, assetId) {
	const payload = treatBody(aas);	

	payload.type = 'I4AAS',
	payload.id =  `urn:ngsi-ld:I4AAS:${assetId.replace(/^https?\:\/\//i, "")}`;

	return payload;
}



function transformAsset(asset, assetId) {
	const payload = treatBody(asset);
	const id = encodeURI(assetId + ':' + asset.idShort.trim());

	payload.type = 'I4Asset',
	payload.id =  `urn:ngsi-ld:I4Asset:${id.replace(/^https?\:\/\//i, "")}`;


	debug(payload.id)

	return payload;
}

function transformSubmodel(submodel, assetId) {
	const payload = treatBody(submodel);
	const id = encodeURI(assetId + ':' + submodel.idShort.trim());

	payload.type = 'I4Submodel',
	payload.id =  `urn:ngsi-ld:I4Submodel:${id.replace(/^https?\:\/\//i, "")}`;

	return payload;
}

function transformSubmodelElement(element, submodelId, assetId) {
	const payload = treatBody(element);
	const id = encodeURI(assetId + ':' +  submodelId + ':' + element.idShort.trim());

	payload.type = 'I4SubmodelProperty',
	payload.id =  `urn:ngsi-ld:I4SubmodelProperty:${id.replace(/^https?\:\/\//i, "")}`;

	return payload;
}



function upsertNGSI(entities){
	return new Promise((resolve, reject) => {
		if (_.isEmpty(entities)){
			return resolve();
		}
		const options = {
	        url:  `${CONTEXT_BROKER}/ngsi-ld/v1/entityOperations/upsert/`,
	        method: 'POST',
	        json: entities,
	        headers: {
	            'Content-Type': 'application/json',
	            'Link': `<${JSON_LD_CONTEXT}>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"`
	        }
	    };

	    got(options)
		    .then((response) => {
		    	return resolve();
		    })
		    .catch((error) => {
		        return reject(error);
		     });

	});
}

function getAAS(id) {
  return new Promise((resolve, reject) => {

  	const options =  {
		method: 'GET',
		throwHttpErrors: false,
		retry: 0
	};
	let ngsiEntities = [];

  	got(`${AAS_SERVER}/aas/${id}/aasenv`, options)
    .then((response) => {
    	const body = JSON.parse(response.body);
    	body.assetAdministrationShells.forEach((shell)=>{
    		if (!_.isEmpty(shell.asset.keys)){
    			const id = encodeURI(shell.asset.keys[0].value);
  				ngsiEntities.push(transformAAS(shell, id));
		    	ngsiEntities.push(transformAsset(body.assets[0], id));

  				body.submodels.forEach((submodel)=>{
		    		if (!_.isEmpty(submodel.identification.id)){
		  				ngsiEntities.push(transformSubmodel(submodel, id));

		  				submodel.submodelElements.forEach((element)=>{
		  					if (!_.isEmpty(element.semanticId.keys)){
		  						ngsiEntities.push(transformSubmodelElement(element, submodel.idShort, id));
		  					}
		  				});
		  			}
  				});
  			}
  		});

    	debug(ngsiEntities.length)
  		
    	resolve(ngsiEntities);
    })
    .catch((error) => {
        return reject(error);
     });
  });
}


/**
 *
 * @param req - the incoming request
 * @param res - the response to return
 */
async function readData(req, res) {

	const options =  {
		method: 'GET',
		throwHttpErrors: false,
		retry: 0
	};

  got(`${AAS_SERVER}/server/listaas`, options)
    .then((response) => {
    	const body = JSON.parse(response.body);
			const readAAS = [];
    	body.aaslist.forEach((aas)=>{
    		const parts = aas.split(" : ");
    		let promise = getAAS(parts[1]);
  			readAAS.push(promise);
    	})
    	Promise.all(readAAS)
		  .then(aasAsNGSI => {
		  		const pushAAS = [];
		    	aasAsNGSI.forEach((ngsi)=>{
		    		let promise = upsertNGSI(ngsi);
		  			pushAAS.push(promise);
		    	})
		    	Promise.all(pushAAS)
		  		.then(results => {
		    		return res.send("OK");
		   		})
		   		.catch((error) => {
		  			debug(error)
        		return res.send(error);
     			});
		  })
		  .catch((error) => {
		  		debug(error)
        	return res.send(error);
     	});
  	});
	
}

exports.response = postEntity;
exports.readData = readData;
