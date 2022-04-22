const ExtractorItem = require('./../src/ExtractorItem');
const config = require('./../src/config/internal_config.json');
const cfenv = require("cfenv");

class Storage {

	constructor(callback) {

		// Environment variables HANA_DB_USER_LOGIN, HANA_DB_USER_PASSWORD and HANA_DB_SCHEMA should be set

		const hdb = require('hdb');
		this.connection_status = false;

		this.schemaName = process.env.HANA_DB_SCHEMA || 'SMART_MONITORING';
		const VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);

		if (config.execution_environment == 'BTP') {

			// HANA Connection parameters for BTP mode

			const hanaServiceName = VCAP_SERVICES['hana-cloud'][0]['name'];
			const appEnv = cfenv.getAppEnv();
			const hanaCredentials = appEnv.getServiceCreds(hanaServiceName);

			this.client = hdb.createClient({
				host: hanaCredentials.host,
				port: hanaCredentials.port,
				user: process.env.HANA_DB_USER_LOGIN,
				password: process.env.HANA_DB_USER_PASSWORD,
				cert: hanaCredentials.certificate
			});

		} else {

			// HANA Connection parameters for XSA mode

			const hanaCredentials = VCAP_SERVICES.hana[0].credentials;

			this.client = hdb.createClient({
				host: hanaCredentials.host,
				port: hanaCredentials.port,
				user: process.env.HANA_DB_USER_LOGIN,
				password: process.env.HANA_DB_USER_PASSWORD,

			});

		} // if (config.execution_environment == 'BTP')


		this.client.on('error', function (err) {
			console.error('[DB INTERFACE] Network connection error during client.on', err);
			return callback(false);
		});


		this.client.connect(function (err) {
			if (err) {
				console.error('[DB INTERFACE] HANA database connection error during client.connect');
				console.error(err);

				return callback(false);
			} else {
				return callback(true);
			}
		});

	} // constructor(callback)

	async InsertExtractorItemToDB(context_id, event_type_id, context_name, mname, metric_threshold_green_to_yellow, metric_threshold_yellow_to_red, short_text, added_on_date) {

		let insertExtractorItem = 'INSERT INTO ' + this.schemaName + '.mai_scope(context_id, event_type_id, context_name, mname, metric_threshold_green_to_yellow, metric_threshold_yellow_to_red, m_short_text, added_on_date) VALUES(' +
			'\'' + context_id + '\'' + ', ' +
			'\'' + event_type_id + '\'' + ', ' +
			'\'' + context_name + '\'' + ', ' +
			'\'' + mname + '\'' + ', ' +
			metric_threshold_green_to_yellow + ', ' +
			metric_threshold_yellow_to_red + ', ' +
			'\'' + short_text + '\'' + ', ' +
			added_on_date + ')';

		return this.exec(insertExtractorItem);

	} // async InsertExtractorItemToDB

	async InsertMetricMeasurementToDB(odata_call_timestamp, context_id, event_type_id, context_name, mname, value_time_stamp, value_time_stamp_unix, value_max, value_min, value_sum, value_count, value_mean) {

		let insertMetricMeasurement = 'INSERT INTO ' + this.schemaName + '.metric_measured(odata_call_timestamp, context_id, event_type_id, context_name, mname, data_collection_timestamp, ' +
			'data_collection_timestamp_unix, metric_sum_value, metric_min_value, metric_max_value, metric_count, metric_value) VALUES(' +
			odata_call_timestamp + ', ' +
			'\'' + context_id + '\'' + ', ' +
			'\'' + event_type_id + '\'' + ', ' +
			'\'' + context_name + '\'' + ', ' +
			'\'' + mname + '\'' + ', ' +
			value_time_stamp + ', ' +
			value_time_stamp_unix + ', ' +
			value_sum + ', ' +
			value_min + ', ' +
			value_max + ', ' +
			value_count + ', ' +
			value_mean + ')';

		return this.exec(insertMetricMeasurement);

	} // async InsertMetricMeasurementToDB

	async GetAllExtractorItemsFromDB(callback) {

		let getAllExtractorItems = 'SELECT * FROM ' + this.schemaName + '.mai_scope';

		this.execsql(getAllExtractorItems, function (response) {

			return callback(response);
		});

	} // async GetAllExtractorItemsFromDB


	async GetDatabaseSize(callback) {


		let getTotalUsed = 'SELECT ROUND(SUM(ESTIMATED_MAX_MEMORY_SIZE_IN_TOTAL)/1024/1024,10) AS SIZE_IN_MB FROM M_CS_TABLES WHERE SCHEMA_NAME = \'' + this.schemaName + '\' AND TABLE_NAME = \'METRIC_MEASURED\''


		this.execsql(getTotalUsed, function (response) {

			return callback(response[0].SIZE_IN_MB);
		});
	} // async GetDatabaseSize

	async GetSnapshotsCount(callback) {

		let getSnapshotsCount = 'SELECT COUNT(*) as count FROM ' + this.schemaName + '.metric_measured'

		this.execsql(getSnapshotsCount, function (response) {


			return callback(response);
		});

	} // async GetSnapshotsCount

	async GetAllSnapshotsFromDB(callback) {

		let getAllSnapshotItems = 'SELECT top 200 odata_call_timestamp, ' +
			this.schemaName + '.metric_measured.context_id, ' +
			this.schemaName + '.metric_measured.event_type_id, ' +
			'data_collection_timestamp, data_collection_timestamp_unix, ' +
			this.schemaName + '.metric_measured.context_name, ' +
			this.schemaName + '.metric_measured.mname, ' +
			'metric_value, metric_threshold_green_to_yellow, metric_threshold_yellow_to_red, metric_sum_value, metric_count, m_short_text FROM ' + this.schemaName + '.metric_measured INNER JOIN ' +
			this.schemaName + '.mai_scope ON ' + this.schemaName + '.metric_measured.context_id = ' + this.schemaName + '.mai_scope.context_id AND ' +
			this.schemaName + '.metric_measured.event_type_id = ' + this.schemaName + '.mai_scope.event_type_id order by ' +
			this.schemaName + '.metric_measured.odata_call_timestamp desc';

		this.execsql(getAllSnapshotItems, function (response) {

			return callback(response);
		});
	} // async GetAllSnapshotsFromDB

	async DeleteAllExtractorItemsFromDB() {

		let deleteAllExtractorItems = 'DELETE FROM ' + this.schemaName + '.mai_scope';

		return this.exec(deleteAllExtractorItems);

	} // async DeleteAllExtractorItemsFromDB



	async DeleteAllSnapshotsFromDB() {

		let deleteAllSnapshotsFromDB = 'DELETE FROM ' + this.schemaName + '.metric_measured';

		return this.exec(deleteAllSnapshotsFromDB);

	} // async DeleteAllSnapshotsFromDB


	async DeleteScopeElements(context_id, event_type_id) {


		console.log('[DB INTERFACE] DELETION FROM SCOPE: context id=', context_id, ' / event_type_id=', event_type_id);

		let DeleteScopeElements = 'DELETE FROM ' + this.schemaName + '.mai_scope WHERE context_id =' +
			'\'' + context_id + '\'' + ' AND event_type_id = ' +
			'\'' + event_type_id + '\''

		return this.exec(DeleteScopeElements);
	} // async DeleteScopeElements


	disconnectSession() {
		this.client.disconnect();
	} // disconnectSession

	closeSession() {
		this.client.end();
		return true;
	} // closeSession


	execsql(statement, callback) {

		//console.log ('STATEMENT: ', statement);

		this.client.exec(statement, function (err, rows) {

			if (err) {
				return console.error('[DB INTERFACE] SQL execution error:', err);
			}

			if (rows.length > 0) {


				return callback(rows);

			} else {
				console.log('[DB INTERFACE] Internal database table does not contain records');
				return callback(0);

			}

		});
	} // execsql

	exec(statement) {

		//	console.log ('STATEMENT: ', statement);

		this.client.exec(statement, function (err) {
			if (err) {
				return console.error('[DB INTERFACE] SQL execution error:', err);
			}


		});

	} // exec
} // class Storage

module.exports = Storage;
