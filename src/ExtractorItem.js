
const Storage 	= require('./../src/Storage');

class ExtractorItem {

	 constructor (context_id, event_type_id, context_name, mname, metric_threshold_green_to_yellow, metric_threshold_yellow_to_red, short_text, added_on_date){

		this.context_id = context_id.replace(/-/g,'');
		this.event_type_id = event_type_id.replace(/-/g,'');
		this.context_name = context_name;
		this.mname = mname;
		this.metric_threshold_green_to_yellow = metric_threshold_green_to_yellow;
		this.metric_threshold_yellow_to_red = metric_threshold_yellow_to_red;
        this.short_text = short_text;
		this.added_on_date = added_on_date;

	} //constructor	

} // ExtractorItem

module.exports = ExtractorItem;
