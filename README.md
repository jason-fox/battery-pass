Start up using

```console
./services test3
```

Wait for AAS, get the list of available shells:

```console
curl -L -X GET 'http://localhost:51310/server/listaas'
```

Individual AAS - use short name:

```console
curl -L -X GET 'http://localhost:51310/aas/Festo_3S7PM0CP4BD/aasenv'
```

Trigger Import to context broker:

```console
curl -L -X GET 'http://localhost:3000/aas/'
```

Read `types`

```console
curl -L -X GET 'http://localhost:1026/ngsi-ld/v1/types' \
-H 'Link: <http://context/ngsi-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
```

GET I4Submodels

```console
curl -L -X GET 'http://localhost:1026/ngsi-ld/v1/entities/?type=I4Submodel&options=keyValues' \
-H 'Link: <http://context/ngsi-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
```

GET an individual IAAS

```console
curl -L -X GET 'http://localhost:1026/ngsi-ld/v1/entities/urn:ngsi-ld:I4AAS:PK.FESTO.COM/3S7PM0CP4BD?options=keyValues' \
-H 'Link: <http://context/ngsi-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
```

GET using `q`

```console
curl -L -X GET 'http://localhost:1026/ngsi-ld/v1/entities/?q=idShort=="Festo_3S7PM0CP4BD"' \
-H 'Link: <http://context/ngsi-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
```

```console
curl -L -g -X GET 'http://localhost:1026/ngsi-ld/v1/entities/?q=modelType[name]=="AssetAdministrationShell"' \
-H 'Link: <http://context/ngsi-context.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"'
```



