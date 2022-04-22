
const Storage = require('./../src/Storage');
const ExtractorItem = require('./../src/ExtractorItem');
const request = require('request');

class MetricMeasurement extends ExtractorItem {

	constructor(odata_call_timestamp, context_id, event_type_id, context_name, mname, value_time_stamp, value_time_stamp_unix, value_max, value_min, value_sum, value_count, value_mean) {

		super(context_id, event_type_id, context_name, mname);

		this.odata_call_timestamp = odata_call_timestamp;
		this.context_id = context_id.replace(/-/g, '');
		this.event_type_id = event_type_id.replace(/-/g, '');
		this.context_name = context_name;
		this.mname = mname;
		this.value_time_stamp = value_time_stamp
		this.value_time_stamp_unix = value_time_stamp_unix
		this.value_max = value_max;
		this.value_min = value_min;
		this.value_sum = value_sum;
		this.value_count = value_count;
		this.value_mean = value_mean;


	} // constructor

	async AddRecordToDB() {

		var _this = this;

		let storage = new Storage(

			async function (connection_status) {


				if (connection_status == false)

				{

					console.log('[SNAPSHOT INSERTER] There was an error while connecting to HANA database');
					
				} else {


					await storage.InsertMetricMeasurementToDB(_this.odata_call_timestamp, _this.context_id, _this.event_type_id, _this.context_name, _this.mname,
						_this.value_time_stamp, _this.value_time_stamp_unix, _this.value_max, _this.value_min, _this.value_sum, _this.value_count, _this.value_mean,
						function () {

							storage.closeSession();

						});

				}

			});
	}

} // MetricMeasurement

module.exports = MetricMeasurement;