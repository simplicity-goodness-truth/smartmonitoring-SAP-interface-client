
const request = require('request');
const oauth2 = require('simple-oauth2');
const config = require('./../src/config/internal_config.json');

// Abstract MAI Object

class MAIObject {

	constructor() {

		// XSUAA and Connectivity services are required for OData call from BTP only

		if (config.execution_environment == 'BTP') {

			const VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);

			this.xsuaa = {
				"client": {
					"id": VCAP_SERVICES.xsuaa[0].credentials.clientid,
					"secret": VCAP_SERVICES.xsuaa[0].credentials.clientsecret
				},
				"auth": {
					"tokenHost": VCAP_SERVICES.xsuaa[0].credentials.url,
					"tokenPath": "/oauth/token"
				},
				"options": {
					"useBasicAuthorizationHeader": false
				}

			} //this.xsuaa

			this.connectivity = {
				"client": {
					"id": VCAP_SERVICES.connectivity[0].credentials.clientid,
					"secret": VCAP_SERVICES.connectivity[0].credentials.clientsecret
				},
				"auth": {
					"tokenHost": VCAP_SERVICES.connectivity[0].credentials.url,
					"tokenPath": "/oauth/token"
				},
				"options": {
					"useBasicAuthorizationHeader": false
				}
			} // this.connectivity

			this.proxy_host = VCAP_SERVICES.connectivity[0].credentials.onpremise_proxy_host;
			this.proxy_port = VCAP_SERVICES.connectivity[0].credentials.onpremise_proxy_port;

		}

	} //constructor


	async oDataRequest(options, bufferResponse = false) {

		if (config.execution_environment == 'BTP') {

			let response = await this.oDataRequestFromBTP(options, bufferResponse = false);
			return response;

		} else {

			let response = await this.oDataRequestFromXSA(options, bufferResponse = false);
			return response;

		} // if (config.execution_environment == 'BTP')
	} // async oDataRequest

	async oDataRequestFromXSA(options, bufferResponse = false) {

	let response = {};
		let requestResult, _response;

		options = options || {};

		// follow location
		options.followAllRedirects = true;

		// default method
		options.method = options.method || "GET";

		// set timeout

		options.timeout = config.cloud_connector.connection_timeout;

		try {

			options.headers = options.headers || {};
			options.headers["Authorization"] = "Basic " + Buffer.from(`${this.config.backend_credentials.service_user}:${this.config.backend_credentials.service_pass}`).toString("base64");
			options.headers["Accept"] = options.headers["Accept"] || "application/json";
			options.headers["Accept-Language"] = options.headers["Accept-Language"] || 'en';
			options.headers["Content-Type"] = options.headers["Content-Type"] || "application/json";

			let serviceQuery = '';
			switch (options.method) {
				case "GET":
					serviceQuery = options.serviceQuery || '';
					options.url += serviceQuery;
					if (bufferResponse) {
						options.encoding = null;
					}

					requestResult = await this.requestPromise(options);
					response = (bufferResponse) ? requestResult.buffer : requestResult.response;

					break;

				case "POST":

					// getting csrf-token
					options.method = "GET";
					options.headers["x-csrf-token"] = "Fetch";
					if (options.json) {
						var requestJSON = options.json;
						delete options.json;
					}
					if (options.formData) {
						var requestFormData = options.formData;
						delete options.formData;
					}
					if (options.body) {
						var requestBody = options.body;
						delete options.body;
					}

					// Do get for csrf
					requestResult = await this.requestPromise(options);
					_response = requestResult.response;


					// init post headers
					options.headers["x-csrf-token"] = _response.headers['x-csrf-token'];
					options.headers["Cookie"] = _response.headers["set-cookie"];
					options.method = "POST";
					if (requestJSON) {
						options.json = requestJSON;
					}
					if (requestFormData) {
						options.formData = requestFormData;
					}
					if (requestBody) {
						options.body = requestBody;
					}
					serviceQuery = options.serviceQuery || '';
					options.url += serviceQuery;

					if (bufferResponse) {
						options.encoding = null;
					}

					// Do post
					requestResult = await this.requestPromise(options);
					response = (bufferResponse) ? requestResult.buffer : requestResult.response;
					break;

			} // switch (options.method)
		} // try
		catch (e) {
			console.log(`[ODATA SUPPLY]: ${e.name}\n${e.message}\n${e.stack}\n\n`);
			throw new Error("oData service error: " + e.message);
		}

		return response;

	} // async oDataRequestFromXSA

	async oDataRequestFromBTP(options, bufferResponse = false) {

		let response = {};
		let requestResult, _response;

		options = options || {};

		// proxy setup

		options.proxy = 'http://' + this.proxy_host + ':' + this.proxy_port;

		// follow location
		options.followAllRedirects = true;

		// default method
		options.method = options.method || "GET";

		// set timeout

		options.timeout = config.cloud_connector.connection_timeout;

		try {

			const connectivity = await oauth2
				.create(this.connectivity)
				.clientCredentials
				.getToken();

			const xsuaa = await oauth2
				.create(this.xsuaa)
				.clientCredentials
				.getToken();

			options.headers = options.headers || {};
			options.headers["Authorization"] = "Basic " + Buffer.from(`${this.config.backend_credentials.service_user}:${this.config.backend_credentials.service_pass}`).toString("base64");
			options.headers["SAP-Connectivity-Authentication"] = `Bearer ${xsuaa.access_token}`;
			options.headers["Proxy-Authorization"] = `Bearer ${connectivity.access_token}`;
			options.headers["SAP-Connectivity-SCC-Location_ID"] = this.config.cloud_connector.location_id;
			options.headers["Accept"] = options.headers["Accept"] || "application/json";
			options.headers["Accept-Language"] = options.headers["Accept-Language"] || 'en';
			options.headers["Content-Type"] = options.headers["Content-Type"] || "application/json";

			let serviceQuery = '';
			switch (options.method) {
				case "GET":
					serviceQuery = options.serviceQuery || '';
					options.url += serviceQuery;
					if (bufferResponse) {
						options.encoding = null;
					}

					requestResult = await this.requestPromise(options);
					response = (bufferResponse) ? requestResult.buffer : requestResult.response;

					break;

				case "POST":

					// getting csrf-token
					options.method = "GET";
					options.headers["x-csrf-token"] = "Fetch";
					if (options.json) {
						var requestJSON = options.json;
						delete options.json;
					}
					if (options.formData) {
						var requestFormData = options.formData;
						delete options.formData;
					}
					if (options.body) {
						var requestBody = options.body;
						delete options.body;
					}

					// Do get for csrf
					requestResult = await this.requestPromise(options);
					_response = requestResult.response;


					// init post headers
					options.headers["x-csrf-token"] = _response.headers['x-csrf-token'];
					options.headers["Cookie"] = _response.headers["set-cookie"];
					options.method = "POST";
					if (requestJSON) {
						options.json = requestJSON;
					}
					if (requestFormData) {
						options.formData = requestFormData;
					}
					if (requestBody) {
						options.body = requestBody;
					}
					serviceQuery = options.serviceQuery || '';
					options.url += serviceQuery;

					if (bufferResponse) {
						options.encoding = null;
					}

					// Do post
					requestResult = await this.requestPromise(options);
					response = (bufferResponse) ? requestResult.buffer : requestResult.response;
					break;

			} // switch (options.method)
		} // try
		catch (e) {
			console.log(`[ODATA SUPPLY]: ${e.name}\n${e.message}\n${e.stack}\n\n`);
			throw new Error("oData service error: " + e.message);
		}

		return response;

	} // async oDataRequest (options, bufferResponse = false)

	requestPromise(options) {
		let rp = new Promise((resolve, reject) => {
			try {
				request(options, (error, response, buffer) => {
					if (!error && /^2/.test('' + response.statusCode)) {
						resolve({
							response,
							buffer
						}); // resolve
					} // if
					else {
						reject(new Error("Request problem: " + ((response === undefined) ? `network error: ${error}` : (response.statusCode + "\n" + response.body))));
					}
				}); // request
			} // try
			catch (e) {
				reject(e);
			}
		}); // let rp = new Promise((resolve, reject)
		return rp;
	} // requestPromise (options)

} // class MAIObject

module.exports = MAIObject;
