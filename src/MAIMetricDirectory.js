
const request = require('request');
const MAIObject = require('./../src/MAIObject');
const ExtractorItem = require('./../src/ExtractorItem');
const Storage = require('./../src/Storage');
const MetricMeasurement = require('./../src/MetricMeasurement');

class MAIMetricDirectory extends MAIObject {

	constructor(MAIMetricDirectoryConfig) {
		super();

		this.config = MAIMetricDirectoryConfig;

		this.updated_objects = {
			data: []
		};
	}

	GetConfig() {
		return this.config;
	}

	async CopyScopeFromMAIToDB(tech_scenario, context_name, metric_name) {

		let _this = this;

		let response = await _this.oDataRequest({
			url: _this.config.odata.backend_service,
			serviceQuery: "mai_scope?$filter=TechScenario eq '" + tech_scenario + "' and ContextNameList eq '" + context_name + "' and MetricNameList eq '" + metric_name + "'",
			method: "GET"
		});

		let _managed_object = JSON.parse(response.body).d.results;

		console.log('[SCOPE INSERTER] Received ', _managed_object.length, ' mai_scope records from backend via OData');

		let storage = new Storage(

			async function (connection_status) {

				if (connection_status == false)

				{
					console.error('[SCOPE INSERTER] There was an error while connecting to HANA database');

				} else {

					for (let i = 0; i < _managed_object.length; ++i) {

						// Calculating current timestamp in UTC

						var addedOnDate = Math.floor((new Date()).getTime() / 1000);

						// during mname and short text insertion we need to get rid of special characters except underscore						

						await storage.InsertExtractorItemToDB(
							_managed_object[i].ContextId.replace(/-/g, ''),
							 _managed_object[i].EventTypeId.replace(/-/g, ''),
							  _managed_object[i].ContextName, 
							  _managed_object[i].Mname.replace(/[`~!@#$%^&*|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, ''),
							_managed_object[i].Greentoyellow, 
							_managed_object[i].Yellowtored,
							_managed_object[i].ShortText.replace(/[`~!@#$%^&*|+\-=?;:'",.<>\{\}\[\]\\\/]/gi, ''),
							addedOnDate);

					} // for (let i = 0; i < _managed_object.length; ++i)

					await storage.closeSession();

					return true;


				}
			});

	} // CopyScopeFromMAIToDB


	// Method to fill array of updated objects

	async AddUpdatedObjectToList(context_id, event_type_id, value, timestamp) {

		this.updated_objects.data.push({
			"context_id": context_id,
			"metric_id": event_type_id,
			"value": value,
			"timestamp": timestamp
		});
		return true;
	} // async AddUpdatedObjectToList


	async GetBindedMonitoringSnapshot(odata_call_timestamp, snapshotRequest, callback) {

		var _this = this;

		let response = await _this.oDataRequest({
			url: _this.config.odata.backend_service,
			serviceQuery: "mai_snapshot_request",
			method: "POST",
			body: snapshotRequest
		});

		var _mai_snapshot = JSON.parse(JSON.parse(response.body).d.Response).VALUES;


		var data_collection_timestamp;
		var data_collection_timestamp_unix;
		var metric_mean_value;

		if (_mai_snapshot.length > 0) {

			console.log('[SNAPSHOT SUPPLY] Received ', _mai_snapshot.length, ' metric measurements records from backend via OData');

			let storage = new Storage(

				async function (connection_status) {

					if (connection_status == false)

					{
						console.error('[SNAPSHOT SUPPLY] There was an error while connecting to HANA database');

					} else {

						for (let i = 0; i < _mai_snapshot.length; i++) {

							data_collection_timestamp_unix = _this.abapTimestampToEpoch(_mai_snapshot[i].VALUE_TIMESTAMP.toString());
							metric_mean_value = _mai_snapshot[i].VALUE_SUM / _mai_snapshot[i].VALUE_COUNT;

							// Last line contains server time, it's not written to database

							if (i !== (_mai_snapshot.length - 1)) {

								await storage.InsertMetricMeasurementToDB(odata_call_timestamp,
									_mai_snapshot[i].CONTEXT_ID,
									_mai_snapshot[i].EVENT_TYPE_ID,
									_mai_snapshot[i].CONTEXT_NAME,
									_mai_snapshot[i].MNAME,
									_mai_snapshot[i].VALUE_TIMESTAMP,
									data_collection_timestamp_unix / 1000,
									_mai_snapshot[i].VALUE_MAX,
									_mai_snapshot[i].VALUE_MIN,
									_mai_snapshot[i].VALUE_SUM,
									_mai_snapshot[i].VALUE_COUNT,
									metric_mean_value);

							}

							await _this.AddUpdatedObjectToList(
								_mai_snapshot[i].CONTEXT_ID,
								_mai_snapshot[i].EVENT_TYPE_ID,
								metric_mean_value,
								data_collection_timestamp_unix / 1000
							);

						} // for (let i = 0; i < _mai_snapshot.length; ++i)									

						await storage.closeSession();
						return callback(_this.updated_objects);
					}
				});


		} else {
			console.log('[SNAPSHOT SUPPLY] There are no received metric measurements records from backend via OData');
			return null;
		}

	} // GetBindedMonitoringSnapshot

	parseJsonDate(jsonDateString) {
		return new Date(parseInt(jsonDateString.replace('/Date(', '')));

	} // parseJsonDate(jsonDateString)

	abapTimestampToEpoch(abapTimeStamp) {

		const epochTimeStampBackinUTC = new Date(abapTimeStamp.slice(0, 4), 
			abapTimeStamp.slice(4, 6) - 1, 
  			abapTimeStamp.slice(6, 8),
			abapTimeStamp.slice(8, 10), 
			abapTimeStamp.slice(10, 12), 
			abapTimeStamp.slice(12, 14));

		const epochTimeStampForwardinUTC = 
			  new Date(epochTimeStampBackinUTC.getTime() - (epochTimeStampBackinUTC.getTimezoneOffset() * 60000)).toISOString();

		const epochTimeStamp = new Date(epochTimeStampForwardinUTC);

		return epochTimeStamp.getTime();

	} // abapTimestampToEpoch(abapTimeStamp)

} // class MAIMetricDirectory

module.exports = MAIMetricDirectory;
