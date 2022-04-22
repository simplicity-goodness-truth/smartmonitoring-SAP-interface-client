
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const CronJob = require('cron').CronJob;
const request = require('request');
const nodemailer = require('nodemailer');

const MAIObject = require('./src/MAIObject');
const MAIMetricDirectory = require('./src/MAIMetricDirectory');
const ExtractorItem = require('./src/ExtractorItem');
const config = require('./src/config/internal_config.json');
const Storage = require('./src/Storage');

const {
	performance
} = require('perf_hooks');

const cfenv = require("cfenv");

const MAIEvent = require('./src/MetricMeasurement');

var collector_state = 'stopped';
var watchdog_state = 'stopped';
var backend_not_reached = false;
var pingTime = 'N/A';

var collector_start_time = 0;
var last_collector_execution = new Date();

var scope_entered = false;
var server_message = 'Ready';
var scope_array = [];
var collector_runs = [];

const port = process.env.PORT || 5000;

var pushedElements = 0;

// ------ XSUAA AppRouter Security Start ------

const passport = require('passport');
const xsenv = require('@sap/xsenv');
const JWTStrategy = require('@sap/xssec').JWTStrategy;
var xsuaaServiceInstanceName;

const VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);

if (config.execution_environment == 'BTP') {

	xsuaaServiceInstanceName = VCAP_SERVICES.xsuaa[0].instance_name;

} else {
	xsuaaServiceInstanceName = VCAP_SERVICES.xsuaa[0].name;
}

const services = xsenv.getServices({
	uaa: xsuaaServiceInstanceName
});


passport.use(new JWTStrategy(services.uaa));

app.use(passport.initialize());
app.use(passport.authenticate('JWT', {
	session: false
}));

// ------ XSUAA AppRouter Security End ------

// ------ Enablement of email exchange Start ------

var transporter = nodemailer.createTransport({
	host: config.email.host,
	auth: {
		user: config.email.user,
		pass: config.email.password
	},
	secureConnection: false,
	port: config.email.port,
	tls: {
		ciphers: 'SSLv3'
	}
});

// ------ Enablement of email exchange End ------

// Declaration of Collector to be run every 5 minutes

var collector;

// Server start

app.listen(port, function () {

	const autocollect = config.admin.autocollect;
	const autowatchdog = config.admin.autowatchdog;

	console.log('::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::');
	console.log('::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::');

	console.log('[SERVICE START] SAP Monitoring Extension interface is live on port ' + port);
	console.log('[SERVICE START] Collector autostart option: ' + autocollect);
	console.log('[SERVICE START] Watchdog autostart option: ' + autowatchdog);
	console.log('[SERVICE START] Housekeeper: started by default');
	console.log('[SERVICE START] Execution environment: ' + config.execution_environment);


	if (autocollect == 'true') {

		console.log('[SERVICE START] Collector autostart is on, trying to start the collector');
		SelectCollector();
		StartCollector();
		collector_state = 'scheduled every 5 minutes';
		collector_start_time = seconds_since_epoch();

	}

	StartHousekeeper();

	// Updating availability file

	// UpdateAvailabilityFile('Application start');

	if (config.email.receiver !== 'false') {

		const VCAP_APPLICATION = JSON.parse(process.env.VCAP_APPLICATION);

		var mailOptions = {
			from: config.email.sender,
			to: config.email.receiver,
			subject: config.execution_environment + ' Machine Learning extension: interface restart',
			text: 'SAP Monitoring Machine Learning Extension interface server successfully restarted' + '\n' + '\n' +
				'Timestamp: ' + serverTime('ISO') + '\n' +
				'Port: ' + port + '\n' +
				'Collector autostart: ' + autocollect + '\n' +
				'Application name: ' + VCAP_APPLICATION.application_name + '\n' +
				'URL: ' + VCAP_APPLICATION.application_uris[0] + '\n' +
				'Space name: ' + VCAP_APPLICATION.space_name
		};

		transporter.sendMail(mailOptions, function (error, info) {
			if (error) {
				console.log(error);
			} else {
				console.log('[SERVICE START] Email sent successfully: ' + info.response);
			}
		}); //  transporter.sendMail

	} // if (email !== '')

});

app.get('/', function (req, res) {

	res.render('index',
		renderDataPrepare()
	);

});


app.get('/monitor', function (req, res) {

	if (collector.running == true) {
		var monitoring_collection = [];
		var snapshots_count = 0;

		getSnapshotFromDB(function (result) {

			if (result) {

				if (result.length > 0) {

					var monitoring_collection = [];
					var snapShotString;

					for (let i = 0; i < result.length; i++) {
						snapShotString =
							result[i].ODATA_CALL_TIMESTAMP + '|' +
							result[i].CONTEXT_ID + ' | ' +
							result[i].EVENT_TYPE_ID + ' | ' +
							result[i].DATA_COLLECTION_TIMESTAMP + ' | ' +
							result[i].DATA_COLLECTION_TIMESTAMP_UNIX + ' | ' +
							result[i].CONTEXT_NAME + ' | ' +
							result[i].MNAME + ' | ' +
							result[i].METRIC_VALUE + ' | ' +
							result[i].METRIC_THRESHOLD_GREEN_TO_YELLOW + ' | ' +
							result[i].METRIC_THRESHOLD_YELLOW_TO_RED + ' | ' +
							result[i].METRIC_SUM_VALUE + ' | ' +
							result[i].METRIC_COUNT + '|' +
							result[i].M_SHORT_TEXT.replace(/,/g, '');

						monitoring_collection.push(snapShotString);
					}

					getSnapshotsCount(function (response) {

						if (response) {

							if (response.length > 0) {


								snapshots_count = response[0].COUNT;
								res.render('monitor', {
									'monitoring_values': monitoring_collection,
									'snapshots_count': snapshots_count
								}); // res.render


							} // if (result.length > 0
							else {
								console.log('[PUSHES MONITOR] ERROR: cannot get snapshots count');
								server_message = '[PUSHES MONITOR] ERROR: cannot get snapshots count'
								snapshots_count = 0
							}

						} else // if (result)

						{


							console.log('[PUSHES MONITOR] ERROR: cannot get snapshots count');
							server_message = '[PUSHES MONITOR] ERROR: cannot get snapshots count'
							snapshots_count = 0;
						}
					}); // getSnapshotsCount(function (result)



				} // if (result.length > 0)
				else {

					res.send('ERROR: cannot get a monitoring snapshot from internal database');

					console.log('[PUSHES MONITOR] ERROR: cannot get a monitoring snapshot from internal database');
					monitoring_collection = '[PUSHES MONITOR] ERROR: cannot get a monitoring snapshot from internal database';
				}
			} else {

				res.send('ERROR: cannot get a monitoring snapshot from internal database');

				console.log('[PUSHES MONITOR] ERROR: cannot get a monitoring snapshot from internal database');
				monitoring_collection = '[PUSHES MONITOR] ERROR: cannot get a monitoring snapshot from internal database';

			} //  if (result)

		});

	} else {
		res.send('Collector is not started, and monitoring data cannot be fetched. Please go back and start the collector.');
	} // if (collector.running == true)


}); // app.get('/monitor')



// Configuration for console output format: timestamps customization omitted

var log = console.log;
require('console-stamp')(console);
//		require('console-stamp')(console, {
//			pattern: 'dd/mm/yyyy HH:MM:ss'
//		});



// Declaration of watchdog to be run every 10 minutes

var watchdog = new CronJob({
	cronTime: '*/10 * * * *',
	onTick: function () {
		WatchdogBody();
	},
	start: false,
});

// Declaration of housekeeper to be run every 6 hours

var housekeeper = new CronJob({
	cronTime: '* */6 * * *',
	onTick: function () {
		HousekeeperBody();
	},
	start: false,
});

app.use(bodyParser.json()); // support json encoded bodies

app.use(bodyParser.urlencoded({
	extended: true
})); // support encoded bodies


app.set('view engine', 'ejs');

async function getMAIScopeFromDB(callback) {

	let storage = new Storage(

		async function (connection_status) {

			if (connection_status == false)

			{

				console.log('[SCOPE SUPPLY] There was an error while connecting to HANA database');

				return callback(null);

			} else {

				await storage.GetAllExtractorItemsFromDB(async function (response) {

					var result = response;

					console.log('[SCOPE SUPPLY] Received ', result.length, ' records from mai_scope databases');

					await storage.closeSession();

					if (result) {
						return callback(result);
					} else {
						return callback(null);
					}
				});

			}


		});
}; // async function getMAIScopeFromDB(callback)

async function getDatabaseSize(callback) {

	let storage = new Storage(

		async function (connection_status) {


			if (connection_status == false)

			{
				console.log('[DB SIZE SUPPLY] There was an error while connecting to HANA database');
				return callback(null);

			} else {

				let result = storage.GetDatabaseSize(
					async function (response) {

						await storage.closeSession;
						if (response) {


							return callback(response);
						} else {
							return callback(null);
						}

					});
			}


		});

}; // async function getDatabaseSize(callback)

async function getSnapshotsCount(callback) {

	let storage = new Storage(
		async function (connection_status) {

			if (connection_status == false)

			{

				console.log('[SNAPSHOTS COUNT SUPPLY] There was an error while connecting to HANA database');
				return callback(null);
			} else {


				await storage.GetSnapshotsCount(function (response) {

					var result = response;
					response
					if (result) {
						return callback(result);
					} else {
						return callback(null);
					}
				});

			} // else

		});

};

async function recordPushLogRecord(pushedElements, code, callTime, backendExecTime) {

	var databaseSize;

	getDatabaseSize(async function (result) {

		var statusLine;

		if (result) {

			databaseSize = result;

			switch (code) {

				default:

					var statusLine = serverTime('ISOstring') + '|' + databaseSize + '|' + pushedElements + '|' + callTime.toString().split('.')[0] + '|' + +backendExecTime.toString().split('.')[0] + '|' + pingTime.toString().split('.')[0];
					collector_runs.unshift(statusLine);
					break;

				case 998:
					var statusLine = serverTime('ISOstring') + '|' + databaseSize + '|' + 'auto restart';
					collector_runs.unshift(statusLine);
					break;

				case 999:
					var statusLine = serverTime('ISOstring') + '|' + databaseSize + '|' + 'backend not reached';
					collector_runs.unshift(statusLine);
					break;
			}

		} else {
			console.log('[PUSHES LOGGER] ERROR: not possible to get a size of a database');
		}


	});

}; // recordPushLogRecord


app.post('/go', function (req, res) {
	// Input parameters logging
	console.log('[SETUP CONSOLE] POST executed');

	// Performing actions based on selected action

	var storage;

	switch (req.body.selected_action) {

		case 'housekeeper_start':
			StartHousekeeper();
			break;
		case 'housekeeper_stop':
			StopHousekeeper();
			break;

		case 'watchdog_start':
			StartWatchdog();
			watchdog_state = 'scheduled every 10 minutes';
			break;
		case 'watchdog_stop':
			StopWatchdog();
			watchdog_state = 'stopped';
			break;

		case 'call_backend':
			callBackendURL();
			break;

		case 'zcollector_run':
			CollectorBody();

			break;
		case 'send_test_email':
			SendTestEmail();
			break;
		case 'collector_start':

			// Select collector mode

			SelectCollector();

			// Execution starts only in a case there are mandatory parameters filled

			//			var emptyMandatoryFieldsFound = checkMandatoryFields(req.body);
			//
			//			if (emptyMandatoryFieldsFound == 1) {
			//				console.log('[SETUP CONSOLE] ERROR: cannot proceed further, check missing parameters');
			//				server_message = '[SETUP CONSOLE] ERROR: cannot proceed further, check missing parameters';
			//				break;
			//			};

			if (scope_entered == false) {
				console.log('[SETUP CONSOLE] Cannot proceed further: MAI scope is not defined');
				server_message = '[SETUP CONSOLE] Cannot proceed further: MAI scope is not defined';
				break;
			};
			StartCollector();
			collector_state = 'scheduled every 5 minutes';
			collector_start_time = seconds_since_epoch();

			break;

		case 'collector_stop':
			if (watchdog.running == true) {
				watchdog_state = 'stopped';
				StopWatchdog();
			}


			StopCollector();
			collector_state = 'stopped';
			server_message = 'Collector stopped';
			collector_start_time = 0;
			break;

		case 'update_config':
			UpdateConfigurationFile(
				req.body.backend_service,
				req.body.service_user,
				req.body.service_password,
				req.body.location_id,
				req.body.backend_url,
				req.body.anomality_url,
				req.body.connection_timeout,
				req.body.autocollect,
				req.body.autowatchdog,
				req.body.email_host,
				req.body.email_port,
				req.body.email_user,
				req.body.email_password,
				req.body.email_sender,
				req.body.email_receiver
			);
			server_message = 'Configuration successfully applied';
			break;

		case 'clear_mai_scope':

			scope_array = [];


			// Deleting mai_scope records recorded previously

			storage = new Storage(

				async function (connection_status) {

					if (connection_status == false)

					{

						console.log('[SETUP CONSOLE] There was an error while connecting to HANA database');

						return callback(null);

					} else {

						console.log('[SETUP CONSOLE] Starting the deletion of MAI scope');

						// ------------------- COMMENTED FOR SAFETY -------------------

						await storage.DeleteAllExtractorItemsFromDB();
						await storage.closeSession();

						console.log('[SETUP CONSOLE] MAI scope database successfully emptied');
					}

				}
			);

			break;

		case 'append_mai_scope':

			storage = new Storage(

				async function (connection_status) {

					if (connection_status == false)

					{

						console.log('[SETUP CONSOLE] There was an error while connecting to HANA database');

						return callback(null);

					} else {

						console.log('[SETUP CONSOLE] Appending current scope');

						copyScopeFromMAIToDB(req.body.tech_scenario, req.body.context_name, req.body.metric_name).then(
							result => {

								console.log('[SETUP CONSOLE] MAI appliance successfully extracted to database');
								server_message = '[SETUP CONSOLE] MAI appliance successfully extracted to database';

							}, error => {
								console.log('[SETUP CONSOLE] ERROR: MAI appliance was not extracted to database');
								server_message = '[SETUP CONSOLE] ERROR: MAI appliance was not extracted to database';

							}

						)
					}

				}
			);

			break;

		case 'get_mai_scope':

			scope_array = [];


			// Deleting mai_scope records recorded previously

			storage = new Storage(

				async function (connection_status) {

					if (connection_status == false)

					{

						console.log('[SETUP CONSOLE] There was an error while connecting to HANA database');

						return callback(null);

					} else {

						console.log('[SETUP CONSOLE] Starting the deletion of MAI scope');

						// ------------------- COMMENTED FOR SAFETY -------------------

						await storage.DeleteAllExtractorItemsFromDB();
						await storage.closeSession();

						console.log('[SETUP CONSOLE] MAI scope database successfully emptied');



						copyScopeFromMAIToDB(req.body.tech_scenario, req.body.context_name, req.body.metric_name).then(
							result => {

								console.log('[SETUP CONSOLE] MAI appliance successfully extracted to database');
								server_message = '[SETUP CONSOLE] MAI appliance successfully extracted to database';

							}, error => {
								console.log('[SETUP CONSOLE] ERROR: MAI appliance was not extracted to database');
								server_message = '[SETUP CONSOLE] ERROR: MAI appliance was not extracted to database';

							}

						)
					}

				}
			);

			break;

		case 'clear_metric_storage':
			deleteSnapshotFromDB().then(
				result => {
					console.log('[SETUP CONSOLE] All snapshots were successfully delete from a database');
					StopCollector();
					collector_state = 'stopped';
					server_message = 'All snapshots were successfully delete from a database and collector stopped';
				}, error => {
					console.log('[SETUP CONSOLE] ERROR: cannot delete snapshots from an internal database');
				});
			break;
	}

	// Redirecting back to / after POST execution

	res.redirect('/');

	//	res.render('index',
	//		renderDataPrepare()
	//	);

});


function renderDataPrepare() {

	var renderData = {};

	// Getting a scope from database

	getMAIScopeFromDB(function (result) {

		var scopeString;

		if (result) {

			if (result.length > 0) {

				scope_array = [];


				for (let i = 0; i < result.length; i++) {

					var addedOnDate = new Date (parseInt(result[i].ADDED_ON_DATE, 10) * 1000);
		
					scopeString = result[i].CONTEXT_NAME + ' | ' +
						result[i].M_SHORT_TEXT.replace(/,/g, '') + ' | ' +
						result[i].MNAME + ' | ' +
						result[i].CONTEXT_ID + ' | ' +
						result[i].EVENT_TYPE_ID + ' | ' +
						result[i].METRIC_THRESHOLD_GREEN_TO_YELLOW + '/' + 	result[i].METRIC_THRESHOLD_YELLOW_TO_RED + ' | ' +		
						addedOnDate.toLocaleString().replace(/,/g,' ');

					scope_array.push(scopeString);
					server_message = 'Successfully received MAI scope from internal database';
					scope_entered = true;

				} // for (let i = 0; i < result.length; i++)

			} else {
				console.log('[RENDER PREP] WARNING: current MAI scope is empty. Try to get full monitoring scope from a backend system. This message always appears at a first run');
				server_message = '[RENDER PREP] WARNING: current MAI scope is empty. Try to get full monitoring scope from a backend system. This message always appears at a first run';

				scope_entered = false;

				scope_array = ['null'];

			}; // if (result.length > 0)

		} else {
			console.log('[RENDER PREP] ERROR: internal database connection error');
			server_message = '[RENDER PREP] ERROR: internal database connection error';
			scope_entered = false;

			scope_array = ['null'];


		} // if (result)

	}); // getMAIScopeFromDB

	renderData = {
		'servertimestamp': serverTime('ISO'),
		'servertime': serverTime('hours_minutes'),
		'collectorstate': collector_state,
		'watchdogstate': watchdog_state,
		'collectorruns': collector_runs,
		'server_message': server_message,
		'screen_connector_timeout': config.cloud_connector.connection_timeout,
		'screen_backend_service_user': config.backend_credentials.service_user,
		'screen_backend_service_password': config.backend_credentials.service_pass,
		'screen_connector_location_id': config.cloud_connector.location_id,
		'screen_get_backend_service': config.odata.backend_service,
		'mai_scope': scope_array,
		'backend_url': config.admin.backend_url,
		'anomality_url': config.admin.anomality_url,
		'autocollect': config.admin.autocollect,
		'autowatchdog': config.admin.autowatchdog,
		'execution_environment': config.execution_environment,
		'email_host': config.email.host,
		'email_port': config.email.port,
		'email_user': config.email.user,
		'email_password': config.email.password,
		'email_sender': config.email.sender,
		'email_receiver': config.email.receiver
	};

	return renderData;

}


app.post('/append_mai_scope', function (req, res) {


	var storage = new Storage(

		async function (connection_status) {

			if (connection_status == false)

			{

				console.log('[SETUP CONSOLE] There was an error while connecting to HANA database');

				return callback(null);

			} else {

				console.log('[SETUP CONSOLE] Appending current scope');

				copyScopeFromMAIToDB(req.body.tech_scenario, req.body.context_name, req.body.metric_name).then(
					result => {

						console.log('[SETUP CONSOLE] MAI appliance successfully extracted to database');
						server_message = '[SETUP CONSOLE] MAI appliance successfully extracted to database';

					}, error => {
						console.log('[SETUP CONSOLE] ERROR: MAI appliance was not extracted to database');
						server_message = '[SETUP CONSOLE] ERROR: MAI appliance was not extracted to database';

					}

				)
			}

		}
	);

	// Redirecting back to / after POST execution

	res.redirect('/');

});
// Function to check empty records in input parameters set
//
//function checkMandatoryFields(fieldsSet) {
//
//	if (((fieldsSet.backend_service !== '') &&
//		(fieldsSet.service_user !== '') &&
//		(fieldsSet.service_password !== '')) &&
//		((fieldsSet.location_id !== '') || (config.execution_environment !== 'BTP')))
//
//	{
//
//		console.log('[FIELDS VALIDATOR] All mandatory parameters are entered');
//		return 0;
//
//	} else
//
//	{
//		console.log('[FIELDS VALIDATOR] Mssing mandatory parameters found');
//		return 1;
//	} // if ((fieldsSet.location_id !== '')
//
//} // function checkMandatoryFields(fieldsSet)

async function copyScopeFromMAIToDB(tech_scenario, context_name, metric_name) {
	let metric_directory = new MAIMetricDirectory(config);
	try {

		let metric_directory_contents = await metric_directory.CopyScopeFromMAIToDB(tech_scenario, context_name, metric_name);


		return metric_directory_contents;

	} catch (e) {
		console.log('[SCOPE INSERTER WRAPPER] copyScopeFromMAIToDB: exception, status put to 404');
		res.status(404).send('Not found');
		return null;
	}

}


function SendTestEmail() {

	var mailOptions = {
		from: config.email.sender,
		to: config.email.receiver,
		subject: 'SAP ML Collector test email',
		text: 'This is a test email from SAP ML Collector'
	}
	transporter.sendMail(mailOptions, function (error, info) {
		if (error) {
			console.log(error);
		} else {
			console.log('Email sent successfully: ' + info.response);
			server_message = 'Test email was sent to ' + email;
		}
	});

}

async function callBackendURL() {
	var backend_url = config.admin.backend_url;
	let metric_directory = new MAIMetricDirectory(config);
	let response = await metric_directory.oDataRequest({
		url: backend_url,
		method: "GET"
	});

	console.log('[BACKEND CALLER] Call to ', backend_url, 'executed with status code ', response.statusCode);

	return response.statusCode;
};

// Contents of a watchdog

async function WatchdogBody() {
	//	var email = config.admin.email;
	var backend_url = config.admin.backend_url;

	console.log('[WATCHDOG] Running mandatory checks');

	try {

		var t0 = performance.now();
		let response_code = await callBackendURL();
		var t1 = performance.now();

		pingTime = (t1 - t0);

		console.log('[WATCHDOG] Backend responsed with ', response_code, ' in ', pingTime, ' ms | collector_start_time = ', collector_start_time, ' | collector.running = ', collector.running);

		// sending an email when backend is again reachable

		if (backend_not_reached == true) {

			//			if (email !== '') {
			//				var mailOptions = {
			//					from: 'cloudextension@hotmail.com',
			//					to: email,
			//					subject: 'SAP ML Collector backend connectivity restored',
			//					text: 'WATCHDOG: SAP ML Collector backend connectivity restored with status ' + response_code
			//				};
			//
			//				transporter.sendMail(mailOptions, function (error, info) {
			//					if (error) {
			//						console.log(error);
			//					} else {
			//						console.log('Email sent successfully: ' + info.response);
			//					}
			//				}); //  transporter.sendMail
			//			}

			backend_not_reached = false;
		}

		if ((collector_start_time > 0) && (collector.running == false)) {
			SelectCollector();
			StartCollector();
			collector_state = 'scheduled every 5 minutes';
			collector_start_time = seconds_since_epoch;

			console.log('[WATCHDOG] Collector restarted with running status = ', collector.running, ' at ', serverTime('ISO'));

			await recordPushLogRecord(0, 998);

			//			if (email !== '') {
			//				var mailOptions = {
			//					from: 'cloudextension@hotmail.com',
			//					to: email,
			//					subject: 'SAP ML Collector restart status:' + collector.running,
			//					text: 'WATCHDOG: collector restarted with running status = ' + collector.running + ' at ' + serverTime('ISO')
			//				};
			//				transporter.sendMail(mailOptions, function (error, info) {
			//					if (error) {
			//						console.log(error);
			//					} else {
			//						console.log('Email sent successfully: ' + info.response);
			//					}
			//				}); //  transporter.sendMail
			//			} else {
			//				console.log('ERROR: Email is not maintained for notifications');
			//			} // if (email !== '')
		} // if ((collector_start_time) && (collector.running == false))


	} catch (e) {

		pingTime = 'N/A'.

		console.log('[WATCHDOG][FAILURE] Backend ', backend_url, ' cannot be reached at ', serverTime('ISO'), '. Check Cloud Connector, network connectivity or backend status. Collector will not be stopped');

		// setting global flag

		await recordPushLogRecord(0, 999);

		//		if ((email !== '') && (backend_not_reached == false)) {
		//
		//			var mailOptions = {
		//				from: 'cloudextension@hotmail.com',
		//				to: email,
		//				subject: 'SAP ML Collector cannot reach backend',
		//				text: 'WATCHDOG: backend ' + backend_url + ' cannot be reached at ' + serverTime('ISO') + '. Check Cloud Connector, network connectivity or backend status. Collector will not be stopped'
		//			};
		//
		//			transporter.sendMail(mailOptions, function (error, info) {
		//				if (error) {
		//					console.log(error);
		//				} else {
		//					console.log('Email sent successfully: ' + info.response);
		//				}
		//			}); // transporter.sendMail
		//
		//		} //  if (email !== '') {

		backend_not_reached = true;

	} // catch (e)

	// Updating availability file

	// UpdateAvailabilityFile('Watchdog');

} //  function WatchdogBody()


function StartHousekeeper() {
	if (housekeeper.running != true) {
		housekeeper.start();
		if (housekeeper.running == true) {
			console.log('[HOUSEKEEPER STARTER] Housekeeper scheduled successfully');
		}
	} else {
		console.log('[HOUSEKEEPER STARTER] Housekeeper already scheduled');
	}
} // StartHousekeeper


function StopHousekeeper() {
	console.log('[HOUSEKEEPER STOPPER] Housekeeper running state: ' + housekeeper.running);
	if (housekeeper.running == true) {
		console.log('[HOUSEKEEPER STOPPER] Stopping the housekeeper');
		housekeeper.stop();
		if (housekeeper.running == false) {
			console.log('[HOUSEKEEPER STOPPER] Housekeeper successfully stopped');
		}
	} else {
		console.log('[HOUSEKEEPER STOPPER] Housekeeper is not scheduled, cannot be stopped');
	}
} // StopHousekeeper


// Body of housekeeper

function HousekeeperBody() {

	var reduction_amount;

	// Leaving last 200 records in push log

	if (collector_runs.length > 200) {

		reduction_amount = collector_runs.length - 200;
		collector_runs.splice(200, reduction_amount);
		console.log('[HOUSEKEEPER] Length of push log reduced to 200');

	}
}

function SelectCollector() {


	console.log('[COLLECTOR SELECTOR] POST collector mode selected');

	collector = new CronJob({
		cronTime: '*/5 * * * *',
		onTick: function () {
			CollectorBody();
		},
		start: false,
	});



} // SelectCollector

function StartCollector() {
	if (collector.running != true) {
		console.log('[COLLECTOR STARTER] Scheduling the collector');
		collector.start();
		if (collector.running == true) {
			console.log('[COLLECTOR STARTER] Collector scheduled successfully');

			if (config.admin.autowatchdog == 'true') {

				console.log('[COLLECTOR STARTER] Calling watchdog to start');
				watchdog_state = 'scheduled every 10 minutes';
				StartWatchdog();

			}

		}
	} else {
		console.log('[COLLECTOR STARTER] Collector already scheduled');
	}
} // StartCollector

function StartWatchdog() {

	const backendURL = config.admin.backend_url;

	if (backendURL !== '') {

		if (watchdog.running != true) {
			watchdog.start();
			if (watchdog.running == true) {
				console.log('[WATCHDOG STARTER] Watchdog scheduled successfully');
			}
		} else {
			console.log('[WATCHDOG STARTER] Watchdog already scheduled');
		}
	} else {
		console.log('[WATCHDOG STARTER] Failed to start watchdog: Availability check URL is not maintained');
	} //  if ( backendURL !== '')



} // StartWatchdog

// Function to stop extractor
function StopCollector() {
	console.log('[COLLECTOR STOPPER] Collector running state: ' + collector.running);
	if (collector.running == true) {
		console.log('[COLLECTOR STOPPER] Stopping the Collector');
		collector.stop();
		if (collector.running == false) {
			console.log('[COLLECTOR STOPPER] Collector successfully stopped');
		}
	} else {
		console.log('[COLLECTOR STOPPER] Collector is not scheduled, cannot be stopped');
	}
} // StopCollector


// Function to stop watchdog

function StopWatchdog() {
	console.log('[WATCHDOG STOPPER] Watchdog running state: ' + watchdog.running);
	if (watchdog.running == true) {
		console.log('[WATCHDOG STOPPER] Stopping the Watchdog');
		watchdog.stop();
		if (watchdog.running == false) {
			console.log('[WATCHDOG STOPPER] Watchdog successfully stopped');
		}
	} else {
		console.log('[WATCHDOG STOPPER] Watchdog is not scheduled, cannot be stopped');
	}
} // StopWatchDog


async function updateAnomality(anomality_update, callTime, backendExecTime) {

	const VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);
	const getTokenUser = VCAP_SERVICES.xsuaa[0].credentials.clientid;
	const getTokenPassword = VCAP_SERVICES.xsuaa[0].credentials.clientsecret;
	const getTokenURL = VCAP_SERVICES.xsuaa[0].credentials.url + '/oauth/token?grant_type=client_credentials';
	const anomalityURL = config.admin.anomality_url;

	// Authorization part : taking tokens

	var getTokenOptions = {
		url: getTokenURL,
		auth: {
			user: getTokenUser,
			password: getTokenPassword
		} // auth
	} // var getTokenOptions

	request(getTokenOptions, function (err, res, body) {

		if (err) {
			console.dir('[AI NEWS PUSHER][ERROR] Failed to get authorization token: ', err);
			return;
		} //if (err)

		// Updating anomaly service

		if (body) {

			const anomalityUpdateAuthorization = JSON.parse(body).token_type + ' ' + JSON.parse(body).access_token;
			request.post({
					uri: anomalityURL,
					headers: {
						'Authorization': anomalityUpdateAuthorization,
						'Content-Type': 'application/json'
					}, // headers
					body: JSON.stringify(anomality_update)
				},

				async function (error, response, body) {

					if (error) {
						
						console.dir('[AI NEWS PUSHER][ERROR] Failed to send update package to ' + anomalityURL + ':' + error);
						
						console.dir('[AI NEWS PUSHER][ERROR] Call headers: ' + headers);
					} //if (err)
					else {

						console.log('[AI NEWS PUSHER] Pushed ', anomality_update.data.length, ' elements');
					} //if (err)

					await updateCounters(anomality_update.data.length);
					await recordPushLogRecord(pushedElements, 0, callTime, backendExecTime);
					await resetCounters();

				} // async function (error, response, body)
			); // request.post
		}

	}); // request(getTokenOptions, function (err, res, body)


} // async function updateAnomality



async function updateCounters(counter) {

	pushedElements = pushedElements + counter;

} // async function updateCounters


async function resetCounters() {

	pushedElements = 0;

} // async function resetCounters



async function collectorRunPeriodCheck() {

	// Double protecion againts Cron bugs to avoid extra collector executions

	var currentTime = new Date();
	var timeDifferenceMS = currentTime.getTime() - last_collector_execution.getTime(); // This will give difference in milliseconds
	var timeDifferenceMin = Math.round(timeDifferenceMS / 60000);

	if (timeDifferenceMin >= 5) {

		last_collector_execution = new Date();

		return true;
	} else {
		return false;
	} // if (timeDifferenceMin >= 5)


} // async function collectorRunPeriodCheck




async function CollectorBody() {

	var collectorTimeHasCome = false;

	collectorTimeHasCome = await collectorRunPeriodCheck();

	if (collectorTimeHasCome === true) {

		console.log('[COLLECTOR] RUN START ON ', serverTime('ISO'));

		getMAIScopeFromDB(async function (result) {


			console.log('[COLLECTOR] MAI scope successfully received from internal database: total ', result.length, ' records');

			if ((result.length > 0)) {


				// Correct part to put to LIVE

				var snapshotRequest = [];

				for (let i = 0; i < result.length; i++) {
					snapshotRequest.push({
						"context_id": result[i].CONTEXT_ID,
						"event_type_id": result[i].EVENT_TYPE_ID,
						"context_name": result[i].CONTEXT_NAME,
						"mname": result[i].MNAME
					});
				}

				var snapshotRequestString = JSON.stringify(snapshotRequest, 0).replace(/"([^"]+)":/g, '$1:');

				await processPostCollectorRequest(snapshotRequestString);

				console.log('[COLLECTOR] RUN END ON ', serverTime('ISO'));


			} //if ((result.length > 0))

		}); // getMAIScopeFromDB(async function (result)

	} // if (collectorTimeHasCome === true)

} // CollectorBody



async function processPostCollectorRequest(snapshotRequest) {


	GetBindedMonitoringSnapshot(parseInt(serverTime('ISO')), snapshotRequest,

		async function (response, callTime, backendExecTime) {

			if ((response) && (response.data.length > 0)) {

				var anomality_update = response;



				// Update of anomality service

				await updateAnomality(anomality_update, callTime, backendExecTime);

			} else

			{
				console.log('[SNAPSHOT SUPPLY WRAPPER] EMPTY RESPONSE: Monitoring data request cannot be prepared');

			} // else

		}); // GetBindedMonitoringSnapshot


} // async function processPostCollectorRequest


async function GetBindedMonitoringSnapshot(odata_call_timestamp, snapshotRequest, callback) {

	var t0 = performance.now();
	var callTime;

	let metric_directory = new MAIMetricDirectory(config);

	await metric_directory.GetBindedMonitoringSnapshot(odata_call_timestamp, snapshotRequest, async function (response) {

		if (response) {

			var t1 = performance.now();

			console.log("[SNAPSHOT SUPPLY WRAPPER] Collector snapshot taken for " + (t1 - t0) + " milliseconds.");

			// Last line contains server information
			// Picking up backend server execution time

			var backendExecTime = response.data[response.data.length - 1].value;
			var backendResponse = response;

			backendResponse.data.splice(-1, 1);

			callTime = (t1 - t0);

			return callback(backendResponse, callTime, backendExecTime);
		} else {
			return callback(null);
		}

	});


}

function serverTime(mode) {
	var current_time = new Date();
	var current_time_ISO = current_time.toISOString().replace(/[^0-9]/g, "").slice(0, -3);
	switch (mode) {
		case 'origin':
			return current_time;
		case 'ISO':
			return current_time_ISO;
		case 'hours_minutes':
			var current_time_hours_minutes = current_time_ISO.substr(8, 2) + ':' + current_time_ISO.substr(10, 2);
			return current_time_hours_minutes;
		case 'hours':
			var current_time_hours = current_time_ISO.substr(8, 2);
			return current_time_hours;
		case 'minutes':
			var current_time_minutes = current_time_ISO.substr(10, 2);
			return current_time_minutes;
		case 'ISOstring':
			current_time = new Date().toISOString().
			replace(/T/, ' '). // replace T with a space
			replace(/\..+/, ''); // delete the dot and everything after
			return current_time;
	}
}

// Current timestamp in seconds
function seconds_since_epoch() {
	return Math.floor(Date.now() / 1000)

}


// Avaialbility file display

app.get('/stat', function (req, res) {

	var fs = require("fs");
	var filename = './src/config/availability.txt';

	fs.readFile(filename, function (err, buf) {
		res.send(buf.toString());
	});


});

// Availability file update

function UpdateAvailabilityFile(event) {

	const fs = require('fs');
	var filename = './src/config/availability.txt';

	var insertString = serverTime('ISOstring') + ' ' + event + '\r\n';

	fs.appendFile(filename, insertString, function (err) {
		if (err) return console.log(err);
		console.log('[AVAILABILITY FILE UPDATER] Availability file updated');

	});

}

//  Update configuration json with values on setup page

function UpdateConfigurationFile(
	backend_service,
	service_user,
	service_password,
	location_id,
	backend_url,
	anomality_url,
	connection_timeout,
	autocollect,
	autowatchdog,
	email_host,
	email_port,
	email_user,
	email_password,
	email_sender,
	email_receiver
) {

	// Setup for file export
	const fs = require('fs');
	var filename = './src/config/internal_config.json';
	var file = require(filename);

	file.odata.backend_service = backend_service;
	file.backend_credentials.service_user = service_user;
	file.backend_credentials.service_pass = service_password;
	file.cloud_connector.location_id = location_id;
	file.admin.backend_url = backend_url;
	file.admin.anomality_url = anomality_url;
	file.cloud_connector.connection_timeout = connection_timeout;
	file.admin.autocollect = autocollect;
	file.admin.autowatchdog = autowatchdog;
	file.email.host = email_host;
	file.email.port = email_port;
	file.email.user = email_user;
	file.email.password = email_password;
	file.email.sender = email_sender;
	file.email.receiver = email_receiver;

	fs.writeFile(filename, JSON.stringify(file, null, 2), function (err) {
		if (err) return console.log(err);
		console.log('[CONFIG FILE UPDATER] Configuration file updated. New contents:', JSON.stringify(file));
		console.log('[CONFIG FILE UPDATER] Writing to ', filename);
	});

} // function UptdateConfigurationFile

async function GetLatestMonitoringSnapshot(odata_call_timestamp, contextIdArray, metricIdArray, contextNameMap, metricNameMap, callback) {

	let metric_directory = new MAIMetricDirectory(config);

	await metric_directory.GetLatestMonitoringSnapshot(odata_call_timestamp, contextIdArray, metricIdArray, contextNameMap, metricNameMap, async function (response) {

		if (response) {

			return callback(response);
		} else {
			return callback(null);
		}

	});


}

async function getSnapshotFromDB(callback) {
	let storage = new Storage(

		async function (connection_status) {


			if (connection_status == false)

			{

				console.log('[SNAPSHOT SUPPLY WRAPPER] There was an error while connecting to HANA database');
				return callback(null);

			} else {


				await storage.GetAllSnapshotsFromDB(async function (response) {

					var result = response;

					console.log('[SNAPSHOT SUPPLY WRAPPER] Received ', result.length, ' records from metric_measured table');

					await storage.closeSession();

					if (result) {
						return callback(result);
					} else {
						return callback(null);
					}
				});

			}

		});

};

async function deleteScopeElements(context_id, event_type_id) {
	let storage = new Storage(

		async function (connection_status) {


			if (connection_status == false)

			{

				console.log('[SCOPE ELEMENTS DELETOR WRAPPER] There was an error while connecting to HANA database');
				return callback(null);
			} else {

				await storage.DeleteScopeElements(context_id, event_type_id, async function () {
					await storage.closeSession();
				});
				return true;
			}

		});

};

async function deleteSnapshotFromDB() {
	let storage = new Storage(

		async function (connection_status) {


			if (connection_status == false)

			{

				console.log('[SNAPSHOTS DB DELETOR WRAPPER] There was an error while connecting to HANA database');
				return callback(null);
			} else {
				await storage.DeleteAllSnapshotsFromDB(async function () {
					await storage.closeSession();
				});
				console.log('[SNAPSHOTS DB DELETOR WRAPPER] All MAI snapshots deleted');
				return true;
			}

		});

}; //async function deleteSnapshotFromDB


app.post('/commitscope', function (req, res) {

	console.log('[SCOPE COMMIT] Scope commit button pressed');
	var deleted_entries = req.body.modifiedScope.slice(0, -1);
	console.log('Array of deleted entries = ', deleted_entries);
	var incoming_array_pairs = deleted_entries.split(',');
	var deleted_context_id;
	var deleted_event_type_id;
	var deleted_event_line;


	if (deleted_entries.length > 0) {

		for (i = 0; i < incoming_array_pairs.length; i++) {
			deleted_event_line = incoming_array_pairs[i].split('|');
			deleted_context_id = deleted_event_line[0];
			deleted_event_type_id = deleted_event_line[1];


			deleteScopeElements(deleted_context_id.replace(/\s/g, ''), deleted_event_type_id.replace(/\s/g, '')).then(
				result => {
					console.log('[SCOPE COMMIT] DELETING RECORD: context_id = ', deleted_context_id.replace(/\s/g, ''), '| deleted event_type_id = ', deleted_event_type_id.replace(/\s/g, ''));

				}, error => {
					console.log('[SCOPE COMMIT] ERROR: cannot delete record from scope database');
					res.redirect(req.get('referer'));
				}); // deleteScopeElements
		}
	} else {
		res.redirect(req.get('referer'));

	}

	res.redirect(req.get('referer'));
});

app.post('/refresh_push', function (req, res) {

	var refresh_push = [];
	var reduction_amount;

	// Leaving last 30 records

	if (collector_runs.length > 30) {

		reduction_amount = collector_runs.length - 30;
		collector_runs.splice(30, reduction_amount);
		console.log('[MANUAL HOUSEKEEPER] Reducing collector_runs=>', collector_runs.length);


	} // if (collector_runs.length > 30)

	res.redirect(req.get('referer'));

}); // app.post('/refresh_push', function (req, res)
